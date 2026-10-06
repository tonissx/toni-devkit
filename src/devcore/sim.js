'use strict';
/**
 * Simulador de balanceamento: joga o DevCore com a própria engine, como um jogador "guloso"
 * que abre o DevCore de tempos em tempos e compra o que tiver melhor custo/benefício.
 * Usado por `npm run devcore:sim` (linha do tempo) e pelos testes (faixas de ritmo).
 */
const { CONTENT } = require('./content/index.js');
const { createState } = require('./engine/state.js');
const { dispatch } = require('./engine/index.js');
const { snapshot } = require('./engine/view.js');
const { production } = require('./engine/production.js');

/** Ganho de produção (por Compute gasto) de cada opção de compra disponível. */
function options(s, now, c, strategy = 'prepared') {
  const base = production(s, now, c).rate;
  const out = [];
  const v = snapshot(s, now, c);
  const tryAction = (action, cost) => {
    const probe = structuredClone(s);
    probe.run.resources.compute.amount = Infinity;
    const r = dispatch(probe, action, now, c);
    if (r.error) return;
    const gain = production(r.state, now, c).rate - base;
    if (gain > 0) out.push({ action, cost, value: gain / cost });
  };
  for (const g of v.generators) if (g.unlocked) tryAction({ type: 'buy', gen: g.id, qty: 1 }, g.cost1);
  for (const u of v.upgrades) if (u.status === 'available') tryAction({ type: 'upgrade', id: u.id }, u.cost);
  for (const p of v.pets) if (p.owned && p.trainCost) tryAction({ type: 'train', pet: p.id }, p.trainCost);
  if (strategy !== 'passive') for (const p of v.pets) if (p.owned && !p.station && p.canStation) out.push({ action: { type: 'station', pet: p.id, on: true }, cost: 0, value: Infinity });
  return out.sort((a, b) => b.value - a.value);
}

/**
 * Jogador "preparado": vê a previsão e põe na estação o pet que contém o incidente (trocando outro, se
 * preciso); usa Hotfix quando um vilão escapou. O "passivo" não faz nada disso (nem usa estações).
 */
function prepare(s, now, c, step) {
  const v = snapshot(s, now, c);
  const f = v.ops.forecast;
  if (f && !f.hidden && !f.covered) {
    const pet = f.counters.find((p) => p.owned && !p.station);
    if (pet) {
      const other = v.pets.find((p) => p.owned && p.station && !f.counters.some((x) => x.id === p.id));
      if (v.stations.used >= v.stations.slots && other) step({ type: 'station', pet: other.id, on: false });
      step({ type: 'station', pet: pet.id, on: true });
    }
  }
  const a = v.ops.active;
  if (a && !a.contained && (s.run.inventory.hotfix || 0) > 0) step({ type: 'use', item: 'hotfix' });
}

/**
 * Blueprints no simulador: Refactor assim que o conjunto fecha; sucata vira a peça faltante do gerador
 * que mais produz; compra as 1–2 últimas peças de um gerador que pesa ≥ 10% da produção (vale o preço).
 */
function blueprints(s, now, c, step) {
  let v = snapshot(s, now, c);
  for (const g of v.generators) if (g.blueprint && g.blueprint.complete) step({ type: 'refactor', gen: g.id });
  v = snapshot(s, now, c);
  const byRate = [...v.generators].filter((g) => g.unlocked && g.blueprint).sort((x, y) => y.rate - x.rate);
  for (const g of byRate) {
    const missing = g.blueprint.parts.filter((p) => !p.owned);
    if (missing.length && v.scrap >= g.blueprint.scrapCost) { step({ type: 'scrapPart', part: missing[0].id }); break; }
  }
  v = snapshot(s, now, c);
  for (const g of v.generators) {
    const bp = g.blueprint;
    if (!bp || bp.complete || bp.owned < 2 || g.rate < 0.1 * v.rate) continue; // conjunto completo: só falta o Refactor
    if (s.run.resources.compute.amount >= bp.buyCost) step({ type: 'buyPart', part: bp.parts.find((p) => !p.owned).id });
  }
  v = snapshot(s, now, c);
  for (const g of v.generators) if (g.blueprint && g.blueprint.complete) step({ type: 'refactor', gen: g.id });
}

