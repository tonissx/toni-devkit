'use strict';
/**
 * Monitor de IA — leitura do Git das pastas onde as sessões trabalham. Só leitura, sem passar pela lista de repositórios
 * do Git do devkit (ler aqui não registra nada lá).
 *
 * O `cwd` vem do transcript da sessão: é dado não confiável. Por isso: git sempre por `execFile` com argumentos (nunca
 * shell), `core.fsmonitor` desligado (config de repositório alheio não executa nada), diff sem programa externo nem
 * conversão de texto, só pastas que existem, e o caminho de um diff só vale se estiver no `status` do mesmo repositório.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { defaultRun } = require('../git/service');
const { parseStatus } = require('../../src/git/parse.js');

const SAFE = ['-c', 'core.fsmonitor=false'];
const TTL_MS = 30_000;
const MAX_FILES = 500;
const MAX_DIFF = 200 * 1024;
const MAX_UNTRACKED = 128 * 1024;
const AI_UNTRACKED_FILES = 40;
const AI_UNTRACKED_BYTES = 64 * 1024;
const AI_MAX_DIFF = 600 * 1024;
// Arquivos que podem guardar segredo: ficam de fora do que vai para a IA (só o nome é citado).
const SECRET_FILE = /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|pfx|p12|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\..*)?|secrets?(\..*)?)$/i;

const sameDir = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
const norm = (p) => path.normalize(String(p || '')).replace(/[\\/]+$/, '');

function createGitInfo({ run = defaultRun, now = () => Date.now(), limit = 4 } = {}) {
  const cache = new Map(); // cwd → { at, val }
  const waiting = [];
  let running = 0;

  /** No máximo `limit` processos git ao mesmo tempo. */
  const gate = (fn) => new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn().then(resolve, reject).finally(() => { running--; const next = waiting.shift(); if (next) next(); });
    };
    if (running < limit) go(); else waiting.push(go);
  });
  const git = (cwd, args, opts) => gate(() => run(cwd, [...SAFE, ...args], { read: true, timeout: 15e3, ...(opts || {}) }));

  const isDir = (p) => fs.stat(p).then((s) => s.isDirectory(), () => false);

  /** cwd → { exists, git, top, main, name, branch, worktree } (sem erro: pasta sumida ou fora de repositório viram flags). */
  async function resolve(cwd, { fresh = false } = {}) {
    if (!cwd || !path.isAbsolute(cwd)) return { exists: false, git: false };
    const hit = cache.get(cwd);
    if (!fresh && hit && now() - hit.at < TTL_MS) return hit.val;
    let val;
    if (!(await isDir(cwd))) val = { exists: false, git: false };
    else {
      try {
        const r = await git(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir', '--abbrev-ref', 'HEAD']);
        const [topRaw, commonRaw, headRaw] = r.stdout.split('\n').map((l) => l.trim());
        const top = norm(path.resolve(cwd, topRaw));
        const common = norm(path.resolve(cwd, commonRaw));
        // Repositório principal: a pasta que contém o .git comum (num worktree, o top é a pasta do worktree).
        const main = path.basename(common).toLowerCase() === '.git' ? norm(path.dirname(common)) : top;
        val = { exists: true, git: true, top, main, name: path.basename(main), branch: headRaw && headRaw !== 'HEAD' ? headRaw : null, detached: headRaw === 'HEAD', worktree: sameDir(top, main) ? null : path.basename(top) };
      } catch { val = { exists: true, git: false }; }
    }
    cache.set(cwd, { at: now(), val });
    return val;
  }

  /** Alterações não comitadas de uma pasta. → { branch, files: [{ path, kind, area }], total, counts, truncated } */
  async function changes(cwd) {
    const info = await resolve(cwd, { fresh: true });
    if (!info.git) return { ...info, files: [], total: 0, counts: {}, truncated: false };
    const out = await git(info.top, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    const st = parseStatus(out.stdout);
    const files = [];
    for (const f of st.conflicts) files.push({ path: f.path, kind: 'conflict', area: 'conflict' });
    for (const f of st.staged) files.push({ path: f.path, kind: f.kind || 'modified', area: 'staged' });
    for (const f of st.unstaged) files.push({ path: f.path, kind: f.kind || 'modified', area: 'unstaged' });
    for (const p of st.untracked) files.push({ path: p, kind: 'untracked', area: 'untracked' });
    const counts = {};
    for (const f of files) counts[f.kind] = (counts[f.kind] || 0) + 1;
    return { ...info, branch: st.branch.head || info.branch, ahead: st.branch.ahead, behind: st.branch.behind, upstream: st.branch.upstream, files: files.slice(0, MAX_FILES), total: files.length, counts, truncated: files.length > MAX_FILES };
  }

  /** Quantos arquivos alterados (para o alerta no card; um `status` leve). */
  async function dirtyCount(cwd) {
    const info = await resolve(cwd);
    if (!info.git) return null;
    const out = await git(info.top, ['status', '--porcelain=v2', '-z', '--untracked-files=normal']);
    return out.stdout.split('\0').filter((p) => p && p[0] !== '#' && p[0] !== '!').length;
  }

  /** Diff de um arquivo da lista de `changes`. → { patch, truncated, binary? } */
  async function diffFile(cwd, filePath, area) {
    const ch = await changes(cwd);
    if (!ch.git) throw new Error('Esta pasta não é um repositório git');
    const f = ch.files.find((x) => x.path === filePath && (!area || x.area === area));
    if (!f) throw new Error('Esse arquivo não está entre as alterações do repositório');
    const info = await resolve(cwd);
    if (f.area === 'untracked') {
      const full = path.resolve(info.top, f.path);
      if (path.relative(info.top, full).startsWith('..')) throw new Error('Caminho fora do repositório');
      const buf = await fs.readFile(full).catch(() => null);
      if (!buf) return { patch: '', truncated: false };
      if (buf.includes(0)) return { patch: '', truncated: false, binary: true };
      const text = buf.subarray(0, MAX_UNTRACKED).toString('utf8');
      const lines = text.split('\n');
      return { patch: `--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n'), truncated: buf.length > MAX_UNTRACKED };
    }
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color'];
    if (f.area === 'staged') args.push('--cached');
    args.push('--', f.path);
    const out = await git(info.top, args);
    const truncated = out.stdout.length > MAX_DIFF;
    return { patch: truncated ? out.stdout.slice(0, MAX_DIFF) : out.stdout, truncated, binary: /^Binary files /m.test(out.stdout) };
  }

  /**
   * O que a IA recebe do Git: tudo que não foi comitado (`git diff HEAD` mais os arquivos novos), os últimos assuntos de
   * commit e a branch. Arquivos de segredo e binários ficam de fora, só pelo nome. Só leitura.
   */
  async function aiInput(cwd) {
    const empty = () => ({ diff: '', recent: [], branch: null, files: [], omitted: [] });
    const info = await resolve(cwd, { fresh: true });
    if (!info.git) return empty();
    const top = info.top;
    const quiet = (p) => p.catch(() => ({ stdout: '' }));
    const [tracked, st, log] = await Promise.all([
      quiet(git(top, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--no-color'])), // sem commits ainda: falha e vira vazio
      quiet(git(top, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])),
      quiet(git(top, ['log', '-n', '10', '--format=%s'])),
    ]);
    const omitted = [];
    const files = [];
    const parts = [];
    for (const sec of tracked.stdout.split(/^(?=diff --git )/m)) {
      if (!sec.startsWith('diff --git ')) continue;
      const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(sec);
      const name = m ? m[2] : '';
      if (SECRET_FILE.test(name)) { omitted.push({ path: name, reason: 'segredo' }); continue; }
      files.push(name);
      parts.push(sec);
    }
    let taken = 0;
    for (const p of parseStatus(st.stdout).untracked) {
      if (SECRET_FILE.test(p)) { omitted.push({ path: p, reason: 'segredo' }); continue; }
      if (taken >= AI_UNTRACKED_FILES) { omitted.push({ path: p, reason: 'limite' }); continue; }
      const full = path.resolve(top, p);
      if (path.relative(top, full).startsWith('..')) continue;
      const buf = await fs.readFile(full).catch(() => null);
      if (!buf) continue;
      if (buf.includes(0)) { omitted.push({ path: p, reason: 'binário' }); continue; }
      const lines = buf.subarray(0, AI_UNTRACKED_BYTES).toString('utf8').split('\n');
      taken++;
      files.push(p);
      parts.push(`diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + (buf.length > AI_UNTRACKED_BYTES ? '\n+… (arquivo cortado)' : '') + '\n');
    }
    const diff = parts.join('');
    return { diff: diff.length > AI_MAX_DIFF ? diff.slice(0, AI_MAX_DIFF) : diff, recent: log.stdout.split('\n').filter(Boolean), branch: info.branch || null, files, omitted };
  }

  return { resolve, changes, dirtyCount, diffFile, aiInput, _cache: cache };
}

module.exports = { createGitInfo };
