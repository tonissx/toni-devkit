'use strict';
/**
 * Missões diárias: 3 por dia local, sorteadas de forma determinística (seed + dia).
 * Progresso = eventos do DevKit do dia (s.quests.seen). Concluir soma ao contador vitalício
 * (skins por marco, Condition questsDone/petQuests) e pode render um consumível.
 * Nunca mexe na produção. Trocar de dia só troca as missões — nada se perde.
 */
const { CONTENT } = require('../content/index.js');
const { dayKey } = require('./conditions.js');
const { rng } = require('./rng.js');
const { grantItem } = require('./incidents.js');

const MAX_KEYS = 20;

/** Hash simples de string → inteiro (para semear o sorteio do dia). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Garante que as missões do estado sejam as do dia de `now`. */
function roll(s, now, c = CONTENT) {
  const q = s.quests;
  const day = dayKey(now);
  if (q.day === day) return;
  const rand = rng((s.seed ^ hash(day)) >>> 0);
  const pool = c.QUESTS.map((x) => x.id);
  const ids = [];
  while (ids.length < Math.min(c.BALANCE.quests.perDay, pool.length)) ids.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  q.day = day; q.ids = ids; q.done = []; q.seen = {};
}

/** Registra um evento do DevKit no progresso do dia (mesmas chaves de discoveries.recordEvent). */
function record(s, name, data, now, c = CONTENT) {
  roll(s, now, c);
  const key = data && (data.tool || data.id);
  const safeKey = typeof key === 'string' && /^[\w.:-]{1,40}$/.test(key) ? key : null;
  for (const n of safeKey ? [name, name + ':' + safeKey] : [name]) {
    const keys = s.quests.seen[n] || (s.quests.seen[n] = []);
    const k = safeKey || '*';
    if (!keys.includes(k) && keys.length < MAX_KEYS) keys.push(k);
  }
}

const progressOf = (q, d) => Math.min(d.when.distinct || 1, (q.seen[d.when.event] || []).length);

/** Conclui missões prontas. Retorna o log ({ type:'quest', id, title, pet, item }). */
function evaluateQuests(s, now, c = CONTENT) {
  roll(s, now, c);
  const q = s.quests;
  const log = [];
  for (const id of q.ids) {
    const d = c.quest[id];
    if (!d || q.done.includes(id) || progressOf(q, d) < (d.when.distinct || 1)) continue;
    q.done.push(id);
    q.total += 1;
    if (d.pet) q.byPet[d.pet] = (q.byPet[d.pet] || 0) + 1;
    const rand = rng((s.seed ^ hash(q.day) ^ hash(id)) >>> 0);
    const item = rand() < c.BALANCE.quests.itemChance ? grantItem(s, rand, c) : null; // estoque cheio → só o contador
    log.push({ type: 'quest', id, title: d.title, pet: d.pet || null, item });
  }
  return log;
}

/** Visão para a UI: missões do dia + próximo visual por marco. */
function questsView(s, c = CONTENT) {
  const q = s.quests;
  const nextSkin = c.SKINS.filter((k) => k.unlock.questsDone != null && !s.cosmetics.unlocked.includes(k.id))
    .sort((a, b) => a.unlock.questsDone - b.unlock.questsDone)[0];
  return {
    day: q.day, total: q.total,
    items: q.ids.filter((id) => c.quest[id]).map((id) => {
      const d = c.quest[id];
      return {
        id, title: d.title, text: d.text, pet: d.pet ? (c.pet[d.pet] || { name: d.pet }).name : null,
        done: q.done.includes(id), progress: progressOf(q, d), need: d.when.distinct || 1,
      };
    }),
    nextSkin: nextSkin ? { name: nextSkin.name, at: nextSkin.unlock.questsDone, left: Math.max(0, nextSkin.unlock.questsDone - q.total) } : null,
  };
}

module.exports = { roll, record, evaluateQuests, questsView };
