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
  // Sem merge na base, mas com todos os commits noutra branch: precisa do -D, só que nada se perde.
  const contained = O.buildOp({ op: 'branch.delete', name: 'release/lote-1', force: true, contained: ['release/lote-2'] });
  assert.deepEqual([contained.args, contained.risk], [['branch', '-D', 'release/lote-1'], 'safe']);
  assert.match(contained.explain, /continuam em release\/lote-2/);
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

/* ─────────────── Fase 2: conflitos, rebase, receitas, novas operações ─────────────── */

const C = require('../src/git/conflict.js');
const RB = require('../src/git/rebase.js');
const { RECIPES } = require('../src/git/recipes.js');

test('parseConflicts/resolveConflicts: blocos, diff3, CRLF e escolhas', () => {
  const text = ['a', '<<<<<<< HEAD', 'meu', '=======', 'deles', '>>>>>>> outra', 'b', '<<<<<<< HEAD', 'x', '||||||| base', 'orig', '=======', 'y1', 'y2', '>>>>>>> outra', 'c', ''].join('\r\n');
  const p = C.parseConflicts(text);
  assert.equal(p.eol, '\r\n');
  assert.equal(C.conflictCount(p), 2);
  assert.deepEqual(p.parts[1], { type: 'conflict', ours: ['meu'], base: null, theirs: ['deles'], oursLabel: 'HEAD', theirsLabel: 'outra' });
  assert.deepEqual(p.parts[3].base, ['orig']);
  assert.equal(C.resolveConflicts(p, ['ours', 'theirs']), ['a', 'meu', 'b', 'y1', 'y2', 'c', ''].join('\r\n'));
  assert.equal(C.resolveConflicts(p, ['both', 'both-rev']), ['a', 'meu', 'deles', 'b', 'y1', 'y2', 'x', 'c', ''].join('\r\n'));
  assert.equal(C.resolveConflicts(p, [{ text: 'feito à mão' }, { text: '' }]), ['a', 'feito à mão', 'b', 'c', ''].join('\r\n'));
  // Sem escolha: os marcadores continuam (e hasMarkers acusa).
  const kept = C.resolveConflicts(p, ['ours']);
  assert.ok(C.hasMarkers(kept));
  assert.ok(!C.hasMarkers(C.resolveConflicts(p, ['ours', 'theirs'])));
  // "<<<<<<<" sem fim é texto comum.
  const broken = C.parseConflicts('x\n<<<<<<< HEAD\ny\n');
  assert.equal(C.conflictCount(broken), 0);
  assert.equal(C.resolveConflicts(broken, []), 'x\n<<<<<<< HEAD\ny\n');
});

test('rebase: validação do plano, todo e prévia', () => {
  const commits = [{ hash: 'a1', subject: 'primeiro' }, { hash: 'b2', subject: 'ajuste' }, { hash: 'c3', subject: 'terceiro' }];
  const plan = [{ hash: 'a1', action: 'pick' }, { hash: 'b2', action: 'fixup' }, { hash: 'c3', action: 'reword', message: 'Terceiro, melhor' }];
  assert.ok(RB.validatePlan(plan, commits));
  assert.equal(RB.buildTodo(plan, (i) => `C:/r/.git/devkit/msg-${i}.txt`), 'pick a1\nfixup b2\npick c3\nexec git commit --amend -q --allow-empty -F "C:/r/.git/devkit/msg-2.txt"\n');
  assert.deepEqual(RB.previewPlan(plan, { a1: commits[0], b2: commits[1], c3: commits[2] }), [
    { subject: 'Terceiro, melhor', from: ['c3'], changed: true }, { subject: 'primeiro', from: ['a1', 'b2'], changed: false },
  ]);
  assert.throws(() => RB.validatePlan([{ hash: 'a1', action: 'squash' }, { hash: 'b2', action: 'pick' }, { hash: 'c3', action: 'pick' }], commits), /primeiro commit mantido/);
  assert.throws(() => RB.validatePlan(plan.slice(0, 2), commits), /todos os commits/);
  assert.throws(() => RB.validatePlan([...plan.slice(0, 2), { hash: 'zz', action: 'pick' }], commits), /não está no intervalo/);
  assert.throws(() => RB.validatePlan(commits.map((c) => ({ hash: c.hash, action: 'drop' })), commits), /remove todos/);
  assert.throws(() => RB.validatePlan([{ hash: 'a1', action: 'reword', message: ' ' }, plan[1], plan[2]], commits), /nova mensagem/);
  assert.throws(() => RB.validatePlan([{ hash: 'a1', action: 'exec rm -rf' }, plan[1], plan[2]], commits), /Ação inválida/);
});

