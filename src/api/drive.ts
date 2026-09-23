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

export async function listDrives(client: InfomaniakClient): Promise<Drive[]> {
  const drives = await client.get<Array<{ id: number; name: string }>>(`${API_BASE}/2/drive`);
  return (drives ?? []).map((d) => ({ id: d.id, name: d.name }));
}

export async function listDirectory(
  client: InfomaniakClient,
  driveId: number,
  directoryId: number,
  cursor?: string | null,
): Promise<DriveListing> {
  const params = new URLSearchParams({ limit: '100', order_by: 'type', order: 'asc' });
  if (cursor) params.set('cursor', cursor);
  const env = await client.request<RawFile[]>(`${API_BASE}/3/drive/${driveId}/files/${directoryId}/files?${params}`);
  return { files: (env.data ?? []).map(mapFile), cursor: env.cursor ?? null, hasMore: Boolean(env.has_more) };
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
): Promise<DriveFile> {
  if (content.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
    throw new InfomaniakApiError('File troppo grande per il caricamento diretto (max 1 GB).', 413);
  }
  const params = new URLSearchParams({
    directory_id: String(directoryId),
    file_name: fileName,
    total_size: String(content.byteLength),
    conflict: 'rename',
  });
  const env = await client.request<RawFile>(`${API_BASE}/3/drive/${driveId}/upload?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content as Uint8Array<ArrayBuffer>,
  });
  return mapFile(env.data as RawFile);
}

/** URL of a folder in the kDrive web app (for a file, the folder containing it). */
export function webUrl(driveId: number, file: Pick<DriveFile, 'id' | 'type' | 'parentId'>): string {
  const folderId = file.type === 'dir' ? file.id : (file.parentId ?? 1);
  return `https://ksuite.infomaniak.com/kdrive/app/drive/${driveId}/files/${folderId}`;
}
