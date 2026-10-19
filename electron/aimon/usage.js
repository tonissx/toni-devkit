'use strict';
/**
 * Monitor de IA — métricas diárias de uso, em %APPDATA%\Toni Devkit\aimon-usage.json. Só números (tokens por modelo, tempo
 * trabalhando/esperando, projeto): nenhum texto de prompt ou resposta é guardado. "Esquecer tudo" apaga o arquivo.
 *
 * Por dia, por sessão: { project, agent, tokens, byModel, workMs, waitMs, waitCount }. O acompanhamento relê as sessões
 * das últimas 24 h a cada abertura, então a gravação é por MÁXIMO (nunca soma): reler a mesma sessão não conta em dobro e
 * uma leitura parcial (arquivo grande, eventos antigos descartados) não diminui o que já foi guardado.
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { costByModel, sumTokens, zero } = require('./pricing');

const KEEP_DAYS = 400;
const { dayKey, dayStart } = require('./time');

/** Blocos [{ from, to, state }] → { [dia]: { workMs, waitMs, waitCount } }, cortando o que atravessa a meia-noite. */
function splitByDay(segs) {
  const out = {};
  for (const s of segs || []) {
    if (!(s.to > s.from)) continue;
    let a = s.from;
    let first = true;
    while (a < s.to) {
      const k = dayKey(a);
      const nextMid = new Date(new Date(a).getFullYear(), new Date(a).getMonth(), new Date(a).getDate() + 1).getTime();
      const b = Math.min(s.to, nextMid);
      const e = out[k] || (out[k] = { workMs: 0, waitMs: 0, waitCount: 0 });
      if (s.state === 'waiting') { e.waitMs += b - a; if (first) e.waitCount++; } else e.workMs += b - a;
      first = false;
      a = b;
    }
  }
  return out;
}

const maxTokens = (a, b) => ({ input: Math.max(a.input || 0, b.input || 0), output: Math.max(a.output || 0, b.output || 0), cacheRead: Math.max(a.cacheRead || 0, b.cacheRead || 0), cacheWrite: Math.max(a.cacheWrite || 0, b.cacheWrite || 0) });

/** Estatística de uma ferramenta/turno: { n, errors, ms, timed, max }. Mesma regra do resto: máximo campo a campo. */
const maxStat = (a, b) => ({ n: Math.max(a.n || 0, b.n || 0), errors: Math.max(a.errors || 0, b.errors || 0), ms: Math.max(a.ms || 0, b.ms || 0), timed: Math.max(a.timed || 0, b.timed || 0), max: Math.max(a.max || 0, b.max || 0) });
const maxStats = (a, b) => { const out = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) out[k] = maxStat(out[k] || {}, v); return out; };
const addStat = (a, b) => (b ? { n: (a.n || 0) + (b.n || 0), errors: (a.errors || 0) + (b.errors || 0), ms: (a.ms || 0) + (b.ms || 0), timed: (a.timed || 0) + (b.timed || 0), max: Math.max(a.max || 0, b.max || 0) } : a);
const addStats = (into, tools) => { for (const [k, v] of Object.entries(tools || {})) into[k] = addStat(into[k] || {}, v); };

function mergeEntry(prev, next) {
  if (!prev) return { project: next.project || '', agent: !!next.agent, tokens: { ...zero(), ...next.tokens }, byModel: JSON.parse(JSON.stringify(next.byModel || {})), workMs: next.workMs || 0, waitMs: next.waitMs || 0, waitCount: next.waitCount || 0, tools: maxStats({}, next.tools), turn: maxStat({}, next.turn || {}) };
  const byModel = { ...prev.byModel };
  for (const [m, t] of Object.entries(next.byModel || {})) byModel[m] = maxTokens(byModel[m] || {}, t);
  return { project: next.project || prev.project, agent: prev.agent, tokens: maxTokens(prev.tokens, next.tokens || {}), byModel, workMs: Math.max(prev.workMs, next.workMs || 0), waitMs: Math.max(prev.waitMs, next.waitMs || 0), waitCount: Math.max(prev.waitCount, next.waitCount || 0),
    tools: maxStats(prev.tools, next.tools), turn: maxStat(prev.turn || {}, next.turn || {}) };
}

