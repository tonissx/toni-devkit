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
const { patchMod } = require('./patches.js');
const { reachable, nodeCost, squadError } = require('./map.js');
const { setupBattle, preview, petStats, enemyStats, countered, petHp, petDown, msUntilHp } = require('./battle.js');
const { abilitiesLocked, incidentsEnabled } = require('./incidents.js');
const { check } = require('./conditions.js');
const { stationedPets } = require('../content/index.js');
const { offlineCapMs } = require('./advance.js');
const { formatNum } = require('./format.js');
const { stageOf, nextStageOf, skinOf } = require('./appearance.js');
const { questsView } = require('./quests.js');

const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 1000) / 10 + '%';

/** Texto curto de um efeito: "+15% Shell", "×3 global". */
function describeEffect(e, c = CONTENT) {
  const [kind, id] = String(e.target || '').split(':');
  const what = kind === 'global' ? 'em tudo' : kind === 'cat' ? (c.category[id] || { name: id }).name
    : kind === 'gen' ? (c.gen[id] || { name: id }).name : e.target;
  if (e.type === 'mul') return '×' + formatNum(e.value, { rate: true }) + ' ' + what;
  if (e.type === 'add') return pct(e.value) + ' ' + what;
  if (e.type === 'per') {
    const src = (c.gen[e.gen] || { name: e.gen }).name;
    return `${pct(e.value)} ${what} a cada ${e.per === 1 ? '' : e.per + ' '}${src}`;
  }
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
  if (cond.questsDone != null) return cond.questsDone + ' missões diárias concluídas';
  if (cond.petQuests) return cond.petQuests.n + ' missões de ' + (c.pet[cond.petQuests.pet] || { name: cond.petQuests.pet }).name;
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
      share: prod.rate > 0 ? (prod.gens[g.id] || 0) / prod.rate : 0, // fração da produção total
      ...comboView(s, g, prod, now, c),
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
      effects: u.effects.map((e) => describeEffect(e, c)).filter(Boolean),
      // Combo: quanto renderia agora (o alvo ganha isto com as unidades atuais do gerador fonte).
      combo: comboInfo(s, u, c),
      comboNow: u.kind === 'combo' ? u.effects.filter((e) => e.type === 'per').map((e) => pct(e.value * ((s.run.generators[e.gen] || {}).owned || 0) / e.per) + ' ' + (c.gen[e.target.split(':')[1]] || {}).name) : [],
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
      trainCost: st.level < maxLevel ? trainCost(p, st.level) * patchMod(s, 'trainCost', c) : null,
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
    id: k.id, name: k.name, colors: k.colors, pet: k.pet || null,
    unlocked: s.cosmetics.unlocked.includes(k.id), fresh: s.cosmetics.fresh.includes(k.id),
    requirement: s.cosmetics.unlocked.includes(k.id) ? '' : describeCondition(k.unlock, c),
  }));

  const newUpgrades = upgrades.filter((u) => u.status === 'available' && u.affordable && !s.discoveries.seenUpgrades.includes(u.id));

  return {
    at: now,
    amount, lifetime: res.lifetime, rate: prod.rate,
    rateInfo: rateBreakdown(s, now, prod, c),
    map: mapView(s, now, c),
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
    quests: questsView(s, c),
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

const TEMPORARY = /^(ability|boost|incident):/;

/**
 * Produção por segundo discriminada: a base (sem nada temporário) e cada efeito temporário ativo — habilidade de
 * DevPet, consumível (boost) ou incidente não contido — com o que ele faz, até quando e quanto mexe na taxa agora
 * (delta = taxa − taxa sem ele; como os efeitos se multiplicam, os deltas não somam exatamente a diferença).
 */
function rateBreakdown(s, now, prod, c) {
  const sources = [...new Set(prod.effects.filter((e) => TEMPORARY.test(e.source)).map((e) => e.source))];
  const base = sources.length ? production(s, now, c, { skip: sources }).rate : prod.rate;
  const items = sources.map((src) => {
    const [kind, id] = src.split(':');
    const effects = prod.effects.filter((e) => e.source === src).map((e) => describeEffect(e, c));
    const delta = prod.rate - production(s, now, c, { skip: [src] }).rate;
    if (kind === 'ability') {
      const pet = c.PETS.find((p) => p.ability === id);
      return { kind, id, name: c.ability[id].name, pet: pet ? pet.id : null, effects, delta, until: s.run.abilities[id].activeUntil };
    }
    if (kind === 'boost') {
      const k = c.consumable[id] || { name: id, icon: 'package' };
      const b = s.run.boosts.find((x) => x.id === id && x.until > now);
      return { kind, id, name: k.name, icon: k.icon, effects, delta, until: b ? b.until : now };
    }
    const inc = c.incident[id];
    return { kind, id, name: inc.name, villain: { id: inc.villain.id, name: inc.villain.name, color: inc.villain.color }, effects, delta, until: s.run.incidents.active ? s.run.incidents.active.end : now };
  });
  return { base, total: prod.rate, items: items.sort((a, b) => b.delta - a.delta) };
}

/** Combo de um upgrade: { from, to, fromName, toName, visible } (visible = os dois geradores já liberados). */
function comboInfo(s, u, c) {
  const e = u.effects.find((x) => x.type === 'per');
  if (!e) return null;
  const to = e.target.split(':')[1];
  const tierOk = (id) => !!c.gen[id] && c.gen[id].tier <= s.run.tier;
  return { from: e.gen, to, fromName: (c.gen[e.gen] || { name: e.gen }).name, toName: (c.gen[to] || { name: to }).name, visible: tierOk(e.gen) && tierOk(to) };
}

/**
 * Combos de um gerador (como o tooltip das grandmas do Cookie Clicker):
 * boosts: quanto ele soma em cada alvo · boostRate/boostShare: quanto esses boosts rendem agora (e % do total)
 * boostedBy: quem soma nele.
 */
function comboView(s, g, prod, now, c) {
  const sum = (pred, key) => {
    const m = new Map();
    for (const e of prod.effects) if (e.type === 'add' && String(e.source).startsWith('combo:') && pred(e)) m.set(key(e), (m.get(key(e)) || 0) + e.value);
    return [...m].map(([id, v]) => ({ id, name: (c.gen[id] || { name: id }).name, pct: v }));
  };
  const boosts = sum((e) => e.source === 'combo:' + g.id, (e) => e.target.split(':')[1]);
  const boostedBy = sum((e) => e.target === 'gen:' + g.id, (e) => e.source.split(':')[1]);
  const boostRate = boosts.length ? Math.max(0, prod.rate - production(s, now, c, { exclude: g.id }).rate) : 0;
  return { boosts, boostedBy, boostRate, boostShare: prod.rate > 0 ? boostRate / prod.rate : 0 };
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

/** Inimigo de um grupo para a UI: atributos na coluna, traços e se o esquadrão salvo anula cada um. */
function enemyInfo(id, col, area, kind, counters, c) {
  const e = c.enemy[id];
  const st = enemyStats(id, col, area, c, kind);
  return {
    id, name: e.name, sprite: e.sprite, color: e.color, boss: !!e.boss, lines: e.lines,
    hp: st.hp, atk: Math.round(st.atk), def: Math.round(st.def), spd: st.spd,
    traits: e.traits.map((t) => ({ id: t, name: c.TRAITS[t].name, text: c.TRAITS[t].text, counterText: c.TRAITS[t].counterText, countered: !!counters && countered(t, counters, c) })),
  };
}

/** Patch para a UI. */
const patchInfo = (id, c) => { const p = c.patch[id]; return p ? { id, name: p.name, rarity: p.rarity, rarityName: c.RARITIES[p.rarity].name, icon: p.icon, description: p.description } : null; };

/** Recompensa (log do mapa) em texto curto para a UI. */
function rewardText(r, c) {
  if (r.type === 'patch') return 'Patch ' + c.patch[r.id].name;
  if (r.type === 'item') return '+1 ' + c.consumable[r.id].name;
  if (r.type === 'part') return 'peça ' + r.name;
  if (r.type === 'scrap') return '+1 sucata';
  if (r.type === 'petLevel') return c.pet[r.pet].name + ' no nível ' + r.level;
  if (r.type === 'battleBuff') return 'próxima batalha +' + Math.round(r.atk * 100) + '% de ataque';
  if (r.type === 'restock') return '+1 de cada consumível';
  if (r.type === 'healAll') return 'time com a vida cheia';
  if (r.type === 'swap') return r.id ? `${c.patch[r.from].name} → ${c.patch[r.id].name}` : 'troca sem Patch disponível';
  return '';
}

/** O que um tipo de ponto rende (texto para o hover). */
function rewardHint(type, c) {
  const R = c.BATTLE_REWARDS;
  if (type === 'battle') return `Consumível ou peça · ${Math.round(R.battle.patchChance * 100)}% de chance de um Patch comum`;
  if (type === 'elite') return 'Patch raro + consumível';
  if (type === 'boss') return 'Patch épico · conclui a área';
  if (type === 'express') return 'Avança sem lutar (sem recompensa)';
  if (type === 'event') return 'Uma escolha com trocas';
  if (type === 'shop') return 'Consumíveis, peças e Patches à venda';
  if (type === 'rest') return 'Treino, reabastecer ou foco';
  return '';
}

/**
 * Mapa da área para a UI: pontos (status, custo, inimigos, recompensa), pendente (evento/descanso/loja), Patches,
 * preparação salva com a previsão, e a última batalha (para a arena).
 */
function mapView(s, now, c) {
  const m = s.run.map;
  const first = c.AREAS[0];
  if (!m) return { unlocked: false, requirement: describeCondition(first.unlock, c), area: { id: first.id, name: first.name } };
  const area = c.area[m.area];
  const amount = s.run.resources.compute.amount;
  const reach = new Set(reachable(s));
  const sq = s.run.squad;
  const squadOk = !squadError(s, sq, c, now);
  const counters = squadOk ? { anyOf: new Set(sq.pets), front: new Set(sq.pets.filter((id) => sq.front.includes(id))) } : null;
  const nodes = Object.values(m.nodes).map((n) => {
    const cost = nodeCost(s, n, c);
    const kind = c.NODE_TYPES[n.type];
    return {
      id: n.id, col: n.col, lane: n.lane, type: n.type, typeName: kind.name, icon: kind.icon, next: n.next, shortcut: n.shortcut || null,
      status: m.at === n.id ? 'current' : m.visited.includes(n.id) ? 'visited' : reach.has(n.id) ? 'reachable' : 'locked',
      cost, affordable: cost <= amount, attempts: m.attempts[n.id] || 0, reward: rewardHint(n.type, c),
      enemies: n.group ? n.group.map((id) => enemyInfo(id, n.col, area, n.type, counters, c)) : null,
      event: n.event ? { id: n.event, title: c.event[n.event].title } : null,
    };
  });
  let pending = null;
  if (m.pending) {
    const node = m.nodes[m.pending.node];
    const base = area.costs[node.col];
    const hasCommon = s.run.patches.some((id) => c.patch[id] && c.patch[id].rarity === 'common');
    if (m.pending.kind === 'event') {
      const ev = c.event[node.event];
      pending = { kind: 'event', node: node.id, title: ev.title, text: ev.text, finder: ev.finder,
        choices: ev.choices.map((ch, i) => ({ index: i, text: ch.text, cost: (ch.cost || 0) * base,
          disabled: (ch.cost || 0) * base > amount || (ch.needs === 'commonPatch' && !hasCommon) })) };
    } else if (m.pending.kind === 'rest') {
      pending = { kind: 'rest', node: node.id, title: 'Descanso', choices: c.REST_OPTIONS.map((o, i) => ({ index: i, text: o.text, cost: 0, disabled: false })) };
    } else {
      pending = { kind: 'shop', node: node.id, title: 'Loja', offers: node.offers.map((o) => ({
        index: o.index, kind: o.kind, price: o.price, bought: o.bought, affordable: o.price <= amount,
        name: o.kind === 'item' ? c.consumable[o.id].name : o.kind === 'part' ? 'Peça de Blueprint' : 'Patch ' + c.RARITIES[o.rarity].name.toLowerCase(),
        icon: o.kind === 'item' ? c.consumable[o.id].icon : o.kind === 'part' ? 'package' : 'sparkles',
        full: o.kind === 'item' && (s.run.inventory[o.id] || 0) >= c.consumable[o.id].cap,
      })) };
    }
  }
  // Previsão para o ponto que está sendo preparado (só um — a view é recalculada a cada ação).
  let forecast = null;
  const target = sq.node && m.nodes[sq.node];
  if (target && target.group && squadOk && reach.has(target.id)) {
    const attempt = m.attempts[target.id] || 0;
    forecast = { node: target.id, ...preview(setupBattle(s, sq, target.group, target.col, m.area, c, target.type, now), (s.seed ^ attempt) >>> 0, c) };
  }
  const lb = m.lastBattle;
  return {
    unlocked: true,
    area: { id: area.id, name: area.name, description: area.description, arena: area.arena, columns: area.columns, lanes: area.lanes },
    at: m.at, cleared: m.cleared, nodes, pending,
    patches: s.run.patches.map((id) => patchInfo(id, c)).filter(Boolean),
    battleBuff: s.run.battleBuff,
    squad: { pets: sq.pets, front: sq.front, triggers: sq.triggers, items: sq.items, node: sq.node, valid: squadOk },
    forecast,
    roster: Object.keys(s.run.pets).filter((id) => c.pet[id]).map((id) => {
      const st = petStats(s, id, c);
      const role = c.ROLES[c.PET_ROLES[id]];
      const ab = c.BATTLE_ABILITIES[c.pet[id].ability];
      const frac = petHp(s, id, now, c);
      const down = petDown(s, id, now, c);
      return { id, name: c.pet[id].name, level: s.run.pets[id].level, role: c.PET_ROLES[id], roleName: role.name,
        hp: st.hp, atk: Math.round(st.atk), def: Math.round(st.def), spd: st.spd,
        // Vida entre batalhas: fração atual, fora de combate, quando volta e quando fica cheia.
        life: frac, down, backInMs: down ? msUntilHp(s, id, c.BATTLE.recovery.koMin, now, c) : 0, fullInMs: msUntilHp(s, id, 1, now, c),
        ability: { id: c.pet[id].ability, name: c.ability[c.pet[id].ability].name, text: ab.text } };
    }),
    items: Object.entries(c.BATTLE_ITEMS).map(([id, k]) => ({ id, name: c.consumable[id].name, icon: c.consumable[id].icon, text: k.text, n: s.run.inventory[id] || 0 })),
    healItems: s.run.inventory['health-check'] || 0,  // Health Check em estoque (cura fora da batalha)
    triggers: c.TRIGGERS,
    lastBattle: lb ? { ...lb, rewards: lb.rewards.map((r) => ({ ...r, text: rewardText(r, c) })),
      units: lb.units.map((u) => (u.side === 'enemy' ? { ...u, sprite: c.enemy[u.id].sprite, color: c.enemy[u.id].color } : u)) } : null,
    stats: { wins: s.arena.wins, losses: s.arena.losses },
    maxRounds: c.BATTLE.maxRounds,
  };
}

module.exports = { snapshot, abilitiesList, itemsList, describeEffect, describeCondition, rewardText };
