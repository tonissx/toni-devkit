'use strict';
/**
 * Singularity (prestígio) — regras puras. Conteúdo e explicação da árvore em content/singularity.js;
 * desenho em docs/devcore-mapa-singularity.md §9.
 *
 * Estado (meta, nunca zera): insight (não gasto) · earned (ganho na vida) · singularities · tree { id: nível }
 *   · respec (planejando a Singularity) · plan { tree, insight, breakdown } (como estava ao começar a planejar)
 *   · fresh { id: níveis comprados no planejamento } · lifetime (Compute de runs passadas) · best · lastAt
 * Run: stats { startedAt, elites, bosses[] } — o que rende Insight.
 *
 * Fluxo: vencer o Pico abre o planejamento sozinho (syncPlan, a cada dispatch) — o Insight desta Singularity entra no
 * saldo. A rapidez congela nesse instante; a profundidade segue crescendo (se o Compute da run passar do próximo
 * degrau antes de confirmar, a diferença entra no saldo); os multiplicadores são os da rede de antes do planejamento.
 * No planejamento, desfazer (treeUndo) devolve 100% do que foi comprado nele e reorganizar (treeRespec) devolve 100%
 * disso e INSIGHT.respecRefund (80%) do resto. singularityCancel limpa as escolhas (rede e Insight como ao abrir);
 * singularity confirma: a run recomeça já com a rede nova (bônus de início e o que atravessa vêm dela). Fora do
 * planejamento, comprar na rede é definitivo.
 *
 * Ações (engine/index.js): singularityPlan · singularityCancel · singularity · treeBuy { id } · treeUndo { id } · treeRespec
 */
const { CONTENT } = require('../content/index.js');
const { createRun } = require('./state.js');
const { rng } = require('./rng.js');

const rankOf = (s, id) => (s.meta.tree && s.meta.tree[id]) || 0;
/** Nós valendo: os comprados (com o nível) e a Estrela do Fundador, para quem a tem. */
const owned = (s, c = CONTENT) => {
  const list = Object.entries(s.meta.tree || {}).filter(([id, r]) => r > 0 && c.perk[id] && c.perk[id].kind !== 'founder').map(([id, r]) => ({ k: c.perk[id], rank: r }));
  if (s.meta.founder && c.perk.founder) list.push({ k: c.perk.founder, rank: 1 });
  return list;
};

/** Produto de um multiplicador de regra da árvore (1 se nenhum). Repetíveis: valor^nível. */
function treeMod(s, key, c = CONTENT) {
  let m = 1;
  for (const { k, rank } of owned(s, c)) if (k.mods && k.mods[key] != null) m *= Math.pow(k.mods[key], rank);
  return m;
}
/** Soma de uma regra aditiva da árvore (0 se nenhuma). Repetíveis: valor × nível. */
function treeAdd(s, key, c = CONTENT) {
  let n = 0;
  for (const { k, rank } of owned(s, c)) if (k.adds && k.adds[key] != null) n += k.adds[key] * rank;
  return n;
}
/** Algum nó comprado liga essa regra? */
const treeFlag = (s, key, c = CONTENT) => owned(s, c).some(({ k }) => k.flags && k.flags[key]);

/**
 * Efeitos de produção da árvore (somados aos dos upgrades): os dos nós (× nível) e o Núcleo
 * (+corePerRun por Singularity feita). perActiveCategory fica para production.js (sabe as categorias ativas).
 */
function treeEffects(s, c = CONTENT) {
  const out = [];
  const n = s.meta.singularities || 0;
  if (n > 0) out.push({ type: 'mul', target: 'global', value: 1 + c.INSIGHT.corePerRun * n, source: 'tree:core' });
  for (const { k, rank } of owned(s, c)) {
    for (const e of k.effects || []) out.push({ ...e, value: e.type === 'mul' ? Math.pow(e.value, rank) : e.value * rank, source: 'tree:' + k.id });
  }
  return out;
}

/**
 * Como a próxima run começa (somando os nós): o maior valor para níveis/tier/Compute/unidades, a soma para estoques
 * e Patches. Clean Slate desliga tudo isso (e o que atravessa).
 */
