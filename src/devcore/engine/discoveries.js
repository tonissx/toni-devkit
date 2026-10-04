'use strict';
/**
 * Fatos de uso do DevKit e descobertas.
 * Anti-abuso por construção: cada evento conta no máximo 1 vez por DIA local (days) e por ID
 * distinto (distinct). 100 notas num dia = 1 dia. Eventos nunca geram Compute — só desbloqueios.
 */
const { CONTENT } = require('../content/index.js');
const { check, dayKey } = require('./conditions.js');
const { petStartLevel } = require('./legacy.js');

const KEEP_DAYS = 60;
const KEEP_IDS = 50;

/** Registra um evento do DevKit (name + chave opcional, ex.: tool.used:sql). */
function recordEvent(s, name, data, now) {
  const key = data && (data.tool || data.id);
  const safeKey = typeof key === 'string' && /^[\w.:-]{1,40}$/.test(key) ? key : null;
  const names = safeKey ? [name, name + ':' + safeKey] : [name];
  const day = dayKey(now);
  for (const n of names) {
    const days = s.usage.days[n] || (s.usage.days[n] = []);
    if (!days.includes(day)) { days.push(day); if (days.length > KEEP_DAYS) days.shift(); }
    if (!s.usage.first[n]) s.usage.first[n] = now;
  }
  if (safeKey) {
    const ids = s.usage.distinct[name] || (s.usage.distinct[name] = []);
    if (!ids.includes(safeKey) && ids.length < KEEP_IDS) ids.push(safeKey);
  }
}

/** Recompensas da run (pet, tier) de uma descoberta. Retorna se algo mudou. */
function grantRunRewards(s, d, c, log) {
  let changed = false;
  for (const r of d.rewards) {
    if (r.pet && !s.run.pets[r.pet]) { s.run.pets[r.pet] = { level: petStartLevel(s, r.pet, c), station: false }; changed = true; }
    if (r.tier && r.tier > s.run.tier) { s.run.tier = r.tier; log.push({ type: 'tier', tier: r.tier }); changed = true; }
  }
  return changed;
}

/**
 * Aplica descobertas cujas condições passaram. Retorna o log ({ type:'discovery', id, … }).
 * Descobertas já feitas devolvem suas recompensas de run quando a condição volta a valer (depois de
 * um Rebuild: tiers pelo Compute da run nova, DevPets já encontrados) — sem anunciar de novo.
 */
function evaluate(s, now, c = CONTENT) {
  const log = [];
  for (let round = 0; round < 5; round++) { // recompensas podem liberar outras (ex.: tier → condição de tier)
    let changed = false;
    for (const d of c.DISCOVERIES) {
      if (!check(d.when, s)) continue;
      if (s.discoveries.found[d.id]) { if (grantRunRewards(s, d, c, log)) changed = true; continue; }
      s.discoveries.found[d.id] = now;
      s.discoveries.unseen.push(d.id);
      grantRunRewards(s, d, c, log);
      log.push({ type: 'discovery', id: d.id, title: d.title, finder: d.finder, pets: d.rewards.filter((r) => r.pet).map((r) => r.pet) });
      changed = true;
    }
    if (!changed) break;
  }
  return log;
}

module.exports = { recordEvent, evaluate };
