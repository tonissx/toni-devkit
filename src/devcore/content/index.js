'use strict';
// Conteúdo do DevCore reunido + validação de ids/referências (roda nos testes).

const BALANCE = require('./balance.js');
const { RESOURCES, CATEGORIES, TIERS } = require('./world.js');
const { GENERATORS } = require('./generators.js');
const { UPGRADES } = require('./upgrades.js');
const { PETS, RARITY } = require('./pets.js');
const { ABILITIES } = require('./abilities.js');
const { SYNERGIES } = require('./synergies.js');
const { DISCOVERIES } = require('./discoveries.js');
const { STAGES, SKINS } = require('./appearance.js');
const { INCIDENTS } = require('./incidents.js');
const { CONSUMABLES } = require('./consumables.js');
const { BLUEPRINTS } = require('./blueprints.js');
const { QUESTS } = require('./quests.js');
const { ROLES, PET_ROLES, BATTLE, TRIGGERS, BATTLE_ABILITIES, BATTLE_ITEMS, TRAITS, BATTLE_TIMEOUT_LORE } = require('./battle.js');
const { ENEMIES } = require('./enemies.js');
const { AREAS, NODE_TYPES } = require('./areas.js');
const { PATCHES, RARITIES } = require('./patches.js');
const { EVENTS, REST_OPTIONS, SHOP, BATTLE_REWARDS } = require('./events.js');

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

const CONTENT = {
  BALANCE, RESOURCES, CATEGORIES, TIERS, GENERATORS, UPGRADES, PETS, RARITY, ABILITIES, SYNERGIES, DISCOVERIES, STAGES, SKINS,
  INCIDENTS, CONSUMABLES, BLUEPRINTS, QUESTS,
  // Mapa e batalhas (docs/devcore-mapa-singularity.md)
  ROLES, PET_ROLES, BATTLE, TRIGGERS, BATTLE_ABILITIES, BATTLE_ITEMS, TRAITS, BATTLE_TIMEOUT_LORE, ENEMIES, AREAS, NODE_TYPES, PATCHES, RARITIES,
  EVENTS, REST_OPTIONS, SHOP, BATTLE_REWARDS,
  enemy: byId(ENEMIES), area: byId(AREAS), patch: byId(PATCHES), event: byId(EVENTS),
  quest: byId(QUESTS),
  gen: byId(GENERATORS), upgrade: byId(UPGRADES), pet: byId(PETS), ability: byId(ABILITIES),
  category: byId(CATEGORIES), discovery: byId(DISCOVERIES), synergy: byId(SYNERGIES), skin: byId(SKINS),
  incident: byId(INCIDENTS), consumable: byId(CONSUMABLES),
  blueprint: Object.fromEntries(BLUEPRINTS.map((b) => [b.gen, b])),
};

/** Pets citados em condições { stationed:[…] } (percorre all/any). */
function stationedPets(cond) {
  if (!cond) return [];
  return [...(cond.stationed || []), ...(cond.all || []).flatMap(stationedPets), ...(cond.any || []).flatMap(stationedPets)];
}

