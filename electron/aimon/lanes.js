'use strict';
/**
 * Monitor de IA — raias: de eventos normalizados (ver util.js) para blocos de tempo por estado. Puro: recebe os eventos
 * e o `now`, sem disco nem relógio. Usa as mesmas regras do status do card (state.js).
 *
 * Só os trechos ativos viram segmento; o ocioso é o vazio entre eles.
 *   working  turno aberto
 *   waiting  turno aberto com ferramenta sem resultado e sem sinal há WAIT_MS (costuma ser aprovação pendente)
 * Turno aberto sem sinal há STALE_MS é dado como encerrado (a sessão foi fechada no meio): não estica até "agora".
 */
const { WAIT_MS, STALE_MS } = require('./state');

/** → [{ from, to, state: 'working'|'waiting', tool? }], em ordem, recortado em [from, now]. */
function segments(events, now, { from = 0 } = {}) {
  const evs = (events || []).filter((e) => e && Number.isFinite(e.ts) && e.ts > 0).sort((a, b) => a.ts - b.ts);
  const raw = [];
  let open = false; let segStart = 0; let lastTs = 0; let lastTool = null;
  const pending = new Set();
  const emit = (a, b, state) => { if (b > a) raw.push({ from: a, to: b, state, tool: lastTool }); };

  // Fecha o que o silêncio entre o último sinal e `t` já decidiu (esperando / sessão encerrada).
  const settle = (t) => {
    const gap = t - lastTs;
    if (gap > STALE_MS) {
      if (pending.size) { emit(segStart, lastTs + WAIT_MS, 'working'); emit(lastTs + WAIT_MS, lastTs + STALE_MS, 'waiting'); } else emit(segStart, lastTs, 'working');
      open = false; pending.clear();
    } else if (pending.size && gap > WAIT_MS) {
      emit(segStart, lastTs + WAIT_MS, 'working'); emit(lastTs + WAIT_MS, t, 'waiting'); segStart = t;
    }
  };

  for (const ev of evs) {
    if (open) settle(ev.ts);
    switch (ev.kind) {
      case 'turn_end':
        if (open) emit(segStart, ev.ts, 'working');
        open = false; pending.clear();
        break;
      case 'prompt': case 'turn_start': case 'text': case 'thinking': case 'tool_use':
        if (!open) { open = true; segStart = ev.ts; pending.clear(); }
        if (ev.kind === 'tool_use') { lastTool = ev.tool || lastTool; if (ev.ref) pending.add(ev.ref); }
        break;
      case 'tool_result': if (ev.ref) pending.delete(ev.ref); break;
      default: break;
    }
    lastTs = ev.ts;
  }
  if (open) { settle(now); if (open) emit(segStart, now, 'working'); }

  const out = [];
  for (const s of raw) {
    const a = Math.max(s.from, from); const b = Math.min(s.to, now);
    if (b <= a) continue;
    const prev = out[out.length - 1];
    if (prev && prev.state === s.state && prev.to === a) { prev.to = b; prev.tool = s.tool || prev.tool; } else out.push({ from: a, to: b, state: s.state, tool: s.tool });
  }
  return out;
}

/** Indicadores de um conjunto de raias [{ segments }]: tempo esperando (somado), pico de sessões ao mesmo tempo e quantas agora. */
function stats(lanes, now) {
  let waitingMs = 0;
  const edges = [];
  let active = 0;
  for (const l of lanes) {
    for (const s of l.segments) {
      if (s.state === 'waiting') waitingMs += s.to - s.from;
      edges.push([s.from, 1], [s.to, -1]);
      if (s.from <= now && s.to >= now) active++;
    }
  }
  // Fim antes do início no mesmo instante: dois blocos que se encostam não contam como paralelos.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0; let peak = 0;
  for (const [, d] of edges) { cur += d; if (cur > peak) peak = cur; }
  return { waitingMs, peak, active };
}

module.exports = { segments, stats };
