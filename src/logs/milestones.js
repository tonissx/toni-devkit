'use strict';
/**
 * Logs — marcos na linha do tempo (deploys do Fluig/WildFly e merges do Git). Puro.
 *
 * Este trecho detecta deploy/undeploy/restart numa linha de log e agrupa rajadas (um restart do servidor
 * redeploya dezenas de .war em poucos segundos) em um único marco.
 */

const DEPLOY_RULES = [
  { re: /WFLYSRV0010: Deployed "([^"]+?)(?:\.(?:war|ear|jar))?"/, kind: 'deploy' },
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
  const label = first.kind + ' ' + names.slice(0, 2).join(', ') + (extra > 0 ? ' +' + extra : '');
  return { id: first.kind + ':' + first.ts, kind: first.kind, ts: first.ts, i: first.i, artifacts: names, label };
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

/** Algum arquivo tem o nome (sem extensão) igual à classe do frame. */
function touchesFrame(files, frame) {
  const base = frameBase(frame).toLowerCase();
  if (!base) return false;
  return (files || []).some((f) => {
    const name = String(f).split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
    return name.toLowerCase() === base;
  });
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

/** Primeiro repositório com pasta igual (sem diferenciar maiúsculas) a algum artefato. */
function suggestRepo(artifacts, repos) {
  const arts = new Set((artifacts || []).map((a) => String(a).toLowerCase()));
  const r = (repos || []).find((x) => (x.folders || []).some((f) => arts.has(String(f).toLowerCase())));
  return r ? r.path : null;
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

module.exports = {
  DEPLOY_RULES, matchDeploy, groupBursts,
  prNumber, frameBase, touchesFrame, previousMilestone, commitsInDeploy, attribute, mergeMilestones, suggestRepo, previousSameArtifact,
};
