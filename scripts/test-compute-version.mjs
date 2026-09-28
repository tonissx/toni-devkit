// Testes da lógica de versionamento do release: node --test scripts/test-compute-version.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideVersion, latestOf, parseSemver } from './compute-version.mjs';

test('parseSemver accepts a v-prefixed tag and strips it', () => {
  assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3 });
});

test('parseSemver accepts a bare semver tag', () => {
  assert.deepEqual(parseSemver('0.1.42'), { major: 0, minor: 1, patch: 42 });
});

test('parseSemver rejects a non-semver tag', () => {
  assert.equal(parseSemver('latest'), null);
});

test('latestOf picks the highest semver among mixed valid/invalid tags', () => {
  assert.deepEqual(latestOf(['v0.1.3', 'latest', 'v0.1.10', 'v0.2.0', 'v0.1.9']), { major: 0, minor: 2, patch: 0 });
});

test('latestOf returns null when there are no valid tags', () => {
  assert.equal(latestOf(['latest', 'nightly']), null);
});

test('decideVersion uses package.json major.minor + run number when no release exists yet', () => {
  const v = decideVersion({ pkgMajor: 0, pkgMinor: 1, runNumber: 7, latest: null });
  assert.deepEqual(v, { major: 0, minor: 1, patch: 7, warning: null });
});

test('decideVersion keeps incrementing the patch when major.minor matches the latest release', () => {
  const v = decideVersion({ pkgMajor: 0, pkgMinor: 1, runNumber: 50, latest: { major: 0, minor: 1, patch: 42 } });
  assert.deepEqual(v, { major: 0, minor: 1, patch: 50, warning: null });
});

test('decideVersion falls back to latestPatch+1 when the run number regressed behind the last release', () => {
  const v = decideVersion({ pkgMajor: 0, pkgMinor: 1, runNumber: 3, latest: { major: 0, minor: 1, patch: 42 } });
  assert.deepEqual(v, { major: 0, minor: 1, patch: 43, warning: null });
});

test('decideVersion jumps straight to a manual major.minor bump, ignoring the old patch line', () => {
  const v = decideVersion({ pkgMajor: 0, pkgMinor: 2, runNumber: 5, latest: { major: 0, minor: 1, patch: 42 } });
  assert.deepEqual(v, { major: 0, minor: 2, patch: 5, warning: null });
});

test('decideVersion never regresses below the latest release when package.json was edited backwards, and warns', () => {
  const v = decideVersion({ pkgMajor: 0, pkgMinor: 1, runNumber: 5, latest: { major: 0, minor: 3, patch: 12 } });
  assert.equal(v.major, 0);
  assert.equal(v.minor, 3);
  assert.equal(v.patch, 13);
  assert.match(v.warning, /atrás da última release/);
});