/* ─────────────── Mapa (robô) ─────────────── */
const { reachable, nodeCost } = require('./engine/map.js');
const { setupBattle, preview, petStats, petHp, petDown } = require('./engine/battle.js');

/** Esquadrão do robô para um grupo de inimigos: counters primeiro, depois os mais fortes; tanques/atacantes na frente. */
function botSquad(s, enemies, kind, c, now = null) {
  const owned = Object.keys(s.run.pets).filter((id) => c.pet[id] && (now == null || !petDown(s, id, now, c)));
  const power = (id) => { const st = petStats(s, id, c); return (st.hp + st.atk * 6 + st.def * 2) * (now == null ? 1 : petHp(s, id, now, c)); };
  const need = new Set();
  for (const e of enemies) for (const t of c.enemy[e].traits) {
    const ct = c.TRAITS[t].counter;
    if (!ct) continue;
    const ids = [...(ct.anyOf || []), ...(ct.front || [])].filter((id) => owned.includes(id));
    if (ids.length) need.add(ids.sort((a, b) => power(b) - power(a))[0]);
  }
  const pets = [...need, ...owned.filter((id) => !need.has(id)).sort((a, b) => power(b) - power(a))].slice(0, c.BATTLE.squadSize);
  const frontRole = (id) => ['tank', 'attacker'].includes(c.PET_ROLES[id]);
  const front = [...pets.filter(frontRole), ...pets.filter((id) => !frontRole(id))].slice(0, 2);
  const triggers = Object.fromEntries(pets.map((id) => [id, c.PET_ROLES[id] === 'support' ? 'allyLow' : 'start']));
  const items = kind === 'battle' ? [] : ['hotfix', 'coffee', 'rollback'].filter((id) => (s.run.inventory[id] || 0) > 0).slice(0, c.BATTLE.maxItems);
  return { pets, front, triggers, items };
}

/** Próximo passo do robô no mapa: { action, cost } ou null. Guarda Compute para lutas que valem a pena. */
function botMapChoice(s, now, c) {
  const m = s.run.map;
  if (!m || m.cleared) return null;
  if (m.pending && m.pending.kind !== 'shop') {
    const node = m.nodes[m.pending.node];
    if (m.pending.kind === 'rest') return { action: { type: 'mapChoose', index: 0 }, cost: 0 };
    const ev = c.event[node.event];
    const amount = s.run.resources.compute.amount;
    const base = c.area[m.area].costs[node.col];
    const hasCommon = s.run.patches.some((id) => c.patch[id].rarity === 'common');
    const i = ev.choices.findIndex((ch) => ch.rewards.length && (ch.cost || 0) * base <= amount && (ch.needs !== 'commonPatch' || hasCommon));
    return { action: { type: 'mapChoose', index: i === -1 ? ev.choices.length - 1 : i }, cost: 0 };
  }
  const options = reachable(s).map((id) => m.nodes[id]).map((n) => {
    const cost = nodeCost(s, n, c);
    if (!n.group) return { n, cost, chance: 1, score: n.type === 'express' ? 0.3 : 2 };
    const squad = botSquad(s, n.group, n.type, c, now);
    if (!squad.pets.length) return { n, cost, chance: 0, score: -1 };
    const p = preview(setupBattle(s, squad, n.group, n.col, m.area, c, n.type, now), (s.seed ^ (m.attempts[n.id] || 0)) >>> 0, c).chance;
    const min = n.type === 'elite' ? 0.8 : 0.5;
    return { n, cost, chance: p, squad, score: p >= min ? p + (n.type === 'elite' ? 0.2 : 0) : -1 };
  }).filter((o) => o.score >= 0).sort((a, b) => b.score - a.score || a.cost - b.cost);
  const best = options[0];
  if (!best) return null;
  const action = best.squad ? { type: 'mapFight', node: best.n.id, squad: best.squad } : { type: 'mapMove', node: best.n.id };
  return { action, cost: best.cost };
}

/**
 * Joga o mapa enquanto houver o que fazer com o Compute atual. `step` aplica a ação e devolve { state } (o estado é
 * substituído a cada ação). → Compute a guardar para o próximo ponto.
 */
