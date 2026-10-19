'use strict';
/**
 * Monitor de IA — resumo dos subagentes de uma sessão (a linha que fica na sessão principal). Puro: recebe as linhas
 * da lista de sessões (electron/aimon/service.js → list) dos subagentes e devolve os totais.
 */
function summarizeAgents(kids) {
  const sum = { n: 0, working: 0, waiting: 0, idle: 0, tools: 0, tokens: 0, lastTs: 0 };
  for (const k of kids || []) {
    if (!k) continue;
    sum.n++;
    if (k.status === 'working') sum.working++;
    else if (k.status === 'waiting') sum.waiting++;
    else sum.idle++; // ocioso e "sem sinal": não estão fazendo nada
    sum.tools += k.tools || 0;
    const t = k.tokens || {};
    sum.tokens += (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
    sum.lastTs = Math.max(sum.lastTs, k.lastTs || 0);
  }
  return sum;
}

/** Partes do texto, em ordem: "3 agentes", "1 trabalhando", "1 esperando" ou "todos concluídos". */
function agentParts(sum) {
  if (!sum.n) return [];
  const parts = [`${sum.n} ${sum.n === 1 ? 'agente' : 'agentes'}`];
  if (sum.working) parts.push(`${sum.working} trabalhando`);
  if (sum.waiting) parts.push(`${sum.waiting} esperando`);
  if (!sum.working && !sum.waiting) parts.push(sum.n === 1 ? 'concluído' : 'todos concluídos');
  return parts;
}

/**
 * O grupo (sessão + subagentes) está recolhido? A escolha explícita da pessoa (true/false) sempre vale; sem escolha, recolhe
 * quando há subagentes e nenhum está trabalhando nem esperando (o que importa está aberto, o que acabou fica resumido).
 */
function isCollapsed(sum, map, key) {
  if (!sum || !sum.n) return false;
  const v = map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  if (typeof v === 'boolean') return v;
  return !sum.working && !sum.waiting;
}

module.exports = { summarizeAgents, agentParts, isCollapsed };