/** Lista de problemas no conteúdo (vazia = ok). */
function validate(c = CONTENT) {
  const errors = [];
  const uniq = (name, list) => {
    const seen = new Set();
    for (const x of list) { if (seen.has(x.id)) errors.push(`${name}: id duplicado ${x.id}`); seen.add(x.id); }
  };
  uniq('generators', c.GENERATORS); uniq('upgrades', c.UPGRADES); uniq('pets', c.PETS);
  uniq('abilities', c.ABILITIES); uniq('synergies', c.SYNERGIES); uniq('discoveries', c.DISCOVERIES); uniq('skins', c.SKINS);
  const checkTarget = (where, t) => {
    const [kind, id] = String(t).split(':');
    if (kind === 'gen' && !c.gen[id]) errors.push(`${where}: gerador inexistente ${id}`);
    if (kind === 'cat' && !c.category[id]) errors.push(`${where}: categoria inexistente ${id}`);
  };
  for (const g of c.GENERATORS) if (!c.category[g.category]) errors.push(`gen ${g.id}: categoria ${g.category}`);
  for (const u of c.UPGRADES) for (const e of u.effects) {
    if (e.target) checkTarget('upgrade ' + u.id, e.target);
    if (e.type === 'per') {
      if (!c.gen[e.gen]) errors.push(`upgrade ${u.id}: combo com gerador inexistente ${e.gen}`);
      if (!String(e.target).startsWith('gen:') || e.target === 'gen:' + e.gen) errors.push(`upgrade ${u.id}: combo deve mirar outro gerador`);
      if (!(e.per > 0) || !(e.value > 0)) errors.push(`upgrade ${u.id}: combo com per/value inválidos`);
    }
  }
  for (const p of c.PETS) {
    if (!c.ability[p.ability]) errors.push(`pet ${p.id}: habilidade ${p.ability}`);
    if (!c.RARITY[p.rarity]) errors.push(`pet ${p.id}: raridade ${p.rarity}`);
    for (const e of p.bonus) checkTarget('pet ' + p.id, e.target);
  }
  for (const s of c.SYNERGIES) {
    for (const g of s.requires.gens || []) if (!c.gen[g]) errors.push(`synergy ${s.id}: gerador ${g}`);
    for (const p of s.requires.pets || []) if (!c.pet[p]) errors.push(`synergy ${s.id}: pet ${p}`);
  }
  if (!c.skin.default) errors.push('skins: falta o visual default');
  for (const k of c.SKINS) {
    if (k.unlock.discovery && !c.discovery[k.unlock.discovery]) errors.push(`skin ${k.id}: descoberta ${k.unlock.discovery}`);
    for (const v of Object.values(k.colors)) if (!/^#[0-9a-fA-F]{6}$/.test(v)) errors.push(`skin ${k.id}: cor inválida ${v}`);
    if (k.pet && !c.pet[k.pet]) errors.push(`skin ${k.id}: pet ${k.pet}`);
    if (k.unlock.petQuests && !c.QUESTS.some((x) => x.pet === k.unlock.petQuests.pet)) errors.push(`skin ${k.id}: nenhuma missão do pet ${k.unlock.petQuests.pet}`);
  }
  uniq('quests', c.QUESTS);
  if (c.BALANCE.quests.perDay > c.QUESTS.length) errors.push('quests: perDay maior que o pool');
  for (const x of c.QUESTS) {
    if (!x.when || !x.when.event) errors.push(`quest ${x.id}: falta when.event`);
    if (x.pet && !c.pet[x.pet]) errors.push(`quest ${x.id}: pet ${x.pet}`);
  }
  if (c.STAGES[0].minLevel !== 1) errors.push('stages: o primeiro estágio deve começar no nível 1');
  uniq('incidents', c.INCIDENTS); uniq('consumables', c.CONSUMABLES); uniq('villains', c.INCIDENTS.map((i) => i.villain));
  for (const i of c.INCIDENTS) {
    if (i.category && !c.category[i.category]) errors.push(`incident ${i.id}: categoria ${i.category}`);
    for (const e of i.effects) {
      checkTarget('incident ' + i.id, e.target);
      if (e.type !== 'mul' || e.value < c.BALANCE.incidents.lossFloor || e.value >= 1) errors.push(`incident ${i.id}: efeito deve ser mul entre o piso e 1`);
    }
    const v = i.villain;
    if (!v || !v.name || !/^#[0-9a-fA-F]{6}$/.test(v.color) || !['active', 'blocked', 'defeated'].every((k) => (v.lines[k] || []).length)) errors.push(`incident ${i.id}: vilão incompleto`);
    for (const id of stationedPets(i.counters)) if (!c.pet[id]) errors.push(`incident ${i.id}: pet ${id}`);
  }
  for (const k of c.CONSUMABLES) if (!(k.cap > 0) || !(k.craftMinutes > 0)) errors.push(`consumable ${k.id}: cap/craftMinutes`);
  for (const g of c.GENERATORS) if (!c.blueprint[g.id]) errors.push(`blueprint: falta o gerador ${g.id}`);
  for (const b of c.BLUEPRINTS) {
    if (!c.gen[b.gen]) errors.push(`blueprint: gerador inexistente ${b.gen}`);
    b.levels.forEach((l, i) => {
      if (l.mk !== i + 2) errors.push(`blueprint ${b.gen}: níveis devem ser Mk II, Mk III…`);
      if (l.parts.length !== 4 || new Set(l.parts).size !== 4) errors.push(`blueprint ${b.gen} mk${l.mk}: 4 peças distintas`);
      if (!(l.mult > 1) || !(l.costDiv >= 1)) errors.push(`blueprint ${b.gen} mk${l.mk}: mult > 1 e costDiv ≥ 1`);
    });
  }
  // Mapa e batalhas
  for (const p of c.PETS) {
    if (!c.ROLES[c.PET_ROLES[p.id]]) errors.push(`battle: pet ${p.id} sem papel`);
    if (!c.BATTLE_ABILITIES[p.ability]) errors.push(`battle: habilidade ${p.ability} sem versão de batalha`);
  }
  for (const id of Object.keys(c.BATTLE_ITEMS)) if (!c.consumable[id]) errors.push(`battle: item ${id} inexistente`);
  uniq('enemies', c.ENEMIES); uniq('patches', c.PATCHES); uniq('events', c.EVENTS); uniq('areas', c.AREAS);
  for (const e of c.ENEMIES) for (const t of e.traits) if (!c.TRAITS[t]) errors.push(`enemy ${e.id}: traço ${t}`);
  for (const a of c.AREAS) {
    if (!a.scale || !(a.scale.linear >= 0) || !(a.scale.quad >= 0) || !(a.scale.eliteMult >= 1)) errors.push(`area ${a.id}: scale`);
    if (a.costs.length !== a.columns + 1) errors.push(`area ${a.id}: costs precisa de ${a.columns + 1} valores (colunas + chefe)`);
    if (!c.enemy[a.boss] || !c.enemy[a.boss].boss) errors.push(`area ${a.id}: chefe ${a.boss}`);
    for (const [kind, groups] of Object.entries(a.groups)) for (const g of groups) for (const id of g) if (!c.enemy[id]) errors.push(`area ${a.id}: inimigo ${id} (${kind})`);
    for (const types of Object.values(a.fixed)) for (const t of types) if (!c.NODE_TYPES[t]) errors.push(`area ${a.id}: tipo ${t}`);
  }
  for (const p of c.PATCHES) {
    if (!c.RARITIES[p.rarity]) errors.push(`patch ${p.id}: raridade ${p.rarity}`);
    for (const e of p.effects || []) if (e.target) checkTarget('patch ' + p.id, e.target);
  }
  for (const ev of c.EVENTS) if (!ev.choices.length) errors.push(`event ${ev.id}: sem escolhas`);
  for (const d of c.DISCOVERIES) {
    for (const r of d.rewards) if (r.pet && !c.pet[r.pet]) errors.push(`discovery ${d.id}: pet ${r.pet}`);
    if (d.finder && !c.pet[d.finder]) errors.push(`discovery ${d.id}: finder ${d.finder}`);
  }
  return errors;
}

module.exports = { CONTENT, validate, stationedPets };
