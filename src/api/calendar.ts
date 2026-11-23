import type { CalendarEvent, NewEvent } from '../shared/types';
import { API_BASE, InfomaniakApiError, type InfomaniakClient } from './client';
import { tr } from '../shared/i18n';

interface RawCalendar {
  id: number | string;
  name?: string;
  default?: boolean;
}

interface RawEvent {
  id: number | string;
  title?: string;
  start: string;
  end: string;
  fullday?: boolean;
  location?: string | null;
}

/** The PIM API expects "YYYY-MM-DD HH:mm:ss" in UTC. */
export function toApiDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export async function listCalendars(client: InfomaniakClient): Promise<RawCalendar[]> {
  const data = await client.get<{ calendars?: RawCalendar[] }>(`${API_BASE}/1/calendar/pim/calendar`);
  return data?.calendars ?? [];
}

/**
 * Ways of writing the from/to of an event query. The calendar API isn't publicly documented: when it
 * refuses one (422), the next is tried, and the one that worked is kept for the next queries.
 */
const RANGE_FORMATS: Array<(d: Date) => string> = [
  toApiDate,
  (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
  (d) => d.toISOString().slice(0, 10),
];
let rangeFormat = 0;

/** Back to the first format (tests). */
export function resetRangeFormat(): void {
  rangeFormat = 0;
}

async function eventsOf(client: InfomaniakClient, calendarId: string, from: Date, to: Date): Promise<RawEvent[]> {
  let firstError: unknown = null;
  for (let i = 0; i < RANGE_FORMATS.length; i++) {
    const n = (rangeFormat + i) % RANGE_FORMATS.length;
    const params = new URLSearchParams({ calendar_id: calendarId, from: RANGE_FORMATS[n](from), to: RANGE_FORMATS[n](to) });
    try {
      const list = (await client.get<RawEvent[] | { events?: RawEvent[] }>(`${API_BASE}/1/calendar/pim/event?${params}`)) ?? [];
      rangeFormat = n;
      return Array.isArray(list) ? list : (list.events ?? []);
    } catch (err) {
      firstError ??= err;
      if (!(err instanceof InfomaniakApiError) || err.status !== 422) throw err;
    }
  }
  throw firstError;
}

export async function upcomingEvents(client: InfomaniakClient, from: Date, to: Date): Promise<CalendarEvent[]> {
  const calendars = await listCalendars(client);
  // Some calendars (subscriptions, shared ones) can refuse the query: skip them unless all fail.
  const results = await Promise.allSettled(calendars.map((cal) => eventsOf(client, String(cal.id), from, to)));
  const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (lists.length === 0 && firstFailure) throw firstFailure.reason;
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const e of lists.flat()) {
    const key = `${e.id}@${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: String(e.id),
      title: e.title || tr('(senza titolo)'),
      start: e.start,
      end: e.end,
      fullday: Boolean(e.fullday),
      location: e.location ?? null,
    });
  }
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export async function createEvent(client: InfomaniakClient, event: NewEvent, timezone: string | null): Promise<void> {
  const calendars = await listCalendars(client);
  const calendar = calendars.find((c) => c.default) ?? calendars[0];
  if (!calendar) throw new InfomaniakApiError(tr('Nessun calendario disponibile.'), 404);
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new InfomaniakApiError(tr('Date dell’evento non valide.'), 400);
  }
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  await client.send('POST', `${API_BASE}/1/calendar/pim/event`, {
    title: event.title,
    start: toApiDate(start),
    end: toApiDate(end),
    description: event.description ?? '',
    freebusy: 'busy',
    type: 'event',
    calendar_id: calendar.id,
    fullday: false,
    timezone_start: tz,
    timezone_end: tz,
    attendees: [],
  });
}
