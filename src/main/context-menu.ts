import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { PAGE_ACTIONS, TEXT_ACTIONS, type PageAction, type TextAction } from '../shared/ai-prompts';
import { stripTrackingParams } from '../shared/privacy-rules';
import { runMediaAction, type MediaAction } from './media';
import { tr } from '../shared/i18n';

export interface ContextMenuActions {
  openInNewTab(url: string): void;
  saveUrlToDrive(url: string): void;
  savePageToDrive(contents: WebContents): void;
  mailLink(url: string, title: string): void;
  print(contents: WebContents): void;
  savePageAs(contents: WebContents): void;
  viewSource(contents: WebContents): void;
  /** AI actions, offered only when the assistant is enabled. */
  aiEnabled(): boolean;
  askAboutText(action: TextAction, text: string): void;
  askAboutPage(action: PageAction): void;
  /** An Infomaniak account is connected: kDrive and Mail actions are offered. */
  cloudEnabled(): boolean;
  /** Items added by the installed extensions (chrome.contextMenus). */
  extensionItems?(params: Electron.ContextMenuParams): MenuItemConstructorOptions[];
}

/** Right-click menu for web pages, with the cloud actions (when an account is connected) next to the usual browser ones. */
export function attachContextMenu(contents: WebContents, actions: ContextMenuActions): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const link = params.linkURL;
    const isHttp = (u: string) => /^https?:/i.test(u);

    if (link) {
      items.push(
        { label: tr('Apri link in una nuova scheda'), click: () => actions.openInNewTab(link) },
        { label: tr('Copia indirizzo link'), click: () => clipboard.writeText(link) },
        ...(stripTrackingParams(link) ? [{ label: tr('Copia link senza tracciamento'), click: () => clipboard.writeText(stripTrackingParams(link) ?? link) }] : []),
        { label: tr('Salva link con nome…'), click: () => contents.downloadURL(link) },
      );
      if (isHttp(link) && actions.cloudEnabled()) {
        items.push(
          { label: tr('Salva destinazione link su kDrive'), click: () => actions.saveUrlToDrive(link) },
          { label: tr('Invia link via Mail…'), click: () => actions.mailLink(link, params.linkText || link) },
        );
      }
      items.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      const src = params.srcURL;
      items.push(
        { label: tr('Apri immagine in una nuova scheda'), click: () => actions.openInNewTab(src) },
        { label: tr('Salva immagine con nome…'), click: () => contents.downloadURL(src) },
        { label: tr('Copia immagine'), click: () => contents.copyImageAt(params.x, params.y) },
        { label: tr('Copia indirizzo immagine'), click: () => clipboard.writeText(src) },
      );
      if (isHttp(src) && actions.cloudEnabled()) items.push({ label: tr('Salva immagine su kDrive'), click: () => actions.saveUrlToDrive(src) });
      items.push({ type: 'separator' });
    }

    if (params.mediaType === 'video' || params.mediaType === 'audio') {
      const flags = params.mediaFlags;
      const src = params.srcURL;
      const isVideo = params.mediaType === 'video';
      // In the main frame the element under the pointer is found by position (CSS pixels).
      const zoom = contents.getZoomFactor() || 1;
      const target = { src: src || undefined, ...(params.frame === contents.mainFrame ? { x: params.x / zoom, y: params.y / zoom } : {}) };
      const act = (action: MediaAction) => () => void runMediaAction(params.frame, action, target);
      items.push(
        { label: flags.isPaused ? tr('Riproduci') : tr('Pausa'), enabled: !flags.inError, click: act('toggle-play') },
        { label: tr('Audio disattivato'), type: 'checkbox', checked: flags.isMuted, enabled: flags.hasAudio || flags.isMuted, click: act('toggle-mute') },
        { label: tr('Ripeti'), type: 'checkbox', checked: flags.isLooping, enabled: flags.canLoop, click: act('toggle-loop') },
        { label: tr('Mostra i controlli'), type: 'checkbox', checked: flags.isControlsVisible, enabled: flags.canToggleControls, click: act('toggle-controls') },
        {
          label: tr('Velocità di riproduzione'),
          submenu: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => ({ label: r === 1 ? tr('Normale') : `${String(r).replace('.', ',')}×`, click: act(`rate:${r}`) })),
        },
      );
      if (isVideo) {
        items.push({
          label: 'Picture-in-picture',
          type: 'checkbox',
          checked: flags.isShowingPictureInPicture,
          enabled: !flags.inError,
          click: act('toggle-pip'),
        });
      }
      items.push({ type: 'separator' });
      if (isHttp(src)) {
        items.push(
          { label: isVideo ? tr('Apri video in una nuova scheda') : tr('Apri audio in una nuova scheda'), click: () => actions.openInNewTab(src) },
          { label: isVideo ? tr('Salva video con nome…') : tr('Salva audio con nome…'), enabled: flags.canSave, click: () => contents.downloadURL(src) },
          { label: isVideo ? tr('Copia indirizzo del video') : tr('Copia indirizzo dell’audio'), click: () => clipboard.writeText(src) },
          { type: 'separator' },
        );
      }
    }

    if (params.isEditable && params.misspelledWord) {
      const word = params.misspelledWord;
      const suggestions = params.dictionarySuggestions.slice(0, 5);
      if (suggestions.length === 0) items.push({ label: tr('Nessun suggerimento'), enabled: false });
      for (const suggestion of suggestions) items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      items.push(
        { label: tr('Aggiungi «{0}» al dizionario', word), click: () => contents.session.addWordToSpellCheckerDictionary(word) },
        { type: 'separator' },
      );
    }

    if (params.isEditable) {
      items.push(
        { role: 'undo', label: tr('Annulla') },
        { role: 'redo', label: tr('Ripeti') },
        { type: 'separator' },
        { role: 'cut', label: tr('Taglia') },
        { role: 'copy', label: tr('Copia') },
        { role: 'paste', label: tr('Incolla') },
        { role: 'selectAll', label: tr('Seleziona tutto') },
        { type: 'separator' },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: tr('Copia') }, { type: 'separator' });
    }

    const selection = params.selectionText.trim();
    if (selection && actions.aiEnabled()) {
      items.push(
        {
          label: tr('Chiedi all’IA'),
          submenu: (Object.keys(TEXT_ACTIONS) as TextAction[]).map((a) => ({ label: TEXT_ACTIONS[a].label, click: () => actions.askAboutText(a, selection.slice(0, 8000)) })),
        },
        { type: 'separator' },
      );
    }

    if (!link && !params.isEditable && params.mediaType === 'none') {
      const history = contents.navigationHistory;
      items.push(
        { label: tr('Indietro'), enabled: history.canGoBack(), click: () => history.goBack() },
        { label: tr('Avanti'), enabled: history.canGoForward(), click: () => history.goForward() },
        { label: tr('Ricarica'), click: () => contents.reload() },
        { type: 'separator' },
        { label: tr('Salva pagina con nome…'), click: () => actions.savePageAs(contents) },
        { label: tr('Stampa…'), click: () => actions.print(contents) },
        ...(actions.cloudEnabled()
          ? [
              { label: tr('Salva pagina come PDF su kDrive'), click: () => actions.savePageToDrive(contents) },
              { label: tr('Invia pagina via Mail…'), click: () => actions.mailLink(contents.getURL(), contents.getTitle()) },
            ]
          : []),
        ...(actions.aiEnabled() && /^https?:/i.test(contents.getURL())
          ? [{ label: tr('IA: pagina'), submenu: (Object.keys(PAGE_ACTIONS) as PageAction[]).map((a) => ({ label: PAGE_ACTIONS[a].label, click: () => actions.askAboutPage(a) })) }]
          : []),
        { type: 'separator' },
      );
    }

    if (!link && !params.isEditable && params.mediaType === 'none' && /^(https?|file):/i.test(contents.getURL())) {
      items.push({ label: tr('Visualizza sorgente pagina'), click: () => actions.viewSource(contents) });
    }
    const fromExtensions = actions.extensionItems?.(params) ?? [];
    if (fromExtensions.length) items.push(...fromExtensions, { type: 'separator' });
    items.push({ label: tr('Ispeziona'), click: () => contents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup();
  });
}
