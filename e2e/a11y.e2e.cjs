const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launchVelo, until } = require('./helpers.cjs');

// axe-core (Deque) checks the pages against WCAG 2.1 A and AA: names of controls, labels, contrast,
// roles, landmarks, language…
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function audit(page) {
  await page.evaluate(AXE);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const PAGES = ['velo://settings/', 'velo://history/', 'velo://bookmarks/', 'velo://passwords/', 'velo://site/?host=example.com', 'velo://import/', 'velo://newtab/'];

test('internal pages and the browser window pass the accessibility checks', async () => {
  const velo = await launchVelo();
  const problems = [];
  try {
    for (const url of PAGES) {
      const page = await velo.openTab(url, url.replace(/\?.*$/, ''));
      await page.waitForLoadState('load');
      await new Promise((r) => setTimeout(r, 700));
      for (const v of await audit(page)) problems.push(`${url} ${v}`);
    }
    for (const v of await audit(velo.win)) problems.push(`browser window ${v}`);
    for (const dark of [true]) {
      await velo.setSettings({ theme: dark ? 'dark' : 'light' });
      await new Promise((r) => setTimeout(r, 500));
      const page = await velo.openTab('velo://settings/', 'velo://settings');
      await new Promise((r) => setTimeout(r, 500));
      for (const v of await audit(page)) problems.push(`dark settings ${v}`);
      for (const v of await audit(velo.win)) problems.push(`dark browser window ${v}`);
    }
  } finally {
    await velo.close();
  }
  assert.deepEqual(problems, []);
});

test('the welcome page passes the accessibility checks', async () => {
  const velo = await launchVelo({ settings: null });
  try {
    const page = await velo.waitPage('velo://welcome');
    const problems = [];
    for (let step = 0; step < 5; step++) {
      await new Promise((r) => setTimeout(r, 400));
      for (const v of await audit(page)) problems.push(`step ${step + 1} ${v}`);
      if (step < 4) await page.click('#next');
    }
    assert.deepEqual(problems, []);
  } finally {
    await velo.close();
  }
});

test('the tab strip works with the keyboard', async () => {
  const velo = await launchVelo();
  try {
    await velo.openTab('velo://history/', 'velo://history');
    await velo.openTab('velo://bookmarks/', 'velo://bookmarks');
    const win = velo.win;
    await win.bringToFront();
    // F6 from the page: address bar, then the tabs.
    await velo.menu('Passa alla parte successiva della finestra');
    assert.equal(await until(() => win.evaluate(() => document.activeElement?.id)), 'omnibox');
    await velo.menu('Passa alla parte successiva della finestra');
    assert.equal(await until(() => win.evaluate(() => document.activeElement?.getAttribute('role'))), 'tab');
    const focusedTitle = () => win.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.match(await focusedTitle(), /Preferiti/);
    await win.keyboard.press('ArrowLeft');
    assert.match(await focusedTitle(), /Cronologia/);
    await win.keyboard.press('Enter');
    assert.equal(await until(async () => (await velo.tabs()).find((t) => t.active)?.url.startsWith('velo://history')), true);
    // Still on the tab after the strip was drawn again.
    assert.match(await focusedTitle(), /Cronologia/);
    const before = (await velo.tabs()).length;
    await win.keyboard.press('Delete');
    assert.equal(await until(async () => (await velo.tabs()).length === before - 1), true);
    assert.equal(await win.evaluate(() => document.activeElement?.getAttribute('role')), 'tab');
  } finally {
    await velo.close();
  }
});
