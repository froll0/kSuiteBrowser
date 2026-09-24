import { API_BASE, type InfomaniakClient } from './client';

export interface Contact {
  id: string;
  name: string;
  emails: string[];
}

interface RawContact {
  id: number | string;
  name?: string;
  firstname?: string;
  lastname?: string;
  emails?: Array<string | { value?: string; address?: string; email?: string }>;
}

export async function listContacts(client: InfomaniakClient): Promise<Contact[]> {
  const raw = (await client.get<RawContact[]>(`${API_BASE}/1/calendar/pim/contact/all?with=emails`)) ?? [];
  return raw.map((c) => ({
    id: String(c.id),
    name: c.name?.trim() || [c.firstname, c.lastname].filter(Boolean).join(' ') || '',
    emails: (c.emails ?? []).map((e) => (typeof e === 'string' ? e : (e.value ?? e.address ?? e.email ?? ''))).filter(Boolean),
  }));
}
