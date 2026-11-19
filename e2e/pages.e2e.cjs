const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchVelo, serve, sleep, until } = require('./helpers.cjs');

test('new tab page: shortcuts can be added and removed, closed tabs reopened', async () => {
  const server = await serve((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Chiusa</title>');
  });
  const velo = await launchVelo({ settings: { onboarded: true, httpsOnly: false } });
  try {
    const url = `http://127.0.0.1:${server.port}/page`;
    await velo.openTab(url, url);
    const closed = await until(async () => (await velo.tabs()).find((t) => t.url === url && t.title === 'Chiusa'));
    await velo.win.evaluate((id) => window.velo.tabs.close(id), closed.id);

    await velo.win.evaluate(() => window.velo.tabs.create('velo://newtab/'));
    // The first tab is a new tab page too: the one in front.
    const newtab = await until(async () => {
      for (const p of velo.app.windows().filter((w) => w.url().startsWith('velo://newtab'))) {
        if (await p.evaluate(() => document.visibilityState === 'visible' && document.querySelector('#recent-list button') !== null)) return p;
      }
      return null;
    });
    assert.ok(newtab, 'the new tab page lists the closed tab');
    assert.match(await newtab.textContent('#recent-list'), /Chiusa/);

    await newtab.click('.tile.add');
    await newtab.fill('#shortcut-url', 'nonsense');
    await newtab.click('#shortcut-save');
    assert.match(await newtab.textContent('#shortcut-error'), /indirizzo web valido/);
    await newtab.fill('#shortcut-name', 'Esempio');
    await newtab.fill('#shortcut-url', 'example.com');
    await newtab.click('#shortcut-save');
    assert.deepEqual(await until(async () => (await velo.settings()).newTabShortcuts.length && (await velo.settings()).newTabShortcuts), [{ url: 'https://example.com/', title: 'Esempio' }]);
    await newtab.waitForSelector('.tile.pinned');
    assert.equal(await newtab.textContent('.tile.pinned .name'), 'Esempio');

    await newtab.hover('.tile.pinned');
    await newtab.click('button[aria-label="Rimuovi la scorciatoia Esempio"]');
    assert.deepEqual(await until(async () => (await velo.settings()).newTabShortcuts.length === 0 && []), []);

    const before = (await velo.tabs()).length;
    await newtab.click('#recent-list button');
    assert.equal(await until(async () => (await velo.tabs()).some((t) => t.url === url)), true);
    assert.equal((await velo.tabs()).length, before + 1);
  } finally {
    await velo.close();
    server.close();
  }
});

test('settings show one page at a time and search all of them', async () => {
  const velo = await launchVelo();
  try {
    const settings = await velo.openTab('velo://settings/#privacy', 'velo://settings');
    await settings.waitForSelector('#privacy .row');
    const visible = () => settings.evaluate(() => [...document.querySelectorAll('#content > section')].filter((s) => s.offsetParent).map((s) => s.id));
    assert.deepEqual(await until(async () => ((await visible()).join() === 'privacy' ? ['privacy'] : null)), ['privacy']);
    assert.equal(await settings.getAttribute('.nav a[href="#privacy"]', 'aria-current'), 'page');

    await settings.fill('#filter', 'cookie');
    const found = await visible();
    assert.ok(found.length > 1, `search shows several pages (${found})`);
    assert.match(await settings.textContent('#filter-summary'), /cookie/);

    await settings.click('.nav a[href="#about"]');
    assert.deepEqual(await until(async () => ((await visible()).join() === 'about,crashes' ? true : null)), true);
    assert.equal(await settings.inputValue('#filter'), '');
  } finally {
    await velo.close();
  }
});

test('an empty bookmarks bar shows only on the new tab page', async () => {
  const velo = await launchVelo();
  try {
    const barShown = () => velo.win.evaluate(() => document.body.classList.contains('bookmarks-bar'));
    await velo.openTab('velo://newtab/', 'velo://newtab');
    assert.equal(await until(barShown), true);
    await velo.openTab('velo://history/', 'velo://history');
    assert.equal(await until(async () => !(await barShown())), true);
    const history = (await velo.tabs()).find((t) => t.url.startsWith('velo://history'));
    await velo.win.evaluate((id) => window.velo.bookmarks.toggle(id), history.id);
    assert.equal(await until(barShown), true);
    await sleep(100);
  } finally {
    await velo.close();
  }
});
