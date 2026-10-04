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
 *   use { item, ability? }    consumível (Coffee, Hotfix, Rollback, Cache Warmer)
 *   craft { item }            fabrica um consumível com Compute (N minutos da produção atual)
 *   (missões diárias: progresso vem de `event`; concluir rende contador de visuais e, às vezes, um consumível)
 *   quiet { on }             modo tranquilo: sem incidentes (e sem as recompensas deles)
 *   buyPart { part }          compra uma peça de Blueprint com Compute (N minutos da produção atual)
 *   scrapPart { part }        troca sucata por uma peça faltante
 *   refactor { gen }          conjunto completo → próximo Mk (produção do gerador × mult, visual novo)
 *   rebuild                   Legado: converte o Compute em fragmentos e recomeça a run (ver engine/legacy.js)
 *   perk { id }               compra um perk da Árvore de Legado com fragmentos
 */
const { CONTENT } = require('../content/index.js');
const { advanceTo } = require('./advance.js');
const { production, stationSlots, generatorUnlocked } = require('./production.js');
const { costOf, maxAffordable, trainCost } = require('./economy.js');
const { check } = require('./conditions.js');
const { recordEvent, evaluate } = require('./discoveries.js');
const { rng } = require('./rng.js');
const { stageOf, evaluateSkins } = require('./appearance.js');
const { record: recordQuestEvent, evaluateQuests } = require('./quests.js');
const { ensureScheduled, endIncident, grantItem, abilitiesLocked, randFor } = require('./incidents.js');
const { bpOf, partId, levelOf, parsePart, partError, dropPart, costDivOf } = require('./blueprints.js');
const { perkMod, buyPerk, rebuild } = require('./legacy.js');

const upgradeAvailable = (s, u) => !s.run.upgrades[u.id] && check(u.requires, s);

/** Custo de comprar uma peça: N minutos da produção atual (Mk II: 3 h, Mk III: 12 h; mínimo 500). */
const partCost = (s, mk, now, c = CONTENT) => Math.max(500, c.BALANCE.blueprints.buyMinutes[mk] * 60 * production(s, now, c).rate);

/** Custo para fabricar um consumível: N minutos da produção atual (mínimo 50). */
const craftCost = (s, k, now, c = CONTENT) => Math.max(50, k.craftMinutes * 60 * production(s, now, c).rate);

