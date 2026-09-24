import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { PAGE_ACTIONS, TEXT_ACTIONS, type PageAction, type TextAction } from '../shared/ai-prompts';
import { stripTrackingParams } from '../shared/privacy-rules';
import { runMediaAction, type MediaAction } from './media';

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
}

/** Right-click menu for web pages, with the kSuite actions next to the usual browser ones. */
export function attachContextMenu(contents: WebContents, actions: ContextMenuActions): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const link = params.linkURL;
    const isHttp = (u: string) => /^https?:/i.test(u);

    if (link) {
      items.push(
        { label: 'Apri link in una nuova scheda', click: () => actions.openInNewTab(link) },
        { label: 'Copia indirizzo link', click: () => clipboard.writeText(link) },
        ...(stripTrackingParams(link) ? [{ label: 'Copia link senza tracciamento', click: () => clipboard.writeText(stripTrackingParams(link) ?? link) }] : []),
        { label: 'Salva link con nome…', click: () => contents.downloadURL(link) },
      );
      if (isHttp(link)) {
        items.push(
          { label: 'Salva destinazione link su kDrive', click: () => actions.saveUrlToDrive(link) },
          { label: 'Invia link via Mail…', click: () => actions.mailLink(link, params.linkText || link) },
        );
      }
      items.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      const src = params.srcURL;
      items.push(
        { label: 'Apri immagine in una nuova scheda', click: () => actions.openInNewTab(src) },
        { label: 'Salva immagine con nome…', click: () => contents.downloadURL(src) },
        { label: 'Copia immagine', click: () => contents.copyImageAt(params.x, params.y) },
        { label: 'Copia indirizzo immagine', click: () => clipboard.writeText(src) },
      );
      if (isHttp(src)) items.push({ label: 'Salva immagine su kDrive', click: () => actions.saveUrlToDrive(src) });
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
        { label: flags.isPaused ? 'Riproduci' : 'Pausa', enabled: !flags.inError, click: act('toggle-play') },
        { label: 'Audio disattivato', type: 'checkbox', checked: flags.isMuted, enabled: flags.hasAudio || flags.isMuted, click: act('toggle-mute') },
        { label: 'Ripeti', type: 'checkbox', checked: flags.isLooping, enabled: flags.canLoop, click: act('toggle-loop') },
        { label: 'Mostra i controlli', type: 'checkbox', checked: flags.isControlsVisible, enabled: flags.canToggleControls, click: act('toggle-controls') },
        {
          label: 'Velocità di riproduzione',
          submenu: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => ({ label: r === 1 ? 'Normale' : `${String(r).replace('.', ',')}×`, click: act(`rate:${r}`) })),
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
          { label: `Apri ${isVideo ? 'video' : 'audio'} in una nuova scheda`, click: () => actions.openInNewTab(src) },
          { label: `Salva ${isVideo ? 'video' : 'audio'} con nome…`, enabled: flags.canSave, click: () => contents.downloadURL(src) },
          { label: `Copia indirizzo ${isVideo ? 'del video' : 'dell’audio'}`, click: () => clipboard.writeText(src) },
          { type: 'separator' },
        );
      }
    }

    if (params.isEditable && params.misspelledWord) {
      const word = params.misspelledWord;
      const suggestions = params.dictionarySuggestions.slice(0, 5);
      if (suggestions.length === 0) items.push({ label: 'Nessun suggerimento', enabled: false });
      for (const suggestion of suggestions) items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      items.push(
        { label: `Aggiungi «${word}» al dizionario`, click: () => contents.session.addWordToSpellCheckerDictionary(word) },
        { type: 'separator' },
      );
    }

    if (params.isEditable) {
      items.push(
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: 'Copia' }, { type: 'separator' });
    }

    const selection = params.selectionText.trim();
    if (selection && actions.aiEnabled()) {
      items.push(
        {
          label: 'Chiedi all’IA',
          submenu: (Object.keys(TEXT_ACTIONS) as TextAction[]).map((a) => ({ label: TEXT_ACTIONS[a].label, click: () => actions.askAboutText(a, selection.slice(0, 8000)) })),
        },
        { type: 'separator' },
      );
    }

    if (!link && !params.isEditable && params.mediaType === 'none') {
      const history = contents.navigationHistory;
      items.push(
        { label: 'Indietro', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Avanti', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Ricarica', click: () => contents.reload() },
        { type: 'separator' },
        { label: 'Salva pagina con nome…', click: () => actions.savePageAs(contents) },
        { label: 'Stampa…', click: () => actions.print(contents) },
        { label: 'Salva pagina come PDF su kDrive', click: () => actions.savePageToDrive(contents) },
        { label: 'Invia pagina via Mail…', click: () => actions.mailLink(contents.getURL(), contents.getTitle()) },
        ...(actions.aiEnabled() && /^https?:/i.test(contents.getURL())
          ? [{ label: 'IA: pagina', submenu: (Object.keys(PAGE_ACTIONS) as PageAction[]).map((a) => ({ label: PAGE_ACTIONS[a].label, click: () => actions.askAboutPage(a) })) }]
          : []),
        { type: 'separator' },
      );
    }

    if (!link && !params.isEditable && params.mediaType === 'none' && /^(https?|file):/i.test(contents.getURL())) {
      items.push({ label: 'Visualizza sorgente pagina', click: () => actions.viewSource(contents) });
    }
    items.push({ label: 'Ispeziona', click: () => contents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup();
  });
}