test('receitas: ids únicos e ações válidas', () => {
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const tabs = ['changes', 'history', 'branches', 'stash', 'time', 'rebase'];
  for (const r of RECIPES) {
    assert.ok(r.title && r.when && r.how && r.cmd, r.id);
    const a = r.action;
    assert.ok((a.tab && tabs.includes(a.tab)) || a.wizard || (a.op && O.buildOp(a.op)), r.id);
  }
});

test('ops da fase 2', () => {
  assert.deepEqual(O.buildOp({ op: 'merge', branch: 'main', mode: 'noff' }).args, ['merge', '--no-edit', '--no-ff', 'main']);
  assert.equal(O.buildOp({ op: 'merge', branch: 'main' }).mayConflict, true);
  assert.deepEqual(O.buildOp({ op: 'cherry-pick', hashes: ['abc1234', 'def5678'] }).args, ['cherry-pick', 'abc1234', 'def5678']);
  assert.deepEqual(O.buildOp({ op: 'continue', operation: 'rebase' }).args, ['rebase', '--continue']);
  assert.equal(O.buildOp({ op: 'abort', operation: 'merge' }).risk, 'discard');
  const take = O.buildOp({ op: 'conflict.take', path: 'a.js', side: 'theirs' });
  assert.deepEqual([take.args, take.then], [['checkout', '--theirs', '--', 'a.js'], [['add', '--', 'a.js']]]);
  const save = O.buildOp({ op: 'conflict.save', path: 'a.js', content: 'x\n' });
  assert.deepEqual(save.writeFile, { path: 'a.js', content: 'x\n' });
  const mv = O.buildOp({ op: 'moveToNewBranch', name: 'feat/y', count: 2 });
  assert.deepEqual([mv.args, mv.then, mv.risk], [['branch', 'feat/y'], [['reset', '--keep', 'HEAD~2']], 'rewrite']);
  assert.deepEqual(O.buildOp({ op: 'file.fromBranch', branch: 'dev', path: 'src/a.js' }).args, ['restore', '--source', 'dev', '--staged', '--worktree', '--', 'src/a.js']);
  assert.throws(() => O.buildOp({ op: 'continue', operation: 'push' }), /Nada para continuar/);
  assert.throws(() => O.buildOp({ op: 'merge', branch: '--abort' }), /inválida/);
  assert.throws(() => O.buildOp({ op: 'cherry-pick', hashes: ['-n'] }), /inválida/);
  assert.throws(() => O.buildOp({ op: 'conflict.take', path: '../x', side: 'ours' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'moveToNewBranch', name: 'x', count: 0 }), /Quantidade/);
});

/* ─────────────── Fase 3: blame, busca, bisect, .gitignore ─────────────── */

const IG = require('../src/git/ignore.js');

test('parseBlame agrupa linhas seguidas do mesmo commit', () => {
  const A = 'a'.repeat(40), B = 'b'.repeat(40);
  const out = [
    `${A} 1 1 2`, 'author Ana', 'author-time 100', 'summary inicial', 'boundary', 'filename f', '\tum',
    `${A} 2 2`, '\tdois\r',
    `${B} 3 3 1`, 'author Bia', 'author-time 200', 'summary muda', 'filename f', '\tTRES',
    `${A} 4 4 1`, 'filename f', '\tquatro',
  ].join('\n');
  const b = P.parseBlame(out);
  assert.deepEqual(b.lines.map((l) => [l.n, l.hash[0], l.text]), [[1, 'a', 'um'], [2, 'a', 'dois'], [3, 'b', 'TRES'], [4, 'a', 'quatro']]);
  assert.deepEqual(b.commits[A], { author: 'Ana', time: 100, summary: 'inicial', boundary: true });
  assert.deepEqual(b.groups.map((g) => [g.hash[0], g.start, g.end]), [['a', 1, 2], ['b', 3, 3], ['a', 4, 4]]);
});

test('parsePickaxe, parseBisectLog e parseCleanPreview', () => {
  const pk = P.parsePickaxe('\x1eh1\x1fmuda B\x1fAna\x1f100\n\nf.txt\nsrc/x.js\n\x1eh2\x1finicial\x1fBia\x1f50\n\nf.txt\n');
  assert.deepEqual(pk, [{ hash: 'h1', subject: 'muda B', author: 'Ana', time: 100, files: ['f.txt', 'src/x.js'] }, { hash: 'h2', subject: 'inicial', author: 'Bia', time: 50, files: ['f.txt'] }]);
  const H = 'c'.repeat(40), G = 'd'.repeat(40);
  const bl = P.parseBisectLog(`# bad: [${H}] dois\n# good: [${G}] um\ngit bisect start\n# first bad commit: [${H}] dois\n`);
  assert.deepEqual(bl, { found: H, good: [G], bad: H, skipped: [] });
  assert.deepEqual(P.parseCleanPreview('Would remove a.txt\nWould remove build/\n'), ['a.txt', 'build/']);
});

