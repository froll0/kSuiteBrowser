import type { CalendarEvent, MailOverview } from './types';

export interface Notice {
  title: string;
  body: string;
}

/**
 * Finds new mail between two checks of the inbox. The first check only records what is there:
 * opening the browser never floods you with notifications for mail you already had.
 */
export class MailWatcher {
  private seen: Map<string, number> | null = null;

  reset(): void {
    this.seen = null;
  }

  update(overview: MailOverview): Notice[] {
    const current = new Map(overview.threads.map((t) => [t.uid, t.unseen]));
    const previous = this.seen;
    this.seen = current;
    if (!previous) return [];

    // New unread thread, or more unread messages in a thread (a reply arrived).
    const fresh = overview.threads.filter((t) => t.unseen > 0 && t.unseen > (previous.get(t.uid) ?? 0));
    if (fresh.length === 0) return [];
    if (fresh.length <= 3) {
      return fresh.map((t) => ({ title: `Nuova email da ${t.from || 'mittente sconosciuto'}`, body: t.subject }));
    }
    const subjects = fresh.slice(0, 3).map((t) => `• ${t.subject}`);
    return [{ title: `${fresh.length} nuove email`, body: [...subjects, fresh.length > 3 ? '…' : ''].filter(Boolean).join('\n') }];
  }
}

function time(date: Date): string {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Reminders for events starting soon; each event (and each occurrence of a recurring one) is announced once. */
export class EventReminder {
  private readonly announced = new Map<string, number>();

  due(events: CalendarEvent[], now: number, leadMinutes: number): Notice[] {
    const notices: Notice[] = [];
    for (const e of events) {
      if (e.fullday) continue;
      const start = Date.parse(e.start);
      if (Number.isNaN(start)) continue;
      const key = `${e.id}@${start}`;
      const inWindow = start - leadMinutes * 60_000 <= now && start >= now - 60_000;
      if (!inWindow || this.announced.has(key)) continue;
      this.announced.set(key, start);
      const minutes = Math.max(0, Math.round((start - now) / 60_000));
      notices.push({
        title: minutes === 0 ? `Adesso: ${e.title}` : `Tra ${minutes} min: ${e.title}`,
        body: `${time(new Date(start))} – ${time(new Date(Date.parse(e.end)))}${e.location ? ` · ${e.location}` : ''}`,
      });
    }
    // Forget events that are long past.
    for (const [key, start] of this.announced) if (start < now - 24 * 3600_000) this.announced.delete(key);
    return notices;
  }
}
