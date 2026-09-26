// Explore the actual downloaded moving dev ZIP, not a rebuilt checkout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

if (process.platform !== 'win32' || !process.argv[2]) throw Error('Expected Windows and downloaded bundle path');
const bundle = process.argv[2];
const evidence = process.argv[3] ?? join(tmpdir(), 'np-dev-card-evidence');
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'np-dev-card-'));
let playing = false;
const media = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const reply = pathname === '/rest/getNowPlaying.view'
    ? { status: 'ok', nowPlaying: { entry: playing ? { username: 'ci-user', title: 'Dev card probe', artist: 'CI artist', duration: 210 } : [] } }
    : { status: 'ok' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 'subsonic-response': reply }));
});
await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
const mediaUrl = `http://127.0.0.1:${media.address().port}`;
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(join(bundle, 'nowplaying.exe'), ['start', '--no-tray', '--no-setup'], {
  cwd: bundle, env: { ...process.env, LOCALAPPDATA: temp, NOWPLAYING_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => output += c);
let browser;
async function eventually(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    if (child.exitCode !== null) throw Error(`App exited ${child.exitCode}: ${output}`);
    try { const result = await check(); if (result) return result; }
    catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  throw Error(`Timed out: ${label}. ${last?.message ?? ''}; process: ${output.slice(-1000)}`);
}
try {
  await eventually(async () => (await fetch(`${base}/settings`)).ok, 'first-run Settings');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/settings`);
  await page.locator('#manual-add summary').click();
  await page.locator('#server-provider').selectOption('navidrome');
  await page.locator('#server-url').fill(mediaUrl);
  await page.locator('#manual-connect').click();
  await page.locator('#signin-username').fill('ci-user');
  await page.locator('#signin-password').fill('ci-demo-password');
  await page.locator('#signin-button').click();
  await page.locator('#card-form').waitFor({ state: 'visible', timeout: 30000 });
  await eventually(async () => (await fetch(`${base}/card.svg`)).ok, 'configured card');
  playing = true;
  await eventually(async () => (await (await fetch(`${base}/card.svg`)).text()).includes('Dev card probe'), 'live mock playback');
  const before = await (await fetch(`${base}/card.svg`)).text();
  assert.match(before, /CI artist/);
  await page.screenshot({ path: join(evidence, 'dev-card-before.png'), fullPage: true });
  await page.locator('#card-theme').selectOption('paper');
  const preview = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/settings/card/preview.svg' && url.searchParams.get('theme') === 'paper'
      && url.searchParams.get('width') === '520' && response.status() === 200;
  });
  await page.locator('#card-width').fill('520');
  await preview;
  await page.waitForFunction(() => {
    const img = document.querySelector('#card-preview');
    return img?.complete && img.naturalWidth === 520 && !img.hidden;
  });
  const cardSave = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await page.locator('#card-save').click();
  const cardSaved = await cardSave;
  assert.equal(cardSaved.status(), 200);
  assert.equal((await cardSaved.json()).card.width, 520);
  const styled = await (await fetch(`${base}/card.svg`)).text();
  assert.match(styled, /Dev card probe/);
  assert.match(styled, /width="520"/);
  assert.match(styled, /fill="#ffffff"/);
  await page.screenshot({ path: join(evidence, 'dev-card-styled.png'), fullPage: true });
  await page.locator('#privacy-hideTitles').check();
  const privacySave = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await page.locator('#privacy-save').click();
  const privacySaved = await privacySave;
  assert.equal(privacySaved.status(), 200);
  assert.equal((await privacySaved.json()).privacy.hideTitles, true);
  const privateCard = await (await fetch(`${base}/card.svg`)).text();
  assert.match(privateCard, /Private media/);
  assert.doesNotMatch(privateCard, /Dev card probe|CI artist/);
  await page.locator('#privacy-hideMusic').check();
  const suppressionSave = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await page.locator('#privacy-save').click();
  const suppressionSaved = await suppressionSave;
  assert.equal(suppressionSaved.status(), 200);
  assert.equal((await suppressionSaved.json()).privacy.hideMusic, true);
  const suppressed = await (await fetch(`${base}/card.svg`)).text();
  assert.match(suppressed, /Nothing playing/);
  assert.doesNotMatch(suppressed, /Dev card probe|CI artist/);
  const config = await readFile(join(temp, 'nowplaying', 'config.json'), 'utf8');
  assert.doesNotMatch(config, /ci-demo-password/);
  console.log('Downloaded dev ZIP: mock playback, card settings save, privacy redaction, kind suppression passed');
} finally {
  await browser?.close();
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  media.closeAllConnections();
  await new Promise(resolve => media.close(resolve));
}