const MAX_HITS = 20;
const HIT_GAP = 30 * 60_000; // dois avisos de limite com menos que isso entre si são o mesmo limite

function createUsageStore({ file, now = () => Date.now() }) {
  let data = { v: 1, days: {}, hits: [] };
  let dirty = false;
  const queue = createQueue();

  const prune = () => {
    const keys = Object.keys(data.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data.days[k];
  };

  return {
    async init() {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        if (raw && raw.v === 1 && raw.days && typeof raw.days === 'object') data = { v: 1, days: raw.days, hits: Array.isArray(raw.hits) ? raw.hits.filter((h) => h && Number.isFinite(h.ts) && Number.isFinite(h.used)).slice(-MAX_HITS) : [] };
      } catch { /* primeira vez ou arquivo ilegível: começa vazio */ }
      return this;
    },
    /** contrib: { [dia]: { [chaveDaSessão]: entrada } } */
    merge(contrib) {
      for (const [day, sessions] of Object.entries(contrib || {})) {
        const d = data.days[day] || (data.days[day] = { sessions: {} });
        for (const [key, e] of Object.entries(sessions)) {
          const next = mergeEntry(d.sessions[key], e);
          if (JSON.stringify(next) !== JSON.stringify(d.sessions[key])) { d.sessions[key] = next; dirty = true; }
        }
      }
    },
    /** Grava se mudou algo desde a última vez. */
    async persist() {
      if (!dirty) return false;
      dirty = false;
      prune();
      await queue.run('save', () => atomicWrite(file, JSON.stringify(data)));
      return true;
    },
    /** Vezes em que o limite de uso foi atingido: [{ ts, used }] (used = tokens contáveis nas 5 h anteriores). */
    recordHits(list) {
      for (const h of list || []) {
        if (!h || !Number.isFinite(h.ts) || !Number.isFinite(h.used) || h.used <= 0) continue;
        const near = data.hits.find((x) => Math.abs(x.ts - h.ts) < HIT_GAP);
        if (near) { if (h.used > near.used) { near.used = h.used; dirty = true; } continue; }
        data.hits.push({ ts: h.ts, used: h.used }); dirty = true;
      }
      data.hits.sort((a, b) => a.ts - b.ts);
      if (data.hits.length > MAX_HITS) data.hits.splice(0, data.hits.length - MAX_HITS);
    },
    hits: () => data.hits.map((h) => ({ ...h })),
    async clear() { data = { v: 1, days: {}, hits: [] }; dirty = false; await queue.run('save', () => atomicWrite(file, JSON.stringify(data))); return true; },
    flush: () => queue.flush(),
    /**
     * Totais dos últimos `days` dias (hoje incluído). `prices`: preços personalizados por modelo. `plans`: [{ ts, status }]
     * para a taxa de aprovação dos planos no mesmo período.
     */
    range(days, { prices = {}, plans = [] } = {}) {
      const n = Math.max(1, Math.min(KEEP_DAYS, Math.floor(days) || 7));
      const today = new Date(now());
      const list = [];
      for (let i = n - 1; i >= 0; i--) list.push(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime()));
      const totals = { tokens: zero(), workMs: 0, waitMs: 0, waitCount: 0 };
      const toolStats = {}; let turnStat = {};
      const modelTokens = {}; const projects = {}; const seen = new Set(); const seenAgents = new Set();
      const outDays = list.map((day) => {
        const d = data.days[day];
        const row = { day, tokens: 0, cost: 0, workMs: 0, waitMs: 0, sessions: 0 };
        if (!d) return row;
        const byModelDay = {};
        for (const [key, e] of Object.entries(d.sessions)) {
          const tot = sumTokens(zero(), e.tokens);
          row.tokens += tot.input + tot.output + tot.cacheRead + tot.cacheWrite;
          totals.tokens = sumTokens(totals.tokens, e.tokens);
          for (const [m, t] of Object.entries(e.byModel || {})) {
            byModelDay[m] = sumTokens(byModelDay[m] || zero(), t);
            modelTokens[m] = sumTokens(modelTokens[m] || zero(), t);
          }
          addStats(toolStats, e.tools); turnStat = addStat(turnStat, e.turn);
          if (e.agent) { seenAgents.add(key); continue; } // subagente: só tokens (o tempo é o da sessão que o criou)
          row.workMs += e.workMs; row.waitMs += e.waitMs;
          totals.workMs += e.workMs; totals.waitMs += e.waitMs; totals.waitCount += e.waitCount;
          if (e.workMs || e.waitMs || tot.output) { row.sessions++; seen.add(key); }
          const p = projects[e.project || 'Sem projeto'] || (projects[e.project || 'Sem projeto'] = { project: e.project || 'Sem projeto', tokens: zero(), byModel: {}, workMs: 0, waitMs: 0, keys: new Set() });
          p.workMs += e.workMs; p.waitMs += e.waitMs; p.keys.add(key);
        }
        // Tokens dos subagentes também contam no projeto da sessão e no custo do dia.
        for (const e of Object.values(d.sessions)) {
          const p = projects[e.project || 'Sem projeto'] || (projects[e.project || 'Sem projeto'] = { project: e.project || 'Sem projeto', tokens: zero(), byModel: {}, workMs: 0, waitMs: 0, keys: new Set() });
          p.tokens = sumTokens(p.tokens, e.tokens);
          for (const [m, t] of Object.entries(e.byModel || {})) p.byModel[m] = sumTokens(p.byModel[m] || zero(), t);
        }
        row.cost = costByModel(byModelDay, prices).cost;
        return row;
      });
      const priced = costByModel(modelTokens, prices);
      const byModel = Object.entries(modelTokens).map(([model, tokens]) => ({ model, tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite, cost: priced.byModel[model].cost, price: priced.byModel[model].price }))
        .sort((a, b) => (b.cost || 0) - (a.cost || 0) || b.total - a.total);
      const byProject = Object.values(projects).map((p) => ({ project: p.project, total: p.tokens.input + p.tokens.output + p.tokens.cacheRead + p.tokens.cacheWrite, cost: costByModel(p.byModel, prices).cost, workMs: p.workMs, waitMs: p.waitMs, sessions: p.keys.size }))
        .filter((p) => p.total || p.workMs || p.waitMs).sort((a, b) => b.cost - a.cost || b.total - a.total);
      const byTool = Object.entries(toolStats).map(([tool, t]) => ({ tool, n: t.n, errors: t.errors, errorRate: t.n ? t.errors / t.n : 0, avgMs: t.timed ? t.ms / t.timed : null, maxMs: t.max, totalMs: t.ms }))
        .sort((a, b) => b.totalMs - a.totalMs || b.n - a.n);
      const turns = { n: turnStat.n || 0, avgMs: turnStat.timed ? turnStat.ms / turnStat.timed : null, maxMs: turnStat.max || 0 };
      const since = dayStart(list[0]);
      const inRange = (plans || []).filter((p) => p && p.ts >= since);
      return {
        days: n,
        series: outDays,
        totals: { ...totals, total: totals.tokens.input + totals.tokens.output + totals.tokens.cacheRead + totals.tokens.cacheWrite, cost: priced.cost, savings: priced.savings, sessions: seen.size, agents: seenAgents.size,
          waitShare: totals.workMs + totals.waitMs > 0 ? totals.waitMs / (totals.workMs + totals.waitMs) : 0 },
        byModel, byProject, byTool, turns, unpriced: priced.unpriced,
        plans: { approved: inRange.filter((p) => p.status === 'approved').length, rejected: inRange.filter((p) => p.status === 'rejected').length },
        since,
      };
    },
    _data: () => data,
  };
}

module.exports = { createUsageStore, splitByDay, dayKey, dayStart };
