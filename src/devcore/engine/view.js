'use strict';
/**
 * Modelo de visualização do DevCore (o que a UI e a palette recebem). Puro, derivado do estado.
 * A UI anima o contador com amount + rate × (agora − at) — sem IPC por frame.
 */
const { CONTENT } = require('../content/index.js');
const { production, stationSlots, synergyActive, hasMechanic, activeCategories, generatorUnlocked } = require('./production.js');
const { costOf, maxAffordable, trainCost } = require('./economy.js');
const { upgradeAvailable, craftCost, partCost } = require('./index.js');
const { bpOf, partId, levelOf, nextMilestone, generatorMult, costDivOf } = require('./blueprints.js');
const { abilitiesLocked, incidentsEnabled } = require('./incidents.js');
const { check } = require('./conditions.js');
const { stationedPets } = require('../content/index.js');
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
    const div = costDivOf(s, g.id, c);
    const max = unlocked ? maxAffordable(g, owned, amount, div) : 0;
    return {
      id: g.id, name: g.name, description: g.description, tier: g.tier, category: g.category, owned, unlocked,
      rate: prod.gens[g.id] || 0,
      each: owned ? (prod.gens[g.id] || 0) / owned : null,
      cost1: costOf(g, owned, 1, div), cost10: costOf(g, owned, 10, div), max, costMax: costOf(g, owned, max, div),
      costDiv: div, mk: bpOf(s, g.id).mk, mult: generatorMult(s, g.id, c), nextMilestone: nextMilestone(owned, c),
      blueprint: blueprintView(s, g.id, now, c),
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
      bonus: p.bonus.map((e) => describeEffect({ ...e, value: e.value * (1 + p.perLevel * (st.level - 1)) }, c) + (e.perActiveCategory ? ' por categoria ativa' : '')),
      station: st.station, canStation: slots > 0 && (st.station || used < slots),
      lines: p.lines,
      ability: {
        id: ability.id, name: ability.name, description: ability.description, cooldownSec: ability.cooldownSec,
        locked: s.run.tier < 2, blocked: abilitiesLocked(s, now, c), activeUntil: a.activeUntil, readyAt: a.readyAt,
        ready: s.run.tier >= 2 && a.readyAt <= now && !abilitiesLocked(s, now, c),
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
    // Próximo instante em que a taxa/cena muda (a UI busca um snapshot novo nessa hora).
    nextChange: Math.min(...[
      ...Object.values(s.run.abilities).map((a) => a.activeUntil),
      ...s.run.boosts.map((b) => b.until),
      s.run.incidents.active ? s.run.incidents.active.end : s.run.incidents.next ? s.run.incidents.next.at : 0,
    ].filter((t) => t > now), Infinity),
    tiers: c.TIERS.map((t) => {
      const era = c.DISCOVERIES.find((d) => d.rewards.some((r) => r.tier === t.id));
      return { id: t.id, name: t.name, mechanic: t.mechanic, at: era && era.when.lifetime != null ? era.when.lifetime : 0 };
    }),
    tier: { id: tier.id, name: tier.name, mechanic: tier.mechanic, next: nextTier ? { id: nextTier.id, name: nextTier.name, at: nextAt, mechanic: nextTier.mechanic } : null },
    scrap: s.run.scrap,
    categories: c.CATEGORIES.map((cat) => ({
      ...cat, active: active.has(cat.id),
      // Visual da estação: o maior Mk entre os geradores da categoria.
      mk: Math.max(1, ...c.GENERATORS.filter((g) => g.category === cat.id).map((g) => bpOf(s, g.id).mk)),
      rate: c.GENERATORS.filter((g) => g.category === cat.id).reduce((n, g) => n + (prod.gens[g.id] || 0), 0),
    })),
    generators, upgrades, pets, synergies, discoveries, skins,
    stations: { slots, used },
    ops: opsView(s, now, c),
    inventory: c.CONSUMABLES.map((k) => ({ id: k.id, name: k.name, icon: k.icon, description: k.description, n: s.run.inventory[k.id] || 0, cap: k.cap, craftCost: craftCost(s, k, now, c) })),
    bestiary: c.INCIDENTS.map((i) => ({ id: i.villain.id, incident: i.id, category: i.category, defeatedLine: i.villain.lines.defeated[0], name: i.villain.name, species: i.villain.species, color: i.villain.color, boss: !!i.villain.boss, description: i.description, counterText: i.counterText, stats: s.bestiary[i.villain.id] || null })),
    offlineCapHours: offlineCapMs(s, c) / 3600e3,
    welcome: s.pending.welcome,
    unseen: [...s.discoveries.unseen],
    newUpgrades: newUpgrades.map((u) => u.id),
    freshSkins: [...s.cosmetics.fresh],
    hasNews: s.discoveries.unseen.length > 0 || newUpgrades.length > 0 || s.cosmetics.fresh.length > 0,
  };
}

