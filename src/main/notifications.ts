import { Notification } from 'electron';
import { EventReminder, MailWatcher, type Notice } from '../shared/notify-logic';
import type { CalendarEvent } from '../shared/types';
import type { KSuiteServices } from './services';
import type { SettingsStore } from './settings';

const MAIL_EVERY_MS = 2 * 60_000;
const EVENTS_EVERY_MS = 5 * 60_000;
const REMINDER_TICK_MS = 30_000;

export interface NotificationHooks {
  /** Opens a kSuite app (mail, calendar) in a browser window. */
  openApp(appId: string): void;
  /** Unread count of the inbox, for the sidebar badge (null when unknown). */
  onUnread(count: number | null): void;
}

/** Desktop notifications for new mail and upcoming events, from periodic checks of the kSuite APIs. */
export class NotificationCenter {
  private readonly mail = new MailWatcher();
  private readonly reminders = new EventReminder();
  private events: CalendarEvent[] = [];
  private readonly shown = new Set<Notification>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly settings: SettingsStore,
    private readonly services: KSuiteServices,
    private readonly hooks: NotificationHooks,
  ) {}

  start(): void {
    this.timers.push(
      setTimeout(() => void this.checkMail(), 5_000),
      setInterval(() => void this.checkMail(), MAIL_EVERY_MS),
      setTimeout(() => void this.refreshEvents(), 8_000),
      setInterval(() => void this.refreshEvents(), EVENTS_EVERY_MS),
      setInterval(() => this.remind(), REMINDER_TICK_MS),
    );
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Call when the account changes: start again without announcing the existing mail. */
  reset(): void {
    this.mail.reset();
    this.events = [];
    this.hooks.onUnread(null);
    void this.checkMail();
    void this.refreshEvents();
  }

  /** Test notification from the settings page. */
  test(): boolean {
    return this.show({ title: 'Notifiche di kSuite Browser attive', body: 'Riceverai qui le nuove email e i promemoria degli eventi.' }, null);
  }

  private get ready(): boolean {
    return this.settings.tokenStatus().configured;
  }

  private async checkMail(): Promise<void> {
    if (!this.ready) return;
    try {
      const overview = await this.services.mailOverview();
      this.hooks.onUnread(overview.inboxUnread);
      const notices = this.mail.update(overview);
      if (this.settings.get().notifyMail) for (const n of notices) this.show(n, 'mail');
    } catch {
      // Offline or missing scope: try again at the next check, without bothering the user.
    }
  }

  private async refreshEvents(): Promise<void> {
    if (!this.ready || !this.settings.get().notifyEvents) return;
    try {
      this.events = await this.services.upcomingEvents(2);
      this.remind();
    } catch {
      /* next time */
    }
  }

  private remind(): void {
    const s = this.settings.get();
    if (!this.ready || !s.notifyEvents || this.events.length === 0) return;
    for (const n of this.reminders.due(this.events, Date.now(), s.eventReminderMinutes)) this.show(n, 'calendar');
  }

  private show(notice: Notice, appId: string | null): boolean {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: notice.title, body: notice.body });
    // Keep a reference until the notification goes away, otherwise its click handler can be collected.
    this.shown.add(n);
    const forget = () => this.shown.delete(n);
    n.on('click', () => {
      forget();
      if (appId) this.hooks.openApp(appId);
    });
    n.on('close', forget);
    n.show();
    return true;
  }
}
