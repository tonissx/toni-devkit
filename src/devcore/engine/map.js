'use strict';
/**
 * Mapa da área (docs/devcore-mapa-singularity.md §4) — regras puras.
 * O mapa é gerado pela semente da run quando a área abre (Localhost: Tier 2). O jogador começa antes da coluna 0 e só
 * anda para a frente, para um ponto ligado ao atual (elite com atalho também liga à coluna +2).
 *
 * Ações (ver engine/index.js): mapFight { node, squad } · mapMove { node } · mapChoose { index } · mapBuy { offer } · mapAdvance
 *   · mapSquad { squad, node? } (salva a preparação; a view mostra a previsão para `node`)
 * Derrota nunca tira progresso: custa só o Compute de entrada, e o ponto continua lá.
 */
const { CONTENT } = require('../content/index.js');
const { rng } = require('./rng.js');
const { check } = require('./conditions.js');
const { grantItem } = require('./incidents.js');
const { dropPart } = require('./blueprints.js');
const { setupBattle, resolve, petDown, msUntilHp, setPetHp, slotsOf, petsOf } = require('./battle.js');
const { formatDuration } = require('./format.js');

/** Hash inteiro estável de uma string (semente por ponto). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const randFor = (s, ...parts) => rng((s.seed ^ hash(parts.join(':'))) >>> 0);
const nodeId = (col, lane) => `${col}-${lane}`;
const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/** Gera o mapa de uma área: { area, nodes: { id: node } }. node: { id, col, lane, type, next[], shortcut?, group?, event?, offers? } */
function generate(area, seed, c = CONTENT) {
  const rand = rng(seed >>> 0);
  const nodes = {};
  const types = Object.entries(c.NODE_TYPES).filter(([, t]) => t.weight > 0);
  const total = types.reduce((n, [, t]) => n + t.weight, 0);
  const weighted = () => { let r = rand() * total; return (types.find(([, t]) => (r -= t.weight) < 0) || types[0])[0]; };
  const events = [...c.EVENTS];
  for (let col = 0; col < area.columns; col++) {
    const fixed = area.fixed[col] ? [...area.fixed[col]] : null;
    if (fixed) for (let i = fixed.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [fixed[i], fixed[j]] = [fixed[j], fixed[i]]; }
    for (let lane = 0; lane < area.lanes; lane++) {
      const type = fixed ? fixed[lane] : weighted();
      const n = { id: nodeId(col, lane), col, lane, type, next: [] };
      if (type === 'battle' || type === 'elite') n.group = pick(area.groups[type], rand);
      if (type === 'event') n.event = (events.length ? events.splice(Math.floor(rand() * events.length), 1)[0] : pick(c.EVENTS, rand)).id;
      if (type === 'shop') n.offers = shopOffers(area, col, rand, c);
      nodes[n.id] = n;
    }
  }
  // Ligações: em frente sempre; diagonais entre trilhas vizinhas sem cruzar.
  for (let col = 0; col < area.columns - 1; col++) {
    for (let lane = 0; lane < area.lanes; lane++) nodes[nodeId(col, lane)].next.push(nodeId(col + 1, lane));
    for (let lane = 0; lane < area.lanes - 1; lane++) {
      const r = rand();
      if (r < area.crossChance / 2) nodes[nodeId(col, lane)].next.push(nodeId(col + 1, lane + 1));
      else if (r < area.crossChance) nodes[nodeId(col, lane + 1)].next.push(nodeId(col + 1, lane));
    }
  }
  // Elite e deploy expresso são escolhas (risco ou atalho pago), não pedágio: todo ponto tem ao menos uma saída comum.
  for (const n of Object.values(nodes)) {
    const outs = n.next.map((id) => nodes[id]);
    if (outs.length && outs.every((x) => x.type === 'elite' || x.type === 'express')) {
      const x = outs[Math.floor(rand() * outs.length)];
      x.type = 'battle';
      x.group = pick(area.groups.battle, rand);
    }
  }
  const boss = { id: 'boss', col: area.columns, lane: Math.floor(area.lanes / 2), type: 'boss', next: [], group: area.groups.boss[0] };
  nodes.boss = boss;
  for (let lane = 0; lane < area.lanes; lane++) nodes[nodeId(area.columns - 1, lane)].next.push('boss');
  // Elite com atalho: depois de vencer, também dá para ir direto à coluna +2.
  for (const n of Object.values(nodes)) {
    if (n.type === 'elite' && n.col >= 1 && n.col <= area.columns - 3 && rand() < area.shortcutChance) n.shortcut = nodeId(n.col + 2, n.lane);
  }
  return { area: area.id, nodes };
}

