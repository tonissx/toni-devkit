// Linha do tempo de balanceamento do DevCore: npm run devcore:sim
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { simulate, PROFILES } = require('../src/devcore/sim.js');
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