function startConfig(s, c = CONTENT) {
  const out = { compute: 0, gens: {}, tier: 1, petLevel: 1, items: {}, patches: {}, keep: { inventory: false, scrap: false, mk: 1 } };
  if (treeFlag(s, 'cleanSlate', c)) return out;
  for (const { k } of owned(s, c)) {
    const st = k.start || {};
    out.compute = Math.max(out.compute, st.compute || 0);
    for (const [g, n] of Object.entries(st.gens || {})) out.gens[g] = Math.max(out.gens[g] || 0, n);
    out.tier = Math.max(out.tier, st.tier || 1);
    out.petLevel = Math.max(out.petLevel, st.petLevel || 1);
    for (const [id, n] of Object.entries(st.items || {})) out.items[id] = (out.items[id] || 0) + n;
    for (const [r, n] of Object.entries(st.patches || {})) out.patches[r] = (out.patches[r] || 0) + n;
    const kp = k.keep || {};
    if (kp.inventory) out.keep.inventory = true;
    if (kp.scrap) out.keep.scrap = true;
    out.keep.mk = Math.max(out.keep.mk, kp.mk || 1);
  }
  return out;
}

/** Nível com que um DevPet começa a run (no teto da raridade). */
function petStartLevel(s, petId, c = CONTENT) {
  const p = c.pet[petId];
  const max = p ? c.RARITY[p.rarity].maxLevel : 1;
  return Math.min(max, startConfig(s, c).petLevel);
}

/** Limite de um consumível (o do conteúdo + Bigger Pockets). */
const capOf = (s, k, c = CONTENT) => k.cap + Math.round(treeAdd(s, 'itemCap', c));

/** Patch aleatório da raridade que a run ainda não tem. → id | null */
function randomPatch(s, rarity, rand, c = CONTENT) {
  const pool = c.PATCHES.filter((p) => p.rarity === rarity && !s.run.patches.includes(p.id));
  if (!pool.length) return null;
  const p = pool[Math.floor(rand() * pool.length)];
  s.run.patches.push(p.id);
  return p.id;
}

/* ─────────────── Insight e a Singularity ─────────────── */

/** A run já venceu o último chefe (Pico Production)? */
const singularityReady = (s, c = CONTENT) => ((s.run.stats && s.run.stats.bosses) || []).includes(c.AREAS[c.AREAS.length - 1].id);

/** Quanto Insight uma Singularity agora renderia, e de onde vem. */
function insightBreakdown(s, now, c = CONTENT) {
  const I = c.INSIGHT;
  const st = s.run.stats || { bosses: [], elites: 0, startedAt: now };
  const bosses = (st.bosses || []).reduce((n, id) => n + (I.boss[id] || 0), 0);
  const elites = (st.elites || 0) * I.elite;
  const days = Math.max(0, (now - (st.startedAt || now)) / 86400e3);
  const speed = Math.max(0, Math.min(I.speed.max, Math.floor(I.speed.days - days)));
  const life = s.run.resources.compute.lifetime;
  const depth = life >= I.depth.from ? Math.min(I.depth.max, Math.floor(Math.log(life / I.depth.from) / Math.log(I.depth.per) + 1e-9)) : 0;
  const raw = bosses + elites + speed + depth;
  const mult = treeMod(s, 'insight', c);
  const founder = Math.round(treeAdd(s, 'insightFlat', c)); // Estrela do Fundador: +1 fixo
  return { bosses, elites, speed, depth, days, raw, mult, founder, total: Math.floor(raw * mult + 1e-9) + founder };
}

/** Pode fazer a Singularity agora? → erro ou null. */
const singularityError = (s, c = CONTENT) => (singularityReady(s, c) ? null : `A Singularity libera ao vencer o chefe de ${c.AREAS[c.AREAS.length - 1].name}`);

/** Abre o planejamento: guarda a rede e o Insight de agora e soma (provisório) o Insight desta Singularity. */
function singularityPlan(s, now, c, log) {
  const err = singularityError(s, c);
  if (err) return err;
  const M = s.meta;
  if (M.respec) return 'A Singularity já está sendo planejada';
  const br = insightBreakdown(s, now, c);
  M.plan = { tree: { ...M.tree }, insight: M.insight || 0, breakdown: br };
  M.insight = (M.insight || 0) + br.total;
  M.respec = true;
  M.fresh = {};
  log.push({ type: 'singularityPlan', pending: br.total });
  return null;
}

