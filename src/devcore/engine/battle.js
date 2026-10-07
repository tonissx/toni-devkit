'use strict';
/**
 * Batalha — auto-battler com preparação (docs/devcore-mapa-singularity.md §5). Regras puras e determinísticas:
 * a mesma preparação + a mesma semente dão a mesma luta. A arena (UI) só reproduz o log.
 *
 * Rodada: gatilhos/itens de início → cada unidade ganha `spd` de energia e age enquanto tiver ≥ energyPerAction
 * (a de mais energia primeiro; empate: pets antes). Fim: todos os inimigos caídos (vitória), todos os pets caídos ou
 * maxRounds sem vencer (derrota).
 *
 * Log (compacto, para a arena): { r, k, a?, t?, v?, c? }
 *   k: atk · miss · heal · ab (habilidade) · item · down · split · decoy · revive · fortify · end (v: 1 vitória, 0 derrota)
 *   a: uid de quem age · t: uid do alvo · v: valor (dano/cura) · c: crítico
 */
const { CONTENT } = require('../content/index.js');
const { rng } = require('./rng.js');
const { stageOf } = require('./appearance.js');

const sum = (list) => list.reduce((n, x) => n + x, 0);

/** Multiplicadores de batalha vindos dos Patches da run: { atk, hp, def, firstCrit }. */
function patchBattle(s, c = CONTENT) {
  const out = { atk: 0, hp: 0, def: 0, firstCrit: false };
  for (const id of (s.run.patches || [])) {
    const p = c.patch[id];
    if (!p) continue;
    for (const k of ['atk', 'hp', 'def']) out[k] += (p.battle && p.battle[k]) || 0;
    if (p.firstCrit) out.firstCrit = true;
  }
  return out;
}

/** Fração de vida de um pet agora (persiste entre batalhas; recupera perHour por hora, também offline). */
function petHp(s, petId, now, c = CONTENT) {
  const st = s.run.pets[petId];
  if (!st) return 0;
  const hp = st.hp == null ? 1 : st.hp;
  if (now == null || hp >= 1) return Math.min(1, hp);
  return Math.min(1, hp + c.BATTLE.recovery.perHour * Math.max(0, now - (st.hpAt || now)) / 3600e3);
}

/** Fora de combate: caiu a 0 numa luta e ainda não recuperou koMin. */
const petDown = (s, petId, now, c = CONTENT) => !!(s.run.pets[petId] && s.run.pets[petId].ko) && petHp(s, petId, now, c) < c.BATTLE.recovery.koMin;

/** Milissegundos até um valor de vida (0 se já passou). */
const msUntilHp = (s, petId, target, now, c = CONTENT) => Math.max(0, (target - petHp(s, petId, now, c)) / c.BATTLE.recovery.perHour * 3600e3);

/** Grava a vida de um pet (fração) agora. */
function setPetHp(s, petId, frac, now) {
  const st = s.run.pets[petId];
  if (!st) return;
  st.hp = Math.max(0, Math.min(1, frac));
  st.hpAt = now;
  st.ko = st.hp <= 0;
}

/** Atributos de combate de um pet no nível atual (sem Patches). */
function petStats(s, petId, c = CONTENT) {
  const p = c.pet[petId];
  const st = s.run.pets[petId];
  const role = c.ROLES[c.PET_ROLES[petId]];
  const B = c.BATTLE;
  const k = (1 + B.perLevel * (st.level - 1)) * B.stageMult[stageOf(st.level, c).id] * B.rarityMult[p.rarity];
  return { hp: Math.round(role.hp * k), atk: role.atk * k, def: role.def * k, spd: role.spd };
}

/** Escala dos inimigos numa coluna: 1 + linear × coluna + quadrática × coluna² (a defesa cresce pela metade). */
const scaleAt = (area, col) => 1 + area.scale.linear * col + area.scale.quad * col * col;

/** Atributos de um inimigo numa coluna da área (elite: vida e ataque × eliteMult). */
function enemyStats(enemyId, col, area, c = CONTENT, kind = 'battle') {
  const e = c.enemy[enemyId];
  const k = scaleAt(area, kind === 'boss' ? Math.min(col, area.columns - 1) : col);
  const m = kind === 'elite' ? area.scale.eliteMult : 1;
  return { hp: Math.round(e.hp * k * m), atk: e.atk * k * m, def: e.def * (1 + (k - 1) * 0.5), spd: e.spd };
}

