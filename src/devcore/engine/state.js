'use strict';
/**
 * Estado do DevCore: um único objeto serializável, com seções separadas.
 *   run          → a infraestrutura atual (o que um futuro "Rebuild" zeraria)
 *   meta         → progressão permanente (prestige; vazio no MVP)
 *   usage        → fatos de uso do DevKit (dias/ids distintos) — nunca resetam
 *   discoveries  → descobertas feitas e ainda não vistas
 *   pending      → resumo de retorno aguardando ser mostrado
 *   cosmetics    → visuais dos DevPets (escolhidos/desbloqueados) — nunca resetam
 *   bestiary     → vilões encontrados (visto/contido/escapou/derrotado) — nunca reseta
 *   quests       → missões diárias (do dia + contadores vitalícios) — só cosméticos/consumíveis
 *   settings     → preferências do jogo (modo tranquilo)
 */
const { CONTENT } = require('../content/index.js');

const VERSION = 1;

function createState(now, c = CONTENT) {
  const B = c.BALANCE;
  const s = {
    version: VERSION,
    seed: (Math.floor(now) % 2147483646) + 1,
    clock: { lastUpdate: now, startedAt: now, lastOfflineMs: 0 },
    run: {
      resources: { compute: { amount: B.start.compute, lifetime: 0 } },
      generators: {},
      upgrades: {},
      tier: 1,
      pets: {},
      abilities: {},
      incidents: { seq: 0, next: null, active: null, history: [] },
      inventory: {},
      boosts: [],
      shields: 0,
      blueprints: {},  // { [gen]: { mk, parts: { [partId]: true } } } — sem entrada = Mk I
      scrap: 0,
      // Mapa e batalhas (docs/devcore-mapa-singularity.md): o mapa nasce no Tier 2 (engine/map.js ensureMap).
      map: null,
      patches: [],        // Patches da run (recompensas do mapa)
      squad: { slots: { vanguard: null, center: null, rear: null }, pets: [], front: [], triggers: {}, items: [], node: null },  // última preparação (e o ponto da previsão)
      battleBuff: null,   // { atk } para a próxima batalha (evento/descanso)
    },
    meta: { fragments: 0, rebuilds: 0, perks: {} },
    usage: { days: {}, distinct: {}, first: {} },
    discoveries: { found: {}, unseen: [], seenUpgrades: [] },
    pending: { welcome: null },
    cosmetics: { skins: {}, unlocked: ['default'], fresh: [] },
    bestiary: {},
    arena: { wins: 0, losses: 0, defeated: {}, areas: {} },  // estatísticas de batalha — nunca zeram
    quests: { day: '', ids: [], done: [], seen: {}, total: 0, byPet: {} }, // missões diárias — o contador nunca reseta
    settings: { quiet: false },
  };
  for (const [id, owned] of Object.entries(B.start.generators)) s.run.generators[id] = { owned };
  for (const id of B.start.pets) s.run.pets[id] = { level: 1, station: false };
  return s;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Completa chaves ausentes com os padrões (sem sobrescrever o que existe). */
function fill(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target)) target[k] = structuredClone(v);
    else if (isObj(v) && isObj(target[k])) fill(target[k], v);
  }
  return target;
}

/**
 * Carrega um estado salvo: aceita versões antigas (migrações por versão) e arquivos incompletos.
 * Estado ilegível → estado novo.
 */
function migrate(raw, now, c = CONTENT) {
  if (!isObj(raw) || !isObj(raw.run)) return createState(now, c);
  const s = structuredClone(raw);
  // (migrações futuras: if (s.version < 2) { … s.version = 2 })
  fill(s, createState(s.clock && s.clock.startedAt ? s.clock.startedAt : now, c));
  s.version = VERSION;
  if (!Number.isFinite(s.run.resources.compute.amount)) s.run.resources.compute.amount = 0;
  return s;
}

module.exports = { VERSION, createState, migrate };
