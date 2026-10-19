'use strict';
/**
 * Monitor de IA — estado de uma sessão a partir dos eventos normalizados (ver util.js). Puro: nada de disco nem relógio
 * além do `now` recebido.
 *
 *   working  turno aberto e sem motivo para achar que parou (inclui ferramenta longa rodando e o modelo pensando)
 *   waiting  turno aberto, ferramenta sem resultado e sem atividade há WAIT_MS — costuma ser aprovação pendente (heurística)
 *   stale    turno aberto mas sem sinal há STALE_MS — a sessão provavelmente foi fechada no meio
 *   idle     turno terminou
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
    case 'prompt': s.turnOpen = true; s.turns++; s.pending.clear(); break;
    case 'turn_start': if (!s.turnOpen) s.turns++; s.turnOpen = true; break;
    case 'turn_end': s.turnOpen = false; s.pending.clear(); break;
    case 'text': s.lastText = ev.summary || s.lastText; s.turnOpen = true; break;
    case 'thinking': s.turnOpen = true; break;
    case 'tool_use': s.turnOpen = true; s.tools++; s.lastTool = { name: ev.tool, summary: ev.summary, ts: ev.ts }; if (ev.ref) s.pending.set(ev.ref, ev.ts); break;
    case 'tool_result': if (ev.ref) s.pending.delete(ev.ref); break;
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

function statusOf(s, now) {
  if (!s.turnOpen) return 'idle';
  const quiet = now - s.lastTs;
  if (quiet > STALE_MS) return 'stale';
  if (s.pending.size && quiet > WAIT_MS) return 'waiting';
  return 'working';
}

function summary(s, now) {
  return {
    status: statusOf(s, now), title: s.title, cwd: s.cwd, branch: s.branch, lastTs: s.lastTs, lastTool: s.lastTool, lastText: s.lastText,
    tokens: { ...s.tokens }, model: s.model, turns: s.turns, tools: s.tools, pending: s.pending.size,
  };
}

module.exports = { createSessionState, apply, statusOf, summary, WAIT_MS, STALE_MS };