/**
 * Monta a batalha a partir do estado: squad = { pets:[ids], front:[ids], triggers:{id:trigger}, items:[ids] }.
 * kind: battle | elite | boss (tipo do ponto do mapa). now: a luta começa com a vida atual de cada pet (sem now: vida cheia).
 * → { pets:[unit], enemies:[unit], items:[ids], counters:{ anyOf:Set, front:Set }, firstCrit }
 */
function setupBattle(s, squad, enemyIds, col, areaId, c = CONTENT, kind = 'battle', now = null) {
  const area = c.area[areaId];
  const pb = patchBattle(s, c);
  const buff = (s.run.battleBuff && s.run.battleBuff.atk) || 0;
  const pets = squad.pets.map((id, i) => {
    const st = petStats(s, id, c);
    const maxHp = Math.round(st.hp * (1 + pb.hp));
    const hp = now == null ? maxHp : Math.max(1, Math.round(maxHp * petHp(s, id, now, c)));
    return {
      uid: 'p' + i, side: 'pet', id, name: c.pet[id].name, role: c.PET_ROLES[id], front: squad.front.includes(id),
      hp, maxHp, atk: st.atk * (1 + pb.atk + buff), def: st.def * (1 + pb.def), spd: st.spd,
      ability: c.pet[id].ability, trigger: (squad.triggers && squad.triggers[id]) || 'start',
    };
  });
  const enemies = enemyIds.map((id, i) => {
    const st = enemyStats(id, col, area, c, kind);
    return { uid: 'e' + i, side: 'enemy', id, name: c.enemy[id].name, traits: c.enemy[id].traits, boss: !!c.enemy[id].boss, hp: st.hp, maxHp: st.hp, atk: st.atk, def: st.def, baseDef: st.def, spd: st.spd };
  });
  return {
    pets, enemies, items: [...(squad.items || [])],
    counters: { anyOf: new Set(squad.pets), front: new Set(squad.pets.filter((id) => squad.front.includes(id))) },
    firstCrit: pb.firstCrit,
  };
}

/** O traço está anulado pelo esquadrão? */
function countered(trait, counters, c) {
  const t = c.TRAITS[trait];
  if (!t || !t.counter) return false;
  if (t.counter.anyOf && t.counter.anyOf.some((id) => counters.anyOf.has(id))) return true;
  if (t.counter.front && t.counter.front.some((id) => counters.front.has(id))) return true;
  return false;
}

