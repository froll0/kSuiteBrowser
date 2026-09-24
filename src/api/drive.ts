import type { Drive, DriveFile, DriveListing } from '../shared/types';
import { API_BASE, InfomaniakApiError, type InfomaniakClient } from './client';

/** Direct (single request) uploads are meant for reasonably small files. */
export const MAX_DIRECT_UPLOAD_BYTES = 1024 * 1024 * 1024;

interface RawFile {
  id: number;
  name: string;
  type: string;
  size?: number | null;
  last_modified_at?: number | null;
  mime_type?: string | null;
  parent_id?: number | null;
}

export function mapFile(f: RawFile): DriveFile {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    size: f.size ?? null,
    lastModified: f.last_modified_at ?? null,
    mimeType: f.mime_type ?? null,
    parentId: f.parent_id ?? null,
  };
}

/** Drives of the user, as the kDrive apps load them (`/2/drive` alone requires an account_id). */
export async function listDrives(client: InfomaniakClient): Promise<Drive[]> {
  const data = await client.get<{ drives?: Array<{ id: number; name: string; in_maintenance?: boolean }> }>(
    `${API_BASE}/2/drive/init?with=drives`,
  );
  return (data?.drives ?? []).map((d) => ({ id: d.id, name: d.name }));
}

export async function listDirectory(
  client: InfomaniakClient,
  driveId: number,
  directoryId: number,
  cursor?: string | null,
): Promise<DriveListing> {
  // Sorting syntax of the kDrive API: order_by=<field>&order_for[<field>]=<asc|desc>.
  const params = new URLSearchParams({ limit: '100', order_by: 'name', 'order_for[name]': 'asc' });
  if (cursor) params.set('cursor', cursor);
  const env = await client.request<RawFile[]>(`${API_BASE}/3/drive/${driveId}/files/${directoryId}/files?${params}`);
  return { files: foldersFirst((env.data ?? []).map(mapFile)), cursor: env.cursor ?? null, hasMore: Boolean(env.has_more) };
}

/** Stable sort that keeps the API order (by name) but lists folders before files. */
export function foldersFirst(files: DriveFile[]): DriveFile[] {
  return [...files].sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir'));
}

export async function getFile(client: InfomaniakClient, driveId: number, fileId: number): Promise<DriveFile> {
  return mapFile(await client.get<RawFile>(`${API_BASE}/3/drive/${driveId}/files/${fileId}`));
}

export async function searchFiles(client: InfomaniakClient, driveId: number, query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({ query, limit: '50' });
  const files = await client.get<RawFile[]>(`${API_BASE}/3/drive/${driveId}/files/search?${params}`);
  return (files ?? []).map(mapFile);
}

export async function downloadFile(client: InfomaniakClient, driveId: number, fileId: number): Promise<Response> {
  return client.raw(`${API_BASE}/2/drive/${driveId}/files/${fileId}/download`);
}

/** Uploads bytes into a folder; an existing file with the same name is kept and the new one renamed. */
export async function uploadFile(
  client: InfomaniakClient,
  driveId: number,
  directoryId: number,
  fileName: string,
  content: Uint8Array,
  /** "rename" keeps the existing file; "version" replaces it (kDrive keeps the old one as a version). */
  conflict: 'rename' | 'version' = 'rename',
): Promise<DriveFile> {
  if (content.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
    throw new InfomaniakApiError('File troppo grande per il caricamento diretto (max 1 GB).', 413);
  }
  const params = new URLSearchParams({
    directory_id: String(directoryId),
    file_name: fileName,
    total_size: String(content.byteLength),
    conflict,
  });
  const env = await client.request<RawFile>(`${API_BASE}/3/drive/${driveId}/upload?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content as Uint8Array<ArrayBuffer>,
  });
  return mapFile(env.data as RawFile);
}

/** Every entry of a folder (all pages). */
export async function listAll(client: InfomaniakClient, driveId: number, directoryId: number): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const listing = await listDirectory(client, driveId, directoryId, cursor);
    all.push(...listing.files);
    if (!listing.hasMore || !listing.cursor) break;
    cursor = listing.cursor;
  }
  return all;
}

/** Moves a file to the kDrive trash. */
export async function trashFile(client: InfomaniakClient, driveId: number, fileId: number): Promise<void> {
  await client.request(`${API_BASE}/2/drive/${driveId}/files/${fileId}`, { method: 'DELETE' });
}

/** Creates a folder (or returns the existing one with that name). */
export async function ensureDirectory(client: InfomaniakClient, driveId: number, parentId: number, name: string): Promise<DriveFile> {
  const existing = (await listAll(client, driveId, parentId)).find((f) => f.type === 'dir' && f.name === name);
  if (existing) return existing;
  const env = await client.request<RawFile>(`${API_BASE}/3/drive/${driveId}/files/${parentId}/directory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return mapFile(env.data as RawFile);
}

/** URL of a folder in the kDrive web app (for a file, the folder containing it). */
export function webUrl(driveId: number, file: Pick<DriveFile, 'id' | 'type' | 'parentId'>): string {
  const folderId = file.type === 'dir' ? file.id : (file.parentId ?? 1);
  return `https://ksuite.infomaniak.com/kdrive/app/drive/${driveId}/files/${folderId}`;
}
