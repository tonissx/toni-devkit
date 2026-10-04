'use strict';
/**
 * Git — leitura das saídas do git (formatos estáveis, pensados para máquina). JS puro, testado em scripts/test-git.mjs.
 * Os comandos que geram cada formato estão em electron/git/service.js; aqui só se interpreta o texto.
 */

const US = '\x1f'; // separa campos
const RS = '\x1e'; // separa registros

/* ─────────────── status --porcelain=v2 --branch -z ─────────────── */

/** Letra do porcelain → tipo legível. */
const KIND = { M: 'modified', T: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict' };

/**
 * → { branch: { oid, head, detached, upstream, ahead, behind }, staged, unstaged, untracked, conflicts }
 * staged/unstaged: [{ path, orig?, kind }] · untracked: [path] · conflicts: [{ path, code }]
 */
function parseStatus(out) {
  const branch = { oid: null, head: null, detached: false, upstream: null, ahead: 0, behind: 0 };
  const staged = [], unstaged = [], untracked = [], conflicts = [];
  const parts = String(out || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('# ')) {
      const [key, ...rest] = p.slice(2).split(' ');
      const v = rest.join(' ');
      if (key === 'branch.oid') branch.oid = v === '(initial)' ? null : v;
      else if (key === 'branch.head') { branch.detached = v === '(detached)'; branch.head = branch.detached ? null : v; }
      else if (key === 'branch.upstream') branch.upstream = v;
      else if (key === 'branch.ab') { const m = /^\+(\d+) -(\d+)$/.exec(v); if (m) { branch.ahead = +m[1]; branch.behind = +m[2]; } }
      continue;
    }
    const type = p[0];
    if (type === '?') { untracked.push(p.slice(2)); continue; }
    if (type === '!') continue;
    if (type === '1' || type === '2') {
      // 1 XY sub mH mI mW hH hI path  ·  2 XY sub mH mI mW hH hI Xscore path \0 orig
      const f = p.split(' ');
      const xy = f[1];
      const path = f.slice(type === '1' ? 8 : 9).join(' ');
      const orig = type === '2' ? parts[++i] : undefined;
      if (xy[0] !== '.') staged.push({ path, ...(orig ? { orig } : {}), kind: KIND[xy[0]] || 'modified' });
      if (xy[1] !== '.') unstaged.push({ path, kind: KIND[xy[1]] || 'modified' });
      continue;
    }
    if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = p.split(' ');
      conflicts.push({ path: f.slice(10).join(' '), code: f[1] });
    }
  }
  return { branch, staged, unstaged, untracked, conflicts };
}

/* ─────────────── log ─────────────── */

/** Formato do log (--format) que parseLog entende. */
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join('%x1f') + '%x1e';

/** Decorações (%D): "HEAD -> main, tag: v1.0, origin/main" → [{ type: 'head'|'branch'|'tag'|'remote', name }]. */
function parseDecorations(d) {
  const refs = [];
  for (let s of String(d || '').split(', ').map((x) => x.trim()).filter(Boolean)) {
    if (s.startsWith('HEAD -> ')) { refs.push({ type: 'head', name: 'HEAD' }); s = s.slice(8); refs.push({ type: 'branch', name: s, current: true }); continue; }
    if (s === 'HEAD') { refs.push({ type: 'head', name: 'HEAD' }); continue; }
    if (s.startsWith('tag: ')) { refs.push({ type: 'tag', name: s.slice(5) }); continue; }
    if (s.startsWith('refs/devkit/')) continue; // pontos de volta do próprio Devkit não poluem o grafo
    if (s.startsWith('refs/stash')) continue;
    refs.push({ type: /\//.test(s) && !s.startsWith('refs/') ? 'remote' : 'branch', name: s });
  }
  return refs;
}

/** → [{ hash, parents, author, email, time (s), subject, refs }] */
function parseLog(out) {
  return String(out || '').split(RS).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [hash, parents, author, email, time, subject, deco] = r.split(US);
    return { hash, parents: parents ? parents.split(' ') : [], author, email, time: Number(time), subject, refs: parseDecorations(deco) };
  });
}