/** Resolve uma batalha (cópia interna do setup — não altera o argumento). → { win, rounds, log, units, usedItems } */
function resolve(setup, seed, c = CONTENT) {
  const B = c.BATTLE;
  const rand = rng(seed >>> 0);
  const pets = setup.pets.map((u) => ({ ...u, energy: 0, alive: true, abilityUsed: false, drain: 0, burst: 1, attacked: false }));
  const enemies = setup.enemies.map((u) => ({ ...u, energy: 0, alive: true, mark: 0, child: false }));
  const units = [...pets, ...enemies];
  const log = [];
  const squad = { shield: null, buffs: [], hasteUntil: 0, decoy: 0 };
  const items = new Set(setup.items);
  const used = [];
  const has = (trait, e) => e.traits.includes(trait) && !countered(trait, setup.counters, c);
  let r = 0;
  let nextEnemy = enemies.length;
  let refire = null; // Cache Warmer: habilidade que dispara de novo no início da próxima rodada

  const alivePets = () => pets.filter((u) => u.alive);
  const aliveEnemies = () => enemies.filter((u) => u.alive);
  const useItem = (id) => { items.delete(id); used.push(id); log.push({ r, k: 'item', v: id }); };
  const atkMult = () => 1 + sum(squad.buffs.filter((b) => b.until >= r).map((b) => b.value));
  const strongest = () => aliveEnemies().sort((a, b) => b.hp - a.hp)[0];
  const weakestAlly = () => alivePets().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  const heal = (u, amount, by) => { const v = Math.min(u.maxHp - u.hp, Math.round(amount)); u.hp += v; log.push({ r, k: 'heal', a: by, t: u.uid, v }); };

  function useAbility(p) {
    if (!p.alive || p.abilityUsed) return;
    p.abilityUsed = true;
    const a = c.BATTLE_ABILITIES[p.ability];
    log.push({ r, k: 'ab', a: p.uid, v: p.ability });
    if (a.type === 'burst') p.burst = a.mult;
    if (a.type === 'decoy') squad.decoy += 1;
    if (a.type === 'shield') squad.shield = { value: a.value, until: r + a.rounds - 1 };
    if (a.type === 'mark') { const t = strongest(); if (t) t.mark += a.value; }
    if (a.type === 'heal') { const t = weakestAlly(); if (t) heal(t, t.maxHp * a.value, p.uid); }
    if (a.type === 'atkBuff') squad.buffs.push({ value: a.value, until: r + a.rounds - 1 });
    if (a.type === 'haste') squad.hasteUntil = r + a.rounds - 1;
    if (a.type === 'cleanse') for (const u of alivePets()) { u.drain = 0; heal(u, u.maxHp * a.value, p.uid); }
    if (items.has('cache-warmer') && !used.includes('cache-warmer')) { useItem('cache-warmer'); refire = p; }
  }

  /** Gatilho "aliado abaixo de 50%": o primeiro pet com esse gatilho dispara. */
  function checkAllyLow() {
    if (!alivePets().some((u) => u.hp < u.maxHp * 0.5)) return;
    const p = pets.find((u) => u.alive && !u.abilityUsed && u.trigger === 'allyLow');
    if (p) useAbility(p);
  }

  function petAct(p) {
    if (p.role === 'support') {
      const t = weakestAlly();
      if (t && t.hp < t.maxHp * B.supportHealBelow) { heal(t, t.maxHp * B.supportHeal, p.uid); return; }
    }
    const foes = aliveEnemies();
    if (!foes.length) return;
    const t = foes.sort((a, b) => b.mark - a.mark || a.hp - b.hp)[0]; // marcado primeiro, depois o mais fraco
    if (has('evade', t) && rand() < c.TRAITS.evade.value) { log.push({ r, k: 'miss', a: p.uid, t: t.uid }); p.attacked = true; return; }
    const crit = (setup.firstCrit && !p.attacked) || rand() < B.critChance;
    p.attacked = true;
    const atk = p.atk * (1 - 0.1 * p.drain) * atkMult() * p.burst;
    p.burst = 1;
    const dmg = Math.max(1, Math.round(atk * 100 / (100 + t.def) * (1 + t.mark) * (crit ? B.critMult : 1)));
    t.hp -= dmg;
    log.push({ r, k: 'atk', a: p.uid, t: t.uid, v: dmg, c: crit || undefined });
    if (has('drain', t)) p.drain = Math.min(5, p.drain + 1);
    if (t.hp <= 0) {
      t.alive = false; t.hp = 0;
      log.push({ r, k: 'down', t: t.uid });
      if (has('split', t) && !t.child) {
        for (let i = 0; i < 2; i++) {
          const hp = Math.max(1, Math.round(t.maxHp * c.TRAITS.split.value));
          const kid = { ...t, uid: 'e' + nextEnemy++, hp, maxHp: hp, alive: true, energy: 0, mark: 0, child: true };
          enemies.push(kid); units.push(kid);
          log.push({ r, k: 'split', a: t.uid, t: kid.uid, v: hp });
        }
      }
    }
  }

  function enemyAct(e) {
    const targets = alivePets();
    if (!targets.length) return;
    const front = targets.filter((u) => u.front);
    const pool = front.length ? front : targets;
    const t = pool.sort((a, b) => (b.role === 'tank') - (a.role === 'tank') || a.hp - b.hp)[0]; // tanque segura a frente
    if (squad.decoy > 0) { squad.decoy -= 1; log.push({ r, k: 'decoy', a: e.uid, t: t.uid }); return; }
    const crit = rand() < B.critChance;
    const def = has('pierce', e) ? 0 : t.def;
    const swarm = e.traits.includes('swarm') && countered('swarm', setup.counters, c) ? c.TRAITS.swarm.value : 1;
    const shield = squad.shield && squad.shield.until >= r ? 1 - squad.shield.value : 1;
    const dmg = Math.max(1, Math.round(e.atk * swarm * 100 / (100 + def) * shield * (crit ? B.critMult : 1)));
    t.hp -= dmg;
    log.push({ r, k: 'atk', a: e.uid, t: t.uid, v: dmg, c: crit || undefined });
    if (t.hp <= 0) {
      t.hp = 0; t.alive = false;
      log.push({ r, k: 'down', t: t.uid });
      if (items.has('rollback')) { useItem('rollback'); t.alive = true; t.hp = Math.round(t.maxHp * c.BATTLE_ITEMS.rollback.value); log.push({ r, k: 'revive', t: t.uid, v: t.hp }); }
    }
    checkAllyLow();
  }

  let win = false;
  for (r = 1; r <= B.maxRounds; r++) {
    // Início da rodada: Cache Warmer, gatilhos, itens de início, fortificação.
    if (refire && refire.alive) { refire.abilityUsed = false; const p = refire; refire = null; useAbility(p); }
    for (const p of pets) if ((p.trigger === 'start' && r === 1) || (p.trigger === 'round3' && r === 3)) useAbility(p);
    if (r === 1) {
      if (items.has('coffee')) { useItem('coffee'); const k = c.BATTLE_ITEMS.coffee; squad.buffs.push({ value: k.value, until: r + k.rounds - 1 }); }
      if (items.has('hotfix')) {
        const t = strongest();
        if (t) {
          useItem('hotfix');
          const dmg = Math.round(Math.max(...pets.map((p) => p.atk)) * c.BATTLE_ITEMS.hotfix.mult);
          t.hp -= dmg;
          log.push({ r, k: 'atk', a: 'item', t: t.uid, v: dmg });
          if (t.hp <= 0) { t.hp = 0; t.alive = false; log.push({ r, k: 'down', t: t.uid }); }
        }
      }
    }
    for (const e of aliveEnemies()) if (has('fortify', e)) { e.def = e.baseDef * (1 + c.TRAITS.fortify.value * r); log.push({ r, k: 'fortify', t: e.uid, v: Math.round(e.def) }); }
    if (!aliveEnemies().length) { win = true; break; }

    // Ações por energia.
    for (const u of units) if (u.alive) u.energy += u.spd + (u.side === 'pet' && squad.hasteUntil >= r ? B.energyPerAction : 0);
    for (let guard = 0; guard < 200; guard++) {
      const next = units.filter((u) => u.alive && u.energy >= B.energyPerAction)
        .sort((a, b) => b.energy - a.energy || (a.side === 'pet' ? -1 : 1) - (b.side === 'pet' ? -1 : 1))[0];
      if (!next) break;
      next.energy -= B.energyPerAction;
      if (next.side === 'pet') petAct(next); else enemyAct(next);
      if (!aliveEnemies().length || !alivePets().length) break;
    }
    if (!aliveEnemies().length) { win = true; break; }
    if (!alivePets().length) break;
  }
  // Motivo do fim: vitória, esquadrão derrubado ou tempo esgotado (maxRounds sem derrubar os inimigos).
  const reason = win ? 'win' : alivePets().length ? 'timeout' : 'wiped';
  log.push({ r: Math.min(r, B.maxRounds), k: 'end', v: win ? 1 : 0, why: reason });
  return {
    win, reason, maxRounds: B.maxRounds, rounds: Math.min(r, B.maxRounds), log, usedItems: used,
    // hp: vida no início (a arena começa daí) · end: vida que sobrou (o mapa grava nos pets)
    units: units.map((u) => {
      const start = (setup.pets.find((x) => x.uid === u.uid) || setup.enemies.find((x) => x.uid === u.uid) || u).hp;
      return { uid: u.uid, side: u.side, id: u.id, name: u.name, hp: u.child ? u.maxHp : start, maxHp: u.maxHp, end: u.alive ? u.hp : 0, front: !!u.front, boss: !!u.boss, child: !!u.child };
    }),
  };
}

/**
 * Chance de vitória: a mesma preparação com previewRuns sementes.
 * → { chance, label, timeouts } (timeouts: fração das simulações perdidas por tempo esgotado — sinal de "falta dano")
 */
function preview(setup, seed, c = CONTENT) {
  const n = c.BATTLE.previewRuns;
  let wins = 0;
  let timeouts = 0;
  for (let i = 0; i < n; i++) {
    const r = resolve(setup, (seed + Math.imul(i + 1, 7919)) >>> 0, c);
    if (r.win) wins++;
    else if (r.reason === 'timeout') timeouts++;
  }
  const chance = wins / n;
  return { chance, label: chance >= c.BATTLE.chance.good ? 'favorável' : chance >= c.BATTLE.chance.risky ? 'arriscado' : 'muito arriscado', timeouts: timeouts / n };
}

module.exports = { petHp, petDown, msUntilHp, setPetHp, scaleAt, petStats, enemyStats, setupBattle, resolve, preview, patchBattle, countered };
