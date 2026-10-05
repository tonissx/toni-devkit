'use strict';
/**
 * Git (processo principal): roda o git do sistema sobre os repositórios que o usuário adicionou.
 *
 * - Sempre execFile('git', args) — sem shell — e só com argumentos montados por src/git/ops.js (escritas) ou aqui
 *   mesmo (leituras). Nada de rede: nenhuma operação de fetch/pull/push existe.
 * - Ponto de volta: antes de operações que reescrevem/descartam, grava refs em refs/devkit/backup/<id>/… (HEAD, as
 *   mudanças via `git stash create`, a ponta de uma branch excluída, um stash descartado) e cópias de arquivos novos
 *   apagados em .git/devkit/files/<id>/. A lista fica em .git/devkit/backups.json. restoreBackup() volta ao estado.
 * - Watcher: observa o repositório aberto (pasta .git e arquivos) e avisa a tela (broadcast) com debounce.
 * - Lista de repositórios em %APPDATA%\Toni Devkit\git-repos.json.
 */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { atomicWrite, createQueue } = require('../lib/fsx');
const P = require('../../src/git/parse.js');
const { buildOp, validRev, validBranchName, validPath } = require('../../src/git/ops.js');
const { validatePlan, buildTodo } = require('../../src/git/rebase.js');
const { appendPattern } = require('../../src/git/ignore.js');

const MAX_BACKUPS = 30;
const MAX_DIFF = 3 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__', 'AppData']);

/** Roda o git. Resolve { stdout, stderr, code }; rejeita com a mensagem do git se o código não for aceito. */
function defaultRun(cwd, args, { stdin, ok = [0], read = true, timeout = 120e3, env: extraEnv } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C', GIT_PAGER: 'cat',
      GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no',
      ...(read ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
      ...(extraEnv || {}),
    };
    const child = execFile('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat', ...args], {
      cwd, env, maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout, encoding: 'utf8',
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      // ENOENT vem tanto de git ausente quanto de pasta (cwd) que não existe mais — repositório movido ou apagado.
      if (err && err.code === 'ENOENT') {
        return reject(fss.existsSync(cwd)
          ? Object.assign(new Error('Git não encontrado — instale o Git para Windows (git-scm.com)'), { code: 'NOGIT' })
          : new Error(`A pasta não existe mais: ${cwd} — o repositório foi movido ou apagado`));
      }
      if (!ok.includes(code)) {
        const msg = String(stderr || stdout || (err && err.message) || 'erro').split('\n').map((l) => l.trim()).filter((l) => l && !/^hint:/.test(l)).slice(0, 6).join('\n');
        return reject(Object.assign(new Error(msg.replace(/^(fatal|error): /, '')), { gitCode: code, stderr }));
      }
      resolve({ stdout, stderr, code });
    });
    if (stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(stdin); }
  });
}

/** Algumas recusas comuns do git explicadas em português (o resto passa como veio). */
function friendly(msg) {
  const m = String(msg || '');
  let x;
  if ((x = /used by worktree at '([^']+)'/.exec(m))) return `em uso pelo worktree ${x[1].split(/[\\/]/).pop()} — remova o worktree antes`;
  if (/not fully merged/.test(m)) return 'tem commits que não estão em outra branch';
  if (/contains modified or untracked files/.test(m)) return 'a pasta tem mudanças não commitadas';
  return m.split('\n')[0];
}

const sameDir = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const stamp = (d) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
};

