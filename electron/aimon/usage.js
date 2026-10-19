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
const pad = (n) => String(n).padStart(2, '0');
/** Dia local (AAAA-MM-DD) de um instante em ms. */
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayStart = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

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

function mergeEntry(prev, next) {
  if (!prev) return { project: next.project || '', agent: !!next.agent, tokens: { ...zero(), ...next.tokens }, byModel: JSON.parse(JSON.stringify(next.byModel || {})), workMs: next.workMs || 0, waitMs: next.waitMs || 0, waitCount: next.waitCount || 0 };
  const byModel = { ...prev.byModel };
  for (const [m, t] of Object.entries(next.byModel || {})) byModel[m] = maxTokens(byModel[m] || {}, t);
  return { project: next.project || prev.project, agent: prev.agent, tokens: maxTokens(prev.tokens, next.tokens || {}), byModel, workMs: Math.max(prev.workMs, next.workMs || 0), waitMs: Math.max(prev.waitMs, next.waitMs || 0), waitCount: Math.max(prev.waitCount, next.waitCount || 0) };
}

function createUsageStore({ file, now = () => Date.now() }) {
  let data = { v: 1, days: {} };
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
        if (raw && raw.v === 1 && raw.days && typeof raw.days === 'object') data = { v: 1, days: raw.days };
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
    async clear() { data = { v: 1, days: {} }; dirty = false; await queue.run('save', () => atomicWrite(file, JSON.stringify(data))); return true; },
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
      const since = dayStart(list[0]);
      const inRange = (plans || []).filter((p) => p && p.ts >= since);
      return {
        days: n,
        series: outDays,
        totals: { ...totals, total: totals.tokens.input + totals.tokens.output + totals.tokens.cacheRead + totals.tokens.cacheWrite, cost: priced.cost, savings: priced.savings, sessions: seen.size, agents: seenAgents.size,
          waitShare: totals.workMs + totals.waitMs > 0 ? totals.waitMs / (totals.workMs + totals.waitMs) : 0 },
        byModel, byProject, unpriced: priced.unpriced,
        plans: { approved: inRange.filter((p) => p.status === 'approved').length, rejected: inRange.filter((p) => p.status === 'rejected').length },
        since,
      };
    },
    _data: () => data,
  };
}

module.exports = { createUsageStore, splitByDay, dayKey, dayStart };
