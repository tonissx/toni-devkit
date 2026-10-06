'use strict';
/**
 * Patches da run (recompensas do mapa): efeitos no sistema de modificadores (como os upgrades) e multiplicadores de
 * regra (mods). Os de batalha ficam em engine/battle.js (patchBattle).
 */
const { CONTENT } = require('../content/index.js');

const owned = (s, c = CONTENT) => (s.run.patches || []).map((id) => c.patch[id]).filter(Boolean);

/** Efeitos de produção dos Patches (source 'patch:<id>'). */
function patchEffects(s, c = CONTENT) {
  const out = [];
  for (const p of owned(s, c)) for (const e of p.effects || []) out.push({ ...e, source: 'patch:' + p.id });
  return out;
}

/** Produto de um multiplicador de regra dos Patches (1 se nenhum): abilityDuration, trainCost. */
function patchMod(s, key, c = CONTENT) {
  let m = 1;
  for (const p of owned(s, c)) if (p.mods && p.mods[key] != null) m *= p.mods[key];
  return m;
}

module.exports = { patchEffects, patchMod };
