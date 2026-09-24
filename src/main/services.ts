import { app, type Session, type WebContents } from 'electron';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { InfomaniakApiError, InfomaniakClient } from '../api/client';
import * as calendar from '../api/calendar';
import { listContacts, type Contact } from '../api/contacts';
import * as drive from '../api/drive';
import * as mail from '../api/mail';
import { getProfile } from '../api/profile';
import type { CalendarEvent, Drive, DriveFile, DriveListing, MailOverview, NewEvent, OutgoingMail, Profile } from '../shared/types';
import { matchesAll } from '../shared/search-match';
import { fileNameFromContentDisposition, fileNameFromUrl, safeFileName, uniquePath } from './files';
import type { SettingsStore } from './settings';

/** Everything the browser does with the kSuite APIs, bound to the configured token and drive. */
export class KSuiteServices {
  private cachedDriveId: number | null = null;
  private cachedProfile: Profile | null = null;

  constructor(private readonly settings: SettingsStore) {}

  /** Call after the token or the selected drive changes. */
  resetCache(): void {
    this.cachedDriveId = null;
    this.cachedProfile = null;
    this.contactsCache = null;
    this.eventsCache = null;
  }

  private client(): InfomaniakClient {
    const token = this.settings.getToken();
    if (!token) throw new InfomaniakApiError('Nessun token API configurato. Aprilo dalle impostazioni.', 401);
    return new InfomaniakClient(token);
  }

  async profile(): Promise<Profile> {
    this.cachedProfile ??= await getProfile(this.client());
    return this.cachedProfile;
  }

  drives(): Promise<Drive[]> {
    return drive.listDrives(this.client());
  }

  async driveId(): Promise<number> {
    const configured = this.settings.get().driveId;
    if (configured) return configured;
    if (this.cachedDriveId) return this.cachedDriveId;
    const [first] = await this.drives();
    if (!first) throw new InfomaniakApiError('Nessun kDrive trovato per questo account.', 404);
    this.cachedDriveId = first.id;
    return first.id;
  }

  /** API client and drive for features that talk to kDrive directly (sync). */
  async driveContext(): Promise<{ client: InfomaniakClient; driveId: number }> {
    return { client: this.client(), driveId: await this.driveId() };
  }

  async listDirectory(directoryId: number, cursor?: string | null): Promise<DriveListing & { driveId: number }> {
    const id = await this.driveId();
    return { ...(await drive.listDirectory(this.client(), id, directoryId, cursor)), driveId: id };
  }

  async search(query: string): Promise<DriveFile[]> {
    return drive.searchFiles(this.client(), await this.driveId(), query);
  }

  async driveWebUrl(file: Pick<DriveFile, 'id' | 'type' | 'parentId'>): Promise<string> {
    return drive.webUrl(await this.driveId(), file);
  }

  /** Downloads a kDrive file into the downloads folder and returns the local path. */
  async downloadToDisk(fileId: number, name: string, folder: string = app.getPath('downloads')): Promise<string> {
    const res = await drive.downloadFile(this.client(), await this.driveId(), fileId);
    const target = uniquePath(folder, safeFileName(name));
    if (!res.body) throw new InfomaniakApiError('Risposta vuota dal server.', 500);
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(target));
    return target;
  }

  async uploadBytes(name: string, content: Uint8Array, directoryId?: number): Promise<DriveFile> {
    const folder = directoryId ?? this.settings.get().driveUploadFolderId;
    return drive.uploadFile(this.client(), await this.driveId(), folder, safeFileName(name), content);
  }

  async uploadLocalFile(path: string, directoryId?: number): Promise<DriveFile> {
    const info = await stat(path);
    if (info.size > drive.MAX_DIRECT_UPLOAD_BYTES) {
      throw new InfomaniakApiError(`${basename(path)} supera 1 GB: caricalo dall'app web di kDrive.`, 413);
    }
    return this.uploadBytes(basename(path), new Uint8Array(await readFile(path)), directoryId);
  }

  /** Saves the page shown in a tab as a PDF into the kDrive destination folder. */
  async savePageAsPdf(contents: WebContents): Promise<DriveFile> {
    const pdf = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const title = contents.getTitle() || fileNameFromUrl(contents.getURL(), 'pagina');
    return this.uploadBytes(`${safeFileName(title, 'pagina')}.pdf`, new Uint8Array(pdf));
  }

  /** Fetches a link or image with the browser session (cookies included) and stores it in kDrive. */
  async saveUrlToDrive(session: Session, url: string): Promise<DriveFile> {
    const res = await session.fetch(url);
    if (!res.ok) throw new InfomaniakApiError(`Download fallito (${res.status}) per ${url}`, res.status);
    const name = fileNameFromContentDisposition(res.headers.get('content-disposition')) ?? fileNameFromUrl(url);
    return this.uploadBytes(name, new Uint8Array(await res.arrayBuffer()));
  }

  // ---------- Unified search ----------

  private contactsCache: { at: number; list: Contact[] } | null = null;
  private eventsCache: { at: number; list: CalendarEvent[] } | null = null;
  private static readonly CACHE_MS = 5 * 60_000;

  searchMail(query: string): Promise<mail.MailSearchHit[]> {
    return mail.searchMail(this.client(), query);
  }

  async searchContacts(query: string): Promise<Contact[]> {
    if (!this.contactsCache || Date.now() - this.contactsCache.at > KSuiteServices.CACHE_MS) {
      this.contactsCache = { at: Date.now(), list: await listContacts(this.client()) };
    }
    return this.contactsCache.list.filter((c) => matchesAll(query, c.name, ...c.emails)).slice(0, 8);
  }

  /** Events from a month ago to six months ahead whose title or place match; upcoming ones first. */
  async searchEvents(query: string): Promise<CalendarEvent[]> {
    if (!this.eventsCache || Date.now() - this.eventsCache.at > KSuiteServices.CACHE_MS) {
      const from = new Date(Date.now() - 30 * 86_400_000);
      const to = new Date(Date.now() + 182 * 86_400_000);
      this.eventsCache = { at: Date.now(), list: await calendar.upcomingEvents(this.client(), from, to) };
    }
    const now = Date.now();
    const hits = this.eventsCache.list.filter((e) => matchesAll(query, e.title, e.location));
    const upcoming = hits.filter((e) => Date.parse(e.end) >= now);
    const past = hits.filter((e) => Date.parse(e.end) < now).reverse();
    return [...upcoming, ...past].slice(0, 8);
  }

  mailOverview(): Promise<MailOverview> {
    return mail.getMailOverview(this.client());
  }

  sendMail(message: OutgoingMail): Promise<void> {
    return mail.sendMail(this.client(), message);
  }

  upcomingEvents(days = 7): Promise<CalendarEvent[]> {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 24 * 3600 * 1000);
    return calendar.upcomingEvents(this.client(), from, to);
  }

  async createEvent(event: NewEvent): Promise<void> {
    const timezone = await this.profile().then((p) => p.timezone, () => null);
    await calendar.createEvent(this.client(), event, timezone);
  }
}
