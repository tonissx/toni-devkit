'use strict';
/**
 * Legado (prestige) — regras puras.
 * Fragmentos na vida = floor(cbrt(Compute de todas as runs / divisor)); o Rebuild rende a diferença
 * para os já ganhos. Nível de Legado = fragmentos ganhos na vida (gastos ou não) → produção ×(1 + perLevel × nível).
 * Perks comprados com fragmentos são permanentes: efeitos (sistema de modificadores), mods (multiplicadores
 * de regras), start (como cada Rebuild começa) e keep (o que atravessa o Rebuild).
 */
const { CONTENT } = require('../content/index.js');
const { createRun } = require('./state.js');

const ownedPerks = (s, c = CONTENT) => Object.keys(s.meta.perks).map((id) => c.perk[id]).filter(Boolean);

/** Produto de um multiplicador de regra dos perks (1 se nenhum). */
function perkMod(s, key, c = CONTENT) {
  let m = 1;
  for (const k of ownedPerks(s, c)) if (k.mods && k.mods[key] != null) m *= k.mods[key];
  return m;
}

/** Como o próximo Rebuild começa (perks somados: máximo para níveis, soma para estoques). */
function startConfig(s, c = CONTENT) {
  const out = { compute: 0, gens: {}, tier: 1, petLevel: 1, items: {}, shields: 0, keep: { inventory: false, scrap: false, mk: 1 } };
  for (const k of ownedPerks(s, c)) {
    const st = k.start || {};
    out.compute = Math.max(out.compute, st.compute || 0);
    for (const [g, n] of Object.entries(st.gens || {})) out.gens[g] = Math.max(out.gens[g] || 0, n);
    out.tier = Math.max(out.tier, st.tier || 1);
    out.petLevel = Math.max(out.petLevel, st.petLevel || 1);
    for (const [id, n] of Object.entries(st.items || {})) out.items[id] = (out.items[id] || 0) + n;
    out.shields += st.shields || 0;
    const kp = k.keep || {};
    if (kp.inventory) out.keep.inventory = true;
    if (kp.scrap) out.keep.scrap = true;
    out.keep.mk = Math.max(out.keep.mk, kp.mk || 1);
  }
  return out;
}

/** Nível em que um DevPet (re)aparece nesta run (perks Muscle Memory / Pack Leader), no teto da raridade. */
function petStartLevel(s, petId, c = CONTENT) {
  const p = c.pet[petId];
  const max = p ? c.RARITY[p.rarity].maxLevel : 1;
  return Math.min(max, startConfig(s, c).petLevel);
}

/** Efeitos permanentes: nível de Legado (mul global) + efeitos dos perks. Entram junto com os upgrades. */
function legacyEffects(s, c = CONTENT) {
  const out = [];
  const level = s.meta.earned || 0;
  if (level > 0) out.push({ type: 'mul', target: 'global', value: 1 + level * c.LEGACY.perLevel * perkMod(s, 'legacyPerLevel', c), source: 'legacy' });
  for (const k of ownedPerks(s, c)) for (const e of k.effects || []) out.push({ ...e, source: 'perk:' + k.id });
  return out;
}

/** Compute somado de todas as runs (passadas + atual). */
const allTimeCompute = (s) => (s.meta.lifetime || 0) + s.run.resources.compute.lifetime;

/** Fragmentos totais na vida para um Compute somado. */
function fragmentsFor(total, c = CONTENT) {
  const x = Math.max(0, total) / c.LEGACY.divisor;
  let n = Math.floor(Math.cbrt(x));
  // Correções de arredondamento nas bordas (cubos exatos).
  while (n > 0 && n ** 3 > x) n--;
  while ((n + 1) ** 3 <= x) n++;
  return n;
}

/** Compute somado necessário para ter `n` fragmentos na vida. */
const computeFor = (n, c = CONTENT) => n ** 3 * c.LEGACY.divisor;

/** Fragmentos que um Rebuild agora renderia. */
const pendingFragments = (s, c = CONTENT) => Math.max(0, fragmentsFor(allTimeCompute(s), c) - (s.meta.earned || 0));