/** Limpa as escolhas do planejamento: a rede volta como estava e o Insight desta Singularity volta inteiro ao saldo. */
function singularityCancel(s, c, log) {
  const M = s.meta;
  if (!M.respec || !M.plan) return 'Nenhuma Singularity em planejamento';
  M.tree = { ...M.plan.tree };
  M.insight = M.plan.insight + M.plan.breakdown.total;
  M.fresh = {};
  log.push({ type: 'singularityCancel' });
  return null;
}

/**
 * A cada dispatch: abre o planejamento quando o Pico é vencido e, já planejando, soma ao saldo a profundidade que a
 * run ganhou desde então (a rapidez fica a do momento em que o Pico caiu; os multiplicadores, os da rede de antes).
 */
function syncPlan(s, now, c, log) {
  const M = s.meta;
  if (!singularityReady(s, c)) return;
  if (!M.respec || !M.plan) { singularityPlan(s, now, c, log); return; }
  const p = M.plan.breakdown;
  const live = insightBreakdown({ ...s, meta: { ...M, tree: M.plan.tree } }, now, c);
  if (live.depth <= p.depth) return;
  const raw = p.bosses + p.elites + p.speed + live.depth;
  const total = Math.floor(raw * p.mult + 1e-9) + (p.founder || 0);
  if (total <= p.total) return;
  M.insight = (M.insight || 0) + (total - p.total);
  M.plan.breakdown = { ...p, depth: live.depth, raw, total };
}

/**
 * Singularity: converte a run em Insight e recomeça.
 * Zera: a run (Compute, geradores, upgrades, combos, tiers, Blueprints, consumíveis, Patches, mapa, níveis dos pets).
 * Fica: DevPets encontrados (no nível inicial da árvore), meta (Insight e árvore), descobertas, uso, visuais,
 * bestiário, estatísticas da arena, missões, configurações. Os tiers voltam pelas descobertas (Compute da run nova).
 */
function singularity(s, now, c, log) {
  const err = singularityError(s, c);
  if (err) return err;
  const M = s.meta;
  const planned = M.respec && M.plan;
  // Planejada: o Insight já entrou no saldo ao abrir o planejamento (com a conta daquele instante).
  const br = planned ? M.plan.breakdown : insightBreakdown(s, now, c);
  const old = s.run;
  if (!planned) M.insight = (M.insight || 0) + br.total;
  M.earned = (M.earned || 0) + br.total;
  M.singularities = (M.singularities || 0) + 1;
  M.lifetime = (M.lifetime || 0) + old.resources.compute.lifetime;
  M.best = M.best ? Math.min(M.best, br.days) : br.days;
  M.lastAt = now;
  M.respec = false; // a rede montada no planejamento fica
  M.fresh = {};
  M.plan = null;
  // Semente nova: outro mapa, outras lutas.
  s.seed = ((Math.imul(s.seed, 48271) >>> 0) % 2147483646) + 1;

  const run = createRun(c, old.incidents.seq, now);
  applyStart(s, run, old, c);
  s.run = run;
  log.push({ type: 'singularity', gained: br.total, count: M.singularities, breakdown: br });
  return null;
}

/** Aplica os bônus de início da árvore a uma run nova (pets encontrados voltam no nível inicial). */
function applyStart(s, run, old, c) {
  const cfg = startConfig(s, c);
  run.resources.compute.amount = Math.max(run.resources.compute.amount, cfg.compute);
  for (const [g, n] of Object.entries(cfg.gens)) run.generators[g] = { owned: Math.max((run.generators[g] || {}).owned || 0, n) };
  run.tier = Math.max(run.tier, cfg.tier);
  for (const id of Object.keys(old.pets)) if (c.pet[id]) run.pets[id] = { level: 1, station: false };
  for (const id of Object.keys(run.pets)) run.pets[id].level = petStartLevel(s, id, c);
  if (cfg.keep.inventory) run.inventory = { ...old.inventory };
  for (const [id, n] of Object.entries(cfg.items)) {
    const k = c.consumable[id];
    run.inventory[id] = Math.min(capOf(s, k, c), (run.inventory[id] || 0) + n);
  }
  for (const [id, n] of Object.entries(run.inventory)) if (c.consumable[id]) run.inventory[id] = Math.min(capOf(s, c.consumable[id], c), n);
  if (cfg.keep.scrap) run.scrap = old.scrap || 0;
  for (const [gen, bp] of Object.entries(old.blueprints || {})) {
    const mk = Math.min(bp.mk, cfg.keep.mk);
    if (mk > 1) run.blueprints[gen] = { mk, parts: {} };
  }
  const rand = rng((s.seed ^ 0x5eed) >>> 0);
  const tmp = { run };
  for (const [rarity, n] of Object.entries(cfg.patches)) for (let i = 0; i < n; i++) randomPatch(tmp, rarity, rand, c);
}