test('.gitignore: sugestões e acréscimo sem duplicar', () => {
  assert.deepEqual(IG.suggestions('src/logs/app.log').map((s) => s.pattern), ['/src/logs/app.log', '*.log', 'app.log', '/src/logs/', '/src/']);
  assert.deepEqual(IG.suggestions('.claude/worktrees/feat-x/').map((s) => s.pattern), ['/.claude/worktrees/feat-x/', 'feat-x/', '/.claude/worktrees/', '/.claude/']);
  assert.deepEqual(IG.suggestions('.env').map((s) => s.pattern), ['/.env', '.env']);
  assert.deepEqual(IG.appendPattern('node_modules/\r\ndist/', '*.log'), { content: 'node_modules/\r\ndist/\r\n*.log\r\n', added: true });
  assert.deepEqual(IG.appendPattern('', '/.claude/'), { content: '/.claude/\n', added: true });
  assert.equal(IG.appendPattern('*.log\n', '*.log').added, false);
  assert.throws(() => IG.appendPattern('', 'a\nb'), /inválido/);
  assert.throws(() => IG.appendPattern('', '# comentário'), /inválido/);
});

test('ops da fase 3', () => {
  assert.deepEqual(O.buildOp({ op: 'tag.create', name: 'v1.2.0', at: 'abc1234', message: 'Versão 1.2' }).args, ['tag', '-a', 'v1.2.0', '-m', 'Versão 1.2', 'abc1234']);
  assert.deepEqual(O.buildOp({ op: 'tag.create', name: 'marco' }).args, ['tag', 'marco', 'HEAD']);
  assert.equal(O.buildOp({ op: 'tag.delete', name: 'v1' }).backupTag, 'v1');
  assert.deepEqual(O.buildOp({ op: 'branch.deleteMany', names: ['a', 'b'] }).backupRef, ['a', 'b']);
  assert.deepEqual(O.buildOp({ op: 'cleanFiles', paths: ['build/', 'x.tmp'] }).args, ['clean', '-f', '-d', '-q', '--', 'build/', 'x.tmp']);
  const ig = O.buildOp({ op: 'ignore.add', pattern: ' *.log ' });
  assert.deepEqual([ig.args, ig.appendIgnore, ig.display], [[], '*.log', 'echo "*.log" >> .gitignore']);
  assert.deepEqual(O.buildOp({ op: 'bisect.start', good: 'v1.0' }).args, ['bisect', 'start', 'HEAD', 'v1.0']);
  assert.deepEqual(O.buildOp({ op: 'bisect.mark', verdict: 'skip' }).args, ['bisect', 'skip']);
  assert.throws(() => O.buildOp({ op: 'bisect.mark', verdict: 'run rm' }), /inválida/);
  assert.throws(() => O.buildOp({ op: 'tag.create', name: '-d' }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'branch.deleteMany', names: ['ok', '--force'] }), /inválido/);
  assert.throws(() => O.buildOp({ op: 'ignore.add', pattern: 'a\nb' }), /inválido/);
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

/* ─────────────── serviço: fase 2 ─────────────── */

/** main e outra mudam a mesma linha de config.txt; outra também cria novo.txt. */
function forkRepo(root) {
  const dir = makeRepo(root);
  write(dir, 'config.txt', 'nome = x\nvalor = 1\nfim\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'config');
  sh(dir, 'switch', '-q', '-c', 'outra');
  write(dir, 'config.txt', 'nome = x\nvalor = 2\nfim\n');
  write(dir, 'novo.txt', 'novo\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'outra muda valor');
  sh(dir, 'switch', '-q', 'main');
  write(dir, 'config.txt', 'nome = x\nvalor = 3\nfim\n');
  sh(dir, 'commit', '-q', '-am', 'main muda valor');
  return dir;
}

test('serviço: prévia de merge aponta o conflito sem mexer em nada', async () => {
  const t = await setup();
  try {
    const dir = forkRepo(t.root);
    const repo = await t.svc.add(dir);
    const head = sh(dir, 'rev-parse', 'HEAD').trim();
    const pv = await t.svc.mergePreview(repo, 'outra');
    assert.equal(pv.ff, false);
    assert.equal(pv.upToDate, false);
    assert.deepEqual(pv.conflicts, ['config.txt']);
    assert.deepEqual(pv.commits.map((c) => c.subject), ['outra muda valor']);
    assert.deepEqual(pv.files.map((f) => f.path).sort(), ['config.txt', 'novo.txt']);
    assert.equal(sh(dir, 'rev-parse', 'HEAD').trim(), head);
    assert.equal((await t.svc.status(repo)).operation, null);
    // Branch já contida: nada a fazer. Branch à frente: avanço direto.
    sh(dir, 'branch', 'atras', 'HEAD~1');
    assert.equal((await t.svc.mergePreview(repo, 'atras')).upToDate, true);
    sh(dir, 'switch', '-q', '-c', 'frente'); sh(dir, 'commit', '-q', '--allow-empty', '-m', 'f'); sh(dir, 'switch', '-q', 'main');
    const ff = await t.svc.mergePreview(repo, 'frente');
    assert.equal(ff.ff, true);
    assert.deepEqual(ff.conflicts, []);
  } finally { t.done(); }
});

test('serviço: merge com conflito → resolver no editor → continuar', async () => {
  const t = await setup();
  try {
    const dir = forkRepo(t.root);
    const repo = await t.svc.add(dir);
    const r = await t.svc.exec(repo, { op: 'merge', branch: 'outra' });
    assert.equal(r.stopped, true);
    assert.equal(r.conflicts, 1);
    assert.equal(r.operation, 'merge');
    assert.ok(r.backup);
    const cf = await t.svc.conflictFile(repo, 'config.txt');
    assert.equal(cf.code, 'UU');
    assert.match(cf.ours, /valor = 3/);
    assert.match(cf.theirs, /valor = 2/);
    assert.match(cf.base, /valor = 1/);
    const parsed = C.parseConflicts(cf.merged);
    assert.equal(C.conflictCount(parsed), 1);
    await t.svc.exec(repo, { op: 'conflict.save', path: 'config.txt', content: C.resolveConflicts(parsed, ['theirs']) });
    let s = await t.svc.status(repo);
    assert.equal(s.conflicts.length, 0);
    assert.equal(s.operation, 'merge');
    await t.svc.exec(repo, { op: 'continue', operation: 'merge' });
    s = await t.svc.status(repo);
    assert.equal(s.operation, null);
    assert.equal(read(dir, 'config.txt').replace(/\r/g, ''), 'nome = x\nvalor = 2\nfim\n');
    const [c] = await t.svc.log(repo, { limit: 1, ref: 'HEAD' });
    assert.equal(c.parents.length, 2);
  } finally { t.done(); }
});

test('serviço: merge com conflito → ficar com a minha versão, ou abortar', async () => {
  const t = await setup();
  try {
    const dir = forkRepo(t.root);
    const repo = await t.svc.add(dir);
    await t.svc.exec(repo, { op: 'merge', branch: 'outra' });
    await t.svc.exec(repo, { op: 'conflict.take', path: 'config.txt', side: 'ours' });
    assert.equal((await t.svc.status(repo)).conflicts.length, 0);
    assert.match(read(dir, 'config.txt'), /valor = 3/);
    await t.svc.exec(repo, { op: 'abort', operation: 'merge' });
    const s = await t.svc.status(repo);
    assert.equal(s.operation, null);
    assert.equal(existsSync(path.join(dir, 'novo.txt')), false);
    // Merge que o git recusa (mudança local no arquivo) vira erro, não "parou em conflito".
    write(dir, 'config.txt', 'mexido\n');
    await assert.rejects(t.svc.exec(repo, { op: 'merge', branch: 'outra' }), /overwritten|would be/);
  } finally { t.done(); }
});

test('serviço: cherry-pick e commit fora da branch atual', async () => {
  const t = await setup();
  try {
    const dir = forkRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'switch', '-q', 'outra');
    write(dir, 'fix.txt', 'correção\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'correção importante');
    const fix = sh(dir, 'rev-parse', 'HEAD').trim();
    sh(dir, 'switch', '-q', 'main');
    assert.equal((await t.svc.commit(repo, fix)).inHead, false);
    const r = await t.svc.exec(repo, { op: 'cherry-pick', hashes: [fix] });
    assert.ok(!r.stopped);
    assert.equal(read(dir, 'fix.txt'), 'correção\n');
    assert.equal((await t.svc.log(repo, { limit: 1, ref: 'HEAD' }))[0].subject, 'correção importante');
    // Commit que já está na branch atual.
    assert.equal((await t.svc.commit(repo, sh(dir, 'rev-parse', 'HEAD~1').trim())).inHead, true);
  } finally { t.done(); }
});

test('serviço: rebase interativo com plano — juntar, reescrever, remover, reordenar', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    for (const [f, m] of [['1.txt', 'um'], ['2.txt', 'ajuste do um'], ['3.txt', 'tres'], ['4.txt', 'lixo']]) {
      write(dir, f, f + '\n'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', m);
    }
    const info = await t.svc.rebaseInfo(repo, { count: 4 });
    assert.deepEqual(info.commits.map((c) => c.subject), ['um', 'ajuste do um', 'tres', 'lixo']);
    assert.equal(info.ontoSubject, 'inicial');
    assert.equal(info.hasMerges, false);
    const [um, aj, tres, lixo] = info.commits.map((c) => c.hash);
    const plan = [
      { hash: tres, action: 'reword', message: 'Três (reescrito)' },
      { hash: um, action: 'pick' },
      { hash: aj, action: 'fixup' },
      { hash: lixo, action: 'drop' },
    ];
    const r = await t.svc.exec(repo, { op: 'rebase.plan', onto: info.onto, plan });
    assert.ok(!r.stopped);
    assert.ok(r.backup);
    assert.deepEqual((await t.svc.log(repo, { ref: 'HEAD' })).map((c) => c.subject), ['um', 'Três (reescrito)', 'inicial']);
    assert.equal(existsSync(path.join(dir, '4.txt')), false);
    assert.equal(existsSync(path.join(dir, '2.txt')), true);
    // Desfazer volta tudo.
    await t.svc.restoreBackup(repo, r.backup);
    assert.deepEqual((await t.svc.log(repo, { ref: 'HEAD' })).map((c) => c.subject), ['lixo', 'tres', 'ajuste do um', 'um', 'inicial']);
    // Plano inválido não roda.
    await assert.rejects(t.svc.exec(repo, { op: 'rebase.plan', onto: info.onto, plan: plan.slice(0, 2) }), /todos os commits/);
  } finally { t.done(); }
});

test('serviço: rebase que para em conflito e é abortado', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'a.txt', 'A\n'); sh(dir, 'commit', '-q', '-am', 'A');
    write(dir, 'a.txt', 'B\n'); sh(dir, 'commit', '-q', '-am', 'B');
    const info = await t.svc.rebaseInfo(repo, { count: 2 });
    const [a, b] = info.commits.map((c) => c.hash);
    const r = await t.svc.exec(repo, { op: 'rebase.plan', onto: info.onto, plan: [{ hash: b, action: 'pick' }, { hash: a, action: 'pick' }] });
    assert.equal(r.stopped, true);
    assert.equal(r.operation, 'rebase');
    await t.svc.exec(repo, { op: 'abort', operation: 'rebase' });
    assert.equal((await t.svc.status(repo)).operation, null);
    assert.deepEqual((await t.svc.log(repo, { ref: 'HEAD' })).map((c) => c.subject), ['B', 'A', 'inicial']);
  } finally { t.done(); }
});

