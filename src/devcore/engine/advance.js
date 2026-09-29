'use strict';
/**
 * Avanço no tempo — sem ticks. Entre dois eventos a taxa é constante, então o ganho é taxa × Δt.
 * O intervalo é percorrido como uma linha do tempo: fim de habilidade, fim de boost (Coffee),
 * início/fim de incidente. Cada evento muda a taxa (ou o estado) naquele instante exato.
 *
 * online:  sem teto (o app estava aberto, mesmo minimizado ou na bandeja)
 * offline: produção com teto de horas (balance.offlineCapHours + upgrades 'offlineCap');
 *          incidentes seguem acontecendo até `now` (suas defesas agem por você)
 * relógio para trás: nada é ganho e lastUpdate não regride.
 */
const { CONTENT } = require('../content/index.js');
const { production, aggregate, sumAdd, upgradeEffects } = require('./production.js');
const { ensureScheduled, processDue } = require('./incidents.js');

const offlineCapMs = (s, c = CONTENT) => (c.BALANCE.offlineCapHours + sumAdd(aggregate(upgradeEffects(s, c)), 'offlineCap')) * 3600e3;

/** Próximo instante (> t) em que algo muda a taxa ou o estado. */
function nextCut(s, t, limit) {
  let n = limit;
  const consider = (x) => { if (x > t && x < n) n = x; };
  for (const a of Object.values(s.run.abilities)) consider(a.activeUntil);
  for (const b of s.run.boosts) consider(b.until);
  const I = s.run.incidents;
  if (I.active) consider(I.active.end);
  else if (I.next) consider(I.next.at);
  return n;
}

/**
 * Avança o estado (mutável — use numa cópia) até `now`.
 * Retorna { gained, elapsedMs, countedMs, log } (countedMs < elapsedMs quando o teto offline corta).
 */
function advanceTo(s, now, { offline = false } = {}, c = CONTENT) {
  const from = s.clock.lastUpdate;
  const log = [];
  if (!(now > from)) return { gained: 0, elapsedMs: 0, countedMs: 0, log };
  const elapsedMs = now - from;
  const countedMs = offline ? Math.min(elapsedMs, offlineCapMs(s, c)) : elapsedMs;
  const capEnd = from + countedMs;
  let t = from;
  let gained = 0;
  ensureScheduled(s, t, c);
  for (let guard = 0; guard < 100000; guard++) {
    processDue(s, t, c, log);
    if (t >= now) break;
    const n = nextCut(s, t, now);
    const segEnd = Math.min(n, capEnd);
    if (segEnd > t) gained += production(s, t, c).rate * (segEnd - t) / 1000;
    t = n;
  }
  const res = s.run.resources.compute;
  res.amount += gained;
  res.lifetime += gained;
  s.clock.lastUpdate = now;
  if (offline) s.clock.lastOfflineMs = elapsedMs;
  return { gained, elapsedMs, countedMs, log };
}

/** Quanto seria produzido de `from` a `to`, sem alterar o estado (inclui incidentes e boosts). */
function produced(s, from, to, c = CONTENT) {
  if (!(to > from)) return 0;
  const copy = structuredClone(s);
  copy.clock.lastUpdate = from;
  return advanceTo(copy, to, { offline: false }, c).gained;
}

module.exports = { advanceTo, produced, offlineCapMs };