/* ─────────────── A rede ─────────────── */

const ADJ = new WeakMap();
/** Vizinhos de cada nó (ligações nos dois sentidos). */
function adjacency(c = CONTENT) {
  if (ADJ.has(c)) return ADJ.get(c);
  const adj = Object.fromEntries(c.TREE.map((k) => [k.id, new Set()]));
  for (const k of c.TREE) for (const l of k.links) { adj[k.id].add(l); adj[l].add(k.id); }
  ADJ.set(c, adj);
  return adj;
}
const isOwned = (s, id) => id === 'core' || rankOf(s, id) > 0;

/** Custo do próximo nível de um nó. */
const perkCost = (s, k) => k.cost + (k.step || 0) * rankOf(s, k.id);

/** Nós comprados num setor (sem contar maestria e infinito) — para a maestria. */
const sectorCount = (s, sector, c = CONTENT) => c.TREE.filter((k) => k.sector === sector && k.kind !== 'mastery' && k.kind !== 'repeat' && rankOf(s, k.id) > 0).length;

/**
 * Situação de um nó: owned (comprado; repetível segue comprável) · available · locked (sem caminho) · excluded
 * (outro paradigma do grupo) · needs (maestria sem nós suficientes). → { status, reason }
 */
function perkState(s, k, c = CONTENT) {
  if (k.kind === 'core') return { status: 'owned', reason: null };
  if (k.kind === 'founder') return s.meta.founder ? { status: 'owned', reason: null } : { status: 'locked', reason: 'Exclusiva de quem jogava antes da grande atualização' };
  const r = rankOf(s, k.id);
  if (r > 0 && k.kind !== 'repeat') return { status: 'owned', reason: null };
  if (k.excl) {
    const other = c.TREE.find((x) => x.excl === k.excl && x.id !== k.id && rankOf(s, x.id) > 0);
    if (other) return { status: 'excluded', reason: `Paradigma excludente: você escolheu ${other.name}` };
  }
  const adj = adjacency(c)[k.id];
  if (k.kind === 'bridge') {
    if (!k.links.every((id) => isOwned(s, id))) return { status: 'locked', reason: 'Sinapse: precisa de um vizinho comprado dos dois setores' };
  } else if (![...adj].some((id) => isOwned(s, id))) return { status: 'locked', reason: 'Compre um nó ligado a este primeiro' };
  if (k.needs && sectorCount(s, k.sector, c) < k.needs) return { status: 'needs', reason: `Maestria: precisa de ${k.needs} nós do setor (tem ${sectorCount(s, k.sector, c)})` };
  return { status: r > 0 ? 'owned' : 'available', reason: null };
}

/** Compra (ou sobe um nível de) um nó. → erro ou null */
function treeBuy(s, id, c, log) {
  const k = c.perk[id];
  if (!k || k.kind === 'core') return 'Nó inexistente';
  if (k.kind === 'founder') return 'A Estrela do Fundador não se compra';
  const st = perkState(s, k, c);
  if (st.status === 'owned' && k.kind !== 'repeat') return 'Nó já comprado';
  if (st.status !== 'available' && !(st.status === 'owned' && k.kind === 'repeat')) return st.reason;
  const cost = perkCost(s, k);
  if ((s.meta.insight || 0) < cost) return 'Insight insuficiente';
  s.meta.insight -= cost;
  s.meta.tree[k.id] = rankOf(s, k.id) + 1;
  if (s.meta.respec) s.meta.fresh = { ...(s.meta.fresh || {}), [k.id]: ((s.meta.fresh || {})[k.id] || 0) + 1 }; // desfazível no planejamento
  log.push({ type: 'treeBuy', id: k.id, name: k.name, rank: s.meta.tree[k.id] });
  return null;
}

