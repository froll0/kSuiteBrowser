const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchVelo, serve, until } = require('./helpers.cjs');

const SHOP = `<title>Shop</title>
<form><input id="code" name="otp" autocomplete="one-time-code" inputmode="numeric"></form>
<form><input id="fn" name="firstname"><input id="ln" name="lastname"><input id="st" autocomplete="address-line1"><input id="zip" name="cap"><input id="city" name="city"><input id="mail" type="email"></form>
<form><input id="cc" autocomplete="cc-number"><input id="exp" autocomplete="cc-exp"><input id="holder" autocomplete="cc-name"></form>`;

test('two-factor codes, addresses and cards fill forms', async () => {
  const server = await serve((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(SHOP);
  }, { secure: true });
  const origin = `https://shop.test:${server.port}`;
  const velo = await launchVelo();
  try {
    await velo.captureMenus();
    const pw = await velo.openTab('velo://passwords/', 'velo://passwords');
    const inv = (ch, ...a) => pw.evaluate(([ch, a]) => window.veloInternal.invoke(ch, ...a), [ch, a]);
    assert.equal((await inv('internal:pw:set-primary', 'Prova-123!')).ok, true);
    const login = (await inv('internal:pw:add', { url: origin, username: 'anna', password: 'x' })).data;
    assert.equal((await inv('internal:pw:update', login.id, { totp: 'otpauth://totp/Shop:anna?secret=JBSWY3DPEHPK3PXP' })).ok, true);
    assert.equal((await inv('internal:pw:update', login.id, { totp: 'abc' })).ok, false);
    assert.equal((await inv('internal:af:save-address', { name: 'Anna Rossi', street: 'Via Roma 1', postalCode: '20100', city: 'Milano', email: 'anna@example.org' })).ok, true);
    assert.equal((await inv('internal:af:save-card', { number: '4111 1111 1111 1112', expMonth: 5, expYear: 29 })).ok, false, 'Luhn check');
    assert.equal((await inv('internal:af:save-card', { name: 'ANNA ROSSI', number: '4111 1111 1111 1111', expMonth: 5, expYear: 29 })).ok, true);

    const shop = await velo.openTab(`${origin}/`, 'shop.test');
    await shop.waitForSelector('#code');
    await shop.click('#code');
    assert.deepEqual(await until(velo.menuLabels), ['Codice di verifica (2FA)', `anna — shop.test:${server.port}`]);
    const before = (await inv('internal:pw:totp')).data[login.id].code;
    await velo.pick('anna');
    const filled = await until(() => shop.inputValue('#code'));
    const after = (await inv('internal:pw:totp')).data[login.id].code;
    // The code may roll over meanwhile: it is one of the two.
    assert.ok([before, after].includes(filled), `${filled} not in ${before}/${after}`);

    await shop.click('#fn');
    assert.equal((await until(velo.menuLabels))[0], 'Anna Rossi, Via Roma 1, Milano');
    await velo.pick('Anna Rossi');
    assert.deepEqual(await until(async () => {
      const v = await shop.evaluate(() => ['fn', 'ln', 'st', 'zip', 'city', 'mail'].map((id) => document.getElementById(id).value));
      return v[0] ? v : null;
    }), ['Anna', 'Rossi', 'Via Roma 1', '20100', 'Milano', 'anna@example.org']);

    await shop.click('#cc');
    assert.equal((await until(velo.menuLabels))[0], '•••• 1111 — 05/29 · ANNA ROSSI');
    await velo.pick('••••');
    assert.deepEqual(await until(async () => {
      const v = await shop.evaluate(() => ['cc', 'exp', 'holder'].map((id) => document.getElementById(id).value));
      return v[0] ? v : null;
    }), ['4111111111111111', '05/29', 'ANNA ROSSI']);
  } finally {
    await velo.close();
    server.close();
  }
});
