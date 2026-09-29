'use strict';
/**
 * Condições declarativas usadas por descobertas e upgrades.
 *   { always } · { lifetime:n } · { tier:n } · { owned:{gen,n} } · { discovery:id }
 *   { usage:{event, days} }   → evento ocorreu em N dias locais distintos
 *   { distinct:{event, n} }   → N ids distintos (ex.: ferramentas diferentes)
 *   { first:event }           → já aconteceu alguma vez
 *   { offlineHours:h }        → o último retorno foi após ≥ h horas fechado
 *   { maxPetLevel:n }         → algum DevPet no nível ≥ n
 *   { anyPetMaxed:true }      → algum DevPet no nível máximo da raridade
 *   { stationed:[petIds] }    → algum desses DevPets está em estação
 *   { all:[…] } · { any:[…] }
 */
const { CONTENT } = require('../content/index.js');

function check(cond, s) {
  if (!cond || cond.always) return true;
  if (cond.all) return cond.all.every((x) => check(x, s));
  if (cond.any) return cond.any.some((x) => check(x, s));
  if (cond.lifetime != null) return s.run.resources.compute.lifetime >= cond.lifetime;
  if (cond.tier != null) return s.run.tier >= cond.tier;
  if (cond.owned) return ((s.run.generators[cond.owned.gen] || {}).owned || 0) >= cond.owned.n;
  if (cond.discovery) return !!s.discoveries.found[cond.discovery];
  if (cond.usage) return (s.usage.days[cond.usage.event] || []).length >= cond.usage.days;
  if (cond.distinct) return (s.usage.distinct[cond.distinct.event] || []).length >= cond.distinct.n;
  if (cond.first) return !!s.usage.first[cond.first];
  if (cond.offlineHours != null) return (s.clock.lastOfflineMs || 0) >= cond.offlineHours * 3600e3;
  if (cond.maxPetLevel != null) return Object.values(s.run.pets).some((p) => p.level >= cond.maxPetLevel);
  if (cond.stationed) return cond.stationed.some((id) => s.run.pets[id] && s.run.pets[id].station);
  if (cond.anyPetMaxed) return Object.entries(s.run.pets).some(([id, p]) => CONTENT.pet[id] && p.level >= CONTENT.RARITY[CONTENT.pet[id].rarity].maxLevel);
  return false;
}

/** Dia local YYYY-MM-DD (dias distintos contam no fuso do usuário). */
function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { check, dayKey };
