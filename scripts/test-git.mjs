// Testes da ferramenta Git: módulos puros e o serviço contra repositórios temporários reais.
// node --test scripts/test-git.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const P = require('../src/git/parse.js');
const { layoutGraph } = require('../src/git/graph.js');
const O = require('../src/git/ops.js');

/* ─────────────── parse ─────────────── */

test('parseStatus: branch, staged/unstaged, renomeado, novo e conflito', () => {
  const out = [
    '# branch.oid 1234abcd', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 aaa bbb src/a.js',
    '1 .M N... 100644 100644 100644 aaa bbb com espaço.txt',
    '1 MM N... 100644 100644 100644 aaa bbb both.js',
    '2 R. N... 100644 100644 100644 aaa bbb R100 novo.js', 'velho.js',
    '1 A. N... 000000 100644 100644 000 bbb added.js',
    '1 .D N... 100644 100644 000000 aaa aaa gone.js',
    'u UU N... 100644 100644 100644 100644 a b c conflito.js',
    '? untracked file.txt',
    '! ignored.log',
    '',
  ].join('\0');
  const s = P.parseStatus(out);
  assert.deepEqual(s.branch, { oid: '1234abcd', head: 'main', detached: false, upstream: 'origin/main', ahead: 2, behind: 1 });
  assert.deepEqual(s.staged, [
    { path: 'src/a.js', kind: 'modified' }, { path: 'both.js', kind: 'modified' },
    { path: 'novo.js', orig: 'velho.js', kind: 'renamed' }, { path: 'added.js', kind: 'added' },
  ]);
  assert.deepEqual(s.unstaged, [{ path: 'com espaço.txt', kind: 'modified' }, { path: 'both.js', kind: 'modified' }, { path: 'gone.js', kind: 'deleted' }]);
  assert.deepEqual(s.untracked, ['untracked file.txt']);
  assert.deepEqual(s.conflicts, [{ path: 'conflito.js', code: 'UU' }]);
  const empty = P.parseStatus('# branch.oid (initial)\0# branch.head (detached)\0');
  assert.equal(empty.branch.oid, null);
  assert.equal(empty.branch.detached, true);
});

test('parseDecorations e parseLog', () => {
  assert.deepEqual(P.parseDecorations('HEAD -> main, tag: v1.0, origin/main, feature/x, refs/devkit/backup/1, refs/stash'), [
    { type: 'head', name: 'HEAD' }, { type: 'branch', name: 'main', current: true },
    { type: 'tag', name: 'v1.0' }, { type: 'remote', name: 'origin/main' }, { type: 'remote', name: 'feature/x' },
  ]);
  const log = P.parseLog(['a1\x1fb1 c1\x1fAna\x1fana@x\x1f1700000000\x1fMerge x\x1fHEAD -> main\x1e', '\nb1\x1f\x1fBia\x1fbia@x\x1f1690000000\x1finicial\x1f\x1e'].join(''));
  assert.equal(log.length, 2);
  assert.deepEqual(log[0].parents, ['b1', 'c1']);
  assert.deepEqual(log[1].parents, []);
  assert.equal(log[1].subject, 'inicial');
  assert.equal(log[0].time, 1700000000);
});

test('parseBranches com upstream e tracking', () => {
  const b = P.parseBranches(['main\x1fh1\x1forigin/main\x1f[ahead 1, behind 2]\x1f100\x1fmsg\x1f*\x1fAna', 'velha\x1fh2\x1forigin/velha\x1f[gone]\x1f90\x1fx\x1f \x1fBia', 'local\x1fh3\x1f\x1f\x1f80\x1fy\x1f \x1fCaio'].join('\n'));
  assert.deepEqual(b[0], { name: 'main', hash: 'h1', upstream: 'origin/main', ahead: 1, behind: 2, gone: false, time: 100, subject: 'msg', current: true, author: 'Ana' });
  assert.equal(b[1].gone, true);
  assert.equal(b[2].upstream, null);
  assert.equal(b[2].current, false);
});

