'use strict';
/**
 * Monitor de IA — estado de uma sessão a partir dos eventos normalizados (ver util.js). Puro: nada de disco nem relógio
 * além do `now` recebido.
 *
 *   working  turno aberto e sem motivo para achar que parou (inclui ferramenta longa rodando e o modelo pensando)
 *   waiting  turno aberto, ferramenta sem resultado e sem atividade há WAIT_MS — costuma ser aprovação pendente (heurística)
 *   stale    turno aberto mas sem sinal há STALE_MS — a sessão provavelmente foi fechada no meio
 *   idle     turno terminou
 *   error    a sessão parou por um erro da API (login expirado, limite, servidor); some com nova atividade
 * Falha de uma ferramenta não é status: o agente costuma tentar de novo (lastToolFailed vira só um aviso no card).
 */
const WAIT_MS = 15_000;
const STALE_MS = 10 * 60_000;

function createSessionState() {
  return { title: '', cwd: null, branch: null, turnOpen: false, pending: new Map(), lastTs: 0, lastTool: null, lastText: '', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {}, model: null, turns: 0, tools: 0 };
}

/** Aplica um evento. Eventos fora de ordem de tempo não voltam o relógio. */
function apply(s, ev) {
  if (!ev) return s;
  if (ev.ts && ev.ts > s.lastTs) s.lastTs = ev.ts;
  switch (ev.kind) {
    case 'title': s.title = ev.summary || s.title; break;
    case 'prompt': s.turnOpen = true; s.turns++; s.pending.clear(); s.error = null; s.lastToolFailed = false; break;
    case 'turn_start': if (!s.turnOpen) s.turns++; s.turnOpen = true; s.error = null; break;
    case 'turn_end': s.turnOpen = false; s.pending.clear(); break;
    case 'text': s.lastText = ev.summary || s.lastText; s.turnOpen = true; s.error = null; break;
    case 'thinking': s.turnOpen = true; s.error = null; break;
    // Erro grave da sessão (API): o turno acaba e o estado fica em erro até haver nova atividade.
    case 'error': s.error = { ts: ev.ts, code: ev.code || null, message: ev.summary || '' }; s.turnOpen = false; s.pending.clear(); break;
    case 'tool_use': s.turnOpen = true; s.error = null; s.tools++; s.lastTool = { name: ev.tool, summary: ev.summary, ts: ev.ts }; if (ev.ref) { s.pending.set(ev.ref, ev.ts); const names = s.toolByRef || (s.toolByRef = new Map()); if (names.size > 100) names.clear(); names.set(ev.ref, ev.tool); } break;
    case 'tool_result': {
      if (ev.ref) s.pending.delete(ev.ref);
      const name = s.toolByRef && s.toolByRef.get(ev.ref);
      if (s.toolByRef) s.toolByRef.delete(ev.ref);
      // A entrega do relatório do subagente (SubagentHandback) sempre dá "ok": não pode apagar o aviso da falha anterior.
      if (name !== 'SubagentHandback') s.lastToolFailed = !!ev.error;
      break;
    }
    case 'usage': {
      const t = ev.tokens || {};
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) s.tokens[k] += t[k] || 0;
      if (ev.model) {
        s.model = ev.model;
        const m = s.byModel[ev.model] || (s.byModel[ev.model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
        for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) m[k] += t[k] || 0;
      }
      break;
    }
    default: break;
  }
  return s;
}

/**
 * live: estado informado pelo próprio agente ({ status: 'busy' | 'waiting' | 'idle' | 'shell' }), quando existe. Vale mais
 * que a estimativa pelo transcript: o transcript não mostra uma chamada pendente, então só ele sabe que há uma resposta esperada.
 */
function statusOf(s, now, live) {
  if (s.error) return 'error';
  if (live) {
    if (live.status === 'waiting') return 'waiting';
    if (live.status === 'busy') return 'working'; // processo vivo e ocupado: nunca "sem sinal"
    if (live.status === 'idle' || live.status === 'shell') return 'idle';
  }
  if (!s.turnOpen) return 'idle';
  const quiet = now - s.lastTs;
  if (quiet > STALE_MS) return 'stale';
  if (s.pending.size && quiet > WAIT_MS) return 'waiting';
  return 'working';
}

function summary(s, now, live) {
  const known = !!live && ['waiting', 'busy', 'idle', 'shell'].includes(live.status);
  return {
    status: statusOf(s, now, live), statusSource: known ? 'live' : 'transcript', waitingFor: known && live.status === 'waiting' ? live.waitingFor || null : null, title: s.title, cwd: s.cwd, branch: s.branch, lastTs: s.lastTs, lastTool: s.lastTool, lastText: s.lastText,
    tokens: { ...s.tokens }, model: s.model, turns: s.turns, tools: s.tools, pending: s.pending.size,
    error: s.error ? { ...s.error } : null, lastToolFailed: !!s.lastToolFailed,
  };
}

module.exports = { createSessionState, apply, statusOf, summary, WAIT_MS, STALE_MS };