function playMap(s, now, c, step, marks, reserveHours) {
  for (let guard = 0; guard < 30; guard++) {
    const m = s.run.map;
    if (!m) return 0;
    if (m.pending && m.pending.kind === 'shop') {
      const node = m.nodes[m.pending.node];
      const o = node.offers.find((x) => !x.bought && x.kind === 'patch' && x.price <= s.run.resources.compute.amount * 0.5);
      if (o) { s = step({ type: 'mapBuy', offer: o.index }).state; continue; }
    }
    const pick = botMapChoice(s, now, c);
    if (!pick) return 0;
    const rate = production(s, now, c).rate;
    if (pick.cost > s.run.resources.compute.amount) return pick.cost <= rate * reserveHours * 3600 ? pick.cost : 0;
    const before = m.lastBattle ? m.lastBattle.id : 0;
    s = step(pick.action).state;
    const lb = s.run.map.lastBattle;
    if (lb && lb.id !== before) { if (lb.win) marks.map.wins++; else marks.map.losses++; }
    if (s.run.map.cleared && marks.map.cleared == null) marks.map.cleared = now;
  }
  return 0;
}

/**
 * profile: { checkEverySec, onlineHoursPerDay, days, events(day) → [{name,data}], strategy?, quiet?, blueprints? }
 * Retorna marcos { t2, t3, pets:{id:t}, synergies:{id:t}, incidents, items, finalAmount, … }.
 */
function simulate(profile, c = CONTENT) {
  const t0 = Date.UTC(2026, 0, 5, 9); // uma segunda-feira, 9h UTC
  const strategy = profile.strategy || 'prepared';
  let s = createState(t0, c);
  let now = t0;
  const marks = { t2: null, t3: null, pets: {}, synergies: {}, purchases: 0, maxWaitSec: 0, maxCheapestSec: 0,
    incidents: { seen: 0, contained: 0, escaped: 0, hotfixed: 0 }, items: 0, parts: 0, firstMk2: null, firstMk3: null,
    map: { opened: null, cleared: null, wins: 0, losses: 0, byDay: [] } };
  const step = (action) => {
    const r = dispatch(s, action, now, c);
    s = r.state;
    for (const e of r.log) {
      if (e.type === 'incidentStart') marks.incidents.seen++;
      if (e.type === 'contained') { marks.incidents.contained++; if (e.item) marks.items++; }
      if (e.type === 'incidentEnd' && e.outcome === 'escaped') marks.incidents.escaped++;
      if (e.type === 'incidentEnd' && e.outcome === 'hotfixed') marks.incidents.hotfixed++;
      if (e.type === 'part' && !e.dup && e.source !== 'buy' && e.source !== 'scrap') marks.parts++;
      if (e.type === 'refactor' && e.mk === 2 && marks.firstMk2 == null) marks.firstMk2 = now - t0;
      if (e.type === 'refactor' && e.mk === 3 && marks.firstMk3 == null) marks.firstMk3 = now - t0;
    }
    return r;
  };
  step({ type: 'boot' });
  if (profile.quiet) step({ type: 'quiet', on: true });
  const end = t0 + profile.days * 86400e3;
  const dayMs = 86400e3;
  let lastPurchase = now;

  while (now < end) {
    const dayStart = t0 + Math.floor((now - t0) / dayMs) * dayMs;
    const online = now - dayStart < profile.onlineHoursPerDay * 3600e3;
    if (!online) {
      // Fecha o app até o dia seguinte e volta (boot com teto offline).
      now = dayStart + dayMs;
      step({ type: 'boot' });
      marks.items += ((s.pending.welcome && s.pending.welcome.finds) || []).filter((f) => f.item).length;
      marks.parts += ((s.pending.welcome && s.pending.welcome.finds) || []).filter((f) => f.part).length;
      step({ type: 'ackWelcome' });
      for (const e of profile.events ? profile.events(Math.round((now - t0) / dayMs)) : []) step({ type: 'event', ...e });
    } else {
      now += profile.checkEverySec * 1000;
      step({ type: 'tick' });
    }
    if (strategy === 'prepared') prepare(s, now, c, step);
    if (strategy !== 'passive' && profile.blueprints !== false) blueprints(s, now, c, step);
    // Mapa: avança quando dá; se o próximo ponto custa até `mapReserveHours` de produção, guarda Compute para ele.
    let reserve = 0;
    if (profile.map !== false) {
      if (s.run.map && marks.map.opened == null) marks.map.opened = now;
      reserve = playMap(s, now, c, step, marks, profile.mapReserveHours || 4);
      if (s.run.map) marks.map.byDay[Math.floor((now - t0) / 86400e3)] = s.run.map.visited.length;
    }
    // Compra enquanto houver o que comprar (melhor valor primeiro), como um jogador atento.
    for (let guard = 0; guard < 200; guard++) {
      const best = options(s, now, c, strategy)[0];
      if (!best || best.cost > s.run.resources.compute.amount - reserve) break;
      step(best.action);
      marks.purchases++;
      marks.maxWaitSec = Math.max(marks.maxWaitSec, (now - lastPurchase) / 1000);
      lastPurchase = now;
    }
    if (online) {
      // Quanto falta para a compra MAIS BARATA disponível (sempre deve haver algo perto).
      const opts = options(s, now, c, strategy).filter((o) => o.cost > 0);
      const rate = production(s, now, c).rate;
      const cheapest = Math.min(...opts.map((o) => o.cost));
      if (rate > 0 && Number.isFinite(cheapest)) marks.maxCheapestSec = Math.max(marks.maxCheapestSec, Math.max(0, cheapest - s.run.resources.compute.amount) / rate);
    }
    if (!marks.t2 && s.run.tier >= 2) marks.t2 = now - t0;
    if (!marks.t3 && s.run.tier >= 3) marks.t3 = now - t0;
    for (const id of Object.keys(s.run.pets)) if (marks.pets[id] == null) marks.pets[id] = now - t0;
    const v = snapshot(s, now, c);
    for (const syn of v.synergies) if (syn.active && marks.synergies[syn.id] == null) marks.synergies[syn.id] = now - t0;
  }
  marks.finalAmount = s.run.resources.compute.lifetime;
  marks.finalRate = production(s, now, c).rate;
  marks.state = s;
  return marks;
}