test('describeReflog em português', () => {
  assert.deepEqual(P.describeReflog('commit: ajusta tela'), { kind: 'commit', text: 'Commit: ajusta tela' });
  assert.equal(P.describeReflog('commit (amend): x').kind, 'amend');
  assert.equal(P.describeReflog('checkout: moving from main to feat').text, 'Trocou de main para feat');
  assert.equal(P.describeReflog('reset: moving to HEAD~1').text, 'Voltou para HEAD~1');
  assert.match(P.describeReflog('reset: moving to HEAD').text, /Limpou as mudanças/);
  assert.match(P.describeReflog('reset: moving to refs/devkit/backup/20261004-1/head').text, /Desfez pelo Devkit/);
  const rl = P.parseReflog('h1\x1fHEAD@{1759600000}\x1fcommit: x\x1e\nh2\x1fHEAD@{1759500000}\x1fcheckout: moving from a to b\x1e');
  assert.deepEqual(rl.map((e) => [e.selector, e.time, e.kind]), [['HEAD@{0}', 1759600000, 'commit'], ['HEAD@{1}', 1759500000, 'checkout']]);
  assert.equal(P.describeReflog('merge feat: Fast-forward').text, 'Mesclou feat (avanço direto)');
  assert.equal(P.describeReflog('rebase (finish): returning to refs/heads/x').kind, 'rebase');
  assert.equal(P.describeReflog('algo novo').kind, 'other');
});

test('parseStashes e parseNumstat', () => {
  const st = P.parseStashes('stash@{0}\x1fh\x1f10\x1fOn main: antes de trocar\x1e\nstash@{1}\x1fg\x1f9\x1fWIP on feat: abc subj\x1e');
  assert.deepEqual(st[0], { ref: 'stash@{0}', hash: 'h', time: 10, message: 'antes de trocar', branch: 'main' });
  assert.equal(st[1].branch, 'feat');
  const ns = P.parseNumstat(['3\t1\ta.js', '-\t-\timg.png', '2\t2\t', 'velho.js', 'novo.js', ''].join('\0'));
  assert.deepEqual(ns, [
    { added: 3, deleted: 1, binary: false, path: 'a.js' },
    { added: 0, deleted: 0, binary: true, path: 'img.png' },
    { added: 2, deleted: 2, binary: false, orig: 'velho.js', path: 'novo.js' },
  ]);
});

test('parsePatch e hunkPatch', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt', 'index 111..222 100644', '--- a/a.txt', '+++ b/a.txt',
    '@@ -1,3 +1,3 @@ cabeça', ' um', '-dois', '+DOIS', ' tres',
    '@@ -10,2 +10,3 @@', ' dez', '+onze', ' doze', '\\ No newline at end of file', '',
  ].join('\n');
  const [f] = P.parsePatch(diff);
  assert.equal(f.oldPath, 'a.txt');
  assert.equal(f.hunks.length, 2);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.t, l.old, l.new]), [[' ', 1, 1], ['-', 2, null], ['+', null, 2], [' ', 3, 3]]);
  assert.equal(f.hunks[0].context, 'cabeça');
  assert.equal(f.hunks[1].lines[3].t, '\\');
  assert.equal(P.hunkPatch(f, f.hunks[1]), ['diff --git a/a.txt b/a.txt', 'index 111..222 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -10,2 +10,3 @@', ' dez', '+onze', ' doze', '\\ No newline at end of file', ''].join('\n'));
  const [nf] = P.parsePatch('diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1 @@\n+oi\n');
  assert.equal(nf.oldPath, null);
  assert.equal(nf.newPath, 'n.txt');
  const [bf] = P.parsePatch('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n');
  assert.equal(bf.binary, true);
});

/* ─────────────── grafo ─────────────── */

test('layoutGraph: linha reta, branch e merge', () => {
  // M (merge de F em C) → C → B → A ; F → B
  const commits = [
    { hash: 'M', parents: ['C', 'F'] },
    { hash: 'F', parents: ['B'] },
    { hash: 'C', parents: ['B'] },
    { hash: 'B', parents: ['A'] },
    { hash: 'A', parents: [] },
  ];
  const { rows, width } = layoutGraph(commits);
  assert.equal(width, 2);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0, 0, 0]);
  // M: raia 0 segue para C (coluna 0); raia 1 nasce do merge e vai até F (coluna 1).
  assert.deepEqual(rows[0].segments, [{ x1: 0, x2: 0, color: 0, kind: 'pass' }, { x1: 0, x2: 1, color: 1, kind: 'merge' }]);
  // F: a raia 1 dele converge em B (coluna 0) duas linhas abaixo; da linha F para C, ela passa em 1.
  assert.deepEqual(rows[1].segments.map((s) => [s.x1, s.x2]), [[0, 0], [1, 1]]);
  // C: as duas raias esperam B → ambas terminam na coluna 0.
  assert.deepEqual(rows[2].segments.map((s) => [s.x1, s.x2, s.kind]), [[0, 0, 'pass'], [1, 0, 'join']]);
  assert.deepEqual(rows[4].segments, []);
});