/* ─────────────── branches (for-each-ref refs/heads) ─────────────── */

const BRANCH_FORMAT = ['%(refname:short)', '%(objectname)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:unix)', '%(subject)', '%(HEAD)', '%(authorname)'].join('%1f');

/** → [{ name, hash, upstream, ahead, behind, gone, time, subject, current, author }] */
function parseBranches(out) {
  return String(out || '').split('\n').filter(Boolean).map((line) => {
    const [name, hash, upstream, track, time, subject, head, author] = line.split(US);
    const ahead = /ahead (\d+)/.exec(track || ''), behind = /behind (\d+)/.exec(track || '');
    return {
      name, hash, upstream: upstream || null, ahead: ahead ? +ahead[1] : 0, behind: behind ? +behind[1] : 0,
      gone: /gone/.test(track || ''), time: Number(time), subject, current: head === '*', author,
    };
  });
}

/* ─────────────── reflog ─────────────── */

// Com --date=unix, %gd sai como HEAD@{<segundos>}: é a hora do movimento (não a do commit).
const REFLOG_FORMAT = ['%H', '%gd', '%gs'].join('%x1f') + '%x1e';

/**
 * Mensagem do reflog → { kind, text } em português. kind: commit | amend | checkout | reset | merge | rebase |
 * cherry-pick | pull | clone | branch | other.
 */
function describeReflog(gs) {
  const s = String(gs || '');
  let m;
  if ((m = /^commit \(amend\): (.*)$/.exec(s))) return { kind: 'amend', text: `Corrigiu o último commit: ${m[1]}` };
  if ((m = /^commit \(initial\): (.*)$/.exec(s))) return { kind: 'commit', text: `Primeiro commit: ${m[1]}` };
  if ((m = /^commit \(merge\): (.*)$/.exec(s))) return { kind: 'merge', text: `Commit de merge: ${m[1]}` };
  if ((m = /^commit: (.*)$/.exec(s))) return { kind: 'commit', text: `Commit: ${m[1]}` };
  if ((m = /^checkout: moving from (.+) to (.+)$/.exec(s))) return { kind: 'checkout', text: `Trocou de ${m[1]} para ${m[2]}` };
  if (/^reset: moving to refs\/devkit\/backup\//.test(s)) return { kind: 'reset', text: 'Desfez pelo Devkit (voltou a um ponto de volta)' };
  if (/^reset: moving to HEAD$/.test(s)) return { kind: 'reset', text: 'Limpou as mudanças dos arquivos (stash ou descarte)' };
  if ((m = /^reset: moving to (.+)$/.exec(s))) return { kind: 'reset', text: `Voltou para ${m[1]}` };
  if ((m = /^merge (.+?): (.*)$/.exec(s))) return { kind: 'merge', text: `Mesclou ${m[1]} (${m[2] === 'Fast-forward' ? 'avanço direto' : m[2]})` };
  if ((m = /^rebase(?: -i)? \((\w+)\): (.*)$/.exec(s))) return { kind: 'rebase', text: m[1] === 'finish' ? `Rebase concluído: ${m[2]}` : `Rebase (${m[1]}): ${m[2]}` };
  if ((m = /^cherry-pick: (.*)$/.exec(s))) return { kind: 'cherry-pick', text: `Trouxe o commit: ${m[1]}` };
  if ((m = /^pull.*?: (.*)$/.exec(s))) return { kind: 'pull', text: `Pull: ${m[1]}` };
  if (/^clone: /.test(s)) return { kind: 'clone', text: 'Clonou o repositório' };
  if ((m = /^branch: (.*)$/.exec(s))) return { kind: 'branch', text: `Branch: ${m[1]}` };
  return { kind: 'other', text: s };
}

/** Saída de `reflog --date=unix` → [{ hash, selector ('HEAD@{2}'), message, time (hora do movimento), kind, text }] */
function parseReflog(out) {
  return String(out || '').split(RS).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r, i) => {
    const [hash, gd, message] = r.split(US);
    const t = /@\{(\d+)\}$/.exec(gd || '');
    return { hash, selector: `HEAD@{${i}}`, message, time: t ? Number(t[1]) : 0, ...describeReflog(message) };
  });
}