/** Ofertas de uma loja (preço = fração × custo-base da coluna). */
function shopOffers(area, col, rand, c) {
  const base = area.costs[col];
  const S = c.SHOP;
  const items = [...c.CONSUMABLES];
  const out = [];
  for (let i = 0; i < S.items && items.length; i++) {
    const k = items.splice(Math.floor(rand() * items.length), 1)[0];
    out.push({ kind: 'item', id: k.id, price: base * S.itemPrice });
  }
  out.push({ kind: 'part', price: base * S.partPrice });
  for (const p of S.patches) out.push({ kind: 'patch', rarity: p.rarity, price: base * p.price });
  return out.map((o, i) => ({ ...o, index: i, bought: false }));
}

/** Estado inicial do mapa de uma área. */
function createMap(s, area, c = CONTENT) {
  return {
    ...generate(area, (s.seed ^ hash('map:' + area.id)) >>> 0, c),
    at: null, visited: [], cleared: false, attempts: {}, pending: null, lastBattle: null, battles: 0,
  };
}

/** Abre o mapa quando a primeira área libera (chamado a cada dispatch). → log */
function ensureMap(s, c = CONTENT) {
  if (s.run.map) return [];
  const area = c.AREAS[0];
  if (!check(area.unlock, s)) return [];
  s.run.map = createMap(s, area, c);
  return [{ type: 'mapOpen', area: area.id, name: area.name }];
}

/** Pontos para onde dá para ir agora. */
function reachable(s) {
  const m = s.run.map;
  if (!m || m.cleared) return [];
  if (m.at == null) return Object.values(m.nodes).filter((n) => n.col === 0).map((n) => n.id);
  const cur = m.nodes[m.at];
  return [...cur.next, ...(cur.shortcut ? [cur.shortcut] : [])];
}

/** Custo de entrar num ponto (Compute). */
function nodeCost(s, node, c = CONTENT) {
  const area = c.area[s.run.map.area];
  return area.costs[Math.min(node.col, area.costs.length - 1)] * c.NODE_TYPES[node.type].costMult;
}

/** Valida a preparação (now: confere quem está fora de combate). → erro ou null */
function squadError(s, squad, c = CONTENT, now = null) {
  const B = c.BATTLE;
  if (!squad) return 'Escolha ao menos um DevPet';
  const pets = petsOf(squad, c);
  if (!pets.length) return 'Escolha ao menos um DevPet';
  if (pets.length > B.squadSize) return `O esquadrão tem no máximo ${B.squadSize} DevPets`;
  if (new Set(pets).size !== pets.length) return 'DevPet repetido no esquadrão';
  if (pets.some((id) => !s.run.pets[id])) return 'DevPet indisponível';
  const down = now == null ? null : pets.find((id) => petDown(s, id, now, c));
  if (down) return `${c.pet[down].name} está fora de combate (volta em ${formatDuration(msUntilHp(s, down, c.BATTLE.recovery.koMin, now, c))})`;
  const items = squad.items || [];
  if (items.length > B.maxItems || new Set(items).size !== items.length) return `Leve até ${B.maxItems} consumíveis diferentes`;
  if (items.some((id) => !c.BATTLE_ITEMS[id] || !(s.run.inventory[id] > 0))) return 'Consumível indisponível';
  if (Object.values(squad.triggers || {}).some((t) => !c.TRIGGERS.some((x) => x.id === t))) return 'Gatilho inválido';
  return null;
}

/** Normaliza a preparação (só o que vale guardar): slots, e pets/front derivados (compatibilidade). */
const cleanSquad = (squad) => {
  const slots = slotsOf(squad);
  const pets = petsOf(squad);
  return {
    slots, pets, front: slots.vanguard ? [slots.vanguard] : [],
    triggers: Object.fromEntries(Object.entries(squad.triggers || {}).filter(([id]) => pets.includes(id))),
    items: [...(squad.items || [])],
  };
};

/** Concede um Patch da raridade (que a run ainda não tem). → id | null */
function grantPatch(s, rarity, rand, c = CONTENT) {
  const pool = c.PATCHES.filter((p) => p.rarity === rarity && !s.run.patches.includes(p.id));
  if (!pool.length) return null;
  const p = pick(pool, rand);
  s.run.patches.push(p.id);
  return p.id;
}

/** O pet de menor nível do esquadrão salvo (ou de todos) que ainda pode subir. */
function petToLevel(s, c) {
  const saved = petsOf(s.run.squad);
  const ids = (saved.length ? saved : Object.keys(s.run.pets)).filter((id) => s.run.pets[id]);
  const max = (id) => c.RARITY[c.pet[id].rarity].maxLevel;
  return ids.filter((id) => s.run.pets[id].level < max(id)).sort((a, b) => s.run.pets[a].level - s.run.pets[b].level)[0] || null;
}

