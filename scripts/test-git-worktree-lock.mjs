// Teste: node --test scripts/test-git-worktree-lock.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const P = require('../src/git/parse.js');
const { buildOp } = require('../src/git/ops.js');
const { createGitService } = require('../electron/git/service.js');

const PORCELAIN = [
  'worktree C:/repo',
  'HEAD aaaa',
  'branch refs/heads/main',
  '',
  'worktree C:/repo/.claude/worktrees/a',
  'HEAD bbbb',
  'branch refs/heads/feat-a',
  'locked claude session a (pid 35932)',
  '',
  'worktree C:/repo/.claude/worktrees/b',
  'HEAD cccc',
  'branch refs/heads/feat-b',
  'locked',
  '',
  'worktree C:/repo/.claude/worktrees/c',
  'HEAD dddd',
  'detached',
  '',
].join('\n');

test('parseWorktrees guarda o motivo da trava', () => {
  const [main, a, b, c] = P.parseWorktrees(PORCELAIN);
  assert.equal(main.locked, false);
  assert.equal(a.locked, true);
  assert.equal(a.lockReason, 'claude session a (pid 35932)');
  assert.equal(b.locked, true);
  assert.equal(b.lockReason, '');
  assert.equal(c.locked, false);
  assert.equal(c.lockReason, '');
});

test('lockOwnerPid acha o pid no motivo', () => {
  assert.equal(P.lockOwnerPid('claude session a (pid 35932)'), 35932);
  assert.equal(P.lockOwnerPid('PID=42'), 42);
  assert.equal(P.lockOwnerPid('trabalho em andamento'), null);
  assert.equal(P.lockOwnerPid(''), null);
  assert.equal(P.lockOwnerPid(undefined), null);
});

test('worktree.removeLocked: --force duas vezes, com ponto de volta e confirmação', () => {
  const op = buildOp({ op: 'worktree.removeLocked', path: 'C:/repo/.claude/worktrees/a' });
  assert.deepEqual(op.args, ['worktree', 'remove', '--force', '--force', 'C:/repo/.claude/worktrees/a']);
  assert.equal(op.risk, 'discard');
  assert.equal(op.backup, true);
  assert.equal(op.backupWorktree, 'C:/repo/.claude/worktrees/a');
  assert.equal(op.worktreePath, 'C:/repo/.claude/worktrees/a');
});

test('worktree.removeLocked recusa caminho inválido', () => {
  assert.throws(() => buildOp({ op: 'worktree.removeLocked', path: '--help' }));
  assert.throws(() => buildOp({ op: 'worktree.removeLocked', path: '' }));
  assert.throws(() => buildOp({ op: 'worktree.removeLocked', path: 'a\nb' }));
});

/* ─────────────── contra o git de verdade ─────────────── */

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

async function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'devkit-wtlock-'));
  const dir = path.join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  sh(dir, 'config', 'user.name', 'Teste');
  sh(dir, 'config', 'user.email', 'teste@devkit');
  writeFileSync(path.join(dir, 'a.txt'), 'um\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'inicial');
  const svc = createGitService({ file: path.join(root, 'git-repos.json'), broadcast: () => {}, watch: () => ({ close() {} }) });
  await svc.init();
  return { root, dir, svc, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Um pid que com certeza não existe mais: o de um processo que acabou de terminar. */
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

test('serviço: worktree travado — motivo, dono vivo ou morto, e "destravar e remover" guarda as mudanças', async () => {
  const t = await setup();
  try {
    const repo = await t.svc.add(t.dir);
    const dead = deadPid();
    const wtDead = path.join(t.dir, '.claude', 'worktrees', 'morto');
    const wtAlive = path.join(t.dir, '.claude', 'worktrees', 'vivo');
    sh(t.dir, 'worktree', 'add', '-q', '-b', 'sessao-morta', wtDead, 'HEAD');
    sh(t.dir, 'worktree', 'add', '-q', '-b', 'sessao-viva', wtAlive, 'HEAD');
    sh(t.dir, 'worktree', 'lock', '--reason', `claude session morto (pid ${dead})`, wtDead);
    sh(t.dir, 'worktree', 'lock', '--reason', `claude session vivo (pid ${process.pid})`, wtAlive);

    const list = await t.svc.worktrees(repo);
    const byName = Object.fromEntries(list.map((w) => [w.name, w]));
    assert.equal(byName.morto.locked, true);
    assert.equal(byName.morto.lockPid, dead);
    assert.equal(byName.morto.lockAlive, false);
    assert.match(byName.morto.lockReason, /claude session morto/);
    assert.equal(byName.vivo.lockPid, process.pid);
    assert.equal(byName.vivo.lockAlive, true);

    // O "Remover" normal continua recusado pelo git enquanto a trava existe.
    await assert.rejects(t.svc.exec(repo, { op: 'worktree.remove', path: byName.morto.path }));
    assert.equal(existsSync(wtDead), true);

    // Destravar e remover: com mudanças pendentes (inclusive arquivo novo), que vão para um stash de segurança.
    writeFileSync(path.join(wtDead, 'novo.txt'), 'trabalho não commitado\n');
    const r = await t.svc.exec(repo, { op: 'worktree.removeLocked', path: byName.morto.path });
    assert.ok(r.backup, 'guarda um ponto de volta');
    assert.equal(existsSync(wtDead), false);
    assert.deepEqual((await t.svc.worktrees(repo)).map((w) => w.name), ['vivo']);
    // Desfazer: o arquivo novo do worktree removido volta como stash.
    const res = await t.svc.restoreBackup(repo, r.backup);
    assert.match(res.message, /Stash recuperado/);
    assert.match((await t.svc.stashes(repo))[0].message, /worktree morto/);
    assert.ok((await t.svc.stashFiles(repo, 'stash@{0}')).some((f) => f.path === 'novo.txt'));

    // Libera a branch do worktree removido; a do que continua existindo segue em uso.
    sh(t.dir, 'branch', '-D', 'sessao-morta');
    assert.throws(() => sh(t.dir, 'branch', '-D', 'sessao-viva'));

    // Fora deste repositório, não.
    await assert.rejects(t.svc.exec(repo, { op: 'worktree.removeLocked', path: path.join(t.root, 'outro') }), /não é deste repositório/);
  } finally { t.done(); }
});
