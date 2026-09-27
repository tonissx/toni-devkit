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
function options(s, now, c) {
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
  for (const p of v.pets) if (p.owned && !p.station && p.canStation) out.push({ action: { type: 'station', pet: p.id, on: true }, cost: 0, value: Infinity });
  return out.sort((a, b) => b.value - a.value);
}

/**
 * profile: { checkEverySec, onlineHoursPerDay, days, events(day) → [{name,data}] }
 * Retorna marcos { t2, t3, pets:{id:t}, synergies:{id:t}, finalAmount, maxGapSec }.
 */
function simulate(profile, c = CONTENT) {
  const t0 = Date.UTC(2026, 0, 5, 9); // uma segunda-feira, 9h UTC
  let s = createState(t0, c);
  let now = t0;
  s = dispatch(s, { type: 'boot' }, now, c).state;
  const marks = { t2: null, t3: null, pets: {}, synergies: {}, purchases: 0, maxWaitSec: 0, maxCheapestSec: 0 };
  const end = t0 + profile.days * 86400e3;
  const dayMs = 86400e3;
  let lastPurchase = now;

  while (now < end) {
    const dayStart = t0 + Math.floor((now - t0) / dayMs) * dayMs;
    const online = now - dayStart < profile.onlineHoursPerDay * 3600e3;
    if (!online) {
      // Fecha o app até o dia seguinte e volta (boot com teto offline).
      now = dayStart + dayMs;
      s = dispatch(s, { type: 'boot' }, now, c).state;
      s = dispatch(s, { type: 'ackWelcome' }, now, c).state;
      for (const e of profile.events ? profile.events(Math.round((now - t0) / dayMs)) : []) s = dispatch(s, { type: 'event', ...e }, now, c).state;
    } else {
      now += profile.checkEverySec * 1000;
      s = dispatch(s, { type: 'tick' }, now, c).state;
    }
    // Compra enquanto houver o que comprar (melhor valor primeiro), como um jogador atento.
    for (let guard = 0; guard < 200; guard++) {
      const best = options(s, now, c)[0];
      if (!best || best.cost > s.run.resources.compute.amount) break;
      s = dispatch(s, best.action, now, c).state;
      marks.purchases++;
      marks.maxWaitSec = Math.max(marks.maxWaitSec, (now - lastPurchase) / 1000);
      lastPurchase = now;
    }
    if (online) {
      // Quanto falta para a compra MAIS BARATA disponível (sempre deve haver algo perto).
      const opts = options(s, now, c).filter((o) => o.cost > 0);
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

/** Perfis padrão. */
const PROFILES = {
  // Sessão ativa: DevCore aberto, olhando a cada 30 s, app aberto o dia inteiro.
  engaged: { checkEverySec: 30, onlineHoursPerDay: 24, days: 1 },
  // Uso casual: app aberto 9 h/dia (dá uma olhada a cada 1 h), fechado à noite; usa o DevKit normalmente.
  casual: {
    checkEverySec: 3600, onlineHoursPerDay: 9, days: 7,
    events: (day) => [
      { name: 'palette.opened' },
      { name: 'tool.used', data: { tool: ['sql', 'xml', 'diff'][day % 3] } },
      { name: 'tool.used', data: { tool: 'sql' } },
      ...(day % 2 === 0 ? [{ name: 'note.created' }] : []),
      ...(day === 2 ? [{ name: 'snippet.created' }] : []),
    ],
  },
};

module.exports = { simulate, PROFILES, options };
