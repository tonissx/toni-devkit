'use strict';
/** Parsers puros (sem chamar git) para a saída dos comandos usados pelo Git Pulse local. */

const FIELD_SEP = '\x1f';

const ORDINARY_RE = /^1 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const RENAME_RE = /^2 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const UNMERGED_RE = /^u (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;

function kindFromXY(xy) {
  if (xy.includes('U')) return 'conflicted';
  if (xy.includes('A')) return 'added';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('C')) return 'copied';
  return 'modified';
}

function makeEntry(xy, filePath, origPath) {
  return {
    path: filePath,
    origPath: origPath || null,
    kind: kindFromXY(xy),
    staged: xy[0] !== '.',
    unstaged: xy[1] !== '.',
    insertions: null,
    deletions: null,
    binary: false,
  };
}

/** `git status --porcelain=v2 --branch -z` → { branch, detached, upstream, hasUpstream, ahead, behind, files }. */
function parsePorcelainV2(stdout) {
  const records = stdout.split('\0').filter((r) => r.length > 0);
  const out = { branch: null, detached: false, upstream: null, hasUpstream: false, ahead: 0, behind: 0, files: [] };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.startsWith('# branch.head ')) {
      const head = rec.slice('# branch.head '.length);
      if (head === '(detached)') out.detached = true;
      else out.branch = head;
    } else if (rec.startsWith('# branch.upstream ')) {
      out.upstream = rec.slice('# branch.upstream '.length);
      out.hasUpstream = true;
    } else if (rec.startsWith('# branch.ab ')) {
      const m = rec.match(/\+(\d+) -(\d+)/);
      if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); }
    } else if (rec[0] === '#') {
      // outros headers (branch.oid, ...) — não usados aqui
    } else if (rec[0] === '?') {
      out.files.push({
        path: rec.slice(2), origPath: null, kind: 'untracked',
        staged: false, unstaged: true, insertions: null, deletions: null, binary: false,
      });
    } else {
      let m = ORDINARY_RE.exec(rec);
      if (m) { out.files.push(makeEntry(m[1], m[8], null)); continue; }
      m = RENAME_RE.exec(rec);
      if (m) { const origPath = records[++i] ?? null; out.files.push(makeEntry(m[1], m[9], origPath)); continue; }
      m = UNMERGED_RE.exec(rec);
      if (m) out.files.push(makeEntry(m[1], m[10], null));
    }
  }
  return out;
}

/**
 * `git diff <base> -z --numstat` → [{ path, insertions, deletions, binary }].
 * Sem `-M`: um arquivo renomeado aparece como duas linhas (delete do path antigo + add do novo) em
 * vez de uma linha de rename — simplificação aceita para o MVP (ver plano). O merge com o status
 * (por `path` exato) ignora a linha "órfã" do path antigo.
 */
function parseNumstat(stdout) {
  const records = stdout.split('\0').filter((r) => r.length > 0);
  const out = [];
  for (const rec of records) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(rec);
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    out.push({ path: m[3], insertions: binary ? null : Number(m[1]), deletions: binary ? null : Number(m[2]), binary });
  }
  return out;
}

/**
 * `git log --pretty=tformat:'%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x00'` →
 * [{ hash, shortHash, author, authorEmail, date, subject }].
 * Mesmo com tformat (terminador por registro), o git ainda emite um '\n' logo após cada '\0' —
 * removido aqui antes de separar os campos.
 */
function parseLog(stdout) {
  return stdout.split('\0')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.length > 0)
    .map((rec) => {
      const [hash, shortHash, author, authorEmail, date, subject] = rec.split(FIELD_SEP);
      return { hash, shortHash, author, authorEmail, date, subject };
    });
}

/** `https://github.com/org/repo.git` ou `git@github.com:org/repo.git` → { host, owner, repo } | null. */
function parseRemoteUrl(url) {
  if (!url) return null;
  let m = url.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) m = url.match(/^[^@]+@([^:]+):(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const host = m[1];
  const parts = m[2].split('/').filter(Boolean);
  const repo = parts[parts.length - 1] || null;
  const owner = parts.length > 1 ? parts[parts.length - 2] : null;
  return { host, owner, repo };
}

module.exports = { parsePorcelainV2, parseNumstat, parseLog, parseRemoteUrl };
