'use strict';
/**
 * Logs — números para a aba Gráficos: os mais frequentes (loggers, endpoints), status e latência dos logs de acesso.
 * Puro: recebe o índice (index.js) e a lista de entradas do filtro atual.
 *
 * O que precisa ler a entrada (logger, caminho) usa no máximo `sample` entradas — as mais recentes — e avisa
 * quando cortou (sampled: true). Nível, tempo, status e duração vêm dos arrays e contam tudo.
 */

const SAMPLE = 300000;

/** Percentil de um array já ordenado (p de 0 a 1). */
function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[k];
}

const ID_SEG = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i;
/** /api/users/123/orders/9f2c… → /api/users/:id/orders/:id (para agrupar endpoints). */
function normPath(p) {
  return String(p || '').split('/').map((s) => (s && ID_SEG.test(s) ? ':id' : s)).join('/') || '/';
}

/** Mais frequentes por uma chave lida da entrada. key(p) → string | null. → { items: [{ key, count, errors }], sampled } */
function topBy(index, result, key, { limit = 12, sample = SAMPLE } = {}) {
  const map = new Map();
  const from = Math.max(0, result.length - sample);
  for (let k = from; k < result.length; k++) {
    const i = result[k];
    const v = key(index.parse(i, 2), i);
    if (v == null || v === '') continue;
    let e = map.get(v);
    if (!e) { e = { key: v, count: 0, errors: 0 }; map.set(v, e); }
    e.count++;
    if (index.level[i] >= 5) e.errors++;
  }
  const items = [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  return { items, sampled: from > 0, distinct: map.size };
}

/** Loggers/categorias mais frequentes (logs de aplicação). */
function topLoggers(index, result, opts) {
  return topBy(index, result, (p) => (p.logger ? shortLogger(p.logger) : null), opts);
}
const shortLogger = (l) => {
  const parts = String(l).split('.');
  return parts.length > 3 ? parts.slice(0, -2).map((s) => s[0]).join('.') + '.' + parts.slice(-2).join('.') : String(l);
};

/**
 * Logs de acesso: status por classe em cada barra do histograma, latência p50/p95 por barra, no geral e por endpoint.
 * hist: { start, step, buckets } (index.summarize). → {
 *   classes: [[2xx,3xx,4xx,5xx] por barra], p50: [], p95: [], overall: { p50, p95, p99, count, withMs },
 *   endpoints: [{ key, count, errors, p95 }], slowest: [...], sampled
 * }
 */
function httpStats(index, result, hist, { sample = SAMPLE, limit = 12 } = {}) {
  const B = hist ? hist.buckets : 0;
  const classes = Array.from({ length: B }, () => [0, 0, 0, 0]);
  const durs = Array.from({ length: B }, () => []);
  const all = [];
  for (let k = 0; k < result.length; k++) {
    const i = result[k];
    const st = index.status[i];
    const ms = index.ms[i];
    const t = index.ts[i];
    let b = -1;
    if (hist && Number.isFinite(t)) { b = Math.floor((t - hist.start) / hist.step); if (b >= B) b = B - 1; else if (b < 0) b = 0; }
    if (b >= 0 && st >= 200) { const c = Math.min(3, Math.floor(st / 100) - 2); if (c >= 0) classes[b][c]++; }
    if (Number.isFinite(ms)) {
      all.push(ms);
      // Amostra por barra (até 2000) para o percentil não custar memória demais.
      if (b >= 0) { const d = durs[b]; if (d.length < 2000) d.push(ms); else if (Math.random() < 2000 / (d.length + 1)) d[Math.floor(Math.random() * 2000)] = ms; }
    }
  }
  const p50 = []; const p95 = [];
  for (const d of durs) { d.sort((a, b) => a - b); p50.push(percentile(d, 0.5)); p95.push(percentile(d, 0.95)); }
  const sorted = Float64Array.from(all).sort();
  const overall = { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), count: result.length, withMs: sorted.length };

  // Endpoints: lê a entrada (amostra das mais recentes).
  const map = new Map();
  const from = Math.max(0, result.length - sample);
  for (let k = from; k < result.length; k++) {
    const i = result[k];
    const p = index.parse(i, 1);
    if (!p.http) continue;
    const key = (p.http.method ? p.http.method + ' ' : '') + normPath(p.http.path);
    let e = map.get(key);
    if (!e) { e = { key, count: 0, errors: 0, ms: [] }; map.set(key, e); }
    e.count++;
    if (index.status[i] >= 500) e.errors++;
    const ms = index.ms[i];
    if (Number.isFinite(ms) && e.ms.length < 5000) e.ms.push(ms);
  }
  const eps = [...map.values()].map((e) => { e.ms.sort((a, b) => a - b); return { key: e.key, count: e.count, errors: e.errors, p95: percentile(e.ms, 0.95) }; });
  const endpoints = eps.slice().sort((a, b) => b.count - a.count).slice(0, limit);
  const failing = eps.filter((e) => e.errors).sort((a, b) => b.errors - a.errors).slice(0, limit);
  const slowest = eps.filter((e) => Number.isFinite(e.p95) && e.count >= 3).sort((a, b) => b.p95 - a.p95).slice(0, limit);
  return { classes, p50, p95, overall, endpoints, failing, slowest, sampled: from > 0 };
}

/** Erros (ERROR+FATAL) por minuto em cada barra do histograma (data: Uint32Array barras × 7 níveis). */
function errorRate(hist) {
  if (!hist) return [];
  const per = hist.step / 60000;
  const out = [];
  for (let b = 0; b < hist.buckets; b++) out.push((hist.data[b * 7 + 5] + hist.data[b * 7 + 6]) / per);
  return out;
}

/** Picos: barras com erros bem acima da mediana (≥ 3× e ≥ 5 erros). → índices das barras. */
function spikes(hist) {
  if (!hist) return [];
  const e = [];
  for (let b = 0; b < hist.buckets; b++) e.push(hist.data[b * 7 + 5] + hist.data[b * 7 + 6]);
  const sorted = e.filter((x) => x > 0).sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const out = [];
  for (let b = 0; b < e.length; b++) if (e[b] >= 5 && e[b] >= Math.max(3 * med, med + 5)) out.push(b);
  return out;
}

module.exports = { percentile, normPath, topBy, topLoggers, shortLogger, httpStats, errorRate, spikes, SAMPLE };
