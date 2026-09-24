import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { PAGE_ACTIONS, TEXT_ACTIONS, type PageAction, type TextAction } from '../shared/ai-prompts';

export interface ContextMenuActions {
  openInNewTab(url: string): void;
  saveUrlToDrive(url: string): void;
  savePageToDrive(contents: WebContents): void;
  mailLink(url: string, title: string): void;
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
        { label: 'Copia immagine', click: () => contents.copyImageAt(params.x, params.y) },
      );
      if (isHttp(src)) items.push({ label: 'Salva immagine su kDrive', click: () => actions.saveUrlToDrive(src) });
      items.push({ type: 'separator' });
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
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
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
        { label: 'Salva pagina come PDF su kDrive', click: () => actions.savePageToDrive(contents) },
        { label: 'Invia pagina via Mail…', click: () => actions.mailLink(contents.getURL(), contents.getTitle()) },
        ...(actions.aiEnabled() && /^https?:/i.test(contents.getURL())
          ? [{ label: 'IA: pagina', submenu: (Object.keys(PAGE_ACTIONS) as PageAction[]).map((a) => ({ label: PAGE_ACTIONS[a].label, click: () => actions.askAboutPage(a) })) }]
          : []),
        { type: 'separator' },
      );
    }

    items.push({ label: 'Ispeziona', click: () => contents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup();
  });
}