function createGitService({ file, run = defaultRun, broadcast = () => {}, now = () => new Date(), watch = fss.watch }) {
  const queue = createQueue();
  let state = { v: 1, repos: [], last: null };
  const info = new Map(); // repo → { gitDir, top }
  let watched = null;     // { repo, watchers, timer }

  /* ─────────────── Lista de repositórios ─────────────── */

  async function init() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      state = { v: 1, repos: Array.isArray(raw.repos) ? raw.repos.filter((r) => r && typeof r.path === 'string') : [], last: typeof raw.last === 'string' ? raw.last : null };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[git] lista de repositórios ilegível:', e.message);
    }
    return list();
  }
  const save = () => queue.run('repos', () => atomicWrite(file, JSON.stringify(state, null, 2)));

  async function version() {
    try { return { available: true, version: (await run(process.cwd(), ['--version'])).stdout.trim().replace(/^git version /, '') }; }
    catch (e) { return { available: false, error: e.message }; }
  }

  function list() { return { repos: state.repos.map((r) => ({ ...r })), last: state.last }; }

  /** Raiz e pasta .git de um caminho dentro de um repositório. */
  async function locate(dir) {
    const r = await run(dir, ['rev-parse', '--show-toplevel', '--absolute-git-dir']).catch((e) => {
      if (e.code === 'NOGIT') throw e;
      throw new Error('Essa pasta não é um repositório git');
    });
    const [top, gitDir] = r.stdout.trim().split('\n');
    return { top: path.normalize(top), gitDir: path.normalize(gitDir) };
  }

  async function add(dir) {
    const { top } = await locate(String(dir || ''));
    if (!state.repos.some((r) => sameDir(r.path, top))) {
      state.repos.push({ path: top, name: path.basename(top), added: now().toISOString() });
      state.repos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
      await save();
    }
    broadcast({ type: 'repos' });
    return top;
  }

  async function remove(repo) {
    state.repos = state.repos.filter((r) => !sameDir(r.path, repo));
    if (state.last && sameDir(state.last, repo)) state.last = null;
    if (watched && sameDir(watched.repo, repo)) unwatch();
    await save();
    broadcast({ type: 'repos' });
    return true;
  }

  /** Procura repositórios até `depth` níveis abaixo de root (pula node_modules, pastas ocultas etc.). */
  async function scan(root, depth = 3) {
    const found = [];
    async function walk(dir, d) {
      if (found.length >= 200) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      if (entries.some((e) => e.name === '.git')) { found.push(path.normalize(dir)); return; }
      if (d >= depth) return;
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$') || SKIP_DIRS.has(e.name)) continue;
        await walk(path.join(dir, e.name), d + 1);
      }
    }
    await walk(String(root || ''), 0);
    return found.filter((f) => !state.repos.some((r) => sameDir(r.path, f)));
  }

  /** O repositório precisa estar na lista do usuário. Devolve { top, gitDir }. */
  async function repoOf(repo) {
    const r = state.repos.find((x) => sameDir(x.path, String(repo || '')));
    if (!r) throw new Error('Esse repositório não está na lista — adicione-o primeiro');
    if (!info.has(r.path)) info.set(r.path, await locate(r.path));
    return { path: r.path, ...info.get(r.path) };
  }

  async function open(repo) {
    const r = await repoOf(repo);
    state.last = r.path;
    const item = state.repos.find((x) => x.path === r.path);
    item.opened = now().toISOString();
    await save();
    watchRepo(r);
    return r.path;
  }

  /* ─────────────── Leituras ─────────────── */

  const git = async (repo, args, opts) => { const r = await repoOf(repo); return run(r.top, args, opts); };
  const hasHead = async (repo) => (await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], { ok: [0, 1] })).code === 0;

  /** Operação em andamento (merge/rebase/cherry-pick/revert/bisect), pelos arquivos da pasta .git. */
  async function inProgress(gitDir) {
    const has = (p) => fs.access(path.join(gitDir, p)).then(() => true, () => false);
    if (await has('rebase-merge') || await has('rebase-apply')) return 'rebase';
    if (await has('MERGE_HEAD')) return 'merge';
    if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await has('REVERT_HEAD')) return 'revert';
    if (await has('BISECT_LOG')) return 'bisect';
    return null;
  }

  async function status(repo) {
    const r = await repoOf(repo);
    const out = await run(r.top, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    const s = P.parseStatus(out.stdout);
    const stashes = await run(r.top, ['stash', 'list', '--format=%gd'], { ok: [0, 1, 128] }).then((x) => x.stdout.split('\n').filter(Boolean).length, () => 0);
    return { ...s, unborn: !s.branch.oid, stashes, operation: await inProgress(r.gitDir), path: r.path, name: path.basename(r.path) };
  }

  /** Resumo leve de cada repositório da lista (para os cartões). */
  async function summaries() {
    return Promise.all(state.repos.map(async (x) => {
      try {
        const s = await status(x.path);
        return { path: x.path, name: x.name, branch: s.branch.head, detached: s.branch.detached, changes: s.staged.length + s.unstaged.length + s.untracked.length, conflicts: s.conflicts.length, ahead: s.branch.ahead, behind: s.branch.behind, upstream: s.branch.upstream, stashes: s.stashes, operation: s.operation, opened: x.opened || null };
      } catch (e) { return { path: x.path, name: x.name, error: e.message }; }
    }));
  }

  /**
   * Histórico (ordem topológica) das branches, tags e HEAD — sem os refs internos (stash, pontos de volta).
   * opts: { skip, limit, author, grep, file, ref }
   */
  async function log(repo, { skip = 0, limit = 300, author, grep, file: f, ref } = {}) {
    if (!(await hasHead(repo))) return [];
    const args = ['log', '--topo-order', `--format=${P.LOG_FORMAT}`, `--max-count=${Math.min(2000, Math.max(1, limit | 0))}`, `--skip=${Math.max(0, skip | 0)}`];
    if (author) args.push(`--author=${String(author).slice(0, 100)}`, '-i');
    if (grep) args.push(`--grep=${String(grep).slice(0, 200)}`, '-i', '--fixed-strings');
    if (ref) { if (!validRev(ref)) throw new Error('Revisão inválida'); args.push(ref); } else args.push('--branches', '--tags', '--remotes', 'HEAD');
    if (f) args.push('--follow', '--', String(f));
    return P.parseLog((await git(repo, args)).stdout);
  }

  /** Detalhes de um commit: mensagem completa e arquivos alterados (contra o 1º pai). */
  async function commit(repo, hash) {
    if (!validRev(hash)) throw new Error('Commit inválido');
    const head = await git(repo, ['show', '-s', `--format=%H${P.US}%P${P.US}%an${P.US}%ae${P.US}%at${P.US}%cn${P.US}%ct${P.US}%D${P.US}%B`, hash]);
    const [h, parents, author, email, time, committer, ctime, deco, ...body] = head.stdout.split(P.US);
    const ps = parents ? parents.trim().split(' ').filter(Boolean) : [];
    const ns = ps.length
      ? await git(repo, ['diff', '--numstat', '-z', '-M', ps[0], h])
      : await git(repo, ['diff-tree', '-r', '--root', '--no-commit-id', '--numstat', '-z', '-M', h]);
    // Já está na branch atual? (Senão, a tela oferece trazê-lo com cherry-pick.)
    const inHead = (await git(repo, ['merge-base', '--is-ancestor', h, 'HEAD'], { ok: [0, 1] })).code === 0;
    return {
      hash: h, parents: ps, author, email, time: +time, committer, committerTime: +ctime, refs: P.parseDecorations(deco), inHead,
      message: body.join(P.US).replace(/\n+$/, ''), files: P.parseNumstat(ns.stdout),
    };
  }

  const truncate = (text) => (text.length > MAX_DIFF ? { patch: text.slice(0, MAX_DIFF), truncated: true } : { patch: text, truncated: false });

  /**
   * Patch de um arquivo. area: 'unstaged' | 'staged' | 'untracked' | 'commit' (com hash) | 'stash' (com ref) |
   * 'range' (hash = a, ref = b: o que b mudou desde o ancestral comum).
   * → { patch, truncated, binary? }
   */
  async function diff(repo, { area, path: p, hash, ref } = {}) {
    const r = await repoOf(repo);
    const pathArg = p ? ['--', String(p)] : [];
    if (area === 'untracked') {
      // Arquivo novo: monta o patch "tudo adicionado" (git diff --no-index varia entre plataformas).
      const abs = path.join(r.top, String(p));
      if (!abs.startsWith(r.top)) throw new Error('Caminho inválido');
      // Pasta com outro repositório dentro (worktree, clone, submódulo não registrado): o git não entra nela.
      if ((await fs.stat(abs)).isDirectory()) return { patch: '', truncated: false, nested: true };
      const buf = await fs.readFile(abs);
      const head = `diff --git a/${p} b/${p}\nnew file mode 100644\n`;
      if (buf.subarray(0, 8000).includes(0)) return { patch: head + `Binary files /dev/null and b/${p} differ\n`, truncated: false, binary: true };
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      const lines = text.split('\n');
      const noEol = !text.endsWith('\n');
      if (!noEol) lines.pop();
      if (!lines.length) return { patch: head, truncated: false };
      return truncate(head + `--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n' + (noEol ? '\\ No newline at end of file\n' : ''));
    }
    if (area === 'staged') return truncate((await run(r.top, ['diff', '--cached', '-M', ...pathArg])).stdout);
    if (area === 'commit') {
      if (!validRev(hash)) throw new Error('Commit inválido');
      return truncate((await run(r.top, ['show', '--format=', '-M', '--first-parent', '-m', hash, ...pathArg])).stdout);
    }
    if (area === 'range') {
      // O que mudou em b desde o ancestral comum com a (o mesmo da comparação de branches).
      if (!validRev(hash) || !validRev(ref)) throw new Error('Revisão inválida');
      return truncate((await run(r.top, ['diff', '-M', `${hash}...${ref}`, ...pathArg])).stdout);
    }
    if (area === 'stash') {
      if (!/^stash@\{\d{1,4}\}$/.test(ref || '')) throw new Error('Stash inválido');
      return truncate((await run(r.top, ['stash', 'show', '-p', '--include-untracked', '-M', ref, ...pathArg])).stdout);
    }
    return truncate((await run(r.top, ['diff', '-M', ...pathArg])).stdout);
  }

  async function worktreeList(r) {
    return P.parseWorktrees((await run(r.top, ['worktree', 'list', '--porcelain'])).stdout);
  }

  /** Worktrees além do principal: pasta, branch, se a pasta ainda existe e quantas mudanças tem. */
  async function worktrees(repo) {
    const r = await repoOf(repo);
    const list = (await worktreeList(r)).filter((w) => !w.main);
    return Promise.all(list.map(async (w) => {
      const exists = fss.existsSync(w.path);
      const dirty = exists ? (await run(w.path, ['status', '--porcelain'], { ok: [0, 128] }).then((x) => x.stdout.split('\n').filter(Boolean).length, () => 0)) : 0;
      return { ...w, exists, dirty, name: w.path.split(/[\\/]/).pop() };
    }));
  }

  /** Branches locais com upstream, à frente/atrás da base (main/master) e se já foram mescladas nela. */
  async function branches(repo) {
    if (!(await hasHead(repo))) return { base: null, branches: [] };
    const list = P.parseBranches((await git(repo, ['for-each-ref', `--format=${P.BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads'])).stdout);
    const base = ['main', 'master', 'develop'].find((b) => list.some((x) => x.name === b)) || (list.find((x) => x.current) || list[0] || {}).name || null;
    const merged = base ? new Set((await git(repo, ['branch', '--format=%(refname:short)', '--merged', base])).stdout.split('\n').filter(Boolean)) : new Set();
    // Linha principal da base (só o primeiro pai de cada merge): uma branch cuja ponta está aqui nunca saiu dela.
    const mainLine = base ? new Set((await git(repo, ['rev-list', '--first-parent', '--max-count=50000', base])).stdout.split('\n').filter(Boolean)) : new Set();
    // Branch aberta noutro worktree: o git não deixa excluir nem trocar para ela daqui.
    const wts = (await worktrees(repo)).filter((w) => w.branch);
    const inWorktree = new Map(wts.map((w) => [w.branch, w.path]));
    const dirtyWt = new Map(wts.map((w) => [w.branch, w.dirty || 0]));
    for (const b of list) { b.worktree = inWorktree.get(b.name) || null; b.worktreeDirty = dirtyWt.get(b.name) || 0; }
    await Promise.all(list.map(async (b) => {
      b.merged = b.name !== base && merged.has(b.name);
      // Outras branches que já têm todos os commits desta (excluí-la não perde nada, mesmo sem merge na base).
      b.containedIn = (await git(repo, ['for-each-ref', '--format=%(refname:short)', '--contains', b.hash, 'refs/heads'])).stdout.split('\n').filter((n) => n && n !== b.name);
      if (!base || b.name === base) return;
      const c = (await git(repo, ['rev-list', '--left-right', '--count', `${base}...${b.name}`])).stdout.trim().split(/\s+/);
      b.baseBehind = +c[0]; b.baseAhead = +c[1];
      // "mesclada" (--merged) só olha commits: uma branch recém-criada na ponta da base (com trabalho ainda não commitado) cai aí também.
      // Depois de um merge real, baseAhead também é 0; o que distingue é a ponta estar na linha principal da base (num merge commit
      // ela é o 2º pai, fora dela). Vale também após `reset` de um commit. Upstream = a própria base (criada de origin/main) não conta.
      b.noOwnCommits = b.merged && mainLine.has(b.hash) && (!b.upstream || b.upstream.endsWith('/' + base));
    }));
    return { base, branches: list };
  }

  /** Compara duas revisões: commits só de um lado e só do outro, e arquivos diferentes (desde o ancestral comum). */
  async function compare(repo, a, b) {
    if (!validRev(a) || !validRev(b)) throw new Error('Revisão inválida');
    const counts = (await git(repo, ['rev-list', '--left-right', '--count', `${a}...${b}`])).stdout.trim().split(/\s+/);
    const side = async (from, to) => P.parseLog((await git(repo, ['log', `--format=${P.LOG_FORMAT}`, '--max-count=200', `${from}..${to}`])).stdout);
    const base = (await git(repo, ['merge-base', a, b], { ok: [0, 1] })).stdout.trim() || null;
    return {
      a, b, base, onlyA: +counts[0], onlyB: +counts[1],
      commitsA: await side(b, a), commitsB: await side(a, b),
      files: P.parseNumstat((await git(repo, ['diff', '--numstat', '-z', '-M', `${a}...${b}`])).stdout),
    };
  }

  async function stashes(repo) {
    return P.parseStashes((await git(repo, ['stash', 'list', `--format=${P.STASH_FORMAT}`], { ok: [0, 1, 128] })).stdout);
  }
  async function stashFiles(repo, ref) {
    if (!/^stash@\{\d{1,4}\}$/.test(ref || '')) throw new Error('Stash inválido');
    return P.parseNumstat((await git(repo, ['stash', 'show', '--numstat', '-z', '--include-untracked', '-M', ref])).stdout);
  }

  async function reflog(repo, limit = 150) {
    if (!(await hasHead(repo))) return [];
    return P.parseReflog((await git(repo, ['reflog', '--date=unix', `--format=${P.REFLOG_FORMAT}`, `-n${Math.min(1000, limit | 0 || 150)}`], { ok: [0, 128] })).stdout);
  }

  /** Visão geral: números, atividade dos últimos 90 dias, autores e arquivos mais alterados. */
  async function overview(repo) {
    const s = await status(repo);
    if (s.unborn) return { status: s, commits: 0, branches: 0, tags: 0, activity: [], authors: [], hotspots: [], last: null };
    const [count, br, tags, act, authors, hot, last] = await Promise.all([
      git(repo, ['rev-list', '--count', 'HEAD']),
      git(repo, ['for-each-ref', '--format=x', 'refs/heads']),
      git(repo, ['for-each-ref', '--format=x', 'refs/tags']),
      git(repo, ['log', '--since=90.days.ago', '--format=%at', 'HEAD']),
      git(repo, ['shortlog', '-sne', 'HEAD']),
      git(repo, ['log', '--since=180.days.ago', '--format=', '--name-only', 'HEAD']),
      log(repo, { limit: 1, ref: 'HEAD' }),
    ]);
    const days = new Map();
    for (const t of act.stdout.split('\n').filter(Boolean)) { const d = new Date(+t * 1000); const k = d.toISOString().slice(0, 10); days.set(k, (days.get(k) || 0) + 1); }
    const activity = [];
    const today = now();
    for (let i = 89; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); const k = d.toISOString().slice(0, 10); activity.push({ day: k, n: days.get(k) || 0 }); }
    const fileCount = new Map();
    for (const f of hot.stdout.split('\n').filter(Boolean)) fileCount.set(f, (fileCount.get(f) || 0) + 1);
    return {
      status: s,
      commits: +count.stdout.trim(),
      branches: br.stdout.split('\n').filter(Boolean).length,
      tags: tags.stdout.split('\n').filter(Boolean).length,
      activity,
      authors: authors.stdout.split('\n').filter(Boolean).map((l) => { const m = /^\s*(\d+)\t(.*?)(?: <(.*)>)?$/.exec(l); return m ? { n: +m[1], name: m[2], email: m[3] || '' } : null; }).filter(Boolean).slice(0, 8),
      hotspots: [...fileCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ path: p, n })),
      last: last[0] || null,
    };
  }

  /* ─────────────── Pontos de volta ─────────────── */

  const backupsFile = (r) => path.join(r.gitDir, 'devkit', 'backups.json');
  async function readBackups(r) { try { return JSON.parse(await fs.readFile(backupsFile(r), 'utf8')).backups || []; } catch { return []; } }
  const writeBackups = (r, list) => atomicWrite(backupsFile(r), JSON.stringify({ v: 1, backups: list }, null, 2));

  /** Grava o estado atual (HEAD, mudanças, e o que a operação vai apagar) antes de uma operação arriscada. */
  async function createBackup(r, op) {
    const id = stamp(now());
    const ref = (k) => `refs/devkit/backup/${id}/${k}`;
    const refs = {};
    const cur = P.parseStatus((await run(r.top, ['status', '--porcelain=v2', '--branch', '-z'])).stdout).branch;
    if (cur.oid) { await run(r.top, ['update-ref', ref('head'), cur.oid], { read: false }); refs.head = cur.oid; }
    if (cur.oid) {
      // Com conflito no índice o git não consegue criar o stash: segue só com o HEAD.
      const wip = (await run(r.top, ['stash', 'create'], { read: false }).catch(() => ({ stdout: '' }))).stdout.trim();
      if (wip) { await run(r.top, ['update-ref', ref('wip'), wip], { read: false }); refs.wip = wip; }
    }
    let kind = 'state';
    const meta = {};
    if (op.backupRef) {
      // Uma ou várias branches que vão ser excluídas: guarda a ponta de cada uma.
      kind = 'branch';
      meta.branchNames = [];
      for (const name of [].concat(op.backupRef)) {
        const tip = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/heads/${name}`], { ok: [0, 1] })).stdout.trim();
        if (!tip) continue;
        const k = 'branch-' + meta.branchNames.length;
        await run(r.top, ['update-ref', ref(k), tip], { read: false });
        refs[k] = tip;
        meta.branchNames.push(name);
      }
    }
    if (op.backupTag) {
      kind = 'tag';
      const obj = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/tags/${op.backupTag}`], { ok: [0, 1] })).stdout.trim();
      if (obj) { await run(r.top, ['update-ref', ref('tag'), obj], { read: false }); refs.tag = obj; meta.tagName = op.backupTag; }
    }
    if (op.backupStash) {
      kind = 'stash';
      const h = (await run(r.top, ['rev-parse', '--verify', '-q', op.backupStash])).stdout.trim();
      const msg = (await run(r.top, ['log', '-1', '--format=%gs', '-g', op.backupStash], { ok: [0, 128] })).stdout.trim();
      await run(r.top, ['update-ref', ref('stash'), h], { read: false });
      refs.stash = h; meta.stashMessage = msg;
    }
    if (op.backupWorktree) {
      // Mudanças (inclusive arquivos novos) de outro worktree que vai ser apagado: viram um stash recuperável.
      await run(op.backupWorktree, ['add', '-A'], { read: false });
      const wip = (await run(op.backupWorktree, ['stash', 'create'], { read: false })).stdout.trim();
      if (wip) {
        await run(r.top, ['update-ref', ref('stash'), wip], { read: false });
        refs.stash = wip; kind = 'stash';
        meta.stashMessage = `Devkit: mudanças do worktree ${path.basename(op.backupWorktree)}`;
      }
    }
    if (op.backupFiles) {
      kind = 'files';
      const dest = path.join(r.gitDir, 'devkit', 'files', id);
      for (const f of op.backupFiles) {
        const src = path.join(r.top, f);
        if (!src.startsWith(r.top)) continue;
        try { await fs.mkdir(path.dirname(path.join(dest, f)), { recursive: true }); await fs.cp(src, path.join(dest, f), { recursive: true }); } catch { /* sumiu: nada a guardar */ }
      }
      meta.files = op.backupFiles;
    }
    const entry = { id, at: now().toISOString(), kind, op: op.op, title: op.title, display: op.display, branch: cur.head, refs, ...meta };
    const list = [entry, ...(await readBackups(r))];
    for (const old of list.slice(MAX_BACKUPS)) await dropBackup(r, old);
    await writeBackups(r, list.slice(0, MAX_BACKUPS));
    return entry;
  }

  async function dropBackup(r, b) {
    for (const k of Object.keys(b.refs || {})) await run(r.top, ['update-ref', '-d', `refs/devkit/backup/${b.id}/${k}`], { read: false, ok: [0, 1, 128] }).catch(() => {});
    if (b.kind === 'files') await fs.rm(path.join(r.gitDir, 'devkit', 'files', b.id), { recursive: true, force: true }).catch(() => {});
  }

  async function backups(repo) { return readBackups(await repoOf(repo)); }

  /** Volta ao estado guardado num ponto de volta (e guarda o estado atual antes, então dá para desfazer o desfazer). */
  async function restoreBackup(repo, id) {
    const r = await repoOf(repo);
    return queue.run('repo:' + r.path, async () => {
      const b = (await readBackups(r)).find((x) => x.id === id);
      if (!b) throw new Error('Esse ponto de volta não existe mais');
      const ref = (k) => `refs/devkit/backup/${b.id}/${k}`;
      let message;
      if (b.kind === 'branch') {
        // Pontos antigos guardavam uma branch só (branchName + refs.branch).
        const list = b.branchNames ? b.branchNames.map((n, i) => [n, ref('branch-' + i)]) : [[b.branchName, ref('branch')]];
        const made = [];
        for (const [orig, from] of list) {
          const cur = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/heads/${orig}`], { ok: [0, 1] })).stdout.trim();
          const saved = (await run(r.top, ['rev-parse', from])).stdout.trim();
          if (cur && cur === saved) continue; // nunca saiu (ex.: o git recusou excluir): nada a recriar
          const name = cur ? `${orig}-restaurada` : orig;
          if (!validBranchName(name)) throw new Error('Nome de branch inválido');
          await run(r.top, ['branch', name, from], { read: false });
          made.push(name);
        }
        message = !made.length ? 'As branches já estavam lá — nada a recriar' : made.length === 1 ? `Branch “${made[0]}” recriada` : `${made.length} branches recriadas`;
      } else if (b.kind === 'tag') {
        const exists = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/tags/${b.tagName}`], { ok: [0, 1] })).code === 0;
        const name = exists ? `${b.tagName}-restaurada` : b.tagName;
        if (!validBranchName(name)) throw new Error('Nome de tag inválido');
        await run(r.top, ['update-ref', `refs/tags/${name}`, ref('tag')], { read: false });
        message = `Tag “${name}” recriada`;
      } else if (b.kind === 'stash') {
        await run(r.top, ['stash', 'store', '-m', b.stashMessage || 'Stash recuperado pelo Devkit', ref('stash')], { read: false });
        message = 'Stash recuperado';
      } else if (b.kind === 'files') {
        const src = path.join(r.gitDir, 'devkit', 'files', b.id);
        for (const f of b.files || []) {
          const to = path.join(r.top, f);
          if (!to.startsWith(r.top)) continue;
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.cp(path.join(src, f), to, { recursive: true }).catch(() => {});
        }
        message = 'Arquivos recuperados';
      } else {
        if (!b.refs.head) throw new Error('Esse ponto de volta não tem um commit para voltar');
        await createBackup(r, { op: 'restore', title: 'Desfazer pelo Devkit', display: 'git reset --hard <ponto de volta>' });
        const cur = P.parseStatus((await run(r.top, ['status', '--porcelain=v2', '--branch', '-z'])).stdout).branch;
        if (b.branch && cur.head !== b.branch) await run(r.top, ['switch', '--discard-changes', b.branch], { read: false });
        await run(r.top, ['reset', '--hard', ref('head')], { read: false });
        if (b.refs.wip) await run(r.top, ['stash', 'apply', '--index', ref('wip')], { read: false }).catch(() => run(r.top, ['stash', 'apply', ref('wip')], { read: false }));
        message = 'Repositório voltou ao ponto de antes de: ' + (b.title || b.op);
      }
      broadcast({ type: 'changed', repo: r.path });
      return { ok: true, message };
    });
  }

  /* ─────────────── Escritas ─────────────── */

  /**
   * Executa uma operação de src/git/ops.js. Extras: branch.switch com { stash: true } guarda as mudanças antes.
   * → { ok, title, display, backup (id ou null), output }
   */
  async function exec(repo, input) {
    const r = await repoOf(repo);
    return queue.run('repo:' + r.path, async () => {
      const unborn = !(await hasHead(r.path));
      const op = buildOp(input, { unborn });
      if (input.op === 'branch.switch' && input.stash) {
        const cur = P.parseStatus((await run(r.top, ['status', '--porcelain=v2', '--branch', '-z'])).stdout).branch.head || 'HEAD';
        await run(r.top, ['stash', 'push', '-u', '-m', `Devkit: guardado ao trocar de ${cur} para ${input.name}`], { read: false });
      }
      if (op.worktreePath) {
        const known = (await worktreeList(r)).filter((w) => !w.main).map((w) => w.path);
        if (!known.some((k) => sameDir(path.normalize(k), path.normalize(op.worktreePath)))) throw new Error('Esse worktree não é deste repositório');
      }
      const env = op.plan ? await prepareRebase(r, op) : undefined;
      const backup = op.backup && !unborn ? await createBackup(r, op) : op.backupFiles ? await createBackup(r, op) : null;
      try {
        if (op.appendIgnore) {
          const file = path.join(r.top, '.gitignore');
          const cur = await fs.readFile(file, 'utf8').catch(() => '');
          const next = appendPattern(cur, op.appendIgnore);
          if (next.added) await fs.writeFile(file, next.content);
        }
        if (!op.args.length) return { ok: true, title: op.title, display: op.display, risk: op.risk, backup: backup ? backup.id : null, output: '' };
        if (op.each) {
          // Um comando por item: o que o git recusar não impede os outros; o resultado diz o que saiu e o que ficou.
          const done = [], failed = [];
          for (let i = 0; i < op.each.length; i++) {
            try { await run(r.top, op.each[i], { read: false }); done.push(op.eachLabel[i]); }
            catch (e) { failed.push({ name: op.eachLabel[i], error: friendly(e.message) }); }
          }
          if (!done.length) throw new Error(failed.map((f) => `${f.name}: ${f.error}`).join('\n'));
          const warning = failed.length ? `${done.length} de ${op.each.length} feito(s). Não deu: ${failed.map((f) => `${f.name} (${f.error})`).join('; ')}` : null;
          return { ok: true, partial: failed.length > 0, warning, done, failed, title: op.title, display: op.display, risk: op.risk, backup: backup ? backup.id : null, output: '' };
        }
        if (op.writeFile) {
          const abs = path.join(r.top, op.writeFile.path);
          if (!validPath(op.writeFile.path) || !abs.startsWith(r.top)) throw new Error('Caminho inválido');
          await fs.writeFile(abs, op.writeFile.content);
        }
        // Merge, cherry-pick e rebase podem parar no meio com conflito (código 1): não é erro, é a vez do usuário.
        const res = await run(r.top, op.args, { stdin: op.stdin, read: false, env, ok: op.mayConflict ? [0, 1] : [0] });
        let output = res.stdout + res.stderr;
        if (res.code !== 0) {
          const st = await status(r.path);
          if (!st.conflicts.length && !st.operation) {
            const msg = String(res.stderr || res.stdout).split('\n').map((l) => l.trim()).filter((l) => l && !/^hint:/.test(l)).slice(0, 6).join('\n');
            throw new Error(msg.replace(/^(fatal|error): /, '') || 'O git recusou a operação');
          }
          return { ok: true, stopped: true, conflicts: st.conflicts.length, operation: st.operation, title: op.title, display: op.display, risk: op.risk, backup: backup ? backup.id : null, output: output.trim().slice(0, 4000) };
        }
        for (const extra of op.then || []) output += (await run(r.top, extra, { read: false })).stdout;
        return { ok: true, title: op.title, display: op.display, risk: op.risk, backup: backup ? backup.id : null, output: output.trim().slice(0, 4000) };
      } finally {
        broadcast({ type: 'changed', repo: r.path });
      }
    });
  }

  /**
   * Rebase com o plano da tela: confere o plano contra os commits do intervalo, grava o todo e as mensagens novas em
   * .git/devkit/rebase/ e devolve o ambiente que faz o git usar esse todo (GIT_SEQUENCE_EDITOR copia o arquivo).
   */
  async function prepareRebase(r, op) {
    const info = await rebaseRange(r, op.args[op.args.length - 1]);
    if (info.hasMerges) throw new Error('Há commits de merge no intervalo — o rebase interativo os desfaria. Escolha um intervalo sem merges.');
    validatePlan(op.plan, info.commits);
    const dir = path.join(r.gitDir, 'devkit', 'rebase');
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const slash = (f) => f.replace(/\\/g, '/');
    const msgFile = (i) => slash(path.join(dir, `msg-${i}.txt`));
    for (let i = 0; i < op.plan.length; i++) {
      const m = String(op.plan[i].message || '').trim();
      if (m && (op.plan[i].action === 'reword' || op.plan[i].action === 'squash')) await fs.writeFile(path.join(dir, `msg-${i}.txt`), m + '\n');
    }
    const todo = path.join(dir, 'todo.txt');
    await fs.writeFile(todo, buildTodo(op.plan, msgFile));
    return { GIT_SEQUENCE_EDITOR: `cp "${slash(todo)}"` };
  }

  /** Commits de onto..HEAD (do mais antigo ao mais novo) e se há merges no meio. */
  async function rebaseRange(r, onto) {
    if (!validRev(onto)) throw new Error('Base inválida');
    const out = (await run(r.top, ['log', '--reverse', `--format=%H${P.US}%s${P.US}%an${P.US}%at${P.RS}`, `${onto}..HEAD`])).stdout;
    const commits = out.split(P.RS).map((x) => x.replace(/^\n/, '')).filter(Boolean).map((x) => { const [hash, subject, author, time] = x.split(P.US); return { hash, subject, author, time: +time }; });
    const merges = (await run(r.top, ['rev-list', '--merges', '--count', `${onto}..HEAD`])).stdout.trim();
    return { commits, hasMerges: +merges > 0 };
  }

  /**
   * Para a tela de reorganizar commits: os últimos `count` commits da branch (ou desde o ancestral comum com `base`),
   * a base (onto) e quais já estão no upstream (enviados).
   */
  async function rebaseInfo(repo, { count = 10, base } = {}) {
    const r = await repoOf(repo);
    let onto;
    if (base) {
      if (!validRev(base)) throw new Error('Base inválida');
      onto = (await run(r.top, ['merge-base', base, 'HEAD'])).stdout.trim();
    } else {
      const n = Math.max(1, Math.min(50, count | 0));
      const total = +(await run(r.top, ['rev-list', '--count', '--first-parent', 'HEAD'])).stdout.trim();
      if (total <= 1) return { onto: null, commits: [], hasMerges: false, pushed: [], reason: 'Só há um commit — nada para reorganizar.' };
      onto = (await run(r.top, ['rev-parse', `HEAD~${Math.min(n, total - 1)}`])).stdout.trim();
    }
    const { commits, hasMerges } = await rebaseRange(r, onto);
    const up = await run(r.top, ['rev-list', `${onto}..@{u}`], { ok: [0, 128] });
    const inUp = new Set(up.code === 0 ? up.stdout.split('\n').filter(Boolean) : []);
    const ontoSubject = (await run(r.top, ['log', '-1', '--format=%s', onto])).stdout.trim();
    return { onto, ontoSubject, commits, hasMerges, pushed: commits.filter((c) => inUp.has(c.hash)).map((c) => c.hash) };
  }

  /** Antes de mesclar: o que entra, se dá para só avançar e quais arquivos vão conflitar (git merge-tree, sem mexer em nada). */
  async function mergePreview(repo, branchName) {
    const r = await repoOf(repo);
    if (!validRev(branchName)) throw new Error('Branch inválida');
    const isAnc = async (a, b) => (await run(r.top, ['merge-base', '--is-ancestor', a, b], { ok: [0, 1] })).code === 0;
    const upToDate = await isAnc(branchName, 'HEAD');
    const ff = !upToDate && await isAnc('HEAD', branchName);
    const commits = P.parseLog((await run(r.top, ['log', `--format=${P.LOG_FORMAT}`, '--max-count=100', `HEAD..${branchName}`])).stdout);
    const changed = P.parseNumstat((await run(r.top, ['diff', '--numstat', '-z', '-M', `HEAD...${branchName}`])).stdout);
    let conflicts = [];
    if (!upToDate && !ff) {
      const mt = await run(r.top, ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', branchName], { ok: [0, 1] });
      conflicts = mt.code === 1 ? mt.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean) : [];
    }
    const st = await status(r.path);
    return { branch: branchName, upToDate, ff, commits, files: changed, conflicts, dirty: st.staged.length + st.unstaged.length, operation: st.operation };
  }

  /** As três versões de um arquivo em conflito (base, minha, deles) e o arquivo como está agora, com os marcadores. */
  async function conflictFile(repo, p) {
    const r = await repoOf(repo);
    if (!validPath(p)) throw new Error('Caminho inválido');
    const st = await status(r.path);
    const c = st.conflicts.find((x) => x.path === p);
    if (!c) throw new Error('Este arquivo não está mais em conflito');
    const stage = async (n) => { const x = await run(r.top, ['show', `:${n}:${p}`], { ok: [0, 128] }); return x.code === 0 ? x.stdout : null; };
    const merged = await fs.readFile(path.join(r.top, p)).then((b) => (b.subarray(0, 8000).includes(0) ? { binary: true } : { text: b.toString('utf8') }), () => null);
    // Códigos: UU ambos mudaram · AA ambos criaram · DU eu excluí · UD eles excluíram · AU/UA só um lado criou.
    return {
      path: p, code: c.code, base: await stage(1), ours: await stage(2), theirs: await stage(3),
      merged: merged && merged.text != null ? merged.text : null, binary: !!(merged && merged.binary),
      deletedBy: c.code === 'DU' || c.code === 'DD' ? 'us' : c.code === 'UD' ? 'them' : null,
      operation: st.operation,
    };
  }

  /* ─────────────── Fase 3: investigar e manter ─────────────── */

  /** Quem mudou cada linha: `git blame` do arquivo (em HEAD ou numa revisão). Arquivos enormes são cortados. */
  async function blame(repo, p, rev) {
    const r = await repoOf(repo);
    if (!validPath(p)) throw new Error('Caminho inválido');
    if (rev && !validRev(rev)) throw new Error('Revisão inválida');
    const out = (await run(r.top, ['blame', '--porcelain', '-w', ...(rev ? [rev] : []), '--', p])).stdout;
    const b = P.parseBlame(out);
    const truncated = b.lines.length > 6000;
    if (truncated) { b.lines = b.lines.slice(0, 6000); b.groups = b.groups.filter((g) => g.start <= 6000); }
    return { path: p, ...b, truncated };
  }

  /** "Quando este texto apareceu/sumiu?": commits que mudaram a quantidade de ocorrências (-S) ou casaram a regex (-G). */
  async function searchText(repo, text, { regex = false, file: f } = {}) {
    const t = String(text || '');
    if (!t.trim() || t.length > 300 || /[\r\n\0]/.test(t)) throw new Error('Digite um texto (uma linha)');
    const args = ['log', '--branches', '--tags', `--format=${P.PICKAXE_FORMAT}`, '--name-only', '--max-count=200', regex ? '-G' + t : '-S' + t];
    if (f) { if (!validPath(f)) throw new Error('Caminho inválido'); args.push('--', f); }
    return P.parsePickaxe((await git(repo, args)).stdout);
  }

  /** Estado do bisect: em andamento?, commit em teste, quantos candidatos faltam, o culpado (se achado). */
  async function bisectState(repo) {
    const r = await repoOf(repo);
    if ((await inProgress(r.gitDir)) !== 'bisect') return { active: false };
    const log = P.parseBisectLog((await run(r.top, ['bisect', 'log'], { ok: [0, 1] })).stdout);
    const goods = (await run(r.top, ['for-each-ref', '--format=%(refname)', 'refs/bisect/good-*'])).stdout.split('\n').filter(Boolean);
    let left = null;
    if (log.bad && goods.length && !log.found) {
      left = +(await run(r.top, ['rev-list', '--count', 'refs/bisect/bad', '--not', ...goods])).stdout.trim();
    }
    const [current] = P.parseLog((await run(r.top, ['log', '-1', `--format=${P.LOG_FORMAT}`, 'HEAD'])).stdout);
    const found = log.found ? P.parseLog((await run(r.top, ['log', '-1', `--format=${P.LOG_FORMAT}`, log.found])).stdout)[0] : null;
    return { active: true, current, found, candidates: left, steps: left ? Math.ceil(Math.log2(left + 1)) : 0, tested: log.good.length + (log.bad ? 1 : 0) + log.skipped.length };
  }

  /** Tags, mais novas primeiro: nome, commit, anotada?, mensagem, data. */
  async function tags(repo) {
    const out = (await git(repo, ['for-each-ref', '--sort=-creatordate', `--format=%(refname:short)${P.US}%(objecttype)${P.US}%(*objectname)%(objectname)${P.US}%(contents:subject)${P.US}%(creatordate:unix)${P.US}%(*subject)`, 'refs/tags'])).stdout;
    return out.split('\n').filter(Boolean).map((l) => {
      const [name, type, ids, message, time, commitSubject] = l.split(P.US);
      const annotated = type === 'tag';
      return { name, annotated, commit: annotated ? ids.slice(0, 40) : ids, message: annotated ? message : '', subject: annotated ? commitSubject : message, time: +time };
    });
  }

  /** O que um `git clean` apagaria (arquivos e pastas não versionados, sem os ignorados). */
  async function cleanPreview(repo) {
    return P.parseCleanPreview((await git(repo, ['clean', '-n', '-d'])).stdout);
  }

  /** O .gitignore da raiz (texto, ou '' se não existir). */
  async function gitignore(repo) {
    const r = await repoOf(repo);
    return fs.readFile(path.join(r.top, '.gitignore'), 'utf8').catch(() => '');
  }

  /** Ritmo dos últimos 180 dias: commits por dia da semana × hora, e por autor por mês. */
  async function rhythm(repo) {
    if (!(await hasHead(repo))) return { grid: Array.from({ length: 7 }, () => Array(24).fill(0)), total: 0 };
    const out = (await git(repo, ['log', '--since=180.days.ago', '--format=%at', 'HEAD'])).stdout;
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let total = 0;
    for (const t of out.split('\n').filter(Boolean)) { const d = new Date(+t * 1000); grid[d.getDay()][d.getHours()]++; total++; }
    return { grid, total };
  }

  /** As duas versões de um arquivo num commit (antes/depois), para abrir no Diff Checker. */
  async function fileVersions(repo, hash, p) {
    const r = await repoOf(repo);
    if (!validRev(hash) || !validPath(p)) throw new Error('Arquivo inválido');
    const show = async (spec) => { const x = await run(r.top, ['show', spec], { ok: [0, 128] }); return x.code === 0 ? x.stdout : ''; };
    return { before: await show(`${hash}~1:${p}`), after: await show(`${hash}:${p}`) };
  }

  /** Arquivos de uma revisão (para "trazer arquivo de outra branch"). */
  async function files(repo, ref) {
    if (!validRev(ref)) throw new Error('Revisão inválida');
    return (await git(repo, ['ls-tree', '-r', '--name-only', '-z', ref])).stdout.split('\0').filter(Boolean).slice(0, 20000);
  }

  /* ─────────────── Watcher ─────────────── */

  function unwatch() {
    if (!watched) return;
    for (const w of watched.watchers) try { w.close(); } catch { /* já fechado */ }
    clearTimeout(watched.timer);
    watched = null;
  }

  /** Observa o repositório aberto: mudanças em .git (refs, index, HEAD) e nos arquivos avisam a tela. */
  function watchRepo(r) {
    if (watched && sameDir(watched.repo, r.path)) return;
    unwatch();
    const w = { repo: r.path, watchers: [], timer: null };
    const ping = (name) => {
      const f = String(name || '').replace(/\\/g, '/');
      if (/(^|\/)node_modules\//.test(f) || /\.lock$/.test(f) || /(^|\/)objects\//.test(f) || /(^|\/)devkit\//.test(f)) return;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => broadcast({ type: 'changed', repo: r.path }), 350);
    };
    for (const dir of [r.top, r.gitDir]) {
      try { w.watchers.push(watch(dir, { recursive: true }, (_e, name) => ping(name))); } catch { /* sem watcher: a tela atualiza no foco */ }
    }
    watched = w;
  }

  return {
    init, version, list, add, remove, scan, open, summaries,
    status, log, commit, diff, branches, compare, stashes, stashFiles, reflog, overview, backups,
    exec, restoreBackup, mergePreview, conflictFile, rebaseInfo, files,
    blame, searchText, bisectState, tags, cleanPreview, gitignore, rhythm, fileVersions, worktrees,
    unwatch, top: async (repo) => (await repoOf(repo)).top,
    flush: () => queue.flush(),
  };
}

module.exports = { createGitService, defaultRun };
