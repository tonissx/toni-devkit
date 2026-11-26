'use strict';
/**
 * Logs — marcos na linha do tempo (deploys do Fluig/WildFly e merges do Git). Puro.
 *
 * Este trecho detecta deploy/undeploy/restart numa linha de log e agrupa rajadas (um restart do servidor
 * redeploya dezenas de .war em poucos segundos) em um único marco.
 */

const DEPLOY_RULES = [
  { re: /WFLYSRV0010: Deployed "([^"]+?)(?:\.(?:war|ear|jar))?"/, kind: 'deploy' },
  // Republicação: o artefato é o NOVO (o segundo nome).
  { re: /WFLYSRV0016: Replaced deployment "[^"]*" with deployment "([^"]+?)(?:\.(?:war|ear|jar))?"/, kind: 'deploy' },
  { re: /WFLYSRV0013: Redeployed "([^"]+?)(?:\.(?:war|ear|jar))?"/, kind: 'deploy' },
  { re: /WFLYSRV0009: Undeployed "([^"]+?)(?:\.(?:war|ear|jar))?"/, kind: 'undeploy' },
  { re: /WFLYSRV0025:/, kind: 'restart' },
  { re: /WFLYSRV0026:/, kind: 'restart' },
];

/** Reconhece uma linha de deploy/undeploy/restart do WildFly. `artifact` vem sem a extensão. */
function matchDeploy(text) {
  const s = String(text || '');
  if (!s.includes('WFLYSRV00')) return null;
  for (const r of DEPLOY_RULES) {
    const m = r.re.exec(s);
    if (m) return { kind: r.kind, artifact: m[1] || null };
  }
  return null;
}

/** Eventos a menos de `gapMs` do anterior entram no mesmo marco. */
function groupBursts(events, gapMs = 120000) {
  const sorted = (events || []).slice().sort((a, b) => a.ts - b.ts);
  const groups = [];
  let cur = null;
  for (const e of sorted) {
    if (cur && e.ts - cur[cur.length - 1].ts < gapMs) cur.push(e);
    else groups.push((cur = [e]));
  }
  return groups.map(toMilestone);
}

/** Restart vence; senão, qualquer deploy na rajada faz dela um deploy (undeploy + deploy = republicação). */
function toMilestone(g) {
  const first = g[0];
  const artifacts = [];
  for (const e of g) if (e.kind === 'deploy' && e.artifact && !artifacts.includes(e.artifact)) artifacts.push(e.artifact);
  if (g.some((e) => e.kind === 'restart')) {
    return { id: 'restart:' + first.ts, kind: 'restart', ts: first.ts, i: first.i, artifacts, label: 'restart · ' + artifacts.length + ' apps' };
  }
  const names = [];
  for (const e of g) if (e.artifact && !names.includes(e.artifact)) names.push(e.artifact);
  const extra = names.length - 2;
  const kind = g.some((e) => e.kind === 'deploy') ? 'deploy' : first.kind;
  const label = kind + ' ' + names.slice(0, 2).join(', ') + (extra > 0 ? ' +' + extra : '');
  return { id: kind + ':' + first.ts, kind, ts: first.ts, i: first.i, artifacts: names, label };
}

const DAY = 86400e3;

/** Número da PR no assunto do commit (merge do GitHub ou squash). */
function prNumber(subject) {
  const s = String(subject || '');
  const m = /^Merge pull request #(\d+)\b/.exec(s) || /\(#(\d+)\)\s*$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** `com.x.WorkflowService$Inner.start` → `WorkflowService` (penúltimo segmento, sem `$…`). */
function frameBase(frame) {
  const parts = String(frame || '').split('.').filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 2].split('$')[0];
}

const JVM_EXT = /\.(?:java|kt|groovy|scala)$/;

/**
 * Teste "este arquivo é o do frame?" (ou null sem frame). Com pacote (`com.x.Utils$1.run`: 3+ segmentos antes do
 * método), o caminho tem de terminar em `com/x/Utils` + `.java|.kt|.groovy|.scala`, com as maiúsculas exatas — um
 * `Utils.js` de outro projeto não conta. Sem pacote, vale o nome do arquivo sem extensão (sem diferenciar maiúsculas).
 */