/** Aplica recompensas de evento/descanso. → [{ type, … }] (para o log e a UI) */
function grantRewards(s, rewards, rand, c, now = null) {
  const out = [];
  for (const r of rewards) {
    if (r.patch) { const id = grantPatch(s, r.patch, rand, c); out.push(id ? { type: 'patch', id } : { type: 'none' }); }
    // Consumível com o estoque cheio: vira uma peça (nunca "nada" — a batalha/evento prometeu uma recompensa).
    if (r.item) { const id = grantItem(s, rand, c); if (id) out.push({ type: 'item', id }); else out.push(...grantRewards(s, [{ part: true }], rand, c, now)); }
    if (r.part) { const d = dropPart(s, rand, {}, c); out.push(d.type === 'part' && !d.dup ? { type: 'part', gen: d.gen, name: d.name, part: d.part } : { type: 'scrap' }); }
    if (r.petLevel) { const id = petToLevel(s, c); if (id) { s.run.pets[id].level += r.petLevel; out.push({ type: 'petLevel', pet: id, level: s.run.pets[id].level }); } }
    if (r.battleBuff) { s.run.battleBuff = { atk: ((s.run.battleBuff && s.run.battleBuff.atk) || 0) + r.battleBuff.atk }; out.push({ type: 'battleBuff', atk: s.run.battleBuff.atk }); }
    if (r.healAll) { for (const id of Object.keys(s.run.pets)) setPetHp(s, id, 1, now); out.push({ type: 'healAll' }); }
    if (r.restock) { for (const k of c.CONSUMABLES) s.run.inventory[k.id] = Math.min(k.cap, (s.run.inventory[k.id] || 0) + 1); out.push({ type: 'restock' }); }
    if (r.swapPatch) {
      const i = s.run.patches.findIndex((id) => c.patch[id] && c.patch[id].rarity === 'common');
      if (i !== -1) { const old = s.run.patches.splice(i, 1)[0]; const id = grantPatch(s, r.swapPatch, rand, c); out.push({ type: 'swap', from: old, id }); }
    }
  }
  return out;
}

/** Recompensas de uma vitória. */
function battleRewards(s, node, rand, c) {
  const R = c.BATTLE_REWARDS[node.type];
  const out = [];
  if (node.type === 'battle') {
    out.push(...grantRewards(s, [rand() < 0.5 ? { item: true } : { part: true }], rand, c));
    if (rand() < R.patchChance) out.push(...grantRewards(s, [{ patch: R.patch }], rand, c));
  } else if (node.type === 'elite') {
    out.push(...grantRewards(s, [{ patch: R.patch }, { item: true }], rand, c));
  } else {
    out.push(...grantRewards(s, [{ patch: R.patch }], rand, c));
  }
  return out.filter((x) => x.type !== 'none');
}

function enter(m, node) {
  m.at = node.id;
  m.visited.push(node.id);
}

