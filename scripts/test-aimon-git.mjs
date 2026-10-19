// Testes da leitura de Git do Monitor de IA com repositórios de verdade (sem Electron): node --test scripts/test-aimon-git.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createGitInfo } = require('../electron/aimon/gitinfo.js');

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-git-')));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function mkRepo() {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'inicial');
  return dir;
}
const same = (a, b) => assert.equal(path.normalize(a).toLowerCase(), path.normalize(b).toLowerCase());

test('gitinfo: repo comum, subpasta, worktree (devolve o repo principal), não-git e pasta inexistente', async () => {
  const repo = mkRepo();
  fs.mkdirSync(path.join(repo, 'sub'));
  const wt = path.join(repo, '.claude', 'worktrees', 'agente-1');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
  const gi = createGitInfo();
  const a = await gi.resolve(repo);
  same(a.top, repo); same(a.main, repo);
  assert.equal(a.branch, 'main');
  assert.equal(a.worktree, null);
  assert.equal(a.name, path.basename(repo));
  same((await gi.resolve(path.join(repo, 'sub'))).top, repo);
  const w = await gi.resolve(wt);
  same(w.top, wt); same(w.main, repo);
  assert.equal(w.worktree, 'agente-1');
  assert.equal(w.branch, 'feat');
  assert.deepEqual(await gi.resolve(tmp()), { exists: true, git: false });
  assert.deepEqual(await gi.resolve(path.join(repo, 'nao-existe')), { exists: false, git: false });
  assert.deepEqual(await gi.resolve('relativo/x'), { exists: false, git: false });
  assert.deepEqual(await gi.resolve(undefined), { exists: false, git: false });
});

test('gitinfo: changes conta M/A/D/untracked e dirtyCount concorda', async () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  sh(repo, 'add', 'b.txt');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\ndois\n');
  fs.writeFileSync(path.join(repo, 'novo.txt'), 'x\n');
  const gi = createGitInfo();
  const ch = await gi.changes(repo);
  assert.equal(ch.branch, 'main');
  assert.equal(ch.total, 3);
  assert.deepEqual(ch.files.map((f) => [f.path, f.kind, f.area]).sort(), [['a.txt', 'modified', 'unstaged'], ['b.txt', 'added', 'staged'], ['novo.txt', 'untracked', 'untracked']]);
  assert.equal(await gi.dirtyCount(repo), 3);
  assert.equal(await gi.dirtyCount(tmp()), null);
});

test('gitinfo: diff de arquivo alterado, novo e binário; recusa o que não está nas alterações', async () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\ndois\n');
  fs.writeFileSync(path.join(repo, 'novo.txt'), 'x\ny\n');
  fs.writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 0]));
  const gi = createGitInfo();
  assert.match((await gi.diffFile(repo, 'a.txt')).patch, /\+dois/);
  assert.match((await gi.diffFile(repo, 'novo.txt')).patch, /\+x\n\+y/);
  assert.equal((await gi.diffFile(repo, 'bin.dat')).binary, true);
  for (const bad of ['../fora.txt', 'inexistente.txt', '..\\..\\x', '-c core.pager=x', '']) await assert.rejects(() => gi.diffFile(repo, bad));
  await assert.rejects(() => gi.diffFile(tmp(), 'a.txt'));
});

test('gitinfo: config do repositório alheio (core.fsmonitor) não executa programa', async () => {
  const repo = mkRepo();
  const marca = path.join(tmp(), 'executou.txt');
  const cmd = process.platform === 'win32' ? `cmd /c echo x> "${marca}"` : `sh -c "echo x > ${marca}"`;
  sh(repo, 'config', 'core.fsmonitor', cmd);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'mudou\n');
  const gi = createGitInfo();
  await gi.changes(repo);
  await gi.dirtyCount(repo);
  assert.equal(fs.existsSync(marca), false);
});

test('gitinfo: ler não mexe na lista de repositórios do Git do devkit', async () => {
  // A leitura só usa defaultRun; não há serviço Git nem arquivo de lista envolvido.
  const mod = require('../electron/aimon/gitinfo.js');
  assert.deepEqual(Object.keys(mod), ['createGitInfo']);
  const repo = mkRepo();
  const before = fs.readdirSync(repo).sort().join();
  await createGitInfo().changes(repo);
  assert.equal(fs.readdirSync(repo).sort().join(), before); // nada novo no repositório
});