test('serviço: mover commits para branch nova, trazer arquivo de outra branch, descartar tudo', async () => {
  const t = await setup();
  try {
    const dir = forkRepo(t.root);
    const repo = await t.svc.add(dir);
    write(dir, 'w.txt', 'w\n'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'devia estar noutra branch');
    write(dir, 'pendente.txt', 'fica\n');
    await t.svc.exec(repo, { op: 'moveToNewBranch', name: 'feat/w', count: 1 });
    assert.equal((await t.svc.log(repo, { limit: 1, ref: 'HEAD' }))[0].subject, 'main muda valor');
    assert.equal((await t.svc.log(repo, { limit: 1, ref: 'feat/w' }))[0].subject, 'devia estar noutra branch');
    assert.equal(read(dir, 'pendente.txt'), 'fica\n');
    assert.deepEqual((await t.svc.files(repo, 'outra')).sort(), ['a.txt', 'config.txt', 'novo.txt']);
    await t.svc.exec(repo, { op: 'file.fromBranch', branch: 'outra', path: 'config.txt' });
    assert.match(read(dir, 'config.txt'), /valor = 2/);
    assert.deepEqual((await t.svc.status(repo)).staged.map((f) => f.path), ['config.txt']);
    await t.svc.exec(repo, { op: 'discardAll' });
    assert.match(read(dir, 'config.txt'), /valor = 3/);
    assert.equal(existsSync(path.join(dir, 'pendente.txt')), true); // arquivos novos ficam
  } finally { t.done(); }
});