/** Achados dos pets durante o tempo fechado: a cada N horas um cache de 1–3 min de produção ou um consumível. */
function petFinds(s, countedMs, from, now, c) {
  const B = c.BALANCE;
  const n = Math.floor(countedMs / (B.petFindEveryHours * perkMod(s, 'petFindEvery', c) * 3600e3));
  const pets = Object.keys(s.run.pets);
  if (!n || !pets.length) return [];
  const rand = rng(s.seed ^ Math.floor(from / 1000));
  const rate = production(s, now, c).rate;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pet = pets[Math.floor(rand() * pets.length)];
    if (rand() < B.blueprints.partChanceFind) {
      const drop = dropPart(s, rand, { mk2Only: true }, c);
      if (drop.type === 'part' && !drop.dup) { out.push({ pet, part: drop.part, partName: drop.name, gen: drop.gen }); continue; }
    }
    if (rand() < B.findConsumableChance) {
      const item = grantItem(s, rand, c);
      if (item) { out.push({ pet, item }); continue; } // estoque cheio → vira cache de Compute
    }
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
  log.push(...adv.log);
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
    // Incidentes enquanto você esteve fora: quem veio, se foi contido (e por quem), o item ganho.
    parts: [...(prev ? prev.parts || [] : []), ...adv.log.filter((x) => x.type === 'part' || x.type === 'scrap').map((x) => ({ gen: x.gen, name: x.name || null, dup: !!x.dup || x.type === 'scrap' }))],
    incidents: [...(prev ? prev.incidents || [] : []), ...adv.log.filter((x) => x.type === 'incidentStart').map((x) => {
      const cont = adv.log.find((y) => y.type === 'contained' && y.at === x.at);
      const end = adv.log.find((y) => y.type === 'incidentEnd' && y.id === x.id && y.at >= x.at);
      const part = cont && cont.part ? (cont.part.type === 'part' && !cont.part.dup ? { gen: cont.part.gen, mk: cont.part.mk, name: cont.part.name } : { scrap: true }) : null;
      return { id: x.id, villain: x.villain, contained: x.contained, by: x.by, item: cont ? cont.item : null, part, durationMs: end ? end.at - x.at : null };
    })],
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
      const div = costDivOf(s, g.id, c);
      const qty = action.qty === 'max' ? maxAffordable(g, owned, res.amount, div) : Math.max(1, Math.floor(action.qty || 1));
      const cost = costOf(g, owned, qty, div);
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
        if (!st.station && used >= stationSlots(s, c)) return s.run.tier < 2 ? 'Estações liberam no tier 2' : 'Sem estações livres';
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
      if (abilitiesLocked(s, now, c)) return 'Merge Conflict: habilidades travadas (Relay em estação ou Hotfix)';
      const a = s.run.abilities[def.id] || { activeUntil: 0, readyAt: 0 };
      if (a.readyAt > now) return 'Em recarga';
      const e = def.effect;
      if (e.type === 'burst') a.activeUntil = now + e.durationSec * perkMod(s, 'abilityDuration', c) * 1000;
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
      a.readyAt = now + def.cooldownSec * perkMod(s, 'abilityCooldown', c) * 1000;
      s.run.abilities[def.id] = a;
      log.push({ type: 'ability', id: def.id, pet: owner.id });
      return null;
    }
    case 'event':
      recordEvent(s, String(action.name || ''), action.data, now);
      recordQuestEvent(s, String(action.name || ''), action.data, now, c);
      return null;
    case 'ackWelcome':
      s.pending.welcome = null;
      return null;
    case 'skin': {
      if (!s.run.pets[action.pet]) return 'DevPet indisponível';
      if (!c.skin[action.skin] || !s.cosmetics.unlocked.includes(action.skin)) return 'Visual bloqueado';
      if (c.skin[action.skin].pet && c.skin[action.skin].pet !== action.pet) return 'Visual exclusivo de outro DevPet';
      s.cosmetics.skins[action.pet] = action.skin;
      s.cosmetics.fresh = s.cosmetics.fresh.filter((id) => id !== action.skin);
      log.push({ type: 'skinChanged', pet: action.pet, skin: action.skin });
      return null;
    }
    case 'use': {
      const k = c.consumable[action.item];
      if (!k || !(s.run.inventory[k.id] > 0)) return 'Item indisponível';
      const e = k.effect;
      if (e.type === 'boost') {
        const b = s.run.boosts.find((x) => x.id === k.id && x.until > now);
        if (b) b.until += e.durationSec * 1000; // outro café estende, não multiplica
        else s.run.boosts.push({ id: k.id, target: e.target, mult: e.mult, until: now + e.durationSec * 1000 });
      } else if (e.type === 'hotfix') {
        const a = s.run.incidents.active;
        if (!a || a.contained) return 'Nenhum incidente para corrigir';
        endIncident(s, now, c, log, 'hotfixed');
      } else if (e.type === 'shield') {
        if (s.run.shields >= k.cap) return 'Rollback já armado';
        s.run.shields += 1;
      } else if (e.type === 'resetCooldown') {
        const waiting = Object.entries(s.run.abilities).filter(([, a]) => a.readyAt > now);
        const pick = action.ability ? waiting.find(([id]) => id === action.ability) : waiting.sort((x, y) => y[1].readyAt - x[1].readyAt)[0];
        if (!pick) return 'Nenhuma habilidade em recarga';
        pick[1].readyAt = now;
      }
      s.run.inventory[k.id] -= 1;
      log.push({ type: 'item', id: k.id });
      return null;
    }
    case 'craft': {
      const k = c.consumable[action.item];
      if (!k) return 'Item indisponível';
      if ((s.run.inventory[k.id] || 0) >= k.cap) return 'Estoque cheio';
      const cost = craftCost(s, k, now, c);
      const res = s.run.resources.compute;
      if (cost > res.amount) return 'Compute insuficiente';
      res.amount -= cost;
      s.run.inventory[k.id] = (s.run.inventory[k.id] || 0) + 1;
      log.push({ type: 'craft', id: k.id });
      return null;
    }
    case 'buyPart': {
      const p = parsePart(action.part, c);
      const err = partError(s, p);
      if (err) return err;
      const cost = partCost(s, p.mk, now, c);
      const res = s.run.resources.compute;
      if (cost > res.amount) return 'Compute insuficiente';
      res.amount -= cost;
      (s.run.blueprints[p.gen] || (s.run.blueprints[p.gen] = { mk: 1, parts: {} })).parts[action.part] = true;
      log.push({ type: 'part', gen: p.gen, mk: p.mk, part: action.part, name: p.name, dup: false, source: 'buy' });
      return null;
    }
    case 'scrapPart': {
      const p = parsePart(action.part, c);
      const err = partError(s, p);
      if (err) return err;
      const need = c.BALANCE.blueprints.scrapPerPart[p.mk];
      if (s.run.scrap < need) return 'Sucata insuficiente (precisa de ' + need + ')';
      s.run.scrap -= need;
      (s.run.blueprints[p.gen] || (s.run.blueprints[p.gen] = { mk: 1, parts: {} })).parts[action.part] = true;
      log.push({ type: 'part', gen: p.gen, mk: p.mk, part: action.part, name: p.name, dup: false, source: 'scrap' });
      return null;
    }
    case 'refactor': {
      const bp = bpOf(s, action.gen);
      const next = levelOf(action.gen, bp.mk + 1, c);
      if (!next) return c.gen[action.gen] ? 'Nível máximo' : 'Gerador inexistente';
      const ids = next.parts.map((_, i) => partId(action.gen, next.mk, i));
      if (!ids.every((id) => bp.parts[id])) return 'Conjunto incompleto';
      const cur = s.run.blueprints[action.gen] || (s.run.blueprints[action.gen] = bp);
      cur.mk = next.mk;
      for (const id of ids) delete cur.parts[id];
      log.push({ type: 'refactor', gen: action.gen, mk: next.mk, category: c.gen[action.gen].category });
      return null;
    }
    case 'quiet': {
      s.settings.quiet = !!action.on;
      if (s.settings.quiet) {
        s.run.incidents.next = null;
        if (s.run.incidents.active) endIncident(s, now, c, log, 'cancelled');
      }
      return null;
    }
    case 'rebuild':
      return rebuild(s, now, c, log);
    case 'perk':
      return buyPerk(s, String(action.id || ''), now, c, log);
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
    log.push(...advanceTo(s, now, { offline: false }, c).log);
    if (action.type !== 'tick') error = act(s, action, now, c, log);
  }
  log.push(...evaluate(s, now, c), ...evaluateQuests(s, now, c), ...evaluateSkins(s, c));
  s.run.boosts = s.run.boosts.filter((b) => b.until > now);
  ensureScheduled(s, now, c); // um tier novo (ou sair do modo tranquilo) liga os incidentes a partir de agora
  return error ? { state: s, log, error } : { state: s, log };
}

module.exports = { dispatch, upgradeAvailable, craftCost, partCost };
