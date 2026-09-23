import { describe, expect, it } from 'vitest';
import { EventReminder, MailWatcher } from '../src/shared/notify-logic';
import type { CalendarEvent, MailOverview, MailThread } from '../src/shared/types';

const thread = (uid: string, unseen: number, subject = `Oggetto ${uid}`, from = 'Bob'): MailThread => ({ uid, subject, from, date: '', preview: '', unseen });
const inbox = (...threads: MailThread[]): MailOverview => ({ mailbox: { uuid: 'm', email: 'a@ik.me' }, inboxUnread: threads.reduce((n, t) => n + t.unseen, 0), threads });

describe('MailWatcher', () => {
  it('stays quiet on the first check', () => {
    const w = new MailWatcher();
    expect(w.update(inbox(thread('1', 2), thread('2', 0)))).toEqual([]);
  });

  it('announces new unread mail and replies, not mail already seen or read', () => {
    const w = new MailWatcher();
    w.update(inbox(thread('1', 1), thread('2', 0)));
    expect(w.update(inbox(thread('3', 1, 'Fattura', 'Anna'), thread('1', 1), thread('2', 0)))).toEqual([
      { title: 'Nuova email da Anna', body: 'Fattura' },
    ]);
    expect(w.update(inbox(thread('3', 1), thread('1', 2, 'Re: progetto'), thread('2', 0)))).toEqual([
      { title: 'Nuova email da Bob', body: 'Re: progetto' },
    ]);
    // Reading mail never notifies.
    expect(w.update(inbox(thread('3', 0), thread('1', 0), thread('2', 0)))).toEqual([]);
  });

  it('groups many new messages in one notification', () => {
    const w = new MailWatcher();
    w.update(inbox());
    const notices = w.update(inbox(thread('a', 1), thread('b', 1), thread('c', 1), thread('d', 1), thread('e', 1)));
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('5 nuove email');
    expect(notices[0].body.split('\n')).toHaveLength(4);
  });

  it('starts over after reset (e.g. another account)', () => {
    const w = new MailWatcher();
    w.update(inbox());
    w.reset();
    expect(w.update(inbox(thread('x', 1)))).toEqual([]);
  });
});

describe('EventReminder', () => {
  const now = Date.parse('2026-09-24T09:00:00Z');
  const ev = (id: string, startMin: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id,
    title: `Riunione ${id}`,
    start: new Date(now + startMin * 60_000).toISOString(),
    end: new Date(now + (startMin + 30) * 60_000).toISOString(),
    fullday: false,
    location: null,
    ...extra,
  });

  it('reminds once, within the lead time', () => {
    const r = new EventReminder();
    const events = [ev('a', 8, { location: 'Sala 2' }), ev('b', 25), ev('c', -10), ev('d', 5, { fullday: true })];
    const first = r.due(events, now, 10);
    expect(first.map((n) => n.title)).toEqual(['Tra 8 min: Riunione a']);
    expect(first[0].body).toMatch(/· Sala 2$/);
    expect(r.due(events, now + 60_000, 10)).toEqual([]);
    expect(r.due(events, now + 16 * 60_000, 10).map((n) => n.title)).toEqual(['Tra 9 min: Riunione b']);
  });

  it('says "now" for events starting this minute', () => {
    expect(new EventReminder().due([ev('n', 0)], now, 10)[0].title).toBe('Adesso: Riunione n');
  });

  it('treats each occurrence of a recurring event separately', () => {
    const r = new EventReminder();
    expect(r.due([ev('rec', 5)], now, 10)).toHaveLength(1);
    expect(r.due([ev('rec', 5 + 24 * 60)], now + 24 * 3600_000, 10)).toHaveLength(1);
  });
});
