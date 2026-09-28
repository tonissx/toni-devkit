'use strict';
/**
 * Modificadores e produção.
 * Toda fonte de bônus (upgrade, DevPet, sinergia, descoberta, habilidade ativa) vira um Effect
 * { type:'add'|'mul', target, value }. Por alvo: fator = (1 + Σadd) × Πmul.
 * Produção de um gerador = base × owned × fator(gen) × fator(categoria) × fator(global) [× diversidade].
 */
const { CONTENT } = require('../content/index.js');

/** Agrega efeitos por alvo. */
function aggregate(effects) {
  const m = new Map();
  for (const e of effects) {
    if (e.type !== 'add' && e.type !== 'mul') continue;
    const a = m.get(e.target) || { add: 0, mul: 1 };
    if (e.type === 'add') a.add += e.value; else a.mul *= e.value;
    m.set(e.target, a);
  }
  return m;
}
const factorOf = (agg, target) => { const a = agg.get(target); return a ? (1 + a.add) * a.mul : 1; };
const sumAdd = (agg, target) => (agg.get(target) || { add: 0 }).add;

const hasMechanic = (s, what, c) => Object.keys(s.run.upgrades).some((id) =>
  (c.upgrade[id] ? c.upgrade[id].effects : []).some((e) => e.type === 'unlock' && e.what === what));

const generatorUnlocked = (s, g) => s.run.tier >= g.tier;

/** Categorias com produção (pelo menos um gerador comprado e liberado). */
function activeCategories(s, c) {
  const set = new Set();
  for (const g of c.GENERATORS) if (generatorUnlocked(s, g) && ((s.run.generators[g.id] || {}).owned || 0) > 0) set.add(g.category);
  return set;
}

/** Quantos DevPets podem ficar em estação (tier 3). */
function stationSlots(s, c = CONTENT) {
  if (s.run.tier < 3) return 0;
  return c.BALANCE.stationSlots + sumAdd(aggregate(upgradeEffects(s, c)), 'stationSlots');
}

function upgradeEffects(s, c) {
  const out = [];
  for (const id of Object.keys(s.run.upgrades)) for (const e of (c.upgrade[id] || { effects: [] }).effects) out.push({ ...e, source: 'upgrade:' + id });
  return out;
}

/** Efeitos de um DevPet no nível atual (e em estação, se estiver). */
function petEffects(s, petId, upAgg, c) {
  const p = c.pet[petId];
  const st = s.run.pets[petId];
  if (!p || !st) return [];
  const lvl = 1 + p.perLevel * (st.level - 1); // +10% do bônus base por nível
  const petMul = 1 + sumAdd(upAgg, 'petBonus');
  const station = st.station && s.run.tier >= 3 ? c.BALANCE.stationMultiplier * (1 + sumAdd(upAgg, 'petStation')) : 1;
  return p.bonus.map((e) => ({ ...e, value: e.value * lvl * petMul * station, source: 'pet:' + petId }));
}

function synergyActive(s, syn, active, c) {
  if (syn.needsMechanic && !hasMechanic(s, syn.needsMechanic, c)) return false;
  const r = syn.requires;
  if ((r.gens || []).some((g) => !((s.run.generators[g] || {}).owned > 0) || !generatorUnlocked(s, c.gen[g]))) return false;
  if ((r.pets || []).some((p) => !s.run.pets[p])) return false;
  if ((r.discoveries || []).some((d) => !s.discoveries.found[d])) return false;
  if (r.minActiveCategories && active.size < r.minActiveCategories) return false;
  return true;
}

/** Bônus vindos de uso do DevKit (recompensas de descoberta), com teto total. */
function discoveryEffects(s, c) {
  const list = [];
  for (const id of Object.keys(s.discoveries.found)) {
    const d = c.discovery[id];
    if (d) for (const r of d.rewards) if (r.effect) list.push({ ...r.effect, source: 'discovery:' + id });
  }
  const total = list.reduce((n, e) => n + (e.type === 'add' ? e.value : 0), 0);
  const cap = c.BALANCE.usageBonusCap;
  const k = total > cap ? cap / total : 1;
  return list.map((e) => (e.type === 'add' ? { ...e, value: e.value * k } : e));
}

/** Habilidades com efeito ativo no instante t. */
function abilityEffects(s, t, c) {
  const out = [];
  for (const [id, a] of Object.entries(s.run.abilities)) {
    const def = c.ability[id];
    if (def && def.effect.type === 'burst' && a.activeUntil > t) out.push({ type: 'mul', target: def.effect.target, value: def.effect.mult, source: 'ability:' + id });
  }
  return out;
}

/** Todos os efeitos no instante t. */
function collectEffects(s, t, c = CONTENT) {
  const ups = upgradeEffects(s, c);
  const upAgg = aggregate(ups);
  const active = activeCategories(s, c);
  const effects = [...ups];
  for (const id of Object.keys(s.run.pets)) effects.push(...petEffects(s, id, upAgg, c));
  for (const syn of c.SYNERGIES) {
    if (!synergyActive(s, syn, active, c)) continue;
    for (const e of syn.effects) effects.push({ ...e, value: e.perActiveCategory ? e.value * active.size : e.value, source: 'synergy:' + syn.id });
  }
  effects.push(...discoveryEffects(s, c), ...abilityEffects(s, t, c));
  return { effects, active };
}

/** Produção no instante t: { rate, gens: {id: rate}, agg, active }. */
function production(s, t, c = CONTENT) {
  const { effects, active } = collectEffects(s, t, c);
  const agg = aggregate(effects);
  const gens = {};
  let rate = 0;
  for (const g of c.GENERATORS) {
    const owned = (s.run.generators[g.id] || {}).owned || 0;
    if (!owned || !generatorUnlocked(s, g)) { gens[g.id] = 0; continue; }
    let r = g.baseProduction * owned * factorOf(agg, 'gen:' + g.id) * factorOf(agg, 'cat:' + g.category) * factorOf(agg, 'global');
    if (g.perActiveCategory) r *= 1 + g.perActiveCategory * active.size;
    gens[g.id] = r;
    rate += r;
  }
  return { rate, gens, agg, active, effects };
}

module.exports = {
  aggregate, factorOf, sumAdd, production, collectEffects, activeCategories, synergyActive,
  hasMechanic, generatorUnlocked, stationSlots, upgradeEffects,
};
