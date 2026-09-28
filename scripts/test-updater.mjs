// Testes do serviço de atualização: node --test scripts/test-updater.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { detectMode, isNewer } = require('../electron/updater/service.js');

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
