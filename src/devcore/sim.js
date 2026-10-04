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

/**
 * profile: { checkEverySec, onlineHoursPerDay, days, events(day) → [{name,data}], strategy?, quiet?, blueprints?, state? }
 * state: continua a partir de um estado (ex.: logo depois de um Rebuild) em vez de um jogo novo.
 * Retorna marcos { t2, t3, pets:{id:t}, synergies:{id:t}, incidents, items, finalAmount, … }.
 */
function simulate(profile, c = CONTENT) {
  const t0 = profile.state ? profile.state.clock.lastUpdate : Date.UTC(2026, 0, 5, 9); // uma segunda-feira, 9h UTC
  const strategy = profile.strategy || 'prepared';
  let s = profile.state ? structuredClone(profile.state) : createState(t0, c);
  let now = t0;
  const marks = { t2: null, t3: null, pets: {}, synergies: {}, purchases: 0, maxWaitSec: 0, maxCheapestSec: 0,
    incidents: { seen: 0, contained: 0, escaped: 0, hotfixed: 0 }, items: 0, parts: 0, firstMk2: null, firstMk3: null };
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
    // Compra enquanto houver o que comprar (melhor valor primeiro), como um jogador atento.
    for (let guard = 0; guard < 200; guard++) {
      const best = options(s, now, c, strategy)[0];
      if (!best || best.cost > s.run.resources.compute.amount) break;
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

/**
 * Legado: joga `runs` runs de `profile.days` dias; ao fim de cada uma dá Rebuild e gasta os fragmentos
 * nos perks mais baratos disponíveis. Retorna por run: { t2, t3, final, rate, gained, level, perks }.
 */
function simulateLegacy(profile, runs = 2, c = CONTENT) {
  const out = [];
  let state = null;
  for (let i = 0; i < runs; i++) {
    const m = simulate({ ...profile, state }, c);
    let s = m.state;
    const now = s.clock.lastUpdate;
    const r = dispatch(s, { type: 'rebuild' }, now, c);
    if (r.error) { out.push({ ...pick(m), error: r.error }); break; }
    s = r.state;
    for (let guard = 0; guard < 50; guard++) {
      const k = snapshot(s, now, c).legacy.perks.filter((x) => x.affordable).sort((a, b) => a.cost - b.cost)[0];
      if (!k) break;
      s = dispatch(s, { type: 'perk', id: k.id }, now, c).state;
    }
    out.push({ ...pick(m), gained: r.log.find((e) => e.type === 'rebuild').gained, level: s.meta.earned, perks: Object.keys(s.meta.perks) });
    state = s;
  }
  return out;
}
const pick = (m) => ({ t2: m.t2, t3: m.t3, final: m.state.run.resources.compute.lifetime, rate: m.finalRate });

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

module.exports = { simulate, simulateLegacy, PROFILES, options, incidentLoss };
