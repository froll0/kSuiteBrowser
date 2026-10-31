const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchVelo, sleep, until } = require('./helpers.cjs');

test('first start: welcome page, then the new tab page', async () => {
  const velo = await launchVelo({ settings: null });
  try {
    const welcome = await velo.waitPage('velo://welcome');
    assert.equal(await welcome.textContent('h1'), 'Benvenuto in Velo');
    await welcome.click('#next');
    assert.equal(await welcome.textContent('h1'), 'Aspetto');
    await welcome.selectOption('select[aria-label="Tema"]', 'dark');
    assert.equal(await until(async () => (await velo.settings()).theme === 'dark'), true);
    for (let i = 0; i < 3; i++) await welcome.click('#next');
    assert.equal(await welcome.textContent('#next'), 'Inizia a navigare');
    await welcome.click('#next');
    assert.deepEqual(await until(async () => {
      const urls = (await velo.tabs()).map((t) => t.url);
      return urls.length === 1 && urls[0] === 'velo://newtab/' ? urls : null;
    }), ['velo://newtab/']);
    assert.equal((await velo.settings()).onboarded, true);
  } finally {
    await velo.close();
  }
});

test('command palette runs commands and opens settings', async () => {
  const velo = await launchVelo();
  try {
    assert.equal(await velo.menu('Tavolozza dei comandi'), 'CmdOrCtrl+K');
    const palette = await velo.waitPage('palette.html');
    await palette.fill('#q', 'dupl');
    assert.equal(await palette.textContent('.row.selected .title'), 'Duplica scheda');
    await palette.keyboard.press('Enter');
    assert.equal(await until(async () => (await velo.tabs()).length === 2), true);

    await velo.menu('Tavolozza dei comandi');
    await sleep(300);
    await palette.fill('#q', 'scorciatoie');
    assert.equal(await palette.textContent('.row.selected .title'), 'Scorciatoie da tastiera');
    await palette.keyboard.press('Enter');
    const settings = await velo.waitPage('velo://settings');
    assert.equal(settings.url(), 'velo://settings/#shortcuts');
  } finally {
    await velo.close();
  }
});

test('a shortcut changed in the settings moves to the menu', async () => {
  const velo = await launchVelo();
  try {
    const settings = await velo.openTab('velo://settings/#shortcuts', 'velo://settings');
    await settings.waitForSelector('#shortcuts button.keys');
    await settings.click('#shortcuts button.keys');
    await settings.keyboard.press('Control+Y');
    assert.deepEqual(await until(async () => (await velo.settings()).shortcuts.newTab && (await velo.settings()).shortcuts), { newTab: 'CmdOrCtrl+Y' });
    const accel = await velo.app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'File').submenu.items[0].accelerator);
    assert.equal(accel, 'CmdOrCtrl+Y');
  } finally {
    await velo.close();
  }
});

test('site settings gather permissions and zoom', async () => {
  const velo = await launchVelo();
  try {
    const site = await velo.openTab('velo://site/?host=example.com', 'velo://site');
    await site.waitForSelector('select[aria-label="Posizione"]');
    assert.equal(await site.textContent('#heading'), 'example.com');
    await site.selectOption('select[aria-label="Posizione"]', 'block');
    await site.selectOption('select[aria-label="Zoom"]', '125');
    const s = await until(async () => {
      const x = await velo.settings();
      return x.siteZoom['example.com'] === 125 && x.sitePermissions.length ? x : null;
    });
    assert.deepEqual(s.sitePermissions, [{ host: 'example.com', permission: 'geolocation', allowed: false }]);
    await site.goto('velo://site/');
    await site.waitForSelector('.site-list');
    assert.match(await site.textContent('.site-list'), /example\.com/);
  } finally {
    await velo.close();
  }
});

test('auto-hiding bar: Velo window buttons on Linux, back when scrolling up', async () => {
  const velo = await launchVelo();
  try {
    if (process.platform === 'linux') assert.equal(await velo.win.evaluate(() => getComputedStyle(document.getElementById('window-controls')).display), 'flex');
    const settings = await velo.openTab('velo://settings/', 'velo://settings');
    await velo.setSettings({ autoHideToolbar: true, revealToolbarOnScrollUp: true });
    const shown = () => velo.win.evaluate(() => document.body.classList.contains('chrome-shown'));
    assert.equal(await until(async () => !(await shown())), true);
    const wheel = (dy) => velo.app.evaluate(({ webContents }, dy) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('velo://settings'));
      wc.sendInputEvent({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: dy, canScroll: true });
    }, dy);
    await settings.bringToFront().catch(() => {});
    await wheel(-120);
    await sleep(300);
    await wheel(120);
    assert.equal(await until(shown), true, 'scrolling up shows the bar');
    await wheel(-120);
    assert.equal(await until(async () => !(await shown())), true, 'scrolling down hides it');
    await velo.setSettings({ reduceMotion: true });
    assert.equal(await until(() => velo.win.evaluate(() => document.documentElement.classList.contains('reduce-motion'))), true);
  } finally {
    await velo.close();
  }
});
