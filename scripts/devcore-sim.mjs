// Linha do tempo de balanceamento do DevCore: npm run devcore:sim
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { simulate, PROFILES, incidentLoss } = require('../src/devcore/sim.js');
const { formatNum, formatDuration } = require('../src/devcore/engine/format.js');

const fmt = (ms) => (ms == null ? '—' : ms < 86400e3 ? formatDuration(ms) : (ms / 86400e3).toFixed(1) + ' dias');
for (const [name, profile] of Object.entries(PROFILES)) {
  const t0 = performance.now();
  const m = simulate(profile);
  console.log(`\n== ${name} (${profile.days} dia(s), app aberto ${profile.onlineHoursPerDay} h/dia, olhando a cada ${formatDuration(profile.checkEverySec * 1000)})`);
  console.log(`  Tier 2: ${fmt(m.t2)}   Tier 3: ${fmt(m.t3)}`);
  console.log(`  Pets: ${Object.entries(m.pets).map(([k, v]) => k + ' ' + fmt(v)).join(' · ')}`);
  console.log(`  Sinergias: ${Object.entries(m.synergies).map(([k, v]) => k + ' ' + fmt(v)).join(' · ') || '—'}`);
  console.log(`  Compras: ${m.purchases} · pior espera pela compra mais barata: ${formatDuration(m.maxCheapestSec * 1000)}`);
  console.log(`  Final: ${formatNum(m.finalAmount)} Compute acumulado · ${formatNum(m.finalRate, { rate: true })}/s   (${(performance.now() - t0).toFixed(0)} ms)`);
}

// Incidentes ("pets do mal"): quanto custam e quanto a preparação compensa (vs. modo tranquilo).
console.log('\n== incidentes (perfil casual, 7 dias)');
for (const strategy of ['passive', 'prepared']) {
  const { loss, marks } = incidentLoss({ ...PROFILES.casual, strategy });
  const i = marks.incidents;
  console.log(`  ${strategy.padEnd(8)} perda ${(loss * 100).toFixed(1)}% · ${i.seen} incidentes: ${i.contained} contidos, ${i.escaped} escaparam, ${i.hotfixed} hotfix · ${(marks.items / PROFILES.casual.days).toFixed(1)} itens/dia`);
}

// Blueprints: preparado + Refactor/compra/troca, 14 dias (1º Mk III é meta de ~1–2 semanas).
{
  const days = 14;
  const m = simulate({ ...PROFILES.casual, days, strategy: 'prepared' });
  console.log(`
== blueprints (casual preparado, ${days} dias)`);
  console.log(`  ${(m.parts / days).toFixed(1)} peças/dia (drops) · 1º Mk II: ${fmt(m.firstMk2)} · 1º Mk III: ${fmt(m.firstMk3)}`);
  const g = m.state.run.generators['terminal-worker'];
  console.log(`  Tier 3: ${fmt(m.t3)} · Terminal: ${g.owned} un. · Mk ${Object.entries(m.state.run.blueprints).map(([k, v]) => k.split('-')[0] + ' ' + v.mk).join(', ') || '—'} · sucata ${m.state.run.scrap}`);
}
