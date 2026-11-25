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

module.exports = { DEPLOY_RULES, matchDeploy, groupBursts };
