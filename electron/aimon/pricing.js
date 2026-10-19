'use strict';
/**
 * Monitor de IA — custo estimado a partir dos tokens. Puro.
 *
 * Os preços são uma ESTIMATIVA (US$ por 1 milhão de tokens de entrada/saída, por família de modelo) e a pessoa pode
 * trocá-los por modelo (prefs.prices). O cache segue a regra pública da Anthropic: leitura custa 10% da entrada e
 * gravação 125% (cache de 5 min). Modelo sem preço conhecido (ex.: modelos do Codex) fica de fora da soma e é listado.
 */
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

// Ordem importa: a primeira regra que casa vale.
const DEFAULT_RULES = [
  { match: /opus-4-[5-9]|opus-[5-9]/i, input: 5, output: 25 },
  { match: /opus/i, input: 15, output: 75 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku-4|haiku-[5-9]/i, input: 1, output: 5 },
  { match: /haiku/i, input: 0.8, output: 4 },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Preço do modelo → { input, output, custom } ou null se não se conhece. `overrides`: { [modelo]: { input, output } }. */
function priceFor(model, overrides) {
  if (!model) return null;
  const o = overrides && overrides[model];
  if (o && num(o.input) != null && num(o.output) != null) return { input: o.input, output: o.output, custom: true };
  const r = DEFAULT_RULES.find((x) => x.match.test(model));
  return r ? { input: r.input, output: r.output, custom: false } : null;
}

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** US$ de um conjunto de tokens com um preço. */
function costOf(tokens, price) {
  if (!price) return null;
  const t = tokens || {};
  return ((t.input || 0) * price.input + (t.output || 0) * price.output
    + (t.cacheRead || 0) * price.input * CACHE_READ + (t.cacheWrite || 0) * price.input * CACHE_WRITE) / 1e6;
}

/** US$ que o cache poupou: o que a leitura custaria como entrada normal menos o que custou. */
function cacheSavings(tokens, price) {
  if (!price) return 0;
  return ((tokens && tokens.cacheRead) || 0) * price.input * (1 - CACHE_READ) / 1e6;
}

/**
 * Custo de um { modelo: tokens }. → { cost, savings, byModel: { [modelo]: { cost|null, price|null } }, unpriced: [modelo] }
 * `cost` soma só os modelos com preço.
 */
function costByModel(byModel, overrides) {
  let cost = 0; let savings = 0;
  const out = {}; const unpriced = [];
  for (const [m, t] of Object.entries(byModel || {})) {
    const price = priceFor(m, overrides);
    const c = costOf(t, price);
    out[m] = { cost: c, price };
    if (c == null) unpriced.push(m); else { cost += c; savings += cacheSavings(t, price); }
  }
  return { cost, savings, byModel: out, unpriced };
}

/** Preços aceitos nas preferências: só { input, output } numéricos e não negativos, até 60 modelos. */
function cleanPrices(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [m, v] of Object.entries(raw).slice(0, 60)) {
    if (typeof m !== 'string' || !m || m.length > 100 || !v || typeof v !== 'object') continue;
    const i = num(Number(v.input)); const o = num(Number(v.output));
    if (i != null && o != null) out[m] = { input: i, output: o };
  }
  return out;
}

const sumTokens = (a, b) => ({ input: a.input + (b.input || 0), output: a.output + (b.output || 0), cacheRead: a.cacheRead + (b.cacheRead || 0), cacheWrite: a.cacheWrite + (b.cacheWrite || 0) });

module.exports = { priceFor, costOf, cacheSavings, costByModel, cleanPrices, sumTokens, zero, DEFAULT_RULES, CACHE_READ, CACHE_WRITE };
