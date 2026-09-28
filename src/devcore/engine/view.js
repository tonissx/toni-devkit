'use strict';
/**
 * Modelo de visualização do DevCore (o que a UI e a palette recebem). Puro, derivado do estado.
 * A UI anima o contador com amount + rate × (agora − at) — sem IPC por frame.
 */
const { CONTENT } = require('../content/index.js');
const { production, stationSlots, synergyActive, hasMechanic, activeCategories, generatorUnlocked } = require('./production.js');
const { costOf, maxAffordable, trainCost } = require('./economy.js');
const { upgradeAvailable } = require('./index.js');
const { offlineCapMs } = require('./advance.js');
const { formatNum } = require('./format.js');
const { stageOf, nextStageOf, skinOf } = require('./appearance.js');

const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 1000) / 10 + '%';

/** Texto curto de um efeito: "+15% Shell", "×3 global". */
function describeEffect(e, c = CONTENT) {
  const [kind, id] = String(e.target || '').split(':');
  const what = kind === 'global' ? 'em tudo' : kind === 'cat' ? (c.category[id] || { name: id }).name
    : kind === 'gen' ? (c.gen[id] || { name: id }).name : e.target;
  if (e.type === 'mul') return '×' + formatNum(e.value, { rate: true }) + ' ' + what;
  if (e.type === 'add') return pct(e.value) + ' ' + what;
  return '';
}

/** Requisito legível de uma condição simples (para upgrades bloqueados). */
function describeCondition(cond, c = CONTENT) {
  if (!cond || cond.always) return '';
  if (cond.all) return cond.all.map((x) => describeCondition(x, c)).filter(Boolean).join(' + ');
  if (cond.any) return cond.any.map((x) => describeCondition(x, c)).filter(Boolean).join(' ou ');
  if (cond.tier != null) return 'Tier ' + cond.tier;
  if (cond.owned) return cond.owned.n + '× ' + (c.gen[cond.owned.gen] || { name: cond.owned.gen }).name;
  if (cond.discovery) return 'descoberta ' + (c.discovery[cond.discovery] || { title: '???' }).title;
  if (cond.lifetime != null) return formatNum(cond.lifetime) + ' Compute acumulado';
  if (cond.maxPetLevel != null) return 'um DevPet no nível ' + cond.maxPetLevel;
  if (cond.anyPetMaxed) return 'um DevPet no nível máximo';
  return '???';
}