/** Perda de produção causada por incidentes: compara com o mesmo perfil no modo tranquilo. */
function incidentLoss(profile, c = CONTENT) {
  // Sem a estratégia de blueprints nas duas execuções: o modo tranquilo não tem drops de vilões,
  // então compará-las com Refactor mediria as peças, não o custo dos incidentes.
  const withIncidents = simulate({ ...profile, blueprints: false }, c);
  const quiet = simulate({ ...profile, blueprints: false, quiet: true }, c);
  return { loss: 1 - withIncidents.finalAmount / quiet.finalAmount, marks: withIncidents };
}

/** Perfis padrão. */
const PROFILES = {
  // Sessão ativa: DevCore aberto, olhando a cada 30 s, app aberto o dia inteiro.
  engaged: { checkEverySec: 30, onlineHoursPerDay: 24, days: 1 },
  // Uso casual: app aberto 9 h/dia (dá uma olhada a cada 1 h), fechado à noite; usa o DevKit normalmente.
  casual: {
    checkEverySec: 3600, onlineHoursPerDay: 9, days: 7,
    events: (day) => [
      { name: 'palette.opened' },
      { name: 'command.executed', data: { id: ['tool:sql', 'app:settings', 'notes:quick', 'devcore:open', 'clipboard:sql', 'theme:toggle'][day % 6] } },
      { name: 'tool.opened', data: { tool: ['sql', 'notes', 'devcore'][day % 3] } },
      { name: 'tool.used', data: { tool: ['sql', 'xml', 'diff'][day % 3] } },
      { name: 'tool.used', data: { tool: 'sql' } },
      ...(day % 2 === 0 ? [{ name: 'note.created' }] : []),
      ...(day === 2 ? [{ name: 'snippet.created' }] : []),
    ],
  },
};

module.exports = { simulate, PROFILES, options, incidentLoss, botSquad, botMapChoice };