/* ─────────────── stash ─────────────── */

const STASH_FORMAT = ['%gd', '%H', '%at', '%gs'].join('%x1f') + '%x1e';

/** → [{ ref ('stash@{0}'), hash, time, message, branch }] */
function parseStashes(out) {
  return String(out || '').split(RS).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [ref, hash, time, gs] = r.split(US);
    // "On main: mensagem" ou "WIP on main: abc123 subject"
    const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(gs || '');
    return { ref, hash, time: Number(time), message: m ? m[2] : gs, branch: m ? m[1] : null };
  });
}

/* ─────────────── diff --numstat -z ─────────────── */

/** → [{ path, orig?, added, deleted, binary }] */
function parseNumstat(out) {
  const parts = String(out || '').split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(p);
    if (!m) continue;
    const binary = m[1] === '-';
    const f = { added: binary ? 0 : +m[1], deleted: binary ? 0 : +m[2], binary };
    if (m[3] === '') { f.orig = parts[++i]; f.path = parts[++i]; } // renomeado: "a\td\t\0antigo\0novo"
    else f.path = m[3];
    files.push(f);
  }
  return files;
}

/* ─────────────── patch (diff unificado de um arquivo) ─────────────── */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Diff unificado (um ou mais arquivos) → [{ header: [linhas até o 1º @@], oldPath, newPath, binary,
 *   hunks: [{ header, oldStart, oldLines, newStart, newLines, lines: [{ t: ' '|'+'|'-'|'\\', text, old, new }] }] }]
 * old/new: número da linha em cada lado (null quando não se aplica).
 */
function parsePatch(text) {
  const files = [];
  let file = null, hunk = null, o = 0, n = 0;
  const lines = String(text || '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      file = { header: [line], oldPath: null, newPath: null, binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = { header: line, oldStart: +m[1], oldLines: m[2] == null ? 1 : +m[2], newStart: +m[3], newLines: m[4] == null ? 1 : +m[4], context: m[5].trim(), lines: [] };
      o = hunk.oldStart; n = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      file.header.push(line);
      if (line.startsWith('--- ')) file.oldPath = line === '--- /dev/null' ? null : line.replace(/^--- (a\/)?/, '');
      else if (line.startsWith('+++ ')) file.newPath = line === '+++ /dev/null' ? null : line.replace(/^\+\+\+ (b\/)?/, '');
      else if (/^Binary files /.test(line)) file.binary = true;
      continue;
    }
    const t = line[0];
    const body = line.slice(1);
    if (t === '+') hunk.lines.push({ t, text: body, old: null, new: n++ });
    else if (t === '-') hunk.lines.push({ t, text: body, old: o++, new: null });
    else if (t === '\\') hunk.lines.push({ t, text: body, old: null, new: null });
    else hunk.lines.push({ t: ' ', text: body, old: o++, new: n++ });
  }
  return files;
}

/**
 * Patch de UM trecho, para `git apply --cached` (stage) / `-R` (unstage, descartar).
 * file: item de parsePatch; hunk: um dos seus hunks.
 */
function hunkPatch(file, hunk) {
  const raw = hunk.lines.map((l) => (l.t === '\\' ? '\\' : l.t) + l.text);
  return [...file.header, hunk.header, ...raw].join('\n') + '\n';
}

/* ─────────────── Fase 3: blame, busca no histórico, bisect, clean ─────────────── */

/**
 * `blame --porcelain` → { commits: { hash → { author, time, summary, boundary } }, lines: [{ n, hash, text }],
 * groups: [{ hash, start, end }] } — grupos = linhas seguidas do mesmo commit (para a coluna de autoria).
 */