/** Níveis de um nó comprados na janela aberta (desfazíveis de graça). */
const freshOf = (s, id) => (s.meta.respec && s.meta.fresh && s.meta.fresh[id]) || 0;

/** Insight gasto na rede: { fresh (da janela aberta), old (de antes), total }. */
function spentBreakdown(s, c = CONTENT) {
  let fresh = 0; let old = 0;
  for (const { k, rank } of owned(s, c)) {
    const f = Math.min(rank, freshOf(s, k.id));
    for (let i = 0; i < rank; i++) { const v = k.cost + (k.step || 0) * i; if (i >= rank - f) fresh += v; else old += v; }
  }
  return { fresh, old, total: fresh + old };
}
const spentInsight = (s, c = CONTENT) => spentBreakdown(s, c).total;

/** Quanto a reorganização devolve agora: 100% do que é da janela e respecRefund do resto (arredondado para baixo). */
function respecRefund(s, c = CONTENT) {
  const b = spentBreakdown(s, c);
  return b.fresh + Math.floor(b.old * c.INSIGHT.respecRefund + 1e-9);
}

/**
 * A rede continua de pé sem esse nível? Todo nó comprado precisa de caminho até o Núcleo por nós comprados (sinapse:
 * os dois lados), e as maestrias, dos nós do setor.
 */
function treeValid(s, c = CONTENT) {
  const adj = adjacency(c);
  const have = (id) => id === 'core' || rankOf(s, id) > 0;
  const ok = new Set(['core']);
  for (let changed = true; changed;) {
    changed = false;
    for (const k of c.TREE) {
      if (ok.has(k.id) || !have(k.id)) continue;
      const linked = k.kind === 'bridge' ? k.links.every((l) => ok.has(l)) : [...adj[k.id]].some((l) => ok.has(l));
      if (linked) { ok.add(k.id); changed = true; }
    }
  }
  return c.TREE.every((k) => !have(k.id) || (ok.has(k.id) && (!k.needs || sectorCount(s, k.sector, c) >= k.needs)));
}

/** Desfaz o último nível de um nó comprado nesta janela: devolve 100%. → erro ou null */
function treeUndo(s, id, c, log) {
  const k = c.perk[id];
  if (!k || rankOf(s, id) < 1) return 'Nó não comprado';
  if (!s.meta.respec) return 'Só dá para desfazer enquanto a Singularity é planejada';
  if (freshOf(s, id) < 1) return 'Comprado antes: só sai reorganizando a rede (devolve 80%)';
  const probe = { meta: { ...s.meta, tree: { ...s.meta.tree, [id]: rankOf(s, id) - 1 } } };
  if (!treeValid(probe, c)) return 'Outros nós comprados dependem deste: desfaça-os antes';
  const r = rankOf(s, id);
  const back = k.cost + (k.step || 0) * (r - 1);
  if (r - 1 > 0) s.meta.tree[id] = r - 1; else delete s.meta.tree[id];
  s.meta.fresh = { ...s.meta.fresh, [id]: s.meta.fresh[id] - 1 };
  if (!s.meta.fresh[id]) delete s.meta.fresh[id];
  s.meta.insight = (s.meta.insight || 0) + back;
  log.push({ type: 'treeUndo', id, refunded: back });
  return null;
}

/** Reorganiza a rede inteira (só na janela): devolve 100% do que é da janela e 80% do resto. → erro ou null */
function treeRespec(s, c, log) {
  if (!s.meta.respec) return 'A rede só se reorganiza enquanto a Singularity é planejada';
  const back = respecRefund(s, c);
  const spent = spentInsight(s, c);
  s.meta.insight = (s.meta.insight || 0) + back;
  s.meta.tree = {};
  s.meta.fresh = {};
  log.push({ type: 'treeRespec', refunded: back, lost: spent - back });
  return null;
}



module.exports = {
  treeMod, treeAdd, treeFlag, treeEffects, startConfig, petStartLevel, capOf, randomPatch,
  singularityReady, singularityError, insightBreakdown, singularityPlan, singularityCancel, syncPlan, singularity, applyStart,
  adjacency, perkCost, perkState, sectorCount, treeBuy, treeUndo, treeRespec, treeValid, spentInsight,
  spentBreakdown, respecRefund, freshOf, rankOf,
};
