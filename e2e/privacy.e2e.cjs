const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchVelo, serve, until } = require('./helpers.cjs');

test('what removed features left in the profile is purged at start', async () => {
  const velo = await launchVelo({
    before: (userData) => {
      for (const dir of ['Extensions/abc', 'Local Extension Settings/abc', 'tor/data']) fs.mkdirSync(path.join(userData, dir), { recursive: true });
      fs.writeFileSync(path.join(userData, 'extensions.json'), '[]');
    },
  });
  try {
    const left = await until(() => {
      const l = ['Extensions', 'extensions.json', 'tor', 'Local Extension Settings'].filter((n) => fs.existsSync(path.join(velo.userData, n)));
      return l.length === 0 ? l : null;
    });
    assert.deepEqual(left, []);
  } finally {
    await velo.close();
  }
});

test('bounce links go straight to their destination', async () => {
  const server = await serve((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Arrivato</title>');
  });
  const velo = await launchVelo({ settings: { onboarded: true, httpsOnly: false } });
  try {
    const target = `http://127.0.0.1:${server.port}/dest?from=fb`;
    await velo.win.evaluate((u) => window.velo.tabs.create(u), `https://l.facebook.com/l.php?u=${encodeURIComponent(target)}&h=AT1`);
    assert.equal(await until(async () => (await velo.tabs()).some((t) => t.url === target)), true);
  } finally {
    await velo.close();
    server.close();
  }
});

test('a site is forgotten once its tabs are closed (when asked for)', async () => {
  const server = await serve((req, res) => {
    res.setHeader('Set-Cookie', 'keep=1; Max-Age=3600');
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Cookie</title>');
  });
  const velo = await launchVelo({ settings: { onboarded: true, httpsOnly: false, forgetSitesOnClose: true } });
  const cookies = () => velo.app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: 'keep' })).length);
  try {
    await velo.openTab(`http://127.0.0.1:${server.port}/`, `127.0.0.1:${server.port}`);
    assert.equal(await until(async () => (await cookies()) === 1), true);
    await velo.win.evaluate(async () => {
      for (const t of await window.velo.tabs.list()) if (t.url.includes('127.0.0.1')) await window.velo.tabs.close(t.id);
    });
    // 15 s of grace, in case the site is opened again.
    assert.equal(await until(async () => (await cookies()) === 0, 25_000, 500), true);
  } finally {
    await velo.close();
    server.close();
  }
});

test('containers forget their sites too', async () => {
  const server = await serve((req, res) => {
    res.setHeader('Set-Cookie', 'box=1; Max-Age=3600');
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Box</title>');
  });
  const velo = await launchVelo({ settings: { onboarded: true, httpsOnly: false, forgetSitesOnClose: true } });
  const cookies = () => velo.app.evaluate(async ({ session }) => (await session.fromPartition('persist:container-work').cookies.get({ name: 'box' })).length);
  try {
    await velo.captureMenus();
    await velo.win.evaluate(() => window.velo.tabs.containerMenu({ x: 10, y: 10, width: 10, height: 10 }));
    await velo.pick('Lavoro');
    const tab = await until(async () => (await velo.tabs()).find((t) => t.container === 'work'));
    await velo.win.evaluate(([id, url]) => window.velo.tabs.navigate(id, url), [tab.id, `http://127.0.0.1:${server.port}/`]);
    assert.equal(await until(async () => (await cookies()) === 1), true);
    await velo.win.evaluate((id) => window.velo.tabs.close(id), tab.id);
    assert.equal(await until(async () => (await cookies()) === 0, 25_000, 500), true);
  } finally {
    await velo.close();
    server.close();
  }
});
