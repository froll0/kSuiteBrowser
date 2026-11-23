// A small stand-in for the Infomaniak APIs, with sample data, so the cloud features can be tested
// (and looked at) without an account. Start Velo with VELO_API_BASE / VELO_MAIL_API_BASE pointing here
// and VELO_API_TOKEN set to anything.
const http = require('node:http');

const DAY = 86_400_000;
const at = (days, hours, minutes = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + days * DAY + hours * 3_600_000 + minutes * 60_000).toISOString();
};

function sample() {
  return {
    profile: { user_id: 42, display_name: 'Giulia Bianchi', email: 'giulia@example.test', preferences: { timezone: { name: 'Europe/Rome' } } },
    mailboxes: [{ uuid: 'mbx-1', email: 'giulia@example.test', is_primary: true }],
    folders: [{ id: 'inbox', name: 'INBOX', role: 'INBOX', unread_count: 3 }],
    threads: [
      { uid: 't1', subject: 'Preventivo per il sito nuovo', from: [{ name: 'Marco Rossi', email: 'marco@studio.test' }], date: at(0, 9, 12), unseen_messages: 1, messages: [{ preview: 'Ciao Giulia, ti mando il preventivo aggiornato con le modifiche di ieri…' }] },
      { uid: 't2', subject: 'Riunione di giovedì', from: [{ name: 'Elena Conti', email: 'elena@example.test' }], date: at(0, 8, 3), unseen_messages: 1, messages: [{ preview: 'Possiamo spostarla alle 15? Ho un altro impegno la mattina.' }] },
      { uid: 't3', subject: 'La tua fattura di novembre', from: [{ name: 'Infomaniak', email: 'billing@example.test' }], date: at(-1, 17, 40), unseen_messages: 1, messages: [{ preview: 'La fattura è disponibile nel tuo Manager.' }] },
      { uid: 't4', subject: 'Foto della gita', from: [{ name: 'Luca', email: 'luca@example.test' }], date: at(-2, 20, 15), unseen_messages: 0, messages: [{ preview: 'Eccole! Alcune sono venute benissimo.' }] },
    ],
    calendars: [{ id: 1, name: 'Personale', default: true }, { id: 2, name: 'Lavoro' }],
    events: {
      1: [{ id: 'e1', title: 'Dentista', start: at(1, 10), end: at(1, 11), location: 'Via Roma 12' }],
      2: [
        { id: 'e2', title: 'Riunione di progetto', start: at(0, 15), end: at(0, 16), location: 'kMeet' },
        { id: 'e3', title: 'Consegna del preventivo', start: at(3, 0), end: at(4, 0), fullday: true },
      ],
    },
    drives: [{ id: 7, name: 'kDrive di Giulia' }],
    files: {
      1: [
        { id: 10, name: 'Documenti', type: 'dir', last_modified_at: Date.now() / 1000 - 3 * 86400 },
        { id: 11, name: 'Foto', type: 'dir', last_modified_at: Date.now() / 1000 - 20 * 86400 },
        { id: 12, name: 'Preventivo sito.pdf', type: 'file', size: 245_000, mime_type: 'application/pdf', last_modified_at: Date.now() / 1000 - 7200 },
        { id: 13, name: 'Budget 2027.xlsx', type: 'file', size: 58_000, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', last_modified_at: Date.now() / 1000 - 86400 },
        { id: 14, name: 'Note riunione.docx', type: 'file', size: 21_000, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', last_modified_at: Date.now() / 1000 - 4 * 86400 },
      ],
    },
    products: [{ product_id: 111, product_name: 'LLM API', account_name: 'Studio Bianchi', status: 'ok' }],
    models: [{ name: 'mistral3', type: 'llm', info_status: 'ready', endpoints: ['post/2/ai/{product_id}/openai/v1/chat/completions'] }],
  };
}

/** Starts the mock; `fail` makes the listed paths answer with an error, to see the error states. */
function startMockInfomaniak({ fail = {} } = {}) {
  const data = sample();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/mailapi/, '');
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status < 400 ? { result: 'success', ...body } : { result: 'error', error: body }));
    };
    for (const [prefix, error] of Object.entries(fail)) if (path.startsWith(prefix)) return send(error.body ?? { code: 'error', description: 'Failure' }, error.status ?? 500);
    if (path === '/2/profile') return send({ data: data.profile });
    if (path === '/mailbox') return send({ data: data.mailboxes });
    if (/^\/mail\/[^/]+\/folder$/.test(path)) return send({ data: data.folders });
    if (/^\/mail\/[^/]+\/folder\/[^/]+\/message$/.test(path)) return send({ data: { threads: data.threads } });
    if (path === '/1/calendar/pim/calendar') return send({ data: { calendars: data.calendars } });
    if (path === '/1/calendar/pim/event' && req.method === 'GET') return send({ data: data.events[url.searchParams.get('calendar_id')] ?? [] });
    if (path === '/1/calendar/pim/event' && req.method === 'POST') return send({ data: { id: 'new' } });
    if (path === '/1/calendar/pim/contact/all') return send({ data: [] });
    if (path === '/2/drive/init') return send({ data: { drives: data.drives } });
    const list = /^\/3\/drive\/\d+\/files\/(\d+)\/files$/.exec(path);
    if (list) return send({ data: data.files[list[1]] ?? [], cursor: null, has_more: false });
    if (/^\/3\/drive\/\d+\/files\/search$/.test(path)) return send({ data: data.files[1].filter((f) => f.name.toLowerCase().includes((url.searchParams.get('query') ?? '').toLowerCase())) });
    if (path === '/1/ai') return send({ data: data.products });
    if (path === '/1/ai/models') return send({ data: data.models });
    if (/^\/2\/ai\/\d+\/openai\/v1\/chat\/completions$/.test(path)) return send({ choices: [{ message: { content: 'Ecco un riassunto della pagina in tre punti.' } }] });
    return send({ code: 'not_found', description: `No mock for ${req.method} ${path}` }, 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ env: { VELO_API_BASE: base, VELO_MAIL_API_BASE: `${base}/mailapi`, VELO_API_TOKEN: 'mock-token' }, close: () => server.close() });
  }));
}

module.exports = { startMockInfomaniak };
