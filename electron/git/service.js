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
const { buildOp, validRev, validBranchName } = require('../../src/git/ops.js');

const MAX_BACKUPS = 30;
const MAX_DIFF = 3 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__', 'AppData']);

/** Roda o git. Resolve { stdout, stderr, code }; rejeita com a mensagem do git se o código não for aceito. */
function defaultRun(cwd, args, { stdin, ok = [0], read = true, timeout = 120e3 } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C', GIT_PAGER: 'cat',
      GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no',
      ...(read ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
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
    return {
      hash: h, parents: ps, author, email, time: +time, committer, committerTime: +ctime, refs: P.parseDecorations(deco),
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

  /** Branches locais com upstream, à frente/atrás da base (main/master) e se já foram mescladas nela. */
  async function branches(repo) {
    if (!(await hasHead(repo))) return { base: null, branches: [] };
    const list = P.parseBranches((await git(repo, ['for-each-ref', `--format=${P.BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads'])).stdout);
    const base = ['main', 'master', 'develop'].find((b) => list.some((x) => x.name === b)) || (list.find((x) => x.current) || list[0] || {}).name || null;
    const merged = base ? new Set((await git(repo, ['branch', '--format=%(refname:short)', '--merged', base])).stdout.split('\n').filter(Boolean)) : new Set();
    await Promise.all(list.map(async (b) => {
      b.merged = b.name !== base && merged.has(b.name);
      if (!base || b.name === base) return;
      const c = (await git(repo, ['rev-list', '--left-right', '--count', `${base}...${b.name}`])).stdout.trim().split(/\s+/);
      b.baseBehind = +c[0]; b.baseAhead = +c[1];
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
      const wip = (await run(r.top, ['stash', 'create'], { read: false })).stdout.trim();
      if (wip) { await run(r.top, ['update-ref', ref('wip'), wip], { read: false }); refs.wip = wip; }
    }
    let kind = 'state';
    const meta = {};
    if (op.backupRef) {
      kind = 'branch';
      const tip = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/heads/${op.backupRef}`], { ok: [0, 1] })).stdout.trim();
      if (tip) { await run(r.top, ['update-ref', ref('branch'), tip], { read: false }); refs.branch = tip; meta.branchName = op.backupRef; }
    }
    if (op.backupStash) {
      kind = 'stash';
      const h = (await run(r.top, ['rev-parse', '--verify', '-q', op.backupStash])).stdout.trim();
      const msg = (await run(r.top, ['log', '-1', '--format=%gs', '-g', op.backupStash], { ok: [0, 128] })).stdout.trim();
      await run(r.top, ['update-ref', ref('stash'), h], { read: false });
      refs.stash = h; meta.stashMessage = msg;
    }
    if (op.backupFiles) {
      kind = 'files';
      const dest = path.join(r.gitDir, 'devkit', 'files', id);
      for (const f of op.backupFiles) {
        const src = path.join(r.top, f);
        if (!src.startsWith(r.top)) continue;
        try { await fs.mkdir(path.dirname(path.join(dest, f)), { recursive: true }); await fs.copyFile(src, path.join(dest, f)); } catch { /* sumiu: nada a guardar */ }
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
        const exists = (await run(r.top, ['rev-parse', '--verify', '-q', `refs/heads/${b.branchName}`], { ok: [0, 1] })).code === 0;
        const name = exists ? `${b.branchName}-restaurada` : b.branchName;
        if (!validBranchName(name)) throw new Error('Nome de branch inválido');
        await run(r.top, ['branch', name, ref('branch')], { read: false });
        message = `Branch “${name}” recriada`;
      } else if (b.kind === 'stash') {
        await run(r.top, ['stash', 'store', '-m', b.stashMessage || 'Stash recuperado pelo Devkit', ref('stash')], { read: false });
        message = 'Stash recuperado';
      } else if (b.kind === 'files') {
        const src = path.join(r.gitDir, 'devkit', 'files', b.id);
        for (const f of b.files || []) {
          const to = path.join(r.top, f);
          if (!to.startsWith(r.top)) continue;
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(path.join(src, f), to).catch(() => {});
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
      const backup = op.backup && !unborn ? await createBackup(r, op) : op.backupFiles ? await createBackup(r, op) : null;
      try {
        const res = await run(r.top, op.args, { stdin: op.stdin, read: false });
        return { ok: true, title: op.title, display: op.display, risk: op.risk, backup: backup ? backup.id : null, output: (res.stdout + res.stderr).trim().slice(0, 4000) };
      } finally {
        broadcast({ type: 'changed', repo: r.path });
      }
    });
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
    exec, restoreBackup,
    unwatch, top: async (repo) => (await repoOf(repo)).top,
    flush: () => queue.flush(),
  };
}

module.exports = { createGitService, defaultRun };
