import { Menu, ipcMain, safeStorage, type IpcMainEvent, type IpcMainInvokeEvent, type WebFrameMain } from 'electron';
import { keychainAvailable } from '../keychain';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc';
import { generatePassword } from '../../shared/password-gen';
import { siteOf } from '../../shared/privacy-rules';
import type { PasswordPrompt } from '../../shared/types';
import type { SettingsStore } from '../settings';
import type { BrowserWindowController } from '../window';
import { originOf, Vault } from './vault';

const AUTO_LOCK_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

interface Pending {
  prompt: PasswordPrompt;
  password: string;
  window: BrowserWindowController;
  createdAt: number;
}

interface TabRef {
  window: BrowserWindowController;
  tabId: number;
}

/** Filling forms is only offered on secure pages (and local development servers). */
function secureOrigin(origin: string): boolean {
  return origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Saving, filling and generating passwords in web pages, on top of the encrypted vault. */
export class PasswordManager {
  readonly vault: Vault;
  private readonly pending = new Map<string, Pending>();
  /** Save waiting for the primary password to be entered. */
  private saveAfterUnlock: string | null = null;
  private lastUse = Date.now();
  private setupHintShown = false;

  constructor(
    userData: string,
    private readonly settings: SettingsStore,
    private readonly findTab: (frame: WebFrameMain | null | undefined, sender: Electron.WebContents) => TabRef | null,
  ) {
    this.vault = new Vault(join(userData, 'passwords.json'), {
      available: keychainAvailable,
      encrypt: (b) => safeStorage.encryptString(b.toString('base64')),
      decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'base64'),
    });
    setInterval(() => this.autoLock(), 60_000).unref();
  }

  touch(): void {
    this.lastUse = Date.now();
  }

  private autoLock(): void {
    if (this.vault.status().hasPrimary && this.vault.status().state === 'unlocked' && Date.now() - this.lastUse > AUTO_LOCK_MS) this.vault.lock();
    for (const [id, p] of this.pending) if (Date.now() - p.createdAt > PENDING_TTL_MS) this.pending.delete(id);
  }

  /** Origin and tab of a message coming from a page frame; null for anything that is not a web page tab. */
  private context(event: IpcMainEvent | IpcMainInvokeEvent): { origin: string; frame: WebFrameMain; tab: TabRef } | null {
    const frame = event.senderFrame;
    const origin = frame ? originOf(frame.url) : null;
    const tab = this.findTab(frame, event.sender);
    if (!frame || !origin || !tab) return null;
    return { origin, frame, tab };
  }

  register(): void {
    // Autofill on page load: main frame, secure page, exactly one saved login, never in private windows.
    ipcMain.handle('pw:page', (event) => {
      const ctx = this.context(event);
      if (!ctx || ctx.frame !== event.sender.mainFrame || ctx.tab.window.isPrivate) return null;
      if (!this.settings.get().autofillPasswords || !secureOrigin(ctx.origin) || !this.vault.tryAutoUnlock()) return null;
      const logins = this.vault.forOrigin(ctx.origin);
      if (logins.length !== 1) return null;
      this.touch();
      this.vault.markUsed(logins[0].id);
      return { username: logins[0].username, password: logins[0].password };
    });

    ipcMain.handle('pw:field-click', (event, info: { newPassword?: boolean }) => {
      const ctx = this.context(event);
      if (ctx) this.showFieldMenu(ctx, Boolean(info?.newPassword));
    });

    ipcMain.on('pw:submit', (event, data: { username?: unknown; password?: unknown }) => {
      const ctx = this.context(event);
      if (!ctx || ctx.tab.window.isPrivate || !this.settings.get().offerToSavePasswords) return;
      const username = typeof data?.username === 'string' ? data.username.slice(0, 512) : '';
      const password = typeof data?.password === 'string' ? data.password.slice(0, 1024) : '';
      if (!password) return;
      this.offerSave(ctx.tab, ctx.origin, username, password);
    });
  }

  private showFieldMenu(ctx: { origin: string; frame: WebFrameMain; tab: TabRef }, newPassword: boolean): void {
    const { origin, frame, tab } = ctx;
    const fill = (data: { username?: string; password: string; generated?: boolean }) => {
      // The frame may have navigated meanwhile: only fill the origin the login belongs to.
      if (!frame.isDestroyed() && originOf(frame.url) === origin) frame.send('pw:fill', data);
    };
    const items: Electron.MenuItemConstructorOptions[] = [];
    const status = this.vault.status();
    const unlocked = this.vault.tryAutoUnlock();

    if (!unlocked && status.state === 'locked') {
      items.push({ label: 'Sblocca le password salvate…', click: () => tab.window.send(IPC.evPasswordUnlock, { reason: 'fill' }) });
    } else if (unlocked) {
      const logins = this.vault.forOrigin(origin);
      const insecure = secureOrigin(origin) ? '' : ' (connessione non sicura)';
      for (const login of logins) {
        items.push({
          label: `${login.username || '(senza nome utente)'}${insecure}`,
          click: () => {
            this.touch();
            this.vault.markUsed(login.id);
            fill({ username: login.username, password: login.password });
          },
        });
      }
      const site = siteOf(origin);
      const related = this.vault.list().filter((l) => l.origin !== origin && site && siteOf(l.origin) === site);
      if (related.length) {
        items.push({
          label: `Altri accessi per ${site}`,
          submenu: related.map((l) => ({
            label: `${l.username || '(senza nome utente)'} — ${new URL(l.origin).host}`,
            click: () => {
              this.touch();
              this.vault.markUsed(l.id);
              fill({ username: l.username, password: l.password });
            },
          })),
        });
      }
    }
    if (newPassword) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Suggerisci una password sicura', click: () => fill({ password: generatePassword(), generated: true }) });
    }
    if (items.length === 0) return;
    items.push({ type: 'separator' }, { label: 'Gestisci password…', click: () => tab.window.openInternal('ksuite://passwords/') });
    Menu.buildFromTemplate(items).popup({ window: tab.window.win });
  }

  private offerSave(tab: TabRef, origin: string, username: string, password: string): void {
    const status = this.vault.status();
    if (status.state === 'needs-setup') {
      if (!this.setupHintShown) {
        this.setupHintShown = true;
        tab.window.send(IPC.evToast, { kind: 'info', message: 'Per salvare le password imposta una password principale (Impostazioni › Password).' });
      }
      return;
    }
    let kind: PasswordPrompt['kind'] = 'save';
    if (this.vault.tryAutoUnlock()) {
      if (this.vault.isNever(origin)) return;
      const existing = this.vault.forOrigin(origin).find((l) => l.username === username);
      if (existing && existing.password === password) {
        this.vault.markUsed(existing.id);
        return;
      }
      if (existing) kind = 'update';
    }
    // One prompt per tab: a new submission replaces the previous one.
    for (const [id, p] of this.pending) if (p.prompt.tabId === tab.tabId && p.window === tab.window) this.pending.delete(id);
    const prompt: PasswordPrompt = { id: randomUUID(), tabId: tab.tabId, origin, username, kind };
    this.pending.set(prompt.id, { prompt, password, window: tab.window, createdAt: Date.now() });
    tab.window.send(IPC.evPasswordPrompt, prompt);
  }

  /** Answer from the save bar of the browser UI. */
  answer(window: BrowserWindowController, id: string, action: 'save' | 'never' | 'dismiss', username?: string): void {
    const p = this.pending.get(id);
    if (!p || p.window !== window) return;
    if (action === 'dismiss') {
      this.pending.delete(id);
      return;
    }
    if (!this.vault.tryAutoUnlock()) {
      this.saveAfterUnlock = id;
      if (typeof username === 'string') p.prompt.username = username;
      if (action === 'never') p.prompt.kind = 'save';
      (p as Pending & { action?: string }).action = action;
      window.send(IPC.evPasswordUnlock, { reason: 'save' });
      return;
    }
    this.pending.delete(id);
    this.touch();
    if (action === 'never') {
      this.vault.setNever(p.prompt.origin, true);
    } else {
      this.vault.save(p.prompt.origin, typeof username === 'string' ? username.trim() : p.prompt.username, p.password);
      window.send(IPC.evToast, { kind: 'success', message: p.prompt.kind === 'update' ? 'Password aggiornata' : 'Password salvata' });
    }
  }

  /** Primary password entered in the browser UI unlock bar. */
  async unlock(window: BrowserWindowController, primary: string): Promise<void> {
    await this.vault.unlock(primary);
    this.touch();
    const id = this.saveAfterUnlock;
    this.saveAfterUnlock = null;
    const p = id ? (this.pending.get(id) as (Pending & { action?: 'save' | 'never' }) | undefined) : undefined;
    if (id && p) this.answer(window, id, p.action ?? 'save', p.prompt.username);
    else window.send(IPC.evToast, { kind: 'success', message: 'Password sbloccate: clicca di nuovo nel campo di accesso.' });
  }
}
