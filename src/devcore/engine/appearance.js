'use strict';
/**
 * Aparência dos DevPets: estágio (derivado do nível) e visuais (paletas desbloqueáveis).
 * Visuais desbloqueados ficam em cosmetics.unlocked para sempre (não dependem mais da condição).
 */
const { CONTENT } = require('../content/index.js');
const { check } = require('./conditions.js');

/** Estágio de evolução para um nível: { id, name, minLevel }. */
function stageOf(level, c = CONTENT) {
  let st = c.STAGES[0];
  for (const x of c.STAGES) if (level >= x.minLevel) st = x;
  return st;
}

/** Próximo estágio (ou null). */
const nextStageOf = (level, c = CONTENT) => c.STAGES.find((x) => x.minLevel > level) || null;

/** Libera visuais cujas condições passaram. Retorna o log ({ type:'skin', id }). */
function evaluateSkins(s, c = CONTENT) {
  const log = [];
  for (const k of c.SKINS) {
    if (s.cosmetics.unlocked.includes(k.id) || !check(k.unlock, s)) continue;
    s.cosmetics.unlocked.push(k.id);
    s.cosmetics.fresh.push(k.id);
    log.push({ type: 'skin', id: k.id, name: k.name });
  }
  return log;
}

/** Visual em uso por um pet (cai para o original se o id sumiu do conteúdo). */
function skinOf(s, petId, c = CONTENT) {
  const id = s.cosmetics.skins[petId];
  return c.skin[id] || c.skin.default;
}

module.exports = { stageOf, nextStageOf, evaluateSkins, skinOf };
