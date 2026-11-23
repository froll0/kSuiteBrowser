const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchVelo, sleep, until } = require('./helpers.cjs');
const { startMockInfomaniak } = require('./mock-infomaniak.cjs');

const tab = (velo, label) => velo.win.locator('#panel-tabs button', { hasText: label }).first().click();
/** The panel is open by default with an account; opens it otherwise. */
async function openPanel(velo) {
  await sleep(500);
  if (!(await velo.win.evaluate(() => document.body.classList.contains('panel-open')))) await velo.menu('Mostra/nascondi pannello cloud');
  await velo.win.waitForSelector('#panel-tabs button');
}
const panelText = (velo) => velo.win.evaluate(() => document.getElementById('panel-body').innerText);

test('cloud panel: mail, calendar and kDrive from the account', async () => {
  const mock = await startMockInfomaniak();
  const velo = await launchVelo({ env: mock.env });
  try {
    await openPanel(velo);
    assert.match(await until(async () => ((await panelText(velo)).includes('Riunione di progetto') ? panelText(velo) : null)), /Giulia Bianchi[\s\S]*Preventivo per il sito nuovo/);

    await tab(velo, 'Mail');
    await velo.win.waitForSelector('#panel-body .section-head button.primary');
    assert.equal(await velo.win.$('#panel-body form.compose'), null, 'the message form opens on request');
    await velo.win.click('#panel-body .section-head button.primary');
    await velo.win.waitForSelector('#panel-body form.compose');

    await tab(velo, 'Agenda');
    assert.match(await until(async () => ((await panelText(velo)).includes('Dentista') ? panelText(velo) : null)), /Prossimi 7 giorni/i);

    await tab(velo, 'kDrive');
    await velo.win.waitForSelector('#panel-body .file-icon.kind-fileText');
    assert.match(await panelText(velo), /Preventivo sito\.pdf\s+239 kB/);
  } finally {
    await velo.close();
    mock.close();
  }
});

test('cloud panel errors are in plain words, details folded away', async () => {
  const mock = await startMockInfomaniak({ fail: { '/1/calendar/pim/event': { status: 422, body: { code: 'validation_failed', description: 'Validation failed' } } } });
  const velo = await launchVelo({ env: mock.env });
  try {
    await openPanel(velo);
    await tab(velo, 'Agenda');
    const box = await until(() => velo.win.evaluate(() => document.querySelector('#panel-body .error')?.innerText ?? null));
    assert.match(box, /^Il calendario non ha accettato la richiesta\./);
    assert.doesNotMatch(box, /422|validation_failed/, 'the code stays in the details');
    assert.equal(await velo.win.evaluate(() => document.querySelector('#panel-body .error details code').textContent.includes('Errore API 422 [validation_failed]')), true);
    assert.ok(await velo.win.$('#panel-body .error button.link'), 'a Retry button');
    await sleep(100);
  } finally {
    await velo.close();
    mock.close();
  }
});
