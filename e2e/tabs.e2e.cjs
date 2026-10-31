const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchVelo, serve, sleep, until } = require('./helpers.cjs');

test('containers, groups and workspaces, kept with the session', async () => {
  // The page shows the cookie it received: a container keeps its own.
  const server = await serve((req, res) => {
    if (req.url.startsWith('/set')) res.setHeader('Set-Cookie', `who=${req.url.split('=')[1]}; Max-Age=3600`);
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>T</title><script>document.title = "C:" + document.cookie</script>');
  });
  const base = `http://127.0.0.1:${server.port}`;
  const velo = await launchVelo({ settings: { onboarded: true, httpsOnly: false } });
  try {
    await velo.captureMenus();
    await velo.openTab(`${base}/set?v=normal`, '/set?v=normal');
    await velo.win.evaluate(() => window.velo.tabs.containerMenu({ x: 10, y: 10, width: 10, height: 10 }));
    await velo.pick('Lavoro');
    const ctab = await until(async () => (await velo.tabs()).find((t) => t.container === 'work'));
    assert.ok(ctab, 'a tab in the Work container');
    const navigate = (id, url) => velo.win.evaluate(([id, url]) => window.velo.tabs.navigate(id, url), [id, url]);
    await navigate(ctab.id, `${base}/set?v=work`);
    await sleep(800);
    await navigate(ctab.id, `${base}/read`);
    const normal = (await velo.tabs()).find((t) => t.url.includes('v=normal'));
    await navigate(normal.id, `${base}/read`);
    const titles = await until(async () => {
      const tabs = await velo.tabs();
      const a = tabs.find((t) => t.id === ctab.id)?.title;
      const b = tabs.find((t) => t.id === normal.id)?.title;
      return a === 'C:who=work' && b === 'C:who=normal' ? [a, b] : null;
    });
    assert.deepEqual(titles, ['C:who=work', 'C:who=normal']);

    // Groups
    await velo.win.evaluate((id) => window.velo.tabs.menu(id), normal.id);
    await velo.pick('Aggiungi a un nuovo gruppo');
    await velo.win.evaluate((id) => window.velo.tabs.menu(id), ctab.id);
    await velo.pick('Aggiungi al gruppo', 'Gruppo');
    const layout = await until(async () => {
      const l = await velo.win.evaluate(() => window.velo.tabs.layout());
      return l.groups.length === 1 ? l : null;
    });
    const gid = layout.groups[0].id;
    assert.equal((await velo.tabs()).filter((t) => t.groupId === gid).length, 2);
    await velo.win.evaluate((g) => window.velo.tabs.groupUpdate(g, { name: 'Ricerca', collapsed: true }), gid);
    assert.equal(await until(() => velo.win.evaluate(() => document.querySelector('.group-chip')?.textContent)), 'Ricerca2');

    // Workspaces: the tab moves to a new one, the strip shows one workspace at a time.
    await velo.win.evaluate((id) => window.velo.tabs.menu(id), normal.id);
    await velo.pick('Sposta nello spazio di lavoro', 'Nuovo spazio di lavoro');
    const ws = await until(async () => {
      const l = await velo.win.evaluate(() => window.velo.tabs.layout());
      return l.workspace !== 'default' ? l.workspace : null;
    });
    assert.ok(ws);
    assert.equal((await velo.tabs()).filter((t) => t.workspace === ws).length, 1);
    await velo.win.evaluate(() => window.velo.tabs.switchWorkspace('default'));
    assert.equal(await until(() => velo.win.evaluate(() => Boolean(document.querySelector('.workspace-btn')))), true);

    await velo.app.evaluate(({ app }) => app.quit());
    await sleep(2000);
    const saved = JSON.parse(fs.readFileSync(path.join(velo.userData, 'session.json'), 'utf8')).windows[0];
    assert.equal(saved.layout.groups[0].name, 'Ricerca');
    assert.ok(saved.tabs.some((t) => t.workspace === ws));
    assert.ok(saved.tabs.some((t) => t.container === 'work' && t.groupId === gid));
  } finally {
    await velo.close();
    server.close();
  }
});

test('a profile is a separate Velo with its own folder', async () => {
  const velo = await launchVelo({ args: ['--profile=p-e2e'] });
  try {
    const userData = await velo.app.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(userData, path.join(velo.userData, 'Profiles', 'p-e2e'));
    // A new profile starts on the welcome page and shows its name in the title.
    await velo.waitPage('velo://welcome');
    assert.match(await velo.win.title(), /Velo \(p-e2e\)/);
  } finally {
    await velo.close();
  }
});
