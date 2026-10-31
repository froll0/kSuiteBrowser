// Helpers for the end-to-end tests: they start the real Velo (Electron) with a fresh profile and drive
// it through the same bridges its pages use. Run with: npm run build && xvfb-run -a npm run e2e
const { _electron } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const electronPath = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A new empty folder for a test's profile (XDG_CONFIG_HOME, so Velo's data lands in <dir>/Velo). */
function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `velo-e2e-${name}-`));
}

/**
 * Starts Velo. `settings` are written to the profile first (onboarded by default, so no welcome page);
 * `args` are added to the command line.
 */
async function launchVelo({ cfg = tempDir('profile'), settings = { onboarded: true }, args = [], env = {}, before } = {}) {
  fs.mkdirSync(path.join(cfg, 'Velo'), { recursive: true });
  if (settings) fs.writeFileSync(path.join(cfg, 'Velo', 'settings.json'), JSON.stringify({ settings }));
  if (before) before(path.join(cfg, 'Velo'));
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [ROOT, '--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP *.test 127.0.0.1', ...args],
    env: { ...process.env, LANG: 'it_IT.UTF-8', XDG_CONFIG_HOME: cfg, no_proxy: '*', NO_PROXY: '*', ...env },
  });
  await app.firstWindow();
  const velo = {
    app,
    cfg,
    userData: path.join(cfg, 'Velo'),
    /** The last page (tab, popup or browser UI) whose address contains `frag`. */
    page: (frag) => app.windows().filter((p) => p.url().includes(frag)).pop(),
    /** Waits until such a page exists. */
    async waitPage(frag, timeout = 10_000) {
      const end = Date.now() + timeout;
      for (;;) {
        const p = velo.page(frag);
        if (p) {
          await p.waitForLoadState('domcontentloaded').catch(() => {});
          return p;
        }
        if (Date.now() > end) throw new Error(`no page with ${frag}`);
        await sleep(100);
      }
    },
    get win() {
      return velo.page('/renderer/index.html');
    },
    tabs: () => velo.win.evaluate(() => window.velo.tabs.list()),
    settings: () => velo.win.evaluate(() => window.velo.settings.get()),
    setSettings: (patch) => velo.win.evaluate((p) => window.velo.settings.set(p), patch),
    async openTab(url, frag = url) {
      await velo.win.evaluate((u) => window.velo.tabs.create(u), url);
      return velo.waitPage(frag);
    },
    /** Popup menus are captured instead of shown, so a test can choose their items. */
    captureMenus: () => app.evaluate(({ Menu }) => { Menu.prototype.popup = function () { globalThis.__menu = this; }; }),
    menuLabels: () => app.evaluate(() => (globalThis.__menu ? globalThis.__menu.items.map((i) => i.label) : null)),
    /** Clicks an item of the last captured menu, following submenus by label (prefix). */
    pick: (...labels) => app.evaluate((_, labels) => {
      let items = globalThis.__menu.items;
      let item;
      for (const l of labels) {
        item = items.find((i) => i.label === l || i.label.startsWith(l));
        if (!item) throw new Error(`menu item ${l} not found`);
        items = item.submenu ? item.submenu.items : [];
      }
      globalThis.__menu = null;
      item.click();
    }, labels),
    /** Clicks an item of the application menu by label. */
    menu: (label) => app.evaluate(({ Menu }, label) => {
      const walk = (items) => { for (const i of items) { if (i.label === label) return i; if (i.submenu) { const f = walk(i.submenu.items); if (f) return f; } } return null; };
      const item = walk(Menu.getApplicationMenu().items);
      if (!item) throw new Error(`menu ${label} not found`);
      item.click();
      return item.accelerator;
    }, label),
    close: () => app.close().catch(() => {}),
  };
  await velo.waitPage('/renderer/index.html');
  // The first tab and the UI settle.
  await sleep(1500);
  return velo;
}

/** A local web server; `handler(req, res)` as for http.createServer. Resolves to { url, close }. */
function serve(handler, { secure = false } = {}) {
  let server;
  if (secure) {
    const dir = tempDir('cert');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=velo.test'], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, handler);
  } else {
    server = http.createServer(handler);
  }
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() })));
}

/** Waits until `fn()` returns a truthy value (or throws after `timeout`). */
async function until(fn, timeout = 8000, step = 150) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > end) return last;
    await sleep(step);
  }
}

module.exports = { launchVelo, serve, sleep, tempDir, until };
