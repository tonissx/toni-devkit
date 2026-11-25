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

test('foldersOf: nomes dos dois primeiros níveis, sem raiz e sem repetir', () => {
  assert.deepEqual(M.foldersOf(['wgPortalRH/a.js']), ['wgPortalRH']);
  const f = M.foldersOf(['widgets/wgPortalRH/src/a.js']);
  assert.ok(f.includes('widgets') && f.includes('wgPortalRH'));
  assert.ok(!f.includes('src'));
  assert.deepEqual(M.foldersOf(['README.md']), []);
  assert.deepEqual(M.foldersOf(['x/a.js', 'x/b.js', 'x/y/c.js', 'x/y/d.js']).sort(), ['x', 'y']);
  assert.equal(M.suggestRepo(['wgPortalRH'], [{ path: 'r', folders: M.foldersOf(['widgets/wgPortalRH/src/a.js']) }]), 'r');
});

test('clusterMilestones: mesma coluna vira um grupo; fora do histograma fica de fora', () => {
  const hist = { start: 1000, step: 100, buckets: 10 };
  const list = [
    { id: 'm', kind: 'merge', ts: 1210 },
    { id: 'r', kind: 'restart', ts: 1250 },
    { id: 'x', kind: 'manual', ts: 1500 },
    { id: 'antes', kind: 'deploy', ts: 999 },
    { id: 'depois', kind: 'deploy', ts: 2101 },
    { id: 'fim', kind: 'deploy', ts: 2000 },
  ];
  const c = M.clusterMilestones(list, hist);
  assert.deepEqual(c.map((g) => g.b), [2, 5, 9]);
  assert.deepEqual(c[0].items.map((m) => m.id), ['m', 'r']);
  assert.equal(c[0].kind, 'deploy'); // o restart pesa mais que o merge
  assert.equal(c[1].kind, 'manual');
  assert.deepEqual(c[2].items.map((m) => m.id), ['fim']);
  assert.deepEqual(M.clusterMilestones(list, null), []);
});

test('clusterMilestones: gap junta colunas vizinhas e guarda as colunas de cada um', () => {
  const hist = { start: 0, step: 10, buckets: 20 };
  const list = [{ id: 'a', kind: 'merge', ts: 5 }, { id: 'b', kind: 'merge', ts: 15 }, { id: 'c', kind: 'merge', ts: 35 }, { id: 'd', kind: 'merge', ts: 90 }];
  assert.equal(M.clusterMilestones(list, hist).length, 4);
  const g = M.clusterMilestones(list, hist, 2);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].bs, [0, 1, 3]);
  assert.equal(g[0].b, 0);
  assert.equal(g[0].items.length, 3);
});

test('shortLabel e countMilestones', () => {
  assert.equal(M.shortLabel({ kind: 'restart', artifacts: Array(38).fill('a') }), 'restart·38');
  assert.equal(M.shortLabel({ kind: 'deploy', artifacts: ['wgPortalRH', 'wgB', 'wgC'] }), 'wgPortalRH +2');
  assert.equal(M.shortLabel({ kind: 'merge', pr: 126, hash: 'abcdef123' }), '#126');
  assert.equal(M.shortLabel({ kind: 'merge', pr: null, hash: 'abcdef123' }), 'abcdef1');
  assert.equal(M.shortLabel({ kind: 'manual', label: 'publiquei o formulário de férias' }), 'publiquei o formu…');
  const n = M.countMilestones([{ kind: 'deploy', ts: 1 }, { kind: 'restart', ts: 2 }, { kind: 'merge', ts: 3 }, { kind: 'manual', ts: 9 }], 0, 5);
  assert.deepEqual(n, { deploy: 2, merge: 1, manual: 0 });
});

test('fmtGap: minutos, horas e dias', () => {
  assert.equal(M.fmtGap(30e3), 'menos de 1 min');
  assert.equal(M.fmtGap(14 * 60e3 + 59e3), '14 min');
  assert.equal(M.fmtGap(2 * 3600e3 + 5 * 60e3), '2 h');
  assert.equal(M.fmtGap(86400e3 + 1), '1 dia');
  assert.equal(M.fmtGap(3 * 86400e3), '3 dias');
  assert.equal(M.fmtGap(-1), '');
});

test('afterText: deploy, merge com título cortado em 40, restart e manual', () => {
  assert.equal(M.afterText({ kind: 'deploy', artifacts: ['wgPortalRH'] }, 14 * 60e3), '14 min depois do deploy de wgPortalRH');
  assert.equal(M.afterText({ kind: 'deploy', artifacts: ['wgA', 'wgB', 'wgC'] }, 60e3), '1 min depois do deploy de wgA +2');
  assert.equal(M.afterText({ kind: 'restart', artifacts: ['a', 'b'] }, 3600e3), '1 h depois do restart do servidor');
  const title = 'Logs: abrir outro arquivo quando o anterior rotaciona no servidor';
  const t = M.afterText({ kind: 'merge', pr: 126, label: '#126 ' + title }, 2 * 3600e3);
  assert.equal(t, '2 h depois do #126 ' + title.slice(0, 39).trimEnd() + '…');
  assert.equal(M.afterText({ kind: 'merge', pr: 126, label: '#126 Logs: abrir' }, 2 * 3600e3), '2 h depois do #126 Logs: abrir');
  assert.equal(M.afterText({ kind: 'merge', pr: null, hash: 'abcdef1234', label: 'Ajusta X' }, 60e3), '1 min depois do abcdef1 Ajusta X');
  assert.equal(M.afterText({ kind: 'manual', label: 'publiquei o formulário' }, 60e3), '1 min depois do marco «publiquei o formulário»');
  assert.ok(!/causad/i.test(t));
});

test('touchedFile e strongHint', () => {
  assert.equal(M.touchedFile(['src/x/Outro.java', 'src/com/x/WorkflowService.java'], 'com.x.WorkflowService.start'), 'WorkflowService.java');
  assert.equal(M.touchedFile(['src/Outro.java'], 'com.x.WorkflowService.start'), null);
  assert.equal(M.strongHint({ kind: 'merge', pr: 126 }, 'WorkflowService.java'), 'O #126 alterou WorkflowService.java, onde este erro acontece');
  assert.equal(M.strongHint({ kind: 'merge', pr: null, hash: 'abcdef1234' }, 'A.java'), 'O commit abcdef1 alterou A.java, onde este erro acontece');
  assert.equal(M.strongHint({ kind: 'deploy', artifacts: ['wgPortalRH'] }, 'A.java'), 'Um commit na main desde o deploy anterior de wgPortalRH alterou A.java, onde este erro acontece (estimativa)');
});

test('sortAfterLatest: depois do último marco primeiro, depois por count', () => {
  const g = [{ id: 'a', first: 10, count: 9 }, { id: 'b', first: 500, count: 1 }, { id: 'c', first: 600, count: 5 }, { id: 'd', first: 20, count: 50 }];
  assert.deepEqual(M.sortAfterLatest(g, 400).map((x) => x.id), ['c', 'b', 'd', 'a']);
  assert.deepEqual(M.sortAfterLatest(g, null).map((x) => x.id), ['d', 'a', 'c', 'b']);
});
