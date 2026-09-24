import type { Mailbox, MailOverview, MailThread, OutgoingMail } from '../shared/types';
import { MAIL_API_BASE, InfomaniakApiError, type InfomaniakClient } from './client';

interface RawMailbox {
  uuid: string;
  email: string;
  is_primary?: boolean;
}

interface RawFolder {
  id: string;
  name: string;
  role?: string | null;
  unread_count?: number;
  children?: RawFolder[];
}

interface RawThread {
  uid: string;
  subject?: string | null;
  from?: Array<{ name?: string; email?: string }>;
  date?: string;
  unseen_messages?: number;
  messages?: Array<{ preview?: string }>;
}

export async function listMailboxes(client: InfomaniakClient): Promise<Mailbox[]> {
  const boxes = await client.get<RawMailbox[]>(`${MAIL_API_BASE}/mailbox?with=aliases`);
  const sorted = [...(boxes ?? [])].sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  return sorted.map((b) => ({ uuid: b.uuid, email: b.email }));
}

export function findFolderByRole(folders: RawFolder[], role: string): RawFolder | null {
  for (const f of folders) {
    if (f.role?.toUpperCase() === role) return f;
    const nested = findFolderByRole(f.children ?? [], role);
    if (nested) return nested;
  }
  return null;
}

async function folders(client: InfomaniakClient, mailboxUuid: string): Promise<RawFolder[]> {
  return (await client.get<RawFolder[]>(`${MAIL_API_BASE}/mail/${mailboxUuid}/folder`)) ?? [];
}

export function formatSender(from: RawThread['from']): string {
  const first = from?.[0];
  if (!first) return '';
  return first.name?.trim() || first.email || '';
}

export async function getMailOverview(client: InfomaniakClient, limit = 15): Promise<MailOverview> {
  const [mailbox] = await listMailboxes(client);
  if (!mailbox) throw new InfomaniakApiError('Nessuna casella di posta trovata per questo token.', 404);

  const inbox = findFolderByRole(await folders(client, mailbox.uuid), 'INBOX');
  if (!inbox) throw new InfomaniakApiError('Cartella Posta in arrivo non trovata.', 404);

  const params = new URLSearchParams({ offset: '0', limit: String(limit), thread: 'on' });
  const data = await client.get<{ threads?: RawThread[] }>(
    `${MAIL_API_BASE}/mail/${mailbox.uuid}/folder/${inbox.id}/message?${params}`,
  );
  const threads: MailThread[] = (data?.threads ?? []).map((t) => ({
    uid: t.uid,
    subject: t.subject || '(nessun oggetto)',
    from: formatSender(t.from),
    date: t.date ?? '',
    preview: t.messages?.[0]?.preview ?? '',
    unseen: t.unseen_messages ?? 0,
  }));
  return { mailbox, inboxUnread: inbox.unread_count ?? 0, threads };
}

export function parseRecipients(input: string): Array<{ name: string; email: string }> {
  return input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ name: '', email }));
}

export function textToHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const linked = escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<div>${linked.replace(/\n/g, '<br>')}</div>`;
}

/** Sends an email through the kMail draft API (create draft, then send it). */
export async function sendMail(client: InfomaniakClient, mail: OutgoingMail): Promise<void> {
  const to = parseRecipients(mail.to);
  if (to.length === 0) throw new InfomaniakApiError('Specifica almeno un destinatario.', 400);
  const [mailbox] = await listMailboxes(client);
  if (!mailbox) throw new InfomaniakApiError('Nessuna casella di posta trovata per questo token.', 404);

  const payload: Record<string, unknown> = {
    uuid: null,
    subject: mail.subject,
    body: textToHtml(mail.body),
    quote: null,
    mime_type: 'text/html',
    from: { id: null, name: '', email: mailbox.email },
    reply_to: { name: '', email: mailbox.email },
    to,
    cc: null,
    bcc: null,
    references: '',
    in_reply_to: null,
    in_reply_to_uid: null,
    forwarded_uid: null,
    attachments: [],
    identity_id: null,
    ack_request: false,
    st_uuid: null,
    uid: null,
    resource: null,
    priority: 'normal',
    encrypted: false,
    encryption_password: '',
    action: 'save',
    delay: 0,
  };
  const draft = await client.send<{ uuid: string }>('POST', `${MAIL_API_BASE}/mail/${mailbox.uuid}/draft`, payload);
  const resource = `/api/mail/${mailbox.uuid}/draft/${draft.uuid}`;
  await client.send('PUT', `${MAIL_API_BASE}/mail/${mailbox.uuid}/draft/${draft.uuid}`, {
    ...payload,
    uuid: draft.uuid,
    resource,
    action: 'send',
  });
}

export interface MailSearchHit {
  uid: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
  unseen: boolean;
}

/** Full-text search in every folder of the primary mailbox (newest first). */
export async function searchMail(client: InfomaniakClient, query: string, limit = 8): Promise<MailSearchHit[]> {
  const [mailbox] = await listMailboxes(client);
  if (!mailbox) throw new InfomaniakApiError('Nessuna casella di posta trovata per questo token.', 404);
  const inbox = findFolderByRole(await folders(client, mailbox.uuid), 'INBOX');
  if (!inbox) throw new InfomaniakApiError('Cartella Posta in arrivo non trovata.', 404);
  const params = new URLSearchParams({ offset: '0', limit: String(limit), thread: 'off', severywhere: '1', scontains: query });
  const data = await client.get<{ threads?: RawThread[] }>(`${MAIL_API_BASE}/mail/${mailbox.uuid}/folder/${inbox.id}/message?${params}`);
  return (data?.threads ?? []).map((t) => ({
    uid: t.uid,
    subject: t.subject || '(nessun oggetto)',
    from: formatSender(t.from),
    date: t.date ?? '',
    preview: t.messages?.[0]?.preview ?? '',
    unseen: (t.unseen_messages ?? 0) > 0,
  }));
}
