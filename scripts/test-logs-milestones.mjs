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

const ms = [
  { id: 'deploy:1000', kind: 'deploy', ts: 1000, artifacts: ['wgPortalRH'], label: 'deploy wgPortalRH' },
  { id: 'merge:5000', kind: 'merge', ts: 5000, files: ['src/com/x/WorkflowService.java'], label: '#126', pr: 126 },
];
const rel = (m) => m.files || [];

test('prNumber: merge do GitHub e squash', () => {
  assert.equal(M.prNumber('Merge pull request #126 from tonissx/x'), 126);
  assert.equal(M.prNumber('Logs: abrir outro log (#127)'), 127);
  assert.equal(M.prNumber('ajuste'), null);
});

test('frameBase e touchesFrame', () => {
  assert.equal(M.frameBase('com.fluig.workflow.WorkflowService$1.start'), 'WorkflowService');
  assert.equal(M.touchesFrame(['src/com/x/WorkflowService.java'], 'com.x.WorkflowService.start'), true);
  assert.equal(M.touchesFrame(['src/Outro.java'], 'com.x.WorkflowService.start'), false);
  assert.equal(M.touchesFrame(['a.js'], ''), false);
});

test('attribute: marco anterior, intervalo e suspeito forte', () => {
  const r = M.attribute({ first: 5000 + 14 * 60e3, frame: 'com.x.WorkflowService.start' }, ms, 0, rel);
  assert.equal(r.milestone.id, 'merge:5000');
  assert.equal(r.gapMs, 14 * 60e3);
  assert.equal(r.strong, true);
  assert.equal(r.faded, false);
});

test('attribute: erro no começo do log é pré-existente', () => {
  assert.deepEqual(M.attribute({ first: 30e3, frame: '' }, ms, 0, rel), { preexisting: true });
});

test('attribute: log que começa depois do marco não atribui', () => {
  assert.deepEqual(M.attribute({ first: 10 * 60e3, frame: '' }, ms, 6000, rel), { preexisting: true });
});

test('attribute: mais de 24 h fica sem destaque', () => {
  assert.equal(M.attribute({ first: 5000 + 2 * 86400e3, frame: '' }, ms, 0, rel).faded, true);
});

test('attribute: sem marco anterior devolve null', () => {
  assert.equal(M.attribute({ first: 500, frame: '' }, ms, 0, rel), null);
});

test('commitsInDeploy: só commits na pasta do artefato entre os dois deploys', () => {
  const dep = { kind: 'deploy', ts: 10000, artifacts: ['wgPortalRH'] };
  const prev = { kind: 'deploy', ts: 2000, artifacts: ['wgPortalRH'] };
  const commits = [
    { hash: 'a', ts: 1500, files: ['wgPortalRH/src/main/a.js'] },
    { hash: 'b', ts: 3000, files: ['wgportalrh/src/b.js'] },
    { hash: 'c', ts: 4000, files: ['outra/c.js'] },
    { hash: 'd', ts: 12000, files: ['wgPortalRH/d.js'] },
  ];
  assert.deepEqual(M.commitsInDeploy(dep, prev, commits).map((c) => c.hash), ['b']);
});

test('commitsInDeploy: sem deploy anterior usa 7 dias', () => {
  const dep = { kind: 'deploy', ts: 10 * 86400e3, artifacts: ['wgA'] };
  const commits = [
    { hash: 'old', ts: 2 * 86400e3, files: ['wgA/a.js'] },
    { hash: 'new', ts: 5 * 86400e3, files: ['wgA/a.js'] },
  ];
  assert.deepEqual(M.commitsInDeploy(dep, null, commits).map((c) => c.hash), ['new']);
});

test('mergeMilestones respeita os tipos ligados', () => {
  const d = [{ id: 'restart:3', kind: 'restart', ts: 3 }];
  const m = [{ id: 'merge:2', kind: 'merge', ts: 2 }];
  const u = [{ id: 'x', kind: 'manual', ts: 1 }];
  assert.deepEqual(M.mergeMilestones(d, u, m).map((x) => x.ts), [1, 2, 3]);
  assert.deepEqual(M.mergeMilestones(d, u, m, { deploy: false, merge: true, manual: true }).map((x) => x.kind), ['manual', 'merge']);
});

test('suggestRepo pela pasta da widget', () => {
  assert.equal(M.suggestRepo(['wgPortalRH'], [{ path: 'C:/a', folders: ['docs'] }, { path: 'C:/b', folders: ['WGPortalRH'] }]), 'C:/b');
  assert.equal(M.suggestRepo(['x'], [{ path: 'C:/a', folders: ['docs'] }]), null);
});

test('previousSameArtifact: deploy anterior com artefato em comum', () => {
  const list = [
    { id: 'a', kind: 'deploy', ts: 1, artifacts: ['wgA'] },
    { id: 'b', kind: 'deploy', ts: 2, artifacts: ['WGB'] },
    { id: 'c', kind: 'merge', ts: 3, files: [] },
    { id: 'd', kind: 'deploy', ts: 4, artifacts: ['wgb'] },
  ];
  assert.equal(M.previousSameArtifact(list, list[3]).id, 'b');
  assert.equal(M.previousSameArtifact(list, list[0]), null);
});
