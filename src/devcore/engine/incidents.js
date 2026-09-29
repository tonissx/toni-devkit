'use strict';
/**
 * Incidentes ("pets do mal") e consumíveis — regras puras.
 * Agendamento determinístico (seed + seq). Um incidente só começa/acaba dentro do advance (linha do tempo),
 * então o resultado é o mesmo com o app aberto ou fechado. Contenção é decidida no instante em que começa.
 */
const { CONTENT, stationedPets } = require('../content/index.js');
const { check } = require('./conditions.js');
const { rng } = require('./rng.js');
const { dropPart } = require('./blueprints.js');

const incidentsEnabled = (s, c = CONTENT) => !s.settings.quiet && s.run.tier >= c.BALANCE.incidents.minTier;
const randFor = (s, salt) => rng(((s.seed >>> 0) ^ Math.imul((salt >>> 0) + 1, 2654435761)) >>> 0);

/** Sorteia o próximo incidente (tipo por peso entre os liberados, horário e duração). */
function scheduleNext(s, after, c = CONTENT) {
  const I = s.run.incidents;
  if (!incidentsEnabled(s, c)) { I.next = null; return; }
  const B = c.BALANCE.incidents;
  const rand = randFor(s, I.seq);
  I.seq += 1;
  const pool = c.INCIDENTS.filter((i) => i.minTier <= s.run.tier);
  let r = rand() * pool.reduce((n, i) => n + i.weight, 0);
  const inc = pool.find((i) => (r -= i.weight) < 0) || pool[pool.length - 1];
  const hours = B.everyHours[0] + rand() * (B.everyHours[1] - B.everyHours[0]);
  const minutes = inc.durationMin[0] + rand() * (inc.durationMin[1] - inc.durationMin[0]);
  I.next = { id: inc.id, at: after + hours * 3600e3, durationMs: minutes * 60e3 };
}

/** Garante um próximo incidente agendado (ou nenhum, se desligado/antes do tier 2). */
function ensureScheduled(s, t, c = CONTENT) {
  const I = s.run.incidents;
  if (!incidentsEnabled(s, c)) { I.next = null; return; }
  if (!I.active && !I.next) scheduleNext(s, t, c);
}

/** +1 consumível sorteado entre os que não estão no teto (null se tudo cheio). */
function grantItem(s, rand, c = CONTENT) {
  const open = c.CONSUMABLES.filter((k) => (s.run.inventory[k.id] || 0) < k.cap);
  if (!open.length) return null;
  const k = open[Math.floor(rand() * open.length)];
  s.run.inventory[k.id] = (s.run.inventory[k.id] || 0) + 1;
  return k.id;
}

const bump = (s, villainId, field) => {
  const b = s.bestiary[villainId] || (s.bestiary[villainId] = { seen: 0, contained: 0, escaped: 0, defeated: 0 });
  b[field] += 1;
};

function startIncident(s, t, c, log) {
  const I = s.run.incidents;
  const n = I.next;
  const inc = c.incident[n.id];
  I.next = null;
  let by = null;
  if (s.run.shields > 0) { s.run.shields -= 1; by = 'rollback'; }
  else if (inc.counters && check(inc.counters, s)) by = stationedPets(inc.counters).find((id) => s.run.pets[id] && s.run.pets[id].station) || 'infra';
  const contained = !!by;
  I.active = { id: inc.id, start: t, end: t + (contained ? c.BALANCE.incidents.blockedSec * 1000 : n.durationMs), contained, by };
  bump(s, inc.villain.id, 'seen');
  log.push({ type: 'incidentStart', id: inc.id, villain: inc.villain.id, contained, by, at: t });
  if (contained) {
    bump(s, inc.villain.id, 'contained');
    const item = grantItem(s, randFor(s, I.seq * 7919 + Math.floor(t / 1000)), c);
    // Peça de Blueprint de um gerador da estação atacada (Zero: peça Mk III).
    const part = dropPart(s, randFor(s, I.seq * 104729 + Math.floor(t / 1000)), { category: inc.category, mk3: !!inc.villain.boss }, c);
    I.active.part = part.type === 'part' && !part.dup ? { gen: part.gen, mk: part.mk, name: part.name } : { scrap: true, gen: part.gen };
    log.push({ type: 'contained', id: inc.id, villain: inc.villain.id, by, item, part, at: t });
    log.push({ ...part, source: 'incident', at: t });
  }
}

/** Encerra o incidente ativo (outcome: contained | escaped | hotfixed | cancelled) e agenda o próximo. */
function endIncident(s, t, c, log, outcome) {
  const I = s.run.incidents;
  const a = I.active;
  const inc = c.incident[a.id];
  const out = outcome || (a.contained ? 'contained' : 'escaped');
  if (out === 'escaped') bump(s, inc.villain.id, 'escaped');
  if (out === 'hotfixed') {
    bump(s, inc.villain.id, 'defeated');
    if (inc.villain.boss) {
      const part = dropPart(s, randFor(s, I.seq * 15485863 + Math.floor(t / 1000)), { mk3: true }, c);
      a.part = part.type === 'part' && !part.dup ? { gen: part.gen, mk: part.mk, name: part.name } : { scrap: true, gen: part.gen };
      log.push({ ...part, source: 'boss', at: t });
    }
  }
  I.history = [{ id: a.id, villain: inc.villain.id, start: a.start, end: t, outcome: out, by: a.by, part: a.part || null }, ...I.history].slice(0, 10);
  I.active = null;
  log.push({ type: 'incidentEnd', id: a.id, villain: inc.villain.id, outcome: out, at: t });
  if (out !== 'cancelled') scheduleNext(s, t, c);
}

/** Aplica os eventos de incidente que vencem até `t` (fim do ativo, início do próximo). */
function processDue(s, t, c, log) {
  for (let guard = 0; guard < 100; guard++) {
    const I = s.run.incidents;
    if (I.active && I.active.end <= t) { endIncident(s, I.active.end, c, log); continue; }
    if (!I.active && I.next && I.next.at <= t) { startIncident(s, I.next.at, c, log); continue; }
    break;
  }
}

/** Efeitos no instante t: incidente ativo não contido + boosts (Coffee). */
function incidentEffects(s, t, c = CONTENT) {
  const out = [];
  const a = s.run.incidents.active;
  if (a && !a.contained && a.start <= t && t < a.end) for (const e of c.incident[a.id].effects) out.push({ ...e, source: 'incident:' + a.id });
  for (const b of s.run.boosts) if (b.until > t) out.push({ type: 'mul', target: b.target, value: b.mult, source: 'boost:' + b.id });
  return out;
}

/** Habilidades travadas por um incidente (Merge Conflict não contido)? */
function abilitiesLocked(s, t, c = CONTENT) {
  const a = s.run.incidents.active;
  return !!(a && !a.contained && a.start <= t && t < a.end && c.incident[a.id].lockAbilities);
}

module.exports = {
  incidentsEnabled, scheduleNext, ensureScheduled, grantItem, startIncident, endIncident, processDue,
  incidentEffects, abilitiesLocked, randFor,
};
