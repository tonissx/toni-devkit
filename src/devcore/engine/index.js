'use strict';
/**
 * API da engine do DevCore: dispatch(state, action, now) → { state, log, error? }
 * Pura: não lê relógio, disco nem DOM. Toda ação primeiro avança o tempo até `now`.
 *
 * Ações:
 *   boot                      avança o tempo fechado (com teto), achados dos pets, resumo de retorno
 *   tick                      avança o tempo online (heartbeat)
 *   buy { gen, qty|'max' }    upgrade { id }    train { pet }    station { pet, on }
 *   ability { id }            event { name, data }    ackWelcome    seen { upgrades? }
 *   skin { pet, skin }        visual (paleta) de um DevPet — só visuais já desbloqueados
 */
const { CONTENT } = require('../content/index.js');
const { advanceTo } = require('./advance.js');
const { production, stationSlots, generatorUnlocked } = require('./production.js');
const { costOf, maxAffordable, trainCost } = require('./economy.js');
const { check } = require('./conditions.js');
const { recordEvent, evaluate } = require('./discoveries.js');
const { rng } = require('./rng.js');
const { stageOf, evaluateSkins } = require('./appearance.js');

const upgradeAvailable = (s, u) => !s.run.upgrades[u.id] && check(u.requires, s);

/** Achados dos pets durante o tempo fechado: a cada N horas um cache de 1–3 min de produção. */
function petFinds(s, countedMs, from, now, c) {
  const B = c.BALANCE;
  const n = Math.floor(countedMs / (B.petFindEveryHours * 3600e3));
  const pets = Object.keys(s.run.pets);
  if (!n || !pets.length) return [];
  const rand = rng(s.seed ^ Math.floor(from / 1000));
  const rate = production(s, now, c).rate;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pet = pets[Math.floor(rand() * pets.length)];
    const minutes = B.petFindMinutes[0] + Math.floor(rand() * (B.petFindMinutes[1] - B.petFindMinutes[0] + 1));
    const amount = rate * minutes * 60;
    s.run.resources.compute.amount += amount;
    s.run.resources.compute.lifetime += amount;
    out.push({ pet, minutes, amount });
  }
  return out;
}

function boot(s, now, c, log) {
  const B = c.BALANCE;
  const gap = now - s.clock.lastUpdate;
  const offline = gap >= B.offlineThresholdMin * 60e3;
  const rateBefore = production(s, s.clock.lastUpdate, c).rate;
  const from = s.clock.lastUpdate;
  const adv = advanceTo(s, now, { offline }, c);
  if (!offline) return;
  const finds = petFinds(s, adv.countedMs, from, now, c);
  const disc = evaluate(s, now, c);
  log.push(...disc);
  if (adv.elapsedMs < B.welcomeThresholdMin * 60e3) return;
  const prev = s.pending.welcome;
  const w = {
    at: now,
    awayMs: adv.elapsedMs + (prev ? prev.awayMs : 0),
    countedMs: adv.countedMs + (prev ? prev.countedMs : 0),
    capped: adv.countedMs < adv.elapsedMs || !!(prev && prev.capped),
    gained: adv.gained + (prev ? prev.gained : 0),
    rate: rateBefore,
    finds: [...(prev ? prev.finds : []), ...finds],
    discoveries: [...(prev ? prev.discoveries : []), ...disc.filter((x) => x.type === 'discovery').map((x) => x.id)],
  };
  s.pending.welcome = w;
  log.push({ type: 'welcome' });
}