/* ─────────────── serviço: fase 3 ─────────────── */

/** Histórico de 6 commits em calc.js; o 4º introduz o "bug" (BUG). */
function bugRepo(root) {
  const dir = makeRepo(root);
  const steps = ['soma', 'subtrai', 'multiplica', 'divide // BUG', 'potencia', 'raiz'];
  let body = '';
  for (const s of steps) {
    body += `function ${s.split(' ')[0]}() {} ${s.includes('BUG') ? '// BUG' : ''}\n`;
    write(dir, 'calc.js', body);
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'adiciona ' + s.split(' ')[0]);
  }
  return dir;
}

test('serviço: blame, busca no histórico e versões de um arquivo', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    const b = await t.svc.blame(repo, 'calc.js');
    assert.equal(b.lines.length, 6);
    assert.equal(b.commits[b.lines[3].hash].summary, 'adiciona divide');
    assert.equal(b.groups.length, 6);
    const found = await t.svc.searchText(repo, 'BUG');
    assert.deepEqual(found.map((c) => c.subject), ['adiciona divide']);
    assert.deepEqual(found[0].files, ['calc.js']);
    assert.deepEqual((await t.svc.searchText(repo, 'pot[ea]ncia', { regex: true })).map((c) => c.subject), ['adiciona potencia']);
    await assert.rejects(t.svc.searchText(repo, '  '), /Digite/);
    const hist = await t.svc.log(repo, { file: 'calc.js', ref: 'HEAD' });
    assert.equal(hist.length, 6);
    const v = await t.svc.fileVersions(repo, found[0].hash, 'calc.js');
    assert.doesNotMatch(v.before, /BUG/);
    assert.match(v.after, /BUG/);
  } finally { t.done(); }
});

