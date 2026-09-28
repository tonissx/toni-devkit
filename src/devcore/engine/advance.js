'use strict';
/**
 * Avanço no tempo — sem ticks. Entre dois eventos a taxa é constante, então o ganho é taxa × Δt.
 * O intervalo é dividido nos instantes em que alguma habilidade termina (a taxa muda ali).
 *
 * online:  sem teto (o app estava aberto, mesmo minimizado ou na bandeja)
 * offline: com teto de horas (balance.offlineCapHours + upgrades 'offlineCap')
 * relógio para trás: nada é ganho e lastUpdate não regride.
 */
const { CONTENT } = require('../content/index.js');
const { production, aggregate, sumAdd, upgradeEffects } = require('./production.js');

const offlineCapMs = (s, c = CONTENT) => (c.BALANCE.offlineCapHours + sumAdd(aggregate(upgradeEffects(s, c)), 'offlineCap')) * 3600e3;

/** Quanto seria produzido de `from` a `to` (sem alterar o estado). */
function produced(s, from, to, c = CONTENT) {
  if (!(to > from)) return 0;
  const cuts = Object.values(s.run.abilities).map((a) => a.activeUntil).filter((t) => t > from && t < to).sort((a, b) => a - b);
  let total = 0, t = from;
  for (const cut of [...cuts, to]) {
    total += production(s, t, c).rate * (cut - t) / 1000;
    t = cut;
  }
  return total;
}

/**
 * Avança o estado (mutável — use numa cópia) até `now`.
 * Retorna { gained, elapsedMs, countedMs } (countedMs < elapsedMs quando o teto offline corta).
 */
function advanceTo(s, now, { offline = false } = {}, c = CONTENT) {
  const from = s.clock.lastUpdate;
  if (!(now > from)) return { gained: 0, elapsedMs: 0, countedMs: 0 };
  const elapsedMs = now - from;
  const countedMs = offline ? Math.min(elapsedMs, offlineCapMs(s, c)) : elapsedMs;
  const gained = produced(s, from, from + countedMs, c);
  const res = s.run.resources.compute;
  res.amount += gained;
  res.lifetime += gained;
  s.clock.lastUpdate = now;
  if (offline) s.clock.lastOfflineMs = elapsedMs;
  return { gained, elapsedMs, countedMs };
}

module.exports = { advanceTo, produced, offlineCapMs };