function act(s, action, now, c, log) {
  switch (action.type) {
    case 'buy': {
      const g = c.gen[action.gen];
      if (!g || !generatorUnlocked(s, g)) return 'Gerador indisponível';
      const owned = (s.run.generators[g.id] || {}).owned || 0;
      const res = s.run.resources.compute;
      const qty = action.qty === 'max' ? maxAffordable(g, owned, res.amount) : Math.max(1, Math.floor(action.qty || 1));
      const cost = costOf(g, owned, qty);
      if (!qty || cost > res.amount) return 'Compute insuficiente';
      res.amount -= cost;
      s.run.generators[g.id] = { owned: owned + qty };
      log.push({ type: 'purchase', gen: g.id, qty, category: g.category });
      return null;
    }
    case 'upgrade': {
      const u = c.upgrade[action.id];
      if (!u || !upgradeAvailable(s, u)) return 'Upgrade indisponível';
      const res = s.run.resources.compute;
      if (u.cost > res.amount) return 'Compute insuficiente';
      res.amount -= u.cost;
      s.run.upgrades[u.id] = now;
      log.push({ type: 'upgrade', id: u.id });
      return null;
    }
    case 'train': {
      const p = c.pet[action.pet];
      const st = s.run.pets[action.pet];
      if (!p || !st) return 'DevPet indisponível';
      if (st.level >= c.RARITY[p.rarity].maxLevel) return 'Nível máximo';
      const cost = trainCost(p, st.level);
      const res = s.run.resources.compute;
      if (cost > res.amount) return 'Compute insuficiente';
      res.amount -= cost;
      const before = stageOf(st.level, c);
      st.level += 1;
      log.push({ type: 'train', pet: p.id, level: st.level });
      const after = stageOf(st.level, c);
      if (after.id !== before.id) log.push({ type: 'evolve', pet: p.id, stage: after.id, name: after.name });
      return null;
    }
    case 'station': {
      const st = s.run.pets[action.pet];
      if (!st) return 'DevPet indisponível';
      if (action.on) {
        const used = Object.values(s.run.pets).filter((p) => p.station).length;
        if (!st.station && used >= stationSlots(s, c)) return s.run.tier < 3 ? 'Estações liberam no tier 3' : 'Sem estações livres';
      }
      st.station = !!action.on;
      log.push({ type: 'station', pet: action.pet, on: st.station });
      return null;
    }
    case 'ability': {
      const def = c.ability[action.id];
      const owner = def && c.PETS.find((p) => p.ability === def.id && s.run.pets[p.id]);
      if (!def || !owner) return 'Habilidade indisponível';
      if (s.run.tier < 2) return 'Habilidades liberam no tier 2';
      const a = s.run.abilities[def.id] || { activeUntil: 0, readyAt: 0 };
      if (a.readyAt > now) return 'Em recarga';
      const e = def.effect;
      if (e.type === 'burst') a.activeUntil = now + e.durationSec * 1000;
      if (e.type === 'instant') {
        const gained = production(s, now, c).rate * e.seconds;
        s.run.resources.compute.amount += gained;
        s.run.resources.compute.lifetime += gained;
        log.push({ type: 'instant', id: def.id, gained });
      }
      if (e.type === 'recall') {
        for (const [id, other] of Object.entries(s.run.abilities)) {
          if (id !== def.id && other.readyAt > now) other.readyAt = now + (other.readyAt - now) * e.factor;
        }
      }
      a.readyAt = now + def.cooldownSec * 1000;
      s.run.abilities[def.id] = a;
      log.push({ type: 'ability', id: def.id, pet: owner.id });
      return null;
    }
    case 'event':
      recordEvent(s, String(action.name || ''), action.data, now);
      return null;
    case 'ackWelcome':
      s.pending.welcome = null;
      return null;
    case 'skin': {
      if (!s.run.pets[action.pet]) return 'DevPet indisponível';
      if (!c.skin[action.skin] || !s.cosmetics.unlocked.includes(action.skin)) return 'Visual bloqueado';
      s.cosmetics.skins[action.pet] = action.skin;
      s.cosmetics.fresh = s.cosmetics.fresh.filter((id) => id !== action.skin);
      log.push({ type: 'skinChanged', pet: action.pet, skin: action.skin });
      return null;
    }
    case 'seen':
      s.discoveries.unseen = [];
      if (action.skins) s.cosmetics.fresh = [];
      for (const id of action.upgrades || []) if (!s.discoveries.seenUpgrades.includes(id)) s.discoveries.seenUpgrades.push(id);
      return null;
    default:
      return 'Ação desconhecida: ' + action.type;
  }
}

function dispatch(state, action, now, c = CONTENT) {
  const s = structuredClone(state);
  const log = [];
  let error = null;
  if (action.type === 'boot') boot(s, now, c, log);
  else {
    advanceTo(s, now, { offline: false }, c);
    if (action.type !== 'tick') error = act(s, action, now, c, log);
  }
  log.push(...evaluate(s, now, c), ...evaluateSkins(s, c));
  return error ? { state: s, log, error } : { state: s, log };
}

module.exports = { dispatch, upgradeAvailable };