test('serviço: bisect guiado acha o commit do bug', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    const first = sh(dir, 'rev-list', '--max-parents=0', 'HEAD').trim();
    assert.equal((await t.svc.bisectState(repo)).active, false);
    await t.svc.exec(repo, { op: 'bisect.start', bad: 'HEAD', good: first });
    let st = await t.svc.bisectState(repo);
    assert.equal(st.active, true);
    assert.ok(st.candidates > 0);
    // Responde como um "testador": quebrado se o arquivo tem BUG.
    for (let i = 0; i < 10 && !st.found; i++) {
      const broken = read(dir, 'calc.js').includes('BUG');
      await t.svc.exec(repo, { op: 'bisect.mark', verdict: broken ? 'bad' : 'good' });
      st = await t.svc.bisectState(repo);
    }
    assert.equal(st.found.subject, 'adiciona divide');
    await t.svc.exec(repo, { op: 'bisect.reset' });
    assert.equal((await t.svc.bisectState(repo)).active, false);
    assert.equal((await t.svc.status(repo)).branch.head, 'main');
  } finally { t.done(); }
});

test('serviço: tags — criar simples e anotada, excluir e recuperar', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    await t.svc.exec(repo, { op: 'tag.create', name: 'v1.0', at: 'HEAD~2', message: 'Primeira versão' });
    await t.svc.exec(repo, { op: 'tag.create', name: 'marco' });
    const tags = await t.svc.tags(repo);
    const v1 = tags.find((x) => x.name === 'v1.0');
    assert.equal(v1.annotated, true);
    assert.equal(v1.message, 'Primeira versão');
    assert.equal(v1.commit, sh(dir, 'rev-parse', 'HEAD~2').trim());
    assert.equal(v1.subject, 'adiciona potencia'.replace('potencia', 'divide'));
    assert.equal(tags.find((x) => x.name === 'marco').annotated, false);
    const del = await t.svc.exec(repo, { op: 'tag.delete', name: 'v1.0' });
    assert.ok(!(await t.svc.tags(repo)).some((x) => x.name === 'v1.0'));
    await t.svc.restoreBackup(repo, del.backup);
    const back = (await t.svc.tags(repo)).find((x) => x.name === 'v1.0');
    assert.equal(back.annotated, true);
    assert.equal(back.message, 'Primeira versão');
  } finally { t.done(); }
});

