import { describe, expect, it, vi } from 'vitest';
import { upcomingEvents, toApiDate } from '../src/api/calendar';
import { InfomaniakApiError, InfomaniakClient, type FetchLike } from '../src/api/client';
import { listDirectory, listDrives, uploadFile } from '../src/api/drive';
import { findFolderByRole, getMailOverview, sendMail, textToHtml } from '../src/api/mail';
import { getProfile } from '../src/api/profile';

type Route = (url: URL, init: RequestInit) => unknown;

/** Fake fetch answering JSON by "METHOD path" and recording every call. */
function fakeApi(routes: Record<string, Route>) {
  const calls: Array<{ method: string; url: URL; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ method, url, init });
    const route = routes[`${method} ${url.host}${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ result: 'error', error: { code: 'not_found', description: 'no route' } }), { status: 404 });
    return new Response(JSON.stringify({ result: 'success', ...(route(url, init) as object) }), { status: 200 });
  };
  return { client: new InfomaniakClient('secret-token', fetchImpl), calls };
}

describe('InfomaniakClient', () => {
  it('sends the bearer token and unwraps data', async () => {
    const { client, calls } = fakeApi({
      'GET api.infomaniak.com/2/profile': () => ({ data: { user_id: 7, display_name: 'Ada', email: 'ada@ik.me', preferences: { timezone: { name: 'Europe/Zurich' } } } }),
    });
    const profile = await getProfile(client);
    expect(profile).toEqual({ id: 7, displayName: 'Ada', email: 'ada@ik.me', avatar: null, timezone: 'Europe/Zurich' });
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('turns API errors into readable errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"result":"error","error":{"code":"not_authorized"}}', { status: 401 }));
    const client = new InfomaniakClient('bad', fetchImpl);
    await expect(client.get('https://api.infomaniak.com/2/profile')).rejects.toBeInstanceOf(InfomaniakApiError);
    await expect(client.get('https://api.infomaniak.com/2/profile')).rejects.toThrow(/Token non valido/);
  });

  it('names the endpoint and the rejected fields on validation errors', async () => {
    const body = {
      result: 'error',
      error: {
        code: 'validation_failed',
        description: 'Validation failed',
        errors: [{ code: 'validation_rule_in', description: 'The selected order by is invalid.', context: { attribute: 'order_by' } }],
      },
    };
    const client = new InfomaniakClient('t', async () => new Response(JSON.stringify(body), { status: 422 }));
    await expect(client.get('https://api.infomaniak.com/3/drive/1/files/1/files?order_by=x')).rejects.toThrow(
      'Errore API 422 [validation_failed] su api.infomaniak.com/3/drive/1/files/1/files: Validation failed — order_by: The selected order by is invalid.',
    );
  });
});

describe('kDrive', () => {
  it('lists drives from the init endpoint', async () => {
    const { client, calls } = fakeApi({
      'GET api.infomaniak.com/2/drive/init': () => ({ data: { drives: [{ id: 12, name: 'My kSuite' }] } }),
    });
    expect(await listDrives(client)).toEqual([{ id: 12, name: 'My kSuite' }]);
    expect(calls[0].url.searchParams.get('with')).toBe('drives');
  });

  it('lists a directory with cursor pagination, folders first', async () => {
    const { client, calls } = fakeApi({
      'GET api.infomaniak.com/3/drive/12/files/5/files': () => ({
        data: [
          { id: 9, name: 'Doc.pdf', type: 'file', size: 2048, last_modified_at: 1700000000, mime_type: 'application/pdf', parent_id: 5 },
          { id: 10, name: 'Foto', type: 'dir', parent_id: 5 },
        ],
        cursor: 'abc',
        has_more: true,
      }),
    });
    const listing = await listDirectory(client, 12, 5, 'prev');
    expect(listing.files.map((f) => f.name)).toEqual(['Foto', 'Doc.pdf']);
    expect(listing.files[1]).toMatchObject({ id: 9, size: 2048, parentId: 5 });
    expect(listing).toMatchObject({ cursor: 'abc', hasMore: true });
    const params = calls[0].url.searchParams;
    expect(params.get('cursor')).toBe('prev');
    expect(params.get('order_by')).toBe('name');
    expect(params.get('order_for[name]')).toBe('asc');
    expect(params.has('order')).toBe(false);
  });

  it('uploads bytes with size, folder and rename-on-conflict', async () => {
    const { client, calls } = fakeApi({
      'POST api.infomaniak.com/3/drive/12/upload': () => ({ data: { id: 50, name: 'page.pdf', type: 'file', parent_id: 3 } }),
    });
    const file = await uploadFile(client, 12, 3, 'page.pdf', new Uint8Array([1, 2, 3]));
    expect(file.id).toBe(50);
    const params = calls[0].url.searchParams;
    expect(params.get('directory_id')).toBe('3');
    expect(params.get('total_size')).toBe('3');
    expect(params.get('conflict')).toBe('rename');
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/octet-stream');
  });
});

describe('Mail', () => {
  const folders = [
    { id: 'f1', name: 'Dossiers', role: null, children: [{ id: 'inbox-id', name: 'INBOX', role: 'INBOX', unread_count: 3 }] },
  ];

  it('finds nested folders by role', () => {
    expect(findFolderByRole(folders, 'INBOX')?.id).toBe('inbox-id');
    expect(findFolderByRole(folders, 'SENT')).toBeNull();
  });

  it('builds the inbox overview from the primary mailbox', async () => {
    const { client } = fakeApi({
      'GET mail.infomaniak.com/api/mailbox': () => ({ data: [{ uuid: 'other', email: 'b@ik.me' }, { uuid: 'mb1', email: 'a@ik.me', is_primary: true }] }),
      'GET mail.infomaniak.com/api/mail/mb1/folder': () => ({ data: folders }),
      'GET mail.infomaniak.com/api/mail/mb1/folder/inbox-id/message': () => ({
        data: { threads: [{ uid: 't1', subject: 'Ciao', from: [{ name: 'Bob', email: 'bob@x.ch' }], date: '2026-09-23T10:00:00+02:00', unseen_messages: 1, messages: [{ preview: 'Hello' }] }] },
      }),
    });
    const overview = await getMailOverview(client);
    expect(overview.mailbox.uuid).toBe('mb1');
    expect(overview.inboxUnread).toBe(3);
    expect(overview.threads[0]).toMatchObject({ subject: 'Ciao', from: 'Bob', preview: 'Hello', unseen: 1 });
  });

  it('sends through a saved draft', async () => {
    const { client, calls } = fakeApi({
      'GET mail.infomaniak.com/api/mailbox': () => ({ data: [{ uuid: 'mb1', email: 'a@ik.me' }] }),
      'POST mail.infomaniak.com/api/mail/mb1/draft': () => ({ data: { uuid: 'd1' } }),
      'PUT mail.infomaniak.com/api/mail/mb1/draft/d1': () => ({ data: {} }),
    });
    await sendMail(client, { to: 'x@y.ch, z@y.ch', subject: 'Link', body: 'Guarda https://ik.me' });
    const created = JSON.parse(String(calls[1].init.body));
    const sent = JSON.parse(String(calls[2].init.body));
    expect(created.action).toBe('save');
    expect(created.to).toEqual([{ name: '', email: 'x@y.ch' }, { name: '', email: 'z@y.ch' }]);
    expect(sent).toMatchObject({ action: 'send', uuid: 'd1', resource: '/api/mail/mb1/draft/d1' });
  });

  it('escapes HTML and links URLs in the body', () => {
    expect(textToHtml('<b>x</b>\nhttps://ik.me')).toBe('<div>&lt;b&gt;x&lt;/b&gt;<br><a href="https://ik.me">https://ik.me</a></div>');
  });
});

describe('Calendar', () => {
  it('formats dates for the PIM API', () => {
    expect(toApiDate(new Date('2026-09-23T08:05:09.123Z'))).toBe('2026-09-23 08:05:09');
  });

  it('merges and sorts events of every calendar', async () => {
    const { client } = fakeApi({
      'GET api.infomaniak.com/1/calendar/pim/calendar': () => ({ data: { calendars: [{ id: 1 }, { id: 2 }] } }),
      'GET api.infomaniak.com/1/calendar/pim/event': (url) =>
        url.searchParams.get('calendar_id') === '1'
          ? { data: [{ id: 'b', title: 'Dopo', start: '2026-09-24T10:00:00+02:00', end: '2026-09-24T11:00:00+02:00' }] }
          : { data: [{ id: 'a', title: 'Prima', start: '2026-09-23T09:00:00+02:00', end: '2026-09-23T10:00:00+02:00', fullday: false }] },
    });
    const events = await upcomingEvents(client, new Date('2026-09-23'), new Date('2026-09-30'));
    expect(events.map((e) => e.title)).toEqual(['Prima', 'Dopo']);
  });

  it('skips calendars that refuse the query', async () => {
    const { client } = fakeApi({
      'GET api.infomaniak.com/1/calendar/pim/calendar': () => ({ data: { calendars: [{ id: 1 }, { id: 2 }] } }),
      'GET api.infomaniak.com/1/calendar/pim/event': (url) => {
        if (url.searchParams.get('calendar_id') === '2') throw new Error('refused');
        return { data: [{ id: 'a', title: 'Ok', start: '2026-09-23T09:00:00+02:00', end: '2026-09-23T10:00:00+02:00' }] };
      },
    });
    const events = await upcomingEvents(client, new Date('2026-09-23'), new Date('2026-09-30'));
    expect(events.map((e) => e.title)).toEqual(['Ok']);
  });
});
