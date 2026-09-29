// Testes do serviço de atualização: node --test scripts/test-updater.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { detectMode, isNewer, createUpdaterService } = require('../electron/updater/service.js');

/**
 * electron-updater falso que reproduz o que importa: `downloadUpdate()` baixa a versão que a ÚLTIMA
 * checagem enxergou (cache), não a que existe agora. `feed` é a versão publicada no GitHub.
 */
function fakeAutoUpdater(current, feed) {
  const u = new EventEmitter();
  u.feed = feed;
  u.cached = null;
  u.log = [];
  u.offline = false;
  u.checkForUpdates = async () => {
    u.log.push('check');
    if (u.offline) { u.emit('error', new Error('offline')); throw new Error('offline'); }
    u.emit('checking-for-update');
    u.cached = u.feed;
    if (isNewer(u.feed, current)) u.emit('update-available', { version: u.feed });
    else u.emit('update-not-available', { version: u.feed });
    return { updateInfo: { version: u.feed } };
  };
  u.downloadUpdate = async () => {
    u.log.push('download:' + u.cached);
    u.emit('download-progress', { percent: 50 });
    u.emit('update-downloaded', { version: u.cached });
  };
  u.quitAndInstall = () => u.log.push('install');
  return u;
}
const svcWith = (au, current = '0.1.10') => createUpdaterService({
  isPackaged: true, platform: 'win32', portableDir: null, currentVersion: current, autoUpdater: au,
});

test('detectMode is "unsupported" when the app is not packaged (dev mode)', () => {
  assert.equal(detectMode({ isPackaged: false, platform: 'win32', portableDir: null }), 'unsupported');
});

test('detectMode is "check-only" on macOS', () => {
  assert.equal(detectMode({ isPackaged: true, platform: 'darwin', portableDir: null }), 'check-only');
});

test('detectMode is "check-only" for the Windows portable build', () => {
  assert.equal(detectMode({ isPackaged: true, platform: 'win32', portableDir: 'C:\\Users\\x\\Downloads' }), 'check-only');
});

test('detectMode is "full" for an installed Windows (NSIS) app', () => {
  assert.equal(detectMode({ isPackaged: true, platform: 'win32', portableDir: null }), 'full');
});

test('detectMode is "full" on Linux (AppImage)', () => {
  assert.equal(detectMode({ isPackaged: true, platform: 'linux', portableDir: null }), 'full');
});

test('isNewer detects a newer patch version', () => {
  assert.equal(isNewer('0.1.43', '0.1.42'), true);
  assert.equal(isNewer('0.1.42', '0.1.42'), false);
  assert.equal(isNewer('0.1.41', '0.1.42'), false);
});

test('isNewer detects a newer minor/major regardless of patch', () => {
  assert.equal(isNewer('0.2.0', '0.1.99'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
});

test('isNewer tolerates a v-prefixed tag', () => {
  assert.equal(isNewer('v0.1.43', '0.1.42'), true);
});

test('isNewer returns false for unparsable input instead of throwing', () => {
  assert.equal(isNewer('not-a-version', '0.1.0'), false);
});

test('download() fetches the newest version even if a newer release appeared after the last check', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  await svc.check();
  assert.equal(svc.get().status, 'available');
  assert.equal(svc.get().latestVersion, '0.1.11');
  au.feed = '0.1.12'; // a N+1 saiu depois da verificação
  await svc.download();
  assert.deepEqual(au.log, ['check', 'check', 'download:0.1.12']); // recheca antes de baixar
  assert.equal(svc.get().status, 'downloaded');
  assert.equal(svc.get().latestVersion, '0.1.12');
});

test('download() does nothing when the release is gone by the time the user clicks', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  await svc.check();
  au.feed = '0.1.10';
  await svc.download();
  assert.equal(svc.get().status, 'not-available');
  assert.ok(!au.log.some((l) => l.startsWith('download')));
});

test('install() goes straight to the newest: downloads it and installs only that one', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  await svc.check();
  await svc.download();
  assert.equal(svc.get().status, 'downloaded');
  assert.equal(svc.get().latestVersion, '0.1.11');
  au.log.length = 0;
  au.feed = '0.1.12';
  await svc.install();
  assert.deepEqual(au.log, ['check', 'download:0.1.12', 'install']);
  assert.equal(svc.get().latestVersion, '0.1.12');
});

test('install() with nothing newer installs the downloaded version right away', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  await svc.check();
  await svc.download();
  au.log.length = 0;
  await svc.install();
  assert.deepEqual(au.log, ['check', 'install']);
});

test('install() still installs the downloaded version when the recheck fails (offline)', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  await svc.check();
  await svc.download();
  au.offline = true;
  await svc.install();
  assert.equal(svc.get().status, 'downloaded'); // o erro da checagem silenciosa não derruba o download pronto
  assert.ok(au.log.includes('install'));
});

test('check() while an update is downloaded keeps "downloaded" (no flicker) and only swaps for a newer version', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const states = [];
  const svc = createUpdaterService({ isPackaged: true, platform: 'win32', portableDir: null, currentVersion: '0.1.10', autoUpdater: au, broadcast: (s) => states.push(s.status) });
  await svc.check();
  await svc.download();
  states.length = 0;
  await svc.check(); // nada novo
  assert.equal(svc.get().status, 'downloaded');
  assert.deepEqual(states, []); // nenhuma transição visível (checking/not-available)
  au.feed = '0.1.12';
  await svc.check();
  assert.equal(svc.get().status, 'available');
  assert.equal(svc.get().latestVersion, '0.1.12');
});

test('check() is ignored while checking or downloading', async () => {
  const au = fakeAutoUpdater('0.1.10', '0.1.11');
  const svc = svcWith(au);
  au.emit('download-progress', { percent: 10 });
  assert.equal(svc.get().status, 'downloading');
  await svc.check();
  assert.deepEqual(au.log, []);
});

test('check-only mode always points to /releases/latest', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.1.11', html_url: 'https://github.com/o/r/releases/tag/v0.1.11' }) });
  try {
    const svc = createUpdaterService({ isPackaged: true, platform: 'darwin', portableDir: null, currentVersion: '0.1.10', owner: 'o', repo: 'r' });
    await svc.check();
    assert.equal(svc.get().status, 'available');
    assert.equal(svc.get().releaseUrl, 'https://github.com/o/r/releases/latest');
  } finally { globalThis.fetch = realFetch; }
});