/** Pode dar Rebuild agora? → erro ou null. */
function rebuildError(s, c = CONTENT) {
  if (s.run.tier < c.LEGACY.minTier) return `Rebuild libera no Tier ${c.LEGACY.minTier}`;
  if (pendingFragments(s, c) < 1) return 'O Rebuild ainda não renderia nenhum fragmento';
  return null;
}

/** Estado de um perk: owned | available | locked (requisitos) — "affordable" fica para a view. */
function perkStatus(s, k) {
  if (s.meta.perks[k.id]) return 'owned';
  const has = (id) => !!s.meta.perks[id];
  if (k.requires && !k.requires.every(has)) return 'locked';
  if (k.requiresAny && !k.requiresAny.some(has)) return 'locked';
  return 'available';
}

/** Compra um perk com fragmentos. → erro ou null */
function buyPerk(s, id, now, c, log) {
  const k = c.perk[id];
  if (!k) return 'Perk inexistente';
  const st = perkStatus(s, k);
  if (st === 'owned') return 'Perk já adquirido';
  if (st === 'locked') return 'Requer um perk anterior da árvore';
  if (s.meta.fragments < k.cost) return 'Fragmentos insuficientes';
  s.meta.fragments -= k.cost;
  s.meta.perks[k.id] = now;
  log.push({ type: 'perk', id: k.id, name: k.name });
  return null;
}

/**
 * Rebuild: converte o Compute acumulado em fragmentos e recomeça a run.
 * Fica: Legado (meta), descobertas, uso do DevKit, visuais, bestiário, missões, configurações.
 * Volta: DevPets já encontrados (no nível inicial dos perks), conforme as condições das descobertas
 * (ver discoveries.evaluate) — e os tiers, conforme o Compute da run nova.
 */
function rebuild(s, now, c, log) {
  const err = rebuildError(s, c);
  if (err) return err;
  const gained = pendingFragments(s, c);
  const old = s.run;
  s.meta.lifetime = (s.meta.lifetime || 0) + old.resources.compute.lifetime;
  s.meta.earned = (s.meta.earned || 0) + gained;
  s.meta.fragments = (s.meta.fragments || 0) + gained;
  s.meta.rebuilds = (s.meta.rebuilds || 0) + 1;
  s.meta.lastRebuildAt = now;

  const cfg = startConfig(s, c);
  const run = createRun(c, old.incidents.seq);
  run.resources.compute.amount = Math.max(run.resources.compute.amount, cfg.compute);
  for (const [g, n] of Object.entries(cfg.gens)) run.generators[g] = { owned: Math.max((run.generators[g] || {}).owned || 0, n) };
  run.tier = cfg.tier;
  for (const id of Object.keys(run.pets)) run.pets[id].level = petStartLevel(s, id, c);
  if (cfg.keep.inventory) run.inventory = { ...old.inventory };
  for (const [id, n] of Object.entries(cfg.items)) {
    const k = c.consumable[id];
    run.inventory[id] = Math.min(k.cap, (run.inventory[id] || 0) + n);
  }
  run.shields = Math.min(c.consumable.rollback ? c.consumable.rollback.cap : Infinity, cfg.shields);
  if (cfg.keep.scrap) run.scrap = old.scrap;
  for (const [gen, bp] of Object.entries(old.blueprints)) {
    const mk = Math.min(bp.mk, cfg.keep.mk);
    const parts = {};
    for (const id of Object.keys(bp.parts)) {
      if (!cfg.keep.scrap) continue;
      if (id.startsWith(`${gen}:mk${mk + 1}:`)) parts[id] = true;
      else run.scrap += 1; // peça de um nível que não volta: vira sucata
    }
    if (mk > 1 || Object.keys(parts).length) run.blueprints[gen] = { mk, parts };
  }
  s.run = run;
  log.push({ type: 'rebuild', gained, rebuilds: s.meta.rebuilds, level: s.meta.earned });
  return null;
}

module.exports = {
  perkMod, startConfig, petStartLevel, legacyEffects, allTimeCompute, fragmentsFor, computeFor,
  pendingFragments, rebuildError, perkStatus, buyPerk, rebuild,
};