function snapshot(s, now, c = CONTENT) {
  const prod = production(s, now, c);
  const res = s.run.resources.compute;
  const amount = res.amount;
  const tier = c.TIERS.find((t) => t.id === s.run.tier);
  const nextTier = c.TIERS.find((t) => t.id === s.run.tier + 1);
  const nextEra = nextTier && c.DISCOVERIES.find((d) => d.rewards.some((r) => r.tier === nextTier.id));
  const nextAt = nextEra && nextEra.when.lifetime;

  const generators = c.GENERATORS.filter((g) => g.tier <= s.run.tier + 1).map((g) => {
    const owned = (s.run.generators[g.id] || {}).owned || 0;
    const unlocked = generatorUnlocked(s, g);
    const max = unlocked ? maxAffordable(g, owned, amount) : 0;
    return {
      id: g.id, name: g.name, description: g.description, tier: g.tier, category: g.category, owned, unlocked,
      rate: prod.gens[g.id] || 0,
      each: owned ? (prod.gens[g.id] || 0) / owned : null,
      cost1: costOf(g, owned, 1), cost10: costOf(g, owned, 10), max, costMax: costOf(g, owned, max),
    };
  });

  const upgrades = c.UPGRADES.map((u) => {
    const owned = !!s.run.upgrades[u.id];
    const available = upgradeAvailable(s, u);
    return {
      id: u.id, name: u.name, description: u.description, kind: u.kind, cost: u.cost,
      status: owned ? 'owned' : available ? 'available' : 'locked',
      affordable: available && u.cost <= amount,
      requirement: owned || available ? '' : describeCondition(u.requires, c),
    };
  });

  const slots = stationSlots(s, c);
  const used = Object.values(s.run.pets).filter((p) => p.station).length;
  const pets = c.PETS.map((p) => {
    const st = s.run.pets[p.id];
    const ability = c.ability[p.ability];
    const hint = c.DISCOVERIES.find((d) => d.rewards.some((r) => r.pet === p.id));
    if (!st) return { id: p.id, owned: false, name: p.name, rarity: p.rarity, hint: hint ? hint.title : '' };
    const maxLevel = c.RARITY[p.rarity].maxLevel;
    const a = s.run.abilities[ability.id] || { activeUntil: 0, readyAt: 0 };
    const stage = stageOf(st.level, c);
    const next = nextStageOf(st.level, c);
    const skin = skinOf(s, p.id, c);
    return {
      id: p.id, owned: true, name: p.name, species: p.species, rarity: p.rarity, rarityName: c.RARITY[p.rarity].name,
      specialization: p.specialization, category: p.category, level: st.level, maxLevel,
      // Cor efetiva (visual escolhido) + estágio de evolução.
      color: skin.colors.body || p.color, eye: skin.colors.eye || null, baseColor: p.color,
      skin: skin.id, stage: { id: stage.id, name: stage.name, next: next && next.minLevel <= maxLevel ? { name: next.name, level: next.minLevel } : null },
      trainCost: st.level < maxLevel ? trainCost(p, st.level) : null,
      bonus: p.bonus.map((e) => describeEffect({ ...e, value: e.value * (1 + p.perLevel * (st.level - 1)) }, c)),
      station: st.station, canStation: s.run.tier >= 3 && (st.station || used < slots),
      lines: p.lines,
      ability: {
        id: ability.id, name: ability.name, description: ability.description, cooldownSec: ability.cooldownSec,
        locked: s.run.tier < 2, activeUntil: a.activeUntil, readyAt: a.readyAt, ready: s.run.tier >= 2 && a.readyAt <= now,
      },
    };
  });

  const active = activeCategories(s, c);
  const synergiesOn = hasMechanic(s, 'synergies', c);
  const synergies = s.run.tier < 2 ? [] : c.SYNERGIES.map((syn) => {
    const r = syn.requires;
    const missing = [];
    if (syn.needsMechanic && !synergiesOn) missing.push('Distributed Runtime');
    for (const g of r.gens || []) if (!((s.run.generators[g] || {}).owned > 0)) missing.push(c.gen[g].name);
    for (const p of r.pets || []) if (!s.run.pets[p]) missing.push(c.pet[p].name);
    for (const d of r.discoveries || []) if (!s.discoveries.found[d]) missing.push('descoberta ' + c.discovery[d].title);
    if (r.minActiveCategories && active.size < r.minActiveCategories) missing.push(`${r.minActiveCategories} categorias ativas`);
    return {
      id: syn.id, name: syn.name, description: syn.description, active: synergyActive(s, syn, active, c), missing,
      effects: syn.effects.map((e) => describeEffect(e.perActiveCategory ? { ...e, value: e.value * Math.max(1, active.size) } : e, c)),
    };
  });

  const discoveries = c.DISCOVERIES.map((d) => (s.discoveries.found[d.id]
    ? { id: d.id, title: d.title, text: d.text, finder: d.finder, at: s.discoveries.found[d.id], found: true, unseen: s.discoveries.unseen.includes(d.id) }
    : { id: d.id, found: false }));

  const skins = c.SKINS.map((k) => ({
    id: k.id, name: k.name, colors: k.colors,
    unlocked: s.cosmetics.unlocked.includes(k.id), fresh: s.cosmetics.fresh.includes(k.id),
    requirement: s.cosmetics.unlocked.includes(k.id) ? '' : describeCondition(k.unlock, c),
  }));

  const newUpgrades = upgrades.filter((u) => u.status === 'available' && u.affordable && !s.discoveries.seenUpgrades.includes(u.id));

  return {
    at: now,
    amount, lifetime: res.lifetime, rate: prod.rate,
    nextChange: Math.min(...Object.values(s.run.abilities).map((a) => a.activeUntil).filter((t) => t > now), Infinity),
    tiers: c.TIERS.map((t) => {
      const era = c.DISCOVERIES.find((d) => d.rewards.some((r) => r.tier === t.id));
      return { id: t.id, name: t.name, mechanic: t.mechanic, at: era && era.when.lifetime != null ? era.when.lifetime : 0 };
    }),
    tier: { id: tier.id, name: tier.name, mechanic: tier.mechanic, next: nextTier ? { id: nextTier.id, name: nextTier.name, at: nextAt, mechanic: nextTier.mechanic } : null },
    categories: c.CATEGORIES.map((cat) => ({
      ...cat, active: active.has(cat.id),
      rate: c.GENERATORS.filter((g) => g.category === cat.id).reduce((n, g) => n + (prod.gens[g.id] || 0), 0),
    })),
    generators, upgrades, pets, synergies, discoveries, skins,
    stations: { slots, used },
    offlineCapHours: offlineCapMs(s, c) / 3600e3,
    welcome: s.pending.welcome,
    unseen: [...s.discoveries.unseen],
    newUpgrades: newUpgrades.map((u) => u.id),
    freshSkins: [...s.cosmetics.fresh],
    hasNews: s.discoveries.unseen.length > 0 || newUpgrades.length > 0 || s.cosmetics.fresh.length > 0,
  };
}

/** Habilidades para a palette (prontas e em recarga). */
function abilitiesList(s, now, c = CONTENT) {
  return snapshot(s, now, c).pets.filter((p) => p.owned && !p.ability.locked).map((p) => ({
    id: p.ability.id, name: p.ability.name, description: p.ability.description, pet: p.name,
    ready: p.ability.ready, readyInMs: Math.max(0, p.ability.readyAt - now), active: p.ability.activeUntil > now,
  }));
}

module.exports = { snapshot, abilitiesList, describeEffect, describeCondition };