test('layoutGraph: merge num pai que já tem raia mantém a raia', () => {
  // X e Y são pontas; M2 mescla Y; Y ainda aparece depois.
  const commits = [
    { hash: 'Y2', parents: ['Y'] },
    { hash: 'M2', parents: ['X', 'Y'] },
    { hash: 'Y', parents: ['B'] },
    { hash: 'X', parents: ['B'] },
    { hash: 'B', parents: [] },
  ];
  const { rows } = layoutGraph(commits);
  assert.equal(rows[0].col, 0);
  assert.equal(rows[1].col, 1);
  // Em M2: a raia 0 (Y2→Y) continua (pass) e há uma linha extra de M2 até ela (merge).
  const segs = rows[1].segments.map((s) => [s.x1, s.x2, s.kind]);
  assert.ok(segs.some(([a, b, k]) => a === 0 && k === 'pass'));
  assert.ok(segs.some(([a, b, k]) => a === 1 && b === 0 && k === 'merge'));
});

/* ─────────────── ops ─────────────── */

test('ops: argumentos, risco e validação', () => {
  const st = O.buildOp({ op: 'stage', paths: ['a b.txt'] });
  assert.deepEqual(st.args, ['add', '--', 'a b.txt']);
  assert.equal(st.risk, 'safe');
  assert.equal(st.display, 'git add -- "a b.txt"');
  assert.deepEqual(O.buildOp({ op: 'unstage', paths: ['x'] }, { unborn: true }).args, ['rm', '--cached', '-r', '-q', '--', 'x']);
  const c = O.buildOp({ op: 'commit', message: 'Título\n\ncorpo', amend: true });
  assert.deepEqual(c.args, ['commit', '--amend', '-F', '-']);
  assert.equal(c.stdin, 'Título\n\ncorpo');
  assert.equal(c.risk, 'rewrite');
  assert.equal(c.backup, true);
  assert.equal(c.display, 'git commit --amend -m Título');
  assert.deepEqual(O.buildOp({ op: 'branch.create', name: 'feat/x', from: 'main', checkout: true }).args, ['switch', '-c', 'feat/x', 'main']);
  assert.equal(O.buildOp({ op: 'branch.delete', name: 'x', force: true }).risk, 'discard');
  assert.equal(O.buildOp({ op: 'reset', to: 'HEAD~2', mode: 'hard' }).risk, 'discard');
  assert.equal(O.buildOp({ op: 'discard', paths: ['a'] }).backup, true);

  assert.throws(() => O.buildOp({ op: 'rm -rf' }), /desconhecida/);
  assert.throws(() => O.buildOp({ op: 'branch.create', name: '-delete-tudo' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'branch.create', name: 'a..b' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'reset', to: '--hard', mode: 'soft' }), /inválida/);
  assert.throws(() => O.buildOp({ op: 'stage', paths: ['../fora.txt'] }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'stage', paths: ['C:/Windows/x'] }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'stage', paths: [] }), /Nenhum/);
  assert.throws(() => O.buildOp({ op: 'stash.drop', ref: 'HEAD' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'commit', message: '   ' }), /mensagem/);
  assert.throws(() => O.buildOp({ op: 'stageHunk', patch: 'rm -rf /' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'hasOwnProperty' }), /desconhecida/);
});

test('validBranchName segue as regras do git', () => {
  for (const ok of ['main', 'feat/login', 'fix-123', 'v1.2', 'usuário/tarefa']) assert.ok(O.validBranchName(ok), ok);
  for (const bad of ['', 'com espaço', '-x', 'a..b', 'a/', 'x.lock', 'a@{1}', '@', 'a//b', '.oculta', 'a/.b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b']) assert.ok(!O.validBranchName(bad), bad);
});

/* ─────────────── serviço (repositórios temporários reais) ─────────────── */

const { createGitService } = require('../electron/git/service.js');

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
const write = (dir, f, text) => { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), text); };
const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');

/** Repo novo com identidade local e um commit inicial (ou nenhum, com empty: true). */
function makeRepo(root, name = 'repo', { empty = false } = {}) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.name', 'Teste');
  sh(dir, 'config', 'user.email', 'teste@devkit');
  sh(dir, 'config', 'core.autocrlf', 'false');
  if (!empty) {
    write(dir, 'a.txt', 'um\ndois\ntres\nquatro\ncinco\nseis\nsete\noito\nnove\ndez\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'inicial');
  }
  return dir;
}

