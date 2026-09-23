import type { Profile } from '../shared/types';
import { API_BASE, type InfomaniakClient } from './client';

interface RawProfile {
  id?: number;
  user_id?: number;
  display_name?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  login?: string;
  avatar?: string | null;
  preferences?: { timezone?: { name?: string } };
}

export async function getProfile(client: InfomaniakClient): Promise<Profile> {
  const p = await client.get<RawProfile>(`${API_BASE}/2/profile`);
  const name = p.display_name || [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || '';
  return {
    id: p.user_id ?? p.id ?? 0,
    displayName: name,
    email: p.email ?? p.login ?? '',
    avatar: p.avatar ?? null,
    timezone: p.preferences?.timezone?.name ?? null,
  };
}
