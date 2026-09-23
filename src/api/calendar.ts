import type { CalendarEvent, NewEvent } from '../shared/types';
import { API_BASE, InfomaniakApiError, type InfomaniakClient } from './client';

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

export async function upcomingEvents(client: InfomaniakClient, from: Date, to: Date): Promise<CalendarEvent[]> {
  const calendars = await listCalendars(client);
  const lists = await Promise.all(
    calendars.map(async (cal) => {
      const params = new URLSearchParams({ calendar_id: String(cal.id), from: toApiDate(from), to: toApiDate(to) });
      return (await client.get<RawEvent[]>(`${API_BASE}/1/calendar/pim/event?${params}`)) ?? [];
    }),
  );
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const e of lists.flat()) {
    const key = `${e.id}@${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: String(e.id),
      title: e.title || '(senza titolo)',
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
  if (!calendar) throw new InfomaniakApiError('Nessun calendario disponibile.', 404);
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new InfomaniakApiError('Date dell’evento non valide.', 400);
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