async function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'devkit-git-'));
  const events = [];
  const svc = createGitService({ file: path.join(root, 'git-repos.json'), broadcast: (e) => events.push(e), watch: () => ({ close() {} }) });
  await svc.init();
  return { root, svc, events, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('serviço: lista de repositórios, scan e repositório fora da lista', async () => {
  const t = await setup();
  try {
    assert.equal((await t.svc.version()).available, true);
    const dir = makeRepo(t.root, 'proj');
    makeRepo(path.join(t.root, 'fundo', 'mais'), 'aninhado');
    mkdirSync(path.join(t.root, 'node_modules', 'pkg', '.git'), { recursive: true });
    const top = await t.svc.add(dir);
    assert.equal(t.svc.list().repos.length, 1);
    await t.svc.add(dir); // repetido não duplica
    assert.equal(t.svc.list().repos.length, 1);
    await assert.rejects(t.svc.add(t.root), /não é um repositório/);
    const found = await t.svc.scan(t.root, 4);
    assert.equal(found.length, 1);
    assert.match(found[0], /aninhado$/);
    await assert.rejects(t.svc.status(path.join(t.root, 'fundo', 'mais', 'aninhado')), /não está na lista/);
    const persisted = JSON.parse(readFileSync(path.join(t.root, 'git-repos.json'), 'utf8'));
    assert.equal(persisted.repos[0].name, 'proj');
    await t.svc.remove(top);
    assert.equal(t.svc.list().repos.length, 0);
  } finally { t.done(); }
});

test('serviço: status, stage, commit, log e detalhes do commit', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'a.txt', 'um\nDOIS\ntres\nquatro\ncinco\nseis\nsete\noito\nnove\ndez\n');
    write(dir, 'novo arquivo.txt', 'oi\n');
    let s = await t.svc.status(repo);
    assert.equal(s.branch.head, 'main');
    assert.deepEqual(s.unstaged.map((f) => f.path), ['a.txt']);
    assert.deepEqual(s.untracked, ['novo arquivo.txt']);
    const r = await t.svc.exec(repo, { op: 'stageAll' });
    assert.equal(r.display, 'git add -A');
    s = await t.svc.status(repo);
    assert.equal(s.staged.length, 2);
    await t.svc.exec(repo, { op: 'commit', message: 'Segundo commit\n\ncom corpo' });
    const log = await t.svc.log(repo);
    assert.deepEqual(log.map((c) => c.subject), ['Segundo commit', 'inicial']);
    assert.ok(log[0].refs.some((x) => x.name === 'main' && x.current));
    const c = await t.svc.commit(repo, log[0].hash);
    assert.equal(c.message, 'Segundo commit\n\ncom corpo');
    assert.deepEqual(c.files.map((f) => [f.path, f.added, f.deleted]).sort(), [['a.txt', 1, 1], ['novo arquivo.txt', 1, 0]]);
    const root = await t.svc.commit(repo, log[1].hash);
    assert.equal(root.files.length, 1);
    const d = await t.svc.diff(repo, { area: 'commit', hash: log[0].hash, path: 'a.txt' });
    assert.match(d.patch, /-dois\n\+DOIS/);
    assert.ok(t.events.some((e) => e.type === 'changed'));
  } finally { t.done(); }
});

test('serviço: stage e unstage de um trecho só', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'a.txt', 'UM\ndois\ntres\nquatro\ncinco\nseis\nsete\noito\nnove\nDEZ\n');
    const [file] = P.parsePatch((await t.svc.diff(repo, { area: 'unstaged', path: 'a.txt' })).patch);
    assert.equal(file.hunks.length, 2);
    await t.svc.exec(repo, { op: 'stageHunk', patch: P.hunkPatch(file, file.hunks[0]) });
    const staged = (await t.svc.diff(repo, { area: 'staged', path: 'a.txt' })).patch;
    assert.match(staged, /\+UM/);
    assert.doesNotMatch(staged, /DEZ/);
    assert.match((await t.svc.diff(repo, { area: 'unstaged', path: 'a.txt' })).patch, /\+DEZ/);
    const [sf] = P.parsePatch(staged);
    await t.svc.exec(repo, { op: 'unstageHunk', patch: P.hunkPatch(sf, sf.hunks[0]) });
    assert.equal((await t.svc.diff(repo, { area: 'staged', path: 'a.txt' })).patch, '');
    assert.equal(read(dir, 'a.txt').startsWith('UM'), true); // o arquivo não muda
  } finally { t.done(); }
});

