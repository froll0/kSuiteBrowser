import { describe, expect, it } from 'vitest';
import { InfomaniakClient, type FetchLike } from '../src/api/client';
import { listContacts } from '../src/api/contacts';
import { searchMail } from '../src/api/mail';
import { calculate } from '../src/shared/calc';
import { matchesAll } from '../src/shared/search-match';

describe('calculate', () => {
  it('evaluates arithmetic with precedence and parentheses', () => {
    expect(calculate('12*(3+4)')).toBe(84);
    expect(calculate('2+3*4')).toBe(14);
    expect(calculate('2^3^2')).toBe(512);
    expect(calculate('-5 + 2')).toBe(-3);
    expect(calculate('10 % 3')).toBe(1);
    expect(calculate('1,5 × 4')).toBe(6);
    expect(calculate('0.1+0.2')).toBe(0.3);
    expect(calculate('7/2=')).toBe(3.5);
  });

  it('ignores anything that is not a calculation', () => {
    expect(calculate('42')).toBeNull();
    expect(calculate('meteo lugano')).toBeNull();
    expect(calculate('2+')).toBeNull();
    expect(calculate('(1+2')).toBeNull();
    expect(calculate('1/0')).toBeNull();
    expect(calculate('alert(1)')).toBeNull();
    expect(calculate('2026-09-24')).toBeNull();
    expect(calculate('24/09/2026')).toBeNull();
    expect(calculate('079-123-45-67')).toBeNull();
    expect(calculate('100-58')).toBe(42);
  });
});

describe('matchesAll', () => {
  it('requires every word, ignoring case and accents', () => {
    expect(matchesAll('fattura luglio', 'Fattura di Luglio 2026')).toBe(true);
    expect(matchesAll('perche', 'Perché no')).toBe(true);
    expect(matchesAll('fattura agosto', 'Fattura di Luglio')).toBe(false);
    expect(matchesAll('', 'x')).toBe(false);
  });
});

function fake(routes: Record<string, (url: URL) => unknown>) {
  const calls: URL[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const route = routes[`${url.host}${url.pathname}`] as ((url: URL) => unknown) | undefined;
    return new Response(JSON.stringify(route ? { result: 'success', ...(route(url) as object) } : { result: 'error' }), { status: route ? 200 : 404 });
  };
  return { client: new InfomaniakClient('t', fetchImpl), calls };
}

describe('kSuite search APIs', () => {
  it('searches mail in every folder', async () => {
    const { client, calls } = fake({
      'mail.infomaniak.com/api/mailbox': () => ({ data: [{ uuid: 'mb', email: 'a@ik.me' }] }),
      'mail.infomaniak.com/api/mail/mb/folder': () => ({ data: [{ id: 'in', name: 'INBOX', role: 'INBOX' }] }),
      'mail.infomaniak.com/api/mail/mb/folder/in/message': () => ({
        data: { threads: [{ uid: '9', subject: 'Fattura', from: [{ name: 'Anna', email: 'a@x.ch' }], date: '2026-09-01', unseen_messages: 0, messages: [{ preview: 'In allegato' }] }] },
      }),
    });
    expect(await searchMail(client, 'fattura')).toEqual([{ uid: '9', subject: 'Fattura', from: 'Anna', date: '2026-09-01', preview: 'In allegato', unseen: false }]);
    const params = calls[calls.length - 1].searchParams;
    expect(params.get('scontains')).toBe('fattura');
    expect(params.get('severywhere')).toBe('1');
  });

  it('reads contacts with emails as strings or objects', async () => {
    const { client } = fake({
      'api.infomaniak.com/1/calendar/pim/contact/all': () => ({
        data: [
          { id: 1, name: 'Anna Rossi', emails: ['anna@x.ch'] },
          { id: 2, firstname: 'Bob', lastname: 'Neri', emails: [{ value: 'bob@y.ch' }] },
        ],
      }),
    });
    expect(await listContacts(client)).toEqual([
      { id: '1', name: 'Anna Rossi', emails: ['anna@x.ch'] },
      { id: '2', name: 'Bob Neri', emails: ['bob@y.ch'] },
    ]);
  });
});
