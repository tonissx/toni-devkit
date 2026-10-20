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
const { dayKey } = require('./time');
const { newCtx, applyCtx } = require('./context');

const WAIT_MS = 15_000;
const STALE_MS = 10 * 60_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const MAX_EDITS = 200;
const CTX_WINDOW = 200_000;   // janela padrão; passou disso, a sessão é de contexto estendido (1 M)
const CTX_WINDOW_XL = 1_000_000;
const MAX_TOOL_MS = 30 * 60_000;  // ferramenta "demorou" mais que isso quase sempre esperou uma permissão: não entra na média
const MAX_TURN_MS = 6 * 3600e3;
// Pedido que corrige o agente (retrabalho). Heurística em português e inglês.
const CORRECTION = /\b(n[ãa]o\s+(era|é|foi|fez|funcion|quer|assim)|errado|errou|de novo|novamente|refaz|refa[çc]a|desfaz|desfa[çc]a|reverte|volta\s+(atr[áa]s|como)|isso\s+n[ãa]o|wrong|redo|undo|revert|not what|try again|that'?s not)\b/i;
const HARNESS = /^\s*<(task-notification|system-reminder|command-name|command-message|command-args|local-command|user-prompt-submit-hook)\b/i;

function createSessionState() {
  return { title: '', cwd: null, branch: null, turnOpen: false, pending: new Map(), lastTs: 0, lastTool: null, lastText: '', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {}, model: null, turns: 0, tools: 0, failStreak: null, ctxTokens: 0, cx: newCtx(), edits: new Map(),
    firstTs: 0, firstPrompt: '', corrections: 0, toolErrors: 0, toolDaily: {}, turnDaily: {}, turnStartTs: 0 };
}

/** Soma uma ocorrência (com duração, se houver) em { [dia]: { [nome]: { n, errors, ms, timed, max } } }. */
function bump(map, ts, name, { ms = null, error = false } = {}) {
  if (!ts) return;
  const day = dayKey(ts);
  const d = map[day] || (map[day] = {});
  const e = d[name] || (d[name] = { n: 0, errors: 0, ms: 0, timed: 0, max: 0 });
  e.n++;
  if (error) e.errors++;
  if (ms != null && ms >= 0) { e.ms += ms; e.timed++; if (ms > e.max) e.max = ms; }
}

/** Abre a contagem de duração do turno na primeira atividade depois de um turno fechado. */
function openTurn(s, ev) { if (!s.turnOpen && !s.turnStartTs) s.turnStartTs = ev.ts || 0; }
/** Fecha o turno: guarda a duração no dia em que terminou. */
function closeTurn(s, ev) {
  if (s.turnStartTs && ev.ts && ev.ts >= s.turnStartTs && ev.ts - s.turnStartTs <= MAX_TURN_MS) bump(s.turnDaily, ev.ts, 'turn', { ms: ev.ts - s.turnStartTs });
  s.turnStartTs = 0;
}

/** Aplica um evento. Eventos fora de ordem de tempo não voltam o relógio. */
function apply(s, ev) {
  if (!ev) return s;
  applyCtx(s.cx, ev); // do que é feito o contexto (context.js)
  if (ev.ts && ev.ts > s.lastTs) s.lastTs = ev.ts;
  if (ev.ts && (!s.firstTs || ev.ts < s.firstTs) && ev.kind !== 'title') s.firstTs = ev.ts;
  switch (ev.kind) {
    case 'title': s.title = ev.summary || s.title; break;
    case 'prompt':
      openTurn(s, ev);
      s.turnOpen = true; s.turns++; s.pending.clear(); s.error = null; s.lastToolFailed = false; s.failStreak = null;
      if (ev.summary && !HARNESS.test(ev.summary)) {
        if (!s.firstPrompt) s.firstPrompt = ev.summary.slice(0, 300);
        else if (CORRECTION.test(ev.summary)) s.corrections++;
      }
      break;
    case 'turn_start': openTurn(s, ev); if (!s.turnOpen) s.turns++; s.turnOpen = true; s.error = null; break;
    case 'turn_end': closeTurn(s, ev); s.turnOpen = false; s.pending.clear(); break;
    case 'text': openTurn(s, ev); s.lastText = ev.summary || s.lastText; s.turnOpen = true; s.error = null; break;
    case 'thinking': openTurn(s, ev); s.turnOpen = true; s.error = null; break;
    // Erro grave da sessão (API): o turno acaba e o estado fica em erro até haver nova atividade.
    case 'error': s.turnStartTs = 0; s.error = { ts: ev.ts, code: ev.code || null, message: ev.summary || '' }; s.turnOpen = false; s.pending.clear(); break;
    case 'tool_use': openTurn(s, ev); s.turnOpen = true; s.error = null; s.tools++; noteEdit(s, ev); s.lastTool = { name: ev.tool, summary: ev.summary, ts: ev.ts }; if (ev.ref) { s.pending.set(ev.ref, ev.ts); const names = s.toolByRef || (s.toolByRef = new Map()); if (names.size > 100) names.clear(); names.set(ev.ref, ev.tool); } break;
    case 'tool_result': {
      const startedAt = ev.ref ? s.pending.get(ev.ref) : undefined;
      if (ev.ref) s.pending.delete(ev.ref);
      const name = s.toolByRef && s.toolByRef.get(ev.ref);
      if (s.toolByRef) s.toolByRef.delete(ev.ref);
      // A entrega do relatório do subagente (SubagentHandback) sempre dá "ok": não pode apagar o aviso da falha anterior.
      if (name !== 'SubagentHandback') {
        s.lastToolFailed = !!ev.error;
        if (ev.error) s.toolErrors++;
        // Duração por ferramenta. Recusa da pessoa não é execução; muito longa quase sempre foi espera por permissão.
        if (name && !ev.rejected) {
          const ms = startedAt && ev.ts >= startedAt && ev.ts - startedAt <= MAX_TOOL_MS ? ev.ts - startedAt : null;
          bump(s.toolDaily, ev.ts, name, { ms, error: !!ev.error });
        }
        // Mesma ferramenta falhando em sequência = o agente provavelmente está em loop. Recusa da pessoa não conta nem zera.
        if (ev.error) s.failStreak = s.failStreak && s.failStreak.tool === name ? { tool: name, count: s.failStreak.count + 1 } : { tool: name, count: 1 };
        else if (!ev.rejected) s.failStreak = null;
      }
      break;
    }
    case 'usage': {
      const t = ev.tokens || {};
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) s.tokens[k] += t[k] || 0;
      // O que a última chamada leu de contexto (entrada + cache) diz o quanto a conversa já ocupa.
      const ctx = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
      if (ctx > 0) s.ctxTokens = ctx;
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

/** Arquivo que uma ferramenta de edição tocou (normalizado), com o instante — base do aviso de dois agentes no mesmo arquivo. */
function noteEdit(s, ev) {
  if (!EDIT_TOOLS.has(ev.tool) || !ev.summary) return;
  const key = String(ev.summary).split('\\').join('/').toLowerCase();
  s.edits.delete(key);
  s.edits.set(key, { path: ev.summary, ts: ev.ts || 0 });
  if (s.edits.size > MAX_EDITS) s.edits.delete(s.edits.keys().next().value);
}

/** Quanto do contexto parece ocupado: { tokens, limit, pct } ou null. A janela é estimada (200 mil; acima disso, 1 milhão). */
function contextOf(s) {
  if (!s.ctxTokens) return null;
  // Janela informada pelo provedor (Codex) ou, sem ela, estimada pelo maior contexto já visto: depois de uma compactação o
  // valor atual cai, mas a janela continua a mesma.
  const seen = Math.max(s.cx.maxCtx, s.ctxTokens);
  const limit = s.cx.window > 0 ? s.cx.window : seen > CTX_WINDOW ? CTX_WINDOW_XL : CTX_WINDOW;
  return { tokens: s.ctxTokens, limit, pct: Math.round((s.ctxTokens / limit) * 100) };
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
    failStreak: s.failStreak ? { ...s.failStreak } : null, context: contextOf(s),
    firstTs: s.firstTs, firstPrompt: s.firstPrompt, corrections: s.corrections, toolErrors: s.toolErrors,
  };
}

module.exports = { createSessionState, apply, statusOf, summary, contextOf, WAIT_MS, STALE_MS };