test('serviço: limpar branches mescladas, arquivos não versionados e .gitignore', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'branch', 'velha1', 'HEAD~1'); sh(dir, 'branch', 'velha2', 'HEAD~3');
    const del = await t.svc.exec(repo, { op: 'branch.deleteMany', names: ['velha1', 'velha2'] });
    assert.deepEqual((await t.svc.branches(repo)).branches.map((b) => b.name), ['main']);
    const res = await t.svc.restoreBackup(repo, del.backup);
    assert.match(res.message, /2 branches/);
    assert.equal((await t.svc.branches(repo)).branches.length, 3);

    write(dir, 'build/saida.js', 'x\n');
    write(dir, 'tmp.log', 'log\n');
    write(dir, '.gitignore', 'node_modules/\n');
    write(dir, 'node_modules/pkg/index.js', 'ignorado\n');
    sh(dir, 'add', '.gitignore'); sh(dir, 'commit', '-q', '-m', 'gitignore');
    assert.deepEqual((await t.svc.cleanPreview(repo)).sort(), ['build/', 'tmp.log']);
    const cl = await t.svc.exec(repo, { op: 'cleanFiles', paths: ['build/', 'tmp.log'] });
    assert.equal(existsSync(path.join(dir, 'build')), false);
    assert.equal(existsSync(path.join(dir, 'node_modules/pkg/index.js')), true); // ignorados ficam
    await t.svc.restoreBackup(repo, cl.backup);
    assert.equal(read(dir, 'build/saida.js'), 'x\n');

    await t.svc.exec(repo, { op: 'ignore.add', pattern: '*.log' });
    await t.svc.exec(repo, { op: 'ignore.add', pattern: '*.log' }); // não duplica
    assert.equal((await t.svc.gitignore(repo)).replace(/\r/g, ''), 'node_modules/\n*.log\n');
    assert.ok(!(await t.svc.status(repo)).untracked.includes('tmp.log'));
    const rh = await t.svc.rhythm(repo);
    assert.equal(rh.total, 8); // inicial + 6 + .gitignore
    assert.equal(rh.grid.length, 7);
  } finally { t.done(); }
});

test('parseWorktrees', () => {
  const w = P.parseWorktrees('worktree C:/r\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/r/.claude/worktrees/x\nHEAD bbb\nbranch refs/heads/worktree-x\nlocked\n\nworktree C:/tmp/y\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n');
  assert.deepEqual(w.map((x) => [x.path, x.branch, x.main, x.locked, x.detached, x.prunable]), [
    ['C:/r', 'main', true, false, false, false], ['C:/r/.claude/worktrees/x', 'worktree-x', false, true, false, false], ['C:/tmp/y', null, false, false, true, true],
  ]);
});

test('serviço: branch recém-criada na ponta da base é "mesclada" mas sem commits próprios', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'checkout', '-q', '-b', 'feat/nova');
    write(dir, 'novo.txt', 'trabalho não commitado\n');
    let b = (await t.svc.branches(repo)).branches.find((x) => x.name === 'feat/nova');
    assert.equal(b.merged, true);
    assert.equal(b.noOwnCommits, true);
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'trabalho');
    b = (await t.svc.branches(repo)).branches.find((x) => x.name === 'feat/nova');
    assert.equal(b.merged, false);
    assert.equal(b.noOwnCommits, false);
  } finally { t.done(); }
});

test('serviço: branch com commits já mesclada por merge commit continua "mesclada"', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'checkout', '-q', '-b', 'feat/pr');
    write(dir, 'pr.txt', 'trabalho\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'feat: trabalho');
    sh(dir, 'checkout', '-q', 'main');
    sh(dir, 'merge', '-q', '--no-ff', 'feat/pr', '-m', 'Merge pull request #1913');
    sh(dir, 'branch', 'vazia');
    const br = (await t.svc.branches(repo)).branches;
    const pr = br.find((x) => x.name === 'feat/pr');
    assert.equal(pr.merged, true);
    assert.equal(pr.noOwnCommits, false);
    assert.equal(br.find((x) => x.name === 'vazia').noOwnCommits, true);
  } finally { t.done(); }
});

test('serviço: branch que commitou e desfez o commit (reset) continua "sem commits próprios"', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'checkout', '-q', '-b', 'feat/desfeita');
    write(dir, 'novo.txt', 'trabalho\n');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'feat: trabalho');
    sh(dir, 'reset', '-q', 'HEAD~1'); // o commit some, o arquivo fica como mudança não commitada
    const b = (await t.svc.branches(repo)).branches.find((x) => x.name === 'feat/desfeita');
    assert.equal(b.merged, true);
    assert.equal(b.noOwnCommits, true);
  } finally { t.done(); }
});

test('serviço: branch criada de origin/main (upstream = a base) e sem commits é "sem commits próprios"', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const remote = path.join(t.root, 'remoto.git');
    sh(t.root, 'clone', '-q', '--bare', dir, remote);
    sh(dir, 'remote', 'add', 'origin', remote);
    sh(dir, 'fetch', '-q', 'origin');
    sh(dir, 'switch', '-q', '-c', 'feat/do-remoto', 'origin/main');
    const repo = await t.svc.add(dir);
    const b = (await t.svc.branches(repo)).branches.find((x) => x.name === 'feat/do-remoto');
    assert.equal(b.upstream, 'origin/main');
    assert.equal(b.noOwnCommits, true);
  } finally { t.done(); }
});