function parseBlame(out) {
  const commits = {};
  const lines = [];
  let cur = null;
  for (const line of String(out || '').split('\n')) {
    const h = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (h) { cur = { hash: h[1], n: +h[3] }; if (!commits[cur.hash]) commits[cur.hash] = { author: '', time: 0, summary: '', boundary: false }; continue; }
    if (!cur) continue;
    if (line.startsWith('\t')) { lines.push({ n: cur.n, hash: cur.hash, text: line.slice(1).replace(/\r$/, '') }); continue; }
    const c = commits[cur.hash];
    if (line.startsWith('author ')) c.author = line.slice(7);
    else if (line.startsWith('author-time ')) c.time = +line.slice(12);
    else if (line.startsWith('summary ')) c.summary = line.slice(8);
    else if (line === 'boundary') c.boundary = true;
  }
  const groups = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.hash === l.hash && g.end === l.n - 1) g.end = l.n;
    else groups.push({ hash: l.hash, start: l.n, end: l.n });
  }
  return { commits, lines, groups };
}

/** Formato para buscas com arquivos (`--name-only`): cada registro começa com RS. */
const PICKAXE_FORMAT = '%x1e' + ['%H', '%s', '%an', '%at'].join('%x1f');

/** `log -S/-G --name-only` → [{ hash, subject, author, time, files }] */
function parsePickaxe(out) {
  return String(out || '').split(RS).filter((r) => r.trim()).map((r) => {
    const [head, ...rest] = r.split('\n');
    const [hash, subject, author, time] = head.split(US);
    return { hash, subject, author, time: +time, files: rest.map((l) => l.trim()).filter(Boolean) };
  });
}

/** `bisect log` → { found: hash|null, good: [hash], bad: hash|null, skipped: [hash] } */
function parseBisectLog(out) {
  const r = { found: null, good: [], bad: null, skipped: [] };
  for (const line of String(out || '').split('\n')) {
    let m;
    if ((m = /^# first bad commit: \[([0-9a-f]{40})\]/.exec(line))) r.found = m[1];
    else if ((m = /^# bad: \[([0-9a-f]{40})\]/.exec(line))) r.bad = m[1];
    else if ((m = /^# good: \[([0-9a-f]{40})\]/.exec(line))) r.good.push(m[1]);
    else if ((m = /^# skip: \[([0-9a-f]{40})\]/.exec(line))) r.skipped.push(m[1]);
  }
  return r;
}

/** `clean -n -d` → [caminho] (pastas terminam em "/"). */
const parseCleanPreview = (out) => String(out || '').split('\n').map((l) => /^Would remove (.+)$/.exec(l.trim())).filter(Boolean).map((m) => m[1]);

/**
 * `worktree list --porcelain` → [{ path, head, branch (curto) | null, detached, locked, prunable, main }].
 * O primeiro é o principal (a pasta do próprio repositório).
 */
function parseWorktrees(out) {
  return String(out || '').replace(/\r/g, '').split('\n\n').map((b) => b.trim()).filter(Boolean).map((b, i) => {
    const w = { path: '', head: null, branch: null, detached: false, locked: false, prunable: false, main: i === 0 };
    for (const line of b.split('\n')) {
      const [k, ...rest] = line.split(' ');
      const v = rest.join(' ');
      if (k === 'worktree') w.path = v;
      else if (k === 'HEAD') w.head = v;
      else if (k === 'branch') w.branch = v.replace(/^refs\/heads\//, '');
      else if (k === 'detached') w.detached = true;
      else if (k === 'locked') w.locked = true;
      else if (k === 'prunable') w.prunable = true;
    }
    return w;
  });
}

module.exports = {
  parseWorktrees,
  parseBlame, PICKAXE_FORMAT, parsePickaxe, parseBisectLog, parseCleanPreview,
  US, RS, LOG_FORMAT, BRANCH_FORMAT, REFLOG_FORMAT, STASH_FORMAT,
  parseStatus, parseDecorations, parseLog, parseBranches, describeReflog, parseReflog, parseStashes, parseNumstat,
  parsePatch, hunkPatch,
};
