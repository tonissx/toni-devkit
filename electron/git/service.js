'use strict';
/**
 * Orquestração do Git Pulse (local): compõe run.js + parse.js nas 3 operações usadas pelo IPC.
 * Sem estado — o renderer sempre passa o path do repo ativo (guardado por ele via usePersisted).
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { execGit, GitError } = require('./run.js');
const { parsePorcelainV2, parseNumstat, parseLog, parseRemoteUrl } = require('./parse.js');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // SHA fixa da árvore vazia do git
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// %x1f/%x00 são o placeholder textual do PRÓPRIO git (4 chars ASCII) — ele grava os bytes de
// controle na saída; não dá para passar um NUL literal no argv (execFile rejeita).
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x00';

async function hasAnyCommit(repoRoot) {
  try {
    await execGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** Confirma se `pickedPath` existe, tem git disponível e é (ou está dentro de) um repo. */
async function detectRepo(pickedPath) {
  if (!pickedPath) return { gitAvailable: true, isRepo: false, root: null };
  try {
    await fs.stat(pickedPath);
  } catch {
    return { gitAvailable: true, isRepo: false, root: null };
  }
  try {
    await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: pickedPath });
  } catch (e) {
    if (e instanceof GitError && e.type === 'git-not-found') return { gitAvailable: false, isRepo: false, root: null };
    return { gitAvailable: true, isRepo: false, root: null };
  }
  const top = (await execGit(['rev-parse', '--show-toplevel'], { cwd: pickedPath })).trim();
  return { gitAvailable: true, isRepo: true, root: path.normalize(top) };
}

/** Status completo: branch, ahead/behind, arquivos alterados (com stats) e commits recentes. */
async function getStatus(repoRoot) {
  const hasCommits = await hasAnyCommit(repoRoot);
  const base = hasCommits ? 'HEAD' : EMPTY_TREE;

  const [statusOut, numstatOut, logOut, remoteOut] = await Promise.all([
    // --untracked-files=all: lista cada arquivo novo individualmente (senão uma pasta nova inteira
    // vira uma única entrada de diretório, que não dá pra abrir no painel de diff).
    execGit(['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'], { cwd: repoRoot }),
    execGit(['diff', base, '-z', '--numstat'], { cwd: repoRoot }),
    hasCommits
      ? execGit(['log', '-n', '20', '--date=iso-strict', '--pretty=tformat:' + LOG_FORMAT], { cwd: repoRoot })
      : Promise.resolve(''),
    execGit(['remote', 'get-url', 'origin'], { cwd: repoRoot }).catch(() => ''),
  ]);

  const st = parsePorcelainV2(statusOut);
  const stats = parseNumstat(numstatOut);
  const byPath = new Map(stats.map((s) => [s.path, s]));
  for (const f of st.files) {
    const s = byPath.get(f.path);
    if (s) { f.insertions = s.insertions; f.deletions = s.deletions; f.binary = s.binary; }
  }

  const totals = st.files.reduce((acc, f) => {
    acc.filesChanged += 1;
    acc.insertions += f.insertions || 0;
    acc.deletions += f.deletions || 0;
    return acc;
  }, { filesChanged: 0, insertions: 0, deletions: 0 });

  const commits = parseLog(logOut);
  const remoteUrl = remoteOut.trim() || null;
  const parsedRemote = parseRemoteUrl(remoteUrl);

  return {
    repoName: (parsedRemote && parsedRemote.repo) || path.basename(repoRoot),
    remoteUrl,
    branch: st.branch,
    detached: st.detached,
    hasUpstream: st.hasUpstream,
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    hasCommits,
    lastCommit: commits[0] || null,
    recentCommits: commits,
    files: st.files,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

/** `filePath` sempre relativo (como vem de getStatus().files[].path) — rejeita fuga do repo. */
function resolveInRepo(repoRoot, filePath) {
  if (typeof filePath !== 'string' || !filePath || path.isAbsolute(filePath)) throw new Error('Caminho inválido');
  const segments = filePath.split(/[\\/]/);
  if (segments.some((s) => s === '..')) throw new Error('Caminho inválido');
  return path.join(repoRoot, ...segments);
}

const hasNulByte = (s) => s.slice(0, 8000).includes('\0');

/** Diff de um arquivo: conteúdo em HEAD vs. conteúdo atual na working tree. */
async function getFileDiff(repoRoot, filePath) {
  const abs = resolveInRepo(repoRoot, filePath);
  const hasCommits = await hasAnyCommit(repoRoot);

  let before = '';
  if (hasCommits) {
    try { before = await execGit(['show', 'HEAD:' + filePath], { cwd: repoRoot }); }
    catch { before = ''; } // arquivo novo/não versionado: sem conteúdo em HEAD
  }

  let after = '';
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) throw new Error('Arquivo maior que 20 MB');
    after = await fs.readFile(abs, 'utf8');
  } catch (e) {
    if (e instanceof Error && e.message.includes('20 MB')) throw e;
    after = ''; // arquivo excluído na working tree
  }

  return { before, after, binary: hasNulByte(before) || hasNulByte(after) };
}

module.exports = { detectRepo, getStatus, getFileDiff };
