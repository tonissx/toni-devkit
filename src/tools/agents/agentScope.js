'use strict';
// Escopos dos agentes (sem React): usuário (~/.claude/agents) e projeto (<projeto>/.claude/agents). Prioridade do Claude Code:
// quando o mesmo nome existe nos dois, o do projeto vence.

const SCOPES = ['project', 'user'];
const scopeLabel = (scope) => (scope === 'project' ? 'Projeto' : 'Usuário');
const agentKey = (a) => `${a.scope}:${a.name}`;

/** Resposta de agents:list ({ user: { rows }, project: { rows } | null }) → uma lista só, cada linha com `scope`; nome, depois projeto antes do usuário. */
function mergeRows(res) {
  const tag = (scope, part) => ((part && part.rows) || []).map((r) => ({ ...r, scope }));
  return [...tag('project', res && res.project), ...tag('user', res && res.user)]
    .sort((a, b) => a.name.localeCompare(b.name) || SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope));
}

/** Para cada nome presente nos dois escopos: { name, winner: 'project', shadowed: 'user' } (só entre agentes válidos). */
function overlaps(rows) {
  const by = new Map();
  for (const r of rows) if (!r.invalid) (by.get(r.name) || by.set(r.name, new Set()).get(r.name)).add(r.scope);
  return [...by].filter(([, s]) => s.size > 1).map(([name]) => ({ name, winner: 'project', shadowed: 'user' }));
}

module.exports = { SCOPES, scopeLabel, agentKey, mergeRows, overlaps };
