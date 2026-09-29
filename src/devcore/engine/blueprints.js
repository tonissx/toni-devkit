'use strict';
/**
 * Marcos por quantidade e Blueprints (peças → Mk II/III) — regras puras.
 * Peça: id "<gen>:mk<N>:<i>" (i = 0..3). Só existem peças do PRÓXIMO nível de cada gerador;
 * o Refactor consome o conjunto e sobe o Mk.
 */
const { CONTENT } = require('../content/index.js');

const bpOf = (s, gen) => s.run.blueprints[gen] || { mk: 1, parts: {} };
const partId = (gen, mk, i) => `${gen}:mk${mk}:${i}`;
const levelOf = (gen, mk, c = CONTENT) => (c.blueprint[gen] || { levels: [] }).levels.find((l) => l.mk === mk) || null;

/** Decodifica um id de peça → { gen, mk, index, name } (null se inválido). */
function parsePart(id, c = CONTENT) {
  const m = /^([\w-]+):mk(\d):([0-3])$/.exec(String(id || ''));
  if (!m) return null;
  const level = levelOf(m[1], Number(m[2]), c);
  return level ? { gen: m[1], mk: level.mk, index: Number(m[3]), name: level.parts[Number(m[3])] } : null;
}

/** Quantos marcos (25/50/100…) um gerador já atingiu. */
const milestonesReached = (owned, c = CONTENT) => c.BALANCE.milestones.at.filter((a) => owned >= a).length;

/** Multiplicador do i-ésimo marco (mult pode ser número ou lista por marco). */
const milestoneMultAt = (i, c = CONTENT) => { const m = c.BALANCE.milestones.mult; return Array.isArray(m) ? m[i] : m; };

/** Próximo marco: { at, from (marco anterior ou 0), left, mult } ou null. */
function nextMilestone(owned, c = CONTENT) {
  const i = c.BALANCE.milestones.at.findIndex((a) => owned < a);
  const at = c.BALANCE.milestones.at;
  return i === -1 ? null : { at: at[i], from: i ? at[i - 1] : 0, left: at[i] - owned, mult: milestoneMultAt(i, c) };
}

/** Multiplicador total de um gerador por marcos × níveis de Mk alcançados. */
function generatorMult(s, gen, c = CONTENT) {
  const owned = (s.run.generators[gen] || {}).owned || 0;
  let m = 1;
  for (let i = 0; i < milestonesReached(owned, c); i++) m *= milestoneMultAt(i, c);
  const mk = bpOf(s, gen).mk;
  for (const l of (c.blueprint[gen] || { levels: [] }).levels) if (l.mk <= mk) m *= l.mult;
  return m;
}

/** Divisor de custo das próximas unidades pelos Mk alcançados (Mk II ÷4, Mk III ÷10 → ÷40). */
function costDivOf(s, gen, c = CONTENT) {
  let d = 1;
  const mk = bpOf(s, gen).mk;
  for (const l of (c.blueprint[gen] || { levels: [] }).levels) if (l.mk <= mk) d *= l.costDiv || 1;
  return d;
}

/** Efeitos (mul gen:<id>) de marcos e Mk — entram no sistema de modificadores. */
function blueprintEffects(s, c = CONTENT) {
  const out = [];
  for (const g of c.GENERATORS) {
    const m = generatorMult(s, g.id, c);
    if (m !== 1) out.push({ type: 'mul', target: 'gen:' + g.id, value: m, source: 'blueprint:' + g.id });
  }
  return out;
}

/**
 * Sorteia uma peça (determinístico via rand). opts: { category?, mk3?: true (Zero), mk2Only?: true (achados) }
 * Peça repetida (ou nível já esgotado) vira sucata. → log { type:'part', gen, mk, part, name, dup } | { type:'scrap' }
 */
function dropPart(s, rand, opts = {}, c = CONTENT) {
  const unlocked = c.GENERATORS.filter((g) => g.tier <= s.run.tier);
  let pool = unlocked.filter((g) => !opts.category || g.category === opts.category);
  if (!pool.length) pool = unlocked;
  if (opts.mk3) { // Zero: peça Mk III de um gerador que já tem o Mk II (senão, uma Mk II)
    const ready = pool.filter((g) => bpOf(s, g.id).mk === 2);
    if (ready.length) pool = ready;
  }
  // Peso = 1 + 3 × peças já obtidas do próximo nível: os conjuntos tendem a fechar.
  const weight = (x) => 1 + 3 * Object.keys(bpOf(s, x.id).parts).length;
  let r = rand() * pool.reduce((n, x) => n + weight(x), 0);
  const g = pool.find((x) => (r -= weight(x)) < 0) || pool[pool.length - 1];
  const bp = bpOf(s, g.id);
  let mk;
  if (opts.mk3) mk = bp.mk === 2 ? 3 : bp.mk === 1 ? 2 : null;
  else if (opts.mk2Only) mk = bp.mk === 1 ? 2 : null;
  else mk = bp.mk === 1 ? 2 : bp.mk === 2 && rand() < c.BALANCE.blueprints.mk3ChanceContained ? 3 : null;
  const index = Math.floor(rand() * 4);
  if (!mk || !levelOf(g.id, mk, c)) { s.run.scrap += 1; return { type: 'scrap', gen: g.id }; }
  const id = partId(g.id, mk, index);
  const name = levelOf(g.id, mk, c).parts[index];
  const cur = s.run.blueprints[g.id] || (s.run.blueprints[g.id] = { mk: 1, parts: {} });
  if (cur.parts[id]) { s.run.scrap += 1; return { type: 'part', gen: g.id, mk, part: id, name, dup: true }; }
  cur.parts[id] = true;
  return { type: 'part', gen: g.id, mk, part: id, name, dup: false };
}

/** A peça pode ser obtida agora (é do próximo nível do gerador e ainda não foi obtida)? → erro ou null */
function partError(s, p) {
  if (!p) return 'Peça inexistente';
  const bp = bpOf(s, p.gen);
  if (p.mk !== bp.mk + 1) return p.mk <= bp.mk ? 'Esse nível já foi feito' : `Faça o Mk ${bp.mk + 1 === 2 ? 'II' : 'III'} antes`;
  if (bp.parts[partId(p.gen, p.mk, p.index)]) return 'Peça já obtida';
  return null;
}

module.exports = { bpOf, partId, levelOf, parsePart, milestonesReached, nextMilestone, generatorMult, costDivOf, blueprintEffects, dropPart, partError };