/** Blueprint do próximo nível de um gerador: peças obtidas/faltantes, custos, pronto para Refactor. */
function blueprintView(s, gen, now, c) {
  const bp = bpOf(s, gen);
  const next = levelOf(gen, bp.mk + 1, c);
  if (!next) return null;
  const parts = next.parts.map((name, i) => {
    const id = partId(gen, next.mk, i);
    return { id, name, owned: !!bp.parts[id] };
  });
  const complete = parts.every((p) => p.owned);
  return {
    mk: next.mk, mult: next.mult, costDiv: next.costDiv || 1, parts, complete, owned: parts.filter((p) => p.owned).length,
    buyCost: partCost(s, next.mk, now, c), scrapCost: c.BALANCE.blueprints.scrapPerPart[next.mk],
  };
}

/** Incidente → dados para a UI (vilão, efeito, quem contém e se isso já está armado). */
function incidentInfo(s, id, c) {
  const i = c.incident[id];
  const counters = stationedPets(i.counters).map((pid) => ({
    id: pid, name: c.pet[pid].name, owned: !!s.run.pets[pid], station: !!(s.run.pets[pid] && s.run.pets[pid].station),
  }));
  return {
    id: i.id, name: i.name, description: i.description, counterText: i.counterText, category: i.category,
    villain: { id: i.villain.id, name: i.villain.name, color: i.villain.color, boss: !!i.villain.boss, lines: i.villain.lines },
    counters, covered: s.run.shields > 0 || (!!i.counters && check(i.counters, s)),
  };
}

/** Aba Ops: previsão (só nas últimas horas antes), incidente ativo, histórico, escudos. */
function opsView(s, now, c) {
  const I = s.run.incidents;
  const B = c.BALANCE.incidents;
  const enabled = incidentsEnabled(s, c);
  const next = I.next;
  const visible = next && next.at - now <= B.forecastHours * 3600e3;
  return {
    enabled, quiet: s.settings.quiet, unlocked: s.run.tier >= B.minTier, shields: s.run.shields,
    forecast: !next ? null : visible ? { ...incidentInfo(s, next.id, c), at: next.at, inMs: Math.max(0, next.at - now) } : { hidden: true, inMs: Math.max(0, next.at - now) - B.forecastHours * 3600e3 },
    active: I.active ? { ...incidentInfo(s, I.active.id, c), start: I.active.start, end: I.active.end, remainingMs: Math.max(0, I.active.end - now), contained: I.active.contained, by: I.active.by } : null,
    history: I.history.map((h) => ({ ...h, name: c.incident[h.id].name, villainName: c.incident[h.id].villain.name,
      partText: h.part ? (h.part.scrap ? '+1 sucata' : `peça ${h.part.name} (${c.gen[h.part.gen].name})`) : null })),
  };
}

/** Consumíveis em estoque (para a palette). */
function itemsList(s, now, c = CONTENT) {
  const a = s.run.incidents.active;
  return c.CONSUMABLES.map((k) => ({ id: k.id, name: k.name, description: k.description, n: s.run.inventory[k.id] || 0,
    usable: (s.run.inventory[k.id] || 0) > 0 && (k.effect.type !== 'hotfix' || !!(a && !a.contained)) })).filter((k) => k.n > 0);
}

/** Habilidades para a palette (prontas e em recarga). */
function abilitiesList(s, now, c = CONTENT) {
  return snapshot(s, now, c).pets.filter((p) => p.owned && !p.ability.locked).map((p) => ({
    id: p.ability.id, name: p.ability.name, description: p.ability.description, pet: p.name,
    ready: p.ability.ready, readyInMs: Math.max(0, p.ability.readyAt - now), active: p.ability.activeUntil > now,
  }));
}

module.exports = { snapshot, abilitiesList, itemsList, describeEffect, describeCondition };