test('serviço: descartar mudanças e desfazer pelo ponto de volta', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'a.txt', 'trabalho importante\n');
    const r = await t.svc.exec(repo, { op: 'discard', paths: ['a.txt'] });
    assert.ok(r.backup);
    assert.equal(r.risk, 'discard');
    assert.match(read(dir, 'a.txt'), /^um\n/);
    const [b] = await t.svc.backups(repo);
    assert.equal(b.id, r.backup);
    assert.equal(b.kind, 'state');
    assert.ok(b.refs.wip);
    assert.ok(sh(dir, 'for-each-ref', 'refs/devkit').includes(`refs/devkit/backup/${b.id}/head`));
    const res = await t.svc.restoreBackup(repo, b.id);
    assert.equal(res.ok, true);
    assert.equal(read(dir, 'a.txt'), 'trabalho importante\n');
    // O desfazer também deixou um ponto de volta.
    assert.equal((await t.svc.backups(repo))[0].title, 'Desfazer pelo Devkit');
    // Os pontos de volta não aparecem no histórico.
    assert.ok((await t.svc.log(repo)).every((c) => c.refs.every((x) => !x.name.includes('devkit'))));
  } finally { t.done(); }
});

test('serviço: desfazer o último commit e voltar atrás', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'b.txt', 'b\n');
    await t.svc.exec(repo, { op: 'stageAll' });
    await t.svc.exec(repo, { op: 'commit', message: 'commit errado' });
    const r = await t.svc.exec(repo, { op: 'undo.commit' });
    assert.deepEqual((await t.svc.log(repo)).map((c) => c.subject), ['inicial']);
    assert.deepEqual((await t.svc.status(repo)).staged.map((f) => f.path), ['b.txt']);
    await t.svc.restoreBackup(repo, r.backup);
    assert.deepEqual((await t.svc.log(repo)).map((c) => c.subject), ['commit errado', 'inicial']);
    const rl = await t.svc.reflog(repo);
    assert.equal(rl[0].kind, 'reset');
    assert.ok(Math.abs(rl[0].time - Date.now() / 1000) < 120); // hora do movimento, não do commit
    assert.ok(rl.some((e) => e.kind === 'commit'));
  } finally { t.done(); }
});

test('serviço: branches — criar, trocar com stash, mescladas, comparar, excluir e recuperar', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    await t.svc.exec(repo, { op: 'branch.create', name: 'feat/x', checkout: true });
    write(dir, 'x.txt', 'x\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'feat x');
    await t.svc.exec(repo, { op: 'branch.create', name: 'velha' });
    // Trocar com mudanças pendentes, guardando antes.
    write(dir, 'a.txt', 'pendente\n');
    await t.svc.exec(repo, { op: 'branch.switch', name: 'main', stash: true });
    const s = await t.svc.status(repo);
    assert.equal(s.branch.head, 'main');
    assert.equal(s.unstaged.length, 0);
    const st = await t.svc.stashes(repo);
    assert.equal(st.length, 1);
    assert.match(st[0].message, /Devkit: guardado ao trocar de feat\/x para main/);
    assert.deepEqual((await t.svc.stashFiles(repo, 'stash@{0}')).map((f) => f.path), ['a.txt']);

    const b = await t.svc.branches(repo);
    assert.equal(b.base, 'main');
    const fx = b.branches.find((x) => x.name === 'feat/x');
    assert.equal(fx.baseAhead, 1);
    assert.equal(fx.merged, false);
    const cmp = await t.svc.compare(repo, 'main', 'feat/x');
    assert.equal(cmp.onlyB, 1);
    assert.deepEqual(cmp.files.map((f) => f.path), ['x.txt']);

    await assert.rejects(t.svc.exec(repo, { op: 'branch.delete', name: 'feat/x' }), /not fully merged/);
    const del = await t.svc.exec(repo, { op: 'branch.delete', name: 'feat/x', force: true });
    assert.ok(!(await t.svc.branches(repo)).branches.some((x) => x.name === 'feat/x'));
    const res = await t.svc.restoreBackup(repo, del.backup);
    assert.match(res.message, /feat\/x/);
    assert.ok((await t.svc.branches(repo)).branches.some((x) => x.name === 'feat/x'));
    await t.svc.exec(repo, { op: 'branch.rename', from: 'velha', to: 'renomeada' });
    assert.ok((await t.svc.branches(repo)).branches.some((x) => x.name === 'renomeada'));
  } finally { t.done(); }
});