test('serviço: branch em uso por worktree — exclusão parcial, desfazer sem duplicar, remover worktree', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'branch', 'mesclada-1', 'HEAD~1');
    sh(dir, 'branch', 'mesclada-2', 'HEAD~2');
    sh(dir, 'worktree', 'add', '-q', '-b', 'worktree-x', path.join(dir, '.claude', 'worktrees', 'x'), 'HEAD~3');
    const br = await t.svc.branches(repo);
    assert.match(br.branches.find((b) => b.name === 'worktree-x').worktree, /worktrees[\\/]x$/);
    assert.equal(br.branches.find((b) => b.name === 'mesclada-1').worktree, null);
    const wts = await t.svc.worktrees(repo);
    assert.deepEqual(wts.map((w) => [w.name, w.branch, w.exists, w.dirty]), [['x', 'worktree-x', true, 0]]);

    // Como aconteceu: a seleção inclui a branch do worktree. As outras saem; o resultado diz qual ficou e por quê.
    const r = await t.svc.exec(repo, { op: 'branch.deleteMany', names: ['mesclada-1', 'worktree-x', 'mesclada-2'] });
    assert.equal(r.partial, true);
    assert.deepEqual(r.done, ['mesclada-1', 'mesclada-2']);
    assert.match(r.warning, /2 de 3/);
    assert.match(r.failed[0].error, /em uso pelo worktree x/);
    assert.deepEqual((await t.svc.branches(repo)).branches.map((b) => b.name).sort(), ['main', 'worktree-x']);
    // Desfazer recria só as que saíram (nada de "worktree-x-restaurada").
    const res = await t.svc.restoreBackup(repo, r.backup);
    assert.match(res.message, /2 branches/);
    assert.deepEqual((await t.svc.branches(repo)).branches.map((b) => b.name).sort(), ['main', 'mesclada-1', 'mesclada-2', 'worktree-x']);

    // Remover o worktree libera a branch.
    await assert.rejects(t.svc.exec(repo, { op: 'worktree.remove', path: path.join(t.root, 'outro') }), /não é deste repositório/);
    await t.svc.exec(repo, { op: 'worktree.remove', path: wts[0].path });
    assert.equal(existsSync(path.join(dir, '.claude', 'worktrees', 'x')), false);
    assert.deepEqual(await t.svc.worktrees(repo), []);
    const all = await t.svc.exec(repo, { op: 'branch.deleteMany', names: ['worktree-x'] });
    assert.ok(!all.partial);
    // Nenhuma deu certo → erro com o motivo.
    await assert.rejects(t.svc.exec(repo, { op: 'branch.deleteMany', names: ['main'] }), /main/);
  } finally { t.done(); }
});

test('serviço: remover worktree com mudanças — recusa normal, "mesmo assim" guarda num stash e desfazer traz de volta', async () => {
  const t = await setup();
  try {
    const dir = bugRepo(t.root);
    const repo = await t.svc.add(dir);
    sh(dir, 'worktree', 'add', '-q', '-b', 'worktree-y', path.join(dir, '.claude', 'worktrees', 'y'), 'HEAD');
    const wt = (await t.svc.worktrees(repo))[0].path;
    const tracked = sh(wt, 'ls-files').split('\n').filter(Boolean)[0];
    writeFileSync(path.join(wt, tracked), 'alterado no worktree\n');
    writeFileSync(path.join(wt, 'novo.txt'), 'arquivo novo\n');
    await assert.rejects(t.svc.exec(repo, { op: 'worktree.remove', path: wt }), /modified or untracked|mudanças/i);
    const r = await t.svc.exec(repo, { op: 'worktree.removeForce', path: wt });
    assert.ok(r.backup);
    assert.equal(existsSync(wt), false);
    await assert.rejects(t.svc.exec(repo, { op: 'worktree.removeForce', path: path.join(t.root, 'outro') }), /não é deste repositório/);
    // Desfazer: as mudanças (inclusive o arquivo novo) voltam como stash.
    const res = await t.svc.restoreBackup(repo, r.backup);
    assert.match(res.message, /Stash recuperado/);
    const st = (await t.svc.stashes(repo))[0];
    assert.match(st.message, /worktree y/);
    const files = (await t.svc.stashFiles(repo, 'stash@{0}')).map((f) => f.path);
    assert.ok(files.includes('novo.txt') && files.includes(tracked));
  } finally { t.done(); }
});