function frameFileMatcher(frame) {
  const parts = String(frame || '').split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const cls = parts[parts.length - 2].split('$')[0];
  if (!cls) return null;
  if (parts.length >= 4) {
    const suffix = parts.slice(0, -2).join('/') + '/' + cls;
    return (f) => {
      const p = String(f).replace(/\\/g, '/');
      if (!JVM_EXT.test(p)) return false;
      const noExt = p.replace(JVM_EXT, '');
      return noExt === suffix || noExt.endsWith('/' + suffix);
    };
  }
  const low = cls.toLowerCase();
  return (f) => String(f).split(/[\\/]/).pop().replace(/\.[^.]*$/, '').toLowerCase() === low;
}

/** Nome (sem a pasta) do primeiro arquivo que é o do frame (ver `frameFileMatcher`), ou null. */
function touchedFile(files, frame) {
  const match = frameFileMatcher(frame);
  if (!match) return null;
  for (const f of files || []) if (match(f)) return String(f).split(/[\\/]/).pop();
  return null;
}

/** Algum arquivo tem o nome (sem extensão) igual à classe do frame. */
function touchesFrame(files, frame) {
  return touchedFile(files, frame) != null;
}

/** Marco com maior `ts <= t` (busca binária; `sorted` por `ts`). */
function previousMilestone(sorted, t) {
  let lo = 0;
  let hi = (sorted || []).length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts <= t) { found = sorted[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Commit da main que é um merge de fato (tem número de PR ou o assunto começa com "Merge "). Com --first-parent,
 * commits diretos e squash sem PR também aparecem — esses são "Commit na main".
 */
function isMergeCommit(m) {
  if (!m) return false;
  if (m.pr) return true;
  return /^Merge /.test(String(m.subject || m.title || m.label || ''));
}

/** Commits entre o deploy anterior e este, em pastas iguais aos artefatos do deploy. */
function commitsInDeploy(deploy, prev, commits) {
  const arts = new Set(((deploy && deploy.artifacts) || []).map((a) => String(a).toLowerCase()));
  const lower = prev ? prev.ts : deploy.ts - 7 * DAY;
  return (commits || []).filter((c) => {
    if (!(c.ts > lower && c.ts <= deploy.ts)) return false;
    return (c.files || []).some((f) => {
      const segs = String(f).split(/[\\/]/);
      segs.pop();
      return segs.some((s) => arts.has(s.toLowerCase()));
    });
  });
}

/** Marco anterior a uma ocorrência, com intervalo e força do indício. Não afirma causa. */
function attribute(group, sorted, logStart, related) {
  const milestone = previousMilestone(sorted, group.first);
  if (!milestone) return null;
  if (milestone.ts <= logStart || group.first < logStart + 60000) return { preexisting: true };
  const gapMs = group.first - milestone.ts;
  const strong = touchesFrame(related(milestone), group.frame);
  return { milestone, gapMs, strong, faded: gapMs > DAY };
}

/** Junta as três fontes de marcos, ordenadas por `ts`, respeitando os tipos ligados. */
function mergeMilestones(deploys, manual, merges, enabled = { deploy: true, merge: true, manual: true }) {
  return [
    ...(enabled.deploy ? deploys || [] : []),
    ...(enabled.manual ? manual || [] : []),
    ...(enabled.merge ? merges || [] : []),
  ].sort((a, b) => a.ts - b.ts);
}

/** Nomes de pasta genéricos demais para dizer de qual repositório é um artefato (sem diferenciar maiúsculas). */
const GENERIC_FOLDERS = new Set(['src', 'main', 'java', 'resources', 'webapp', 'web-inf', 'meta-inf', 'api', 'portal', 'wcm',
  'widget', 'widgets', 'content', 'test', 'tests', 'lib', 'libs', 'dist', 'build', 'target', 'bin', 'obj', 'node_modules',
  'public', 'static', 'assets', 'js', 'css', 'img', 'images', 'docs', 'scripts', 'config', 'root', 'app', 'apps', 'server',
  'client', 'common', 'core', 'util', 'utils']);

/**
 * Repositórios por quantos artefatos distintos (sem diferenciar maiúsculas) têm uma pasta de mesmo nome, do que mais
 * bate para o que menos bate; os que não batem nenhum ficam de fora. Nomes genéricos (`GENERIC_FOLDERS`) não contam.
 * → [{ path, matches }]
 */
function rankRepos(artifacts, repos) {
  const arts = [...new Set((artifacts || []).map((a) => String(a).toLowerCase()))].filter((a) => a && !GENERIC_FOLDERS.has(a));
  if (!arts.length) return [];
  const out = [];
  for (const r of repos || []) {
    const folders = new Set((r.folders || []).map((f) => String(f).toLowerCase()));
    const matches = arts.filter((a) => folders.has(a)).length;
    if (matches > 0) out.push({ path: r.path, matches });
  }
  return out.sort((a, b) => b.matches - a.matches); // estável: no empate, a ordem da lista do Git
}

/** Liga sozinho só quando o primeiro vence sem empate; senão (null) pergunta. */
function autoRepo(ranked) {
  const [a, b] = ranked || [];
  if (!a || !(a.matches >= 1)) return null;
  return !b || a.matches > b.matches ? a.path : null;
}

const stripExt = (a) => String(a).replace(/\.(war|ear|jar)$/i, '');

/**
 * Qual repositório ligar a um log pelos deploys dele. → { auto: path|null, suggestions: path[] (até 2) }
 * Ligar sozinho só conta artefatos de `deploy` (inclui republicação); os de um restart (o servidor sobe dezenas de
 * apps, inclusive de outros times) e de undeploy só entram na sugestão "Ligar a X?".
 */
function pickRepo(deploys, repos) {
  const own = [];
  const any = [];
  for (const d of deploys || []) {
    for (const a of d.artifacts || []) {
      any.push(stripExt(a));
      if (d.kind === 'deploy') own.push(stripExt(a));
    }
  }
  const auto = autoRepo(rankRepos(own, repos));
  if (auto) return { auto, suggestions: [] };
  return { auto: null, suggestions: rankRepos(any, repos).slice(0, 2).map((r) => r.path) };
}

/** Repositório com mais pastas iguais (sem diferenciar maiúsculas) aos artefatos, ou null. */
function suggestRepo(artifacts, repos) {
  const r = rankRepos(artifacts, repos);
  return r.length ? r[0].path : null;
}

/** Deploy/undeploy/restart anterior que compartilha algum artefato com este. */
function previousSameArtifact(sorted, deploy) {
  const arts = new Set(((deploy && deploy.artifacts) || []).map((a) => String(a).toLowerCase()));
  let best = null;
  for (const m of sorted || []) {
    if (m.ts >= deploy.ts || !['deploy', 'undeploy', 'restart'].includes(m.kind)) continue;
    if (!(m.artifacts || []).some((a) => arts.has(String(a).toLowerCase()))) continue;
    if (!best || m.ts >= best.ts) best = m;
  }
  return best;
}

/** Nomes das pastas dos caminhos, em qualquer nível (sem repetir); arquivo na raiz não contribui. */
function foldersOf(paths) {
  const set = new Set();
  for (const p of paths || []) {
    // Todas as pastas do caminho (o nome do arquivo fica de fora): no monorepo do Fluig as widgets ficam em
    // wcm/widget/<nome>/, no 3º nível.
    const parts = String(p).split('/');
    for (let k = 0; k < parts.length - 1; k++) if (parts[k]) set.add(parts[k]);
  }
  return [...set];
}

/* ── Desenho na linha do tempo ─────────────────────────────────────────────── */

const KIND_GROUP = { deploy: 'deploy', undeploy: 'deploy', restart: 'deploy', merge: 'merge', manual: 'manual' };
const KIND_PRIORITY = ['restart', 'deploy', 'undeploy', 'merge', 'manual'];

/** Grupo do marco para cor/ícone/liga-desliga: 'deploy' (deploy/undeploy/restart), 'merge' ou 'manual'. */
function kindGroup(kind) {
  return KIND_GROUP[kind] || 'manual';
}

/**
 * Agrupa os marcos por coluna do histograma (`Math.floor((ts - start) / step)`). Marcos a até `gap` colunas do
 * grupo anterior entram nele (para os ícones não se sobreporem quando as colunas são estreitas). Marcos fora do
 * histograma ficam de fora. → [{ b, b1, bs: [colunas], items, kind }] — `kind` é o grupo do marco mais importante.
 */
function clusterMilestones(list, hist, gap = 0) {
  if (!hist || !(hist.buckets > 0) || !(hist.step > 0)) return [];
  const B = hist.buckets;
  const out = [];
  for (const m of (list || []).slice().sort((a, b) => a.ts - b.ts)) {
    let b = Math.floor((m.ts - hist.start) / hist.step);
    if (b === B && m.ts <= hist.start + B * hist.step) b = B - 1; // o último instante do log fecha a última coluna
    if (!(b >= 0 && b < B)) continue;
    const last = out[out.length - 1];
    if (last && b - last.b1 <= gap) {
      last.items.push(m);
      if (b !== last.b1) { last.bs.push(b); last.b1 = b; }
    } else out.push({ b, b1: b, bs: [b], items: [m] });
  }
  for (const c of out) {
    let best = c.items[0];
    for (const m of c.items) if (KIND_PRIORITY.indexOf(m.kind) < KIND_PRIORITY.indexOf(best.kind)) best = m;
    c.kind = kindGroup(best.kind);
  }
  return out;
}

/** Rótulo curto ao lado do ícone: `restart·38`, `wgPortalRH +2`, `#126`, `a1b2c3d` ou o texto do marco manual. */
function shortLabel(m, max = 18) {
  if (!m) return '';
  let s;
  const arts = m.artifacts || [];
  if (m.kind === 'restart') s = 'restart·' + arts.length;
  else if (m.kind === 'deploy' || m.kind === 'undeploy') s = arts.length ? arts[0] + (arts.length > 1 ? ' +' + (arts.length - 1) : '') : m.kind;
  else if (m.kind === 'merge') s = m.pr ? '#' + m.pr : String(m.hash || m.label || '').slice(0, 7);
  else s = String(m.label || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Quantos marcos de cada grupo há em [from, to]. → { deploy, merge, manual } */
function countMilestones(list, from = -Infinity, to = Infinity) {
  const n = { deploy: 0, merge: 0, manual: 0 };
  for (const m of list || []) if (m.ts >= from && m.ts <= to) n[kindGroup(m.kind)]++;
  return n;
}

/* ── Etiqueta "depois de…" na aba Problemas ───────────────────────────────── */

/** Intervalo curto e redondo para baixo: `menos de 1 min`, `14 min`, `2 h`, `1 dia`, `3 dias`. */
function fmtGap(ms) {
  if (!(ms >= 0)) return '';
  if (ms < 60000) return 'menos de 1 min';
  if (ms < 3600e3) return Math.floor(ms / 60000) + ' min';
  if (ms < DAY) return Math.floor(ms / 3600e3) + ' h';
  const d = Math.floor(ms / DAY);
  return d + (d === 1 ? ' dia' : ' dias');
}

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/** Título do merge (sem o `#126 ` que o rótulo leva na frente). */
function mergeTitle(m) {
  const label = String(m.title || m.label || '');
  return m.pr && !m.title ? label.replace(new RegExp('^#' + m.pr + '\\s*'), '') : label;
}

/** Nome do marco depois de "do": `deploy de wgPortalRH`, `#126 Logs: abrir…`, `restart do servidor`, `marco «…»`. */
function milestoneName(m) {
  const arts = m.artifacts || [];
  if (m.kind === 'restart') return 'restart do servidor';
  if (m.kind === 'deploy' || m.kind === 'undeploy') return arts.length ? m.kind + ' de ' + arts[0] + (arts.length > 1 ? ' +' + (arts.length - 1) : '') : m.kind;
  if (m.kind === 'merge') {
    const ref = m.pr ? '#' + m.pr : String(m.hash || '').slice(0, 7);
    const title = clip(mergeTitle(m).trim(), 40);
    return title ? ref + ' ' + title : ref;
  }
  return 'marco «' + clip(String(m.label || '').trim(), 40) + '»';
}

/** `14 min depois do deploy de wgPortalRH`. Diz só a ordem no tempo, nunca a causa. */
function afterText(m, gapMs) {
  return fmtGap(gapMs) + ' depois do ' + milestoneName(m);
}

/** Dica do suspeito forte: qual arquivo do marco é o do frame do erro. */
function strongHint(m, file) {
  if (m.kind === 'merge') return 'O ' + (m.pr ? '#' + m.pr : 'commit ' + String(m.hash || '').slice(0, 7)) + ' alterou ' + file + ', onde este erro acontece';
  const arts = m.artifacts || [];
  const of = m.kind === 'restart' || !arts.length ? '' : ' de ' + arts[0];
  return 'Um commit na main desde o deploy anterior' + of + ' alterou ' + file + ', onde este erro acontece (estimativa)';
}

/** Junta listas de commits (uma por repositório) numa só, do mais antigo ao mais novo (estável no empate). */
function sortByTs(lists) {
  return [].concat(...(lists || []).map((l) => l || [])).sort((a, b) => a.ts - b.ts);
}

/* ── Dica de arquivo (commits de qualquer repositório cadastrado) ─────────── */

const fileKey = (f) => String(f).split(/[\\/]/).pop().replace(/\.[^.]*$/, '').toLowerCase();

/** Nome do arquivo sem pasta e sem extensão, em minúsculas → commits que mexeram nele, por `ts` (sem repetir). */
function indexCommitsByFile(commits) {
  const idx = new Map();
  for (const c of commits || []) {
    const seen = new Set();
    for (const f of c.files || []) {
      const k = fileKey(f);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(c);
    }
  }
  for (const list of idx.values()) list.sort((a, b) => a.ts - b.ts);
  return idx;
}

/**
 * Commit mais recente com `first - windowMs < ts <= first` que mexeu no arquivo da classe do frame, ou null.
 * `commits` pode ser a lista ou o índice de `indexCommitsByFile` (para muitos grupos, monte o índice uma vez).
 */
function fileCommitBefore(commits, frame, first, windowMs = 7 * DAY) {
  const base = frameBase(frame).toLowerCase();
  const match = frameFileMatcher(frame);
  if (!base || !match || first == null) return null;
  const list = commits instanceof Map ? commits.get(base) || [] : indexCommitsByFile(commits).get(base) || [];
  // O índice junta pelo nome; o caminho (pacote + extensão da JVM) decide, do mais novo para o mais velho.
  let lo = 0;
  let hi = list.length - 1;
  let k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts <= first) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (; k >= 0 && list[k].ts > first - windowMs; k--) if ((list[k].files || []).some(match)) return list[k];
  return null;
}

/** `WorkflowService.java mudou no #2194 (fluig-navship) 2 h antes`. Só a ordem no tempo, nunca a causa. */
function fileHintText(c, file, gapMs) {
  const ref = c.pr ? '#' + c.pr : String(c.hash || '').slice(0, 7);
  return file + ' mudou no ' + ref + (c.repoName ? ' (' + c.repoName + ')' : '') + ' ' + fmtGap(gapMs) + ' antes';
}

/** Ordem "Depois do último marco": grupos com `first >= latestTs` primeiro; dentro de cada parte, por `count`. */
function sortAfterLatest(groups, latestTs) {
  const after = (g) => (latestTs != null && g.first != null && g.first >= latestTs ? 1 : 0);
  return (groups || []).slice().sort((a, b) => after(b) - after(a) || (b.count || 0) - (a.count || 0));
}

module.exports = {
  rankRepos, autoRepo, pickRepo, GENERIC_FOLDERS, frameFileMatcher, sortByTs, indexCommitsByFile, fileCommitBefore, fileHintText,
  touchedFile, fmtGap, milestoneName, afterText, strongHint, sortAfterLatest,
  foldersOf, DEPLOY_RULES, matchDeploy, groupBursts,
  prNumber, isMergeCommit, frameBase, touchesFrame, previousMilestone, commitsInDeploy, attribute, mergeMilestones, suggestRepo, previousSameArtifact,
  kindGroup, clusterMilestones, shortLabel, countMilestones,
};
