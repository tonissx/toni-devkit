'use strict';
/**
 * Estado do DevCore: um único objeto serializável, com seções separadas.
 *   run          → a run atual (zerada pela Singularity — engine/singularity.js)
 *   meta         → progressão permanente: Insight e a Rede da Singularity — nunca zera
 *   usage        → fatos de uso do DevKit (dias/ids distintos) — nunca resetam
 *   discoveries  → descobertas feitas e ainda não vistas
 *   pending      → resumo de retorno aguardando ser mostrado
 *   cosmetics    → visuais dos DevPets (escolhidos/desbloqueados) — nunca resetam
 *   bestiary     → vilões encontrados (visto/contido/escapou/derrotado) — nunca reseta
 *   quests       → missões diárias (do dia + contadores vitalícios) — só cosméticos/consumíveis
 *   settings     → preferências do jogo (modo tranquilo)
 */
const { CONTENT } = require('../content/index.js');

// 2: grande atualização (mapa, batalhas e Singularity). Saves da versão 1 zeram o farm e ganham o pacote Fundador.
const VERSION = 2;

function createState(now, c = CONTENT) {
  const s = {
    version: VERSION,
    seed: (Math.floor(now) % 2147483646) + 1,
    clock: { lastUpdate: now, startedAt: now, lastOfflineMs: 0 },
    run: createRun(c, 0, now),
    // Singularity (prestígio — engine/singularity.js): insight não gasto, ganho na vida, árvore { id: nível }, janela
    // de reorganização, Compute de runs passadas. (fragments/rebuilds/perks: do Legado guardado, sem uso.)
    meta: { founder: false, fragments: 0, rebuilds: 0, perks: {}, insight: 0, earned: 0, singularities: 0, tree: {}, respec: false, plan: null, fresh: {}, lifetime: 0, best: 0, lastAt: 0 },
    usage: { days: {}, distinct: {}, first: {} },
    discoveries: { found: {}, unseen: [], seenUpgrades: [] },
    pending: { welcome: null, founder: null },
    cosmetics: { skins: {}, unlocked: ['default'], fresh: [] },
    bestiary: {},
    arena: { wins: 0, losses: 0, defeated: {}, areas: {} },  // estatísticas de batalha — nunca zeram
    quests: { day: '', ids: [], done: [], seen: {}, total: 0, byPet: {} }, // missões diárias — o contador nunca reseta
    settings: { quiet: false },
  };
  return s;
}

/** Uma run nova (início do jogo ou Singularity). `seq` mantém a sequência de incidentes entre runs. */
function createRun(c = CONTENT, seq = 0, now = 0) {
  const B = c.BALANCE;
  const run = {
    resources: { compute: { amount: B.start.compute, lifetime: 0 } },
    generators: {},
    upgrades: {},
    tier: 1,
    pets: {},
    abilities: {},
    incidents: { seq, next: null, active: null, history: [] },
    inventory: {},
    boosts: [],
    shields: 0,
    blueprints: {},  // { [gen]: { mk, parts: { [partId]: true } } } — sem entrada = Mk I
    scrap: 0,
    // Mapa e batalhas (docs/devcore-mapa-singularity.md): o mapa nasce no Tier 2 (engine/map.js ensureMap).
    map: null,
    patches: [],        // Patches da run (recompensas do mapa)
    squad: { slots: { vanguard: null, center: null, rear: null }, pets: [], front: [], triggers: {}, items: [], reserve: null, node: null },  // última preparação (e o ponto da previsão)
    battleBuff: null,   // { atk } para a próxima batalha (evento/descanso)
    stats: { startedAt: now, elites: 0, bosses: [] }, // o que rende Insight na Singularity
  };
  for (const [id, owned] of Object.entries(B.start.generators)) run.generators[id] = { owned };
  for (const id of B.start.pets) run.pets[id] = { level: 1, station: false };
  return run;
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
  // Saves de antes da Singularity: os chefes já vencidos nesta run contam para o Insight (áreas antes da atual + a
  // atual, se concluída) e as elites do mapa atual.
  if (!s.run.stats && s.run.map && c.area[s.run.map.area]) {
    const i = c.AREAS.findIndex((a) => a.id === s.run.map.area);
    const bosses = c.AREAS.slice(0, i).map((a) => a.id).concat(s.run.map.cleared ? [s.run.map.area] : []);
    const elites = (s.run.map.visited || []).filter((id) => s.run.map.nodes[id] && s.run.map.nodes[id].type === 'elite').length;
    s.run.stats = { startedAt: (s.clock && s.clock.startedAt) || now, elites, bosses };
  }
  fill(s, createState(s.clock && s.clock.startedAt ? s.clock.startedAt : now, c));
  if (raw.version === 1) founderUpdate(s, now, c);
  // Janela de reorganizar do fluxo antigo (depois do reset) sem planejamento: fecha (hoje a rede se monta antes de confirmar).
  if (s.meta.respec && !s.meta.plan) { s.meta.respec = false; s.meta.fresh = {}; }
  s.version = VERSION;
  if (!Number.isFinite(s.run.resources.compute.amount)) s.run.resources.compute.amount = 0;
  return s;
}

/**
 * Grande atualização (versão 1 → 2): o farm recomeça do zero — Compute, geradores, upgrades, tiers, Blueprints,
 * consumíveis, níveis dos DevPets, habilidades e incidentes. Ficam os DevPets encontrados (no nível 1), descobertas,
 * visuais, bestiário, missões e o uso do DevKit (os tiers voltam pelas descobertas, com o Compute da run nova).
 * Quem já jogava ganha o pacote Fundador: a coleção visual "Fundador" (engine/appearance.js) e a Estrela do Fundador
 * na Rede da Singularity (content/singularity.js). pending.founder mostra a boas-vindas na primeira abertura.
 */
function founderUpdate(s, now, c = CONTENT) {
  const pets = Object.keys(s.run.pets || {}).filter((id) => c.pet[id]);
  s.run = createRun(c, (s.run.incidents && s.run.incidents.seq) || 0, now);
  for (const id of pets) s.run.pets[id] = { level: 1, station: false };
  s.meta = { ...createState(now, c).meta, founder: true };
  s.pending = { ...s.pending, welcome: null, founder: { at: now, pets: pets.length } };
  s.clock.lastUpdate = now;
  s.clock.lastOfflineMs = 0;
}

module.exports = { VERSION, createState, createRun, migrate };