test('serviço: stash — guardar, aplicar, descartar e recuperar', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'a.txt', 'mudei\n');
    write(dir, 'novo.txt', 'novo\n');
    await t.svc.exec(repo, { op: 'stash.push', message: 'meu stash', untracked: true });
    assert.equal(read(dir, 'a.txt').startsWith('um'), true);
    assert.equal(existsSync(path.join(dir, 'novo.txt')), false);
    const d = await t.svc.diff(repo, { area: 'stash', ref: 'stash@{0}' });
    assert.match(d.patch, /\+mudei/);
    const drop = await t.svc.exec(repo, { op: 'stash.drop', ref: 'stash@{0}' });
    assert.equal((await t.svc.stashes(repo)).length, 0);
    await t.svc.restoreBackup(repo, drop.backup);
    const [st] = await t.svc.stashes(repo);
    assert.equal(st.message, 'meu stash');
    await t.svc.exec(repo, { op: 'stash.pop', ref: 'stash@{0}' });
    assert.equal(read(dir, 'a.txt'), 'mudei\n');
    assert.equal(read(dir, 'novo.txt'), 'novo\n');
  } finally { t.done(); }
});

test('serviço: excluir arquivo novo guarda cópia e recupera', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'pasta/rascunho.txt', 'rascunho\n');
    const d = await t.svc.diff(repo, { area: 'untracked', path: 'pasta/rascunho.txt' });
    assert.match(d.patch, /@@ -0,0 \+1,1 @@\n\+rascunho/);
    const r = await t.svc.exec(repo, { op: 'removeUntracked', paths: ['pasta/rascunho.txt'] });
    assert.equal(existsSync(path.join(dir, 'pasta/rascunho.txt')), false);
    await t.svc.restoreBackup(repo, r.backup);
    assert.equal(read(dir, 'pasta/rascunho.txt'), 'rascunho\n');
  } finally { t.done(); }
});

test('serviço: pasta com outro repositório dentro (worktree/clone) não quebra o diff', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    makeRepo(path.join(dir, '.claude', 'worktrees'), 'feat-x');
    const s = await t.svc.status(repo);
    assert.deepEqual(s.untracked, ['.claude/worktrees/feat-x/']);
    const d = await t.svc.diff(repo, { area: 'untracked', path: '.claude/worktrees/feat-x/' });
    assert.deepEqual(d, { patch: '', truncated: false, nested: true });
    // Repositório apagado/movido: a mensagem diz isso (não "Git não encontrado").
    rmSync(dir, { recursive: true, force: true });
    await assert.rejects(t.svc.status(repo), /não existe mais/);
  } finally { t.done(); }
});

test('serviço: repositório sem commits e visão geral', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root, 'vazio', { empty: true });
    const repo = await t.svc.add(dir);
    write(dir, 'x.txt', 'x\n');
    const s = await t.svc.status(repo);
    assert.equal(s.unborn, true);
    assert.deepEqual(await t.svc.log(repo), []);
    await t.svc.exec(repo, { op: 'stage', paths: ['x.txt'] });
    assert.equal((await t.svc.status(repo)).staged.length, 1);
    await t.svc.exec(repo, { op: 'unstage', paths: ['x.txt'] });
    assert.equal((await t.svc.status(repo)).staged.length, 0);
    assert.equal((await t.svc.overview(repo)).commits, 0);

    await t.svc.exec(repo, { op: 'stageAll' });
    await t.svc.exec(repo, { op: 'commit', message: 'primeiro' });
    const ov = await t.svc.overview(repo);
    assert.equal(ov.commits, 1);
    assert.equal(ov.branches, 1);
    assert.equal(ov.activity.length, 90);
    assert.equal(ov.activity.at(-1).n, 1);
    assert.equal(ov.authors[0].name, 'Teste');
    assert.deepEqual(ov.hotspots, [{ path: 'x.txt', n: 1 }]);
    const sum = await t.svc.summaries();
    assert.equal(sum[0].branch, 'main');
    assert.equal(sum[0].changes, 0);
  } finally { t.done(); }
});
