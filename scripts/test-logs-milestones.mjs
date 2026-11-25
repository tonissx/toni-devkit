// Testes dos marcos (deploys/merges) da ferramenta Logs: node --test scripts/test-logs-milestones.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../src/logs/milestones.js');

test('matchDeploy: deploy, undeploy, restart e linha comum', () => {
  assert.deepEqual(M.matchDeploy('WFLYSRV0010: Deployed "wgPortalRH.war" (runtime-name : "wgPortalRH.war")'), { kind: 'deploy', artifact: 'wgPortalRH' });
  assert.deepEqual(M.matchDeploy('WFLYSRV0009: Undeployed "wgPortalRH.war" (runtime-name: "wgPortalRH.war")'), { kind: 'undeploy', artifact: 'wgPortalRH' });
  assert.deepEqual(M.matchDeploy('WFLYSRV0025: Fluig iniciado em 45123ms'), { kind: 'restart', artifact: null });
  assert.equal(M.matchDeploy('Widget sem permissão: 42'), null);
});

test('groupBursts: deploys separados viram marcos separados', () => {
  const r = M.groupBursts([{ kind: 'deploy', artifact: 'wgA', ts: 0, i: 1 }, { kind: 'deploy', artifact: 'wgB', ts: 10 * 60e3, i: 9 }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].label, 'deploy wgA');
  assert.deepEqual(r[1].artifacts, ['wgB']);
});

test('groupBursts: restart com 38 deploys vira um marco', () => {
  const ev = Array.from({ length: 38 }, (_, k) => ({ kind: 'deploy', artifact: 'app' + k, ts: 1000 + k * 500, i: k }));
  ev.push({ kind: 'restart', artifact: null, ts: 30000, i: 99 });
  const r = M.groupBursts(ev);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'restart');
  assert.equal(r[0].label, 'restart · 38 apps');
  assert.equal(r[0].ts, 1000);
});

test('groupBursts: rajada sem restart junta nomes', () => {
  const r = M.groupBursts(['wgA', 'wgB', 'wgC', 'wgD'].map((a, k) => ({ kind: 'deploy', artifact: a, ts: k * 1000, i: k })));
  assert.equal(r[0].label, 'deploy wgA, wgB +2');
});