/** Ações do mapa. → erro ou null (escreve no log). */
function mapAct(s, action, now, c, log) {
  const m = s.run.map;
  if (!m) return 'O mapa abre no Tier 2';
  const res = s.run.resources.compute;
  const blocking = m.pending && m.pending.kind !== 'shop';

  if (action.type === 'mapSquad') {
    const err = squadError(s, action.squad, c, now);
    if (err) return err;
    s.run.squad = { ...cleanSquad(action.squad), node: action.node && m.nodes[action.node] ? action.node : null };
    return null;
  }

  if (action.type === 'mapChoose') {
    if (!blocking) return 'Nada para escolher agora';
    const p = m.pending;
    const node = m.nodes[p.node];
    const options = p.kind === 'event' ? c.event[node.event].choices : c.REST_OPTIONS;
    const ch = options[action.index];
    if (!ch) return 'Escolha inválida';
    if (ch.needs === 'commonPatch' && !s.run.patches.some((id) => c.patch[id] && c.patch[id].rarity === 'common')) return 'Você não tem um Patch comum';
    const area = c.area[m.area];
    const cost = (ch.cost || 0) * area.costs[node.col];
    if (cost > res.amount) return 'Compute insuficiente';
    res.amount -= cost;
    const rewards = grantRewards(s, ch.rewards, randFor(s, 'choose', node.id), c, now);
    m.pending = null;
    log.push({ type: 'mapChoice', node: node.id, kind: p.kind, index: action.index, rewards });
    return null;
  }

  if (action.type === 'mapBuy') {
    if (!m.pending || m.pending.kind !== 'shop') return 'Você não está numa loja';
    const node = m.nodes[m.pending.node];
    const o = node.offers[action.offer];
    if (!o || o.bought) return 'Oferta indisponível';
    if (o.price > res.amount) return 'Compute insuficiente';
    const rand = randFor(s, 'shop', node.id, action.offer);
    let got = null;
    if (o.kind === 'item') {
      const k = c.consumable[o.id];
      if ((s.run.inventory[o.id] || 0) >= k.cap) return 'Estoque cheio';
      s.run.inventory[o.id] = (s.run.inventory[o.id] || 0) + 1;
      got = { type: 'item', id: o.id };
    } else if (o.kind === 'part') {
      [got] = grantRewards(s, [{ part: true }], rand, c);
    } else {
      const id = grantPatch(s, o.rarity, rand, c);
      if (!id) return 'Você já tem todos os Patches dessa raridade';
      got = { type: 'patch', id };
    }
    res.amount -= o.price;
    o.bought = true;
    log.push({ type: 'mapBuy', node: node.id, offer: action.offer, reward: got });
    return null;
  }

  if (action.type === 'mapAdvance') {
    const area = c.area[m.area];
    if (!m.cleared) return 'Vença o chefe da área antes de seguir';
    if (!area.next || !c.area[area.next]) return 'A próxima área ainda não existe';
    const next = c.area[area.next];
    const battles = m.battles;
    s.run.map = createMap(s, next, c);
    s.run.map.battles = battles; // a numeração das lutas segue na run (a UI usa o número para saber que há luta nova)
    log.push({ type: 'mapOpen', area: next.id, name: next.name, from: area.id });
    return null;
  }

  // Movimento (mapMove / mapFight)
  if (m.cleared) return 'Área concluída';
  if (blocking) return m.pending.kind === 'event' ? 'Escolha uma opção do evento antes de seguir' : 'Escolha o benefício do descanso antes de seguir';
  const node = m.nodes[action.node];
  if (!node || !reachable(s).includes(node.id)) return 'Ponto fora de alcance';
  const cost = nodeCost(s, node, c);

  if (action.type === 'mapMove') {
    if (['battle', 'elite', 'boss'].includes(node.type)) return 'Esse ponto é uma batalha';
    if (cost > res.amount) return 'Compute insuficiente';
    res.amount -= cost;
    enter(m, node);
    m.pending = ['event', 'rest', 'shop'].includes(node.type) ? { node: node.id, kind: node.type } : null;
    log.push({ type: 'mapMove', node: node.id, kind: node.type, cost });
    return null;
  }

  if (action.type === 'mapFight') {
    if (!['battle', 'elite', 'boss'].includes(node.type)) return 'Esse ponto não é uma batalha';
    const squad = action.squad || s.run.squad;
    const err = squadError(s, squad, c, now);
    if (err) return err;
    if (cost > res.amount) return 'Compute insuficiente';
    res.amount -= cost;
    s.run.squad = { ...cleanSquad(squad), node: null };
    const attempt = m.attempts[node.id] || 0;
    m.attempts[node.id] = attempt + 1;
    const setup = setupBattle(s, squad, node.group, node.col, m.area, c, node.type, now);
    const result = resolve(setup, (s.seed ^ hash('battle:' + node.id) ^ Math.imul(attempt + 1, 2654435761)) >>> 0, c);
    // A vida que sobrou fica nos pets (recupera com o tempo); quem caiu fica fora de combate.
    for (const u of result.units) if (u.side === 'pet') setPetHp(s, u.id, u.end / u.maxHp, now);
    for (const id of result.usedItems) s.run.inventory[id] = Math.max(0, (s.run.inventory[id] || 0) - 1);
    s.run.battleBuff = null;
    m.pending = null;
    let rewards = [];
    const A = s.arena;
    if (result.win) {
      A.wins += 1;
      for (const id of node.group) A.defeated[id] = (A.defeated[id] || 0) + 1;
      rewards = battleRewards(s, node, randFor(s, 'reward', node.id, attempt), c);
      enter(m, node);
      if (node.type === 'boss') { m.cleared = true; A.areas[m.area] = (A.areas[m.area] || 0) + 1; }
    } else {
      A.losses += 1;
    }
    m.battles += 1;
    m.lastBattle = { id: m.battles, node: node.id, kind: node.type, win: result.win, reason: result.reason, maxRounds: result.maxRounds, rounds: result.rounds, units: result.units, log: result.log, usedItems: result.usedItems, rewards, cost };
    log.push({ type: 'battle', node: node.id, kind: node.type, win: result.win, rewards, cleared: m.cleared });
    return null;
  }
  return 'Ação desconhecida: ' + action.type;
}

module.exports = { generate, createMap, ensureMap, reachable, nodeCost, squadError, mapAct, grantPatch, hash };
