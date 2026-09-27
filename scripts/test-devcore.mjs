// Testes do DevCore (conteúdo, engine, balanceamento): node --test scripts/test-devcore.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CONTENT, validate } = require('../src/devcore/content/index.js');
const { createState, migrate } = require('../src/devcore/engine/state.js');
const { dispatch } = require('../src/devcore/engine/index.js');
const { production, aggregate, factorOf } = require('../src/devcore/engine/production.js');
const { costOf, maxAffordable } = require('../src/devcore/engine/economy.js');
const { produced, offlineCapMs } = require('../src/devcore/engine/advance.js');
const { snapshot, abilitiesList } = require('../src/devcore/engine/view.js');
const { formatNum, formatDuration } = require('../src/devcore/engine/format.js');
const { simulate, PROFILES } = require('../src/devcore/sim.js');

const T0 = Date.UTC(2026, 0, 5, 12);
const H = 3600e3;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

/** Estado de teste: dá Compute, geradores, tier, pets e upgrades direto. */
function make({ compute = 0, gens = {}, tier = 1, pets = null, upgrades = [], found = [] } = {}) {
  const s = createState(T0);
  s.run.resources.compute.amount = compute;
  s.run.generators = Object.fromEntries(Object.entries(gens).map(([k, v]) => [k, { owned: v }]));
  s.run.tier = tier;
  if (pets) s.run.pets = Object.fromEntries(pets.map((p) => [p, { level: 1, station: false }]));
  for (const u of upgrades) s.run.upgrades[u] = T0;
  for (const d of found) s.discoveries.found[d] = T0;
  return s;
}
const run = (s, action, now = T0) => dispatch(s, action, now);

/* ─────────────── conteúdo ─────────────── */
test('content: ids unique and references valid; MVP sizes', () => {
  assert.deepEqual(validate(), []);
  assert.ok(CONTENT.GENERATORS.length >= 4 && CONTENT.GENERATORS.length <= 6);
  assert.ok(CONTENT.PETS.length >= 3 && CONTENT.PETS.length <= 5);
  assert.ok(CONTENT.UPGRADES.length >= 10 && CONTENT.UPGRADES.length <= 15);
  assert.ok(CONTENT.DISCOVERIES.length >= 5 && CONTENT.DISCOVERIES.length <= 10);
  assert.equal(CONTENT.TIERS.length, 3);
});

/* ─────────────── economia ─────────────── */
test('economy: geometric cost, buy 10 and max match the exact sum', () => {
  const g = CONTENT.gen['terminal-worker'];
  let sum = 0;
  for (let k = 0; k < 10; k++) sum += g.baseCost * g.costScaling ** (3 + k);
  near(costOf(g, 3, 10), sum);
  const n = maxAffordable(g, 3, sum);
  assert.equal(n, 10);
  assert.equal(maxAffordable(g, 3, sum - 0.01), 9);
  assert.equal(maxAffordable(g, 0, 1), 0);
});

test('buy: spends exactly, refuses without funds, max buys all it can', () => {
  const g = CONTENT.gen['terminal-worker'];
  let s = make({ compute: costOf(g, 0, 10), gens: {} });
  let r = run(s, { type: 'buy', gen: 'terminal-worker', qty: 10 });
  assert.equal(r.error, undefined);
  assert.equal(r.state.run.generators['terminal-worker'].owned, 10);
  near(r.state.run.resources.compute.amount, 0);
  r = run(r.state, { type: 'buy', gen: 'terminal-worker', qty: 1 });
  assert.equal(r.error, 'Compute insuficiente');
  s = make({ compute: 1000 });
  r = run(s, { type: 'buy', gen: 'terminal-worker', qty: 'max' });
  assert.equal(r.state.run.generators['terminal-worker'].owned, maxAffordable(g, 0, 1000));
  assert.equal(run(make({ compute: 1e9 }), { type: 'buy', gen: 'agent', qty: 1 }).error, 'Gerador indisponível'); // tier 3
});

/* ─────────────── produção e modificadores ─────────────── */
test('modifiers: add sums, mul multiplies, per target', () => {
  const agg = aggregate([
    { type: 'add', target: 'global', value: 0.1 }, { type: 'add', target: 'global', value: 0.05 },
    { type: 'mul', target: 'global', value: 2 }, { type: 'mul', target: 'gen:x', value: 3 },
  ]);
  near(factorOf(agg, 'global'), 1.15 * 2);
  near(factorOf(agg, 'gen:x'), 3);
  assert.equal(factorOf(agg, 'cat:none'), 1);
});

test('production: base × owned × gen × cat × global (Byte + upgrade)', () => {
  const s = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'], upgrades: ['terminal-optimization'] });
  // 0.1 × 10 × 2 (upgrade) × 1.15 (Byte shell) × 1.05 (Byte global)
  near(production(s, T0).rate, 0.1 * 10 * 2 * 1.15 * 1.05);
  assert.equal(production(make({ gens: { agent: 5 } }), T0).rate, 0); // tier 1: agent não produz
});

test('pets: level scales bonus; station doubles it only in tier 3 and respects slots', () => {
  const base = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'], tier: 3 });
  base.run.pets.byte.level = 3; // +20%
  near(production(base, T0).rate, 1 * (1 + 0.15 * 1.2) * (1 + 0.05 * 1.2));
  let r = run(base, { type: 'station', pet: 'byte', on: true });
  assert.equal(r.error, undefined);
  near(production(r.state, T0).rate, 1 * (1 + 0.15 * 1.2 * 2) * (1 + 0.05 * 1.2 * 2));
  const two = make({ tier: 3, pets: ['byte', 'noxi'] });
  r = run(two, { type: 'station', pet: 'byte', on: true });
  assert.equal(run(r.state, { type: 'station', pet: 'noxi', on: true }).error, 'Sem estações livres');
  assert.equal(run(make({ tier: 2, pets: ['byte'] }), { type: 'station', pet: 'byte', on: true }).error, 'Estações liberam no tier 3');
});

test('train: costs compute, raises level, stops at max', () => {
  const s = make({ compute: 1e12, pets: ['byte'] });
  let r = run(s, { type: 'train', pet: 'byte' });
  assert.equal(r.state.run.pets.byte.level, 2);
  near(r.state.run.resources.compute.amount, 1e12 - CONTENT.pet.byte.trainCost);
  r.state.run.pets.byte.level = CONTENT.RARITY.common.maxLevel;
  assert.equal(run(r.state, { type: 'train', pet: 'byte' }).error, 'Nível máximo');
});

test('synergies: pipeline needs Distributed Runtime + gens + Noxi; orchestration scales with categories', () => {
  const gens = { 'script-runner': 1, 'automation-worker': 1 };
  const without = make({ tier: 2, gens, pets: ['noxi'] });
  const withRt = make({ tier: 2, gens, pets: ['noxi'], upgrades: ['distributed-runtime'] });
  const auto = (s) => production(s, T0).gens['automation-worker'];
  near(auto(withRt) / auto(without), (1 + 0.1 + 0.3) / (1 + 0.1));
  const v = snapshot(without, T0);
  assert.deepEqual(v.synergies.find((x) => x.id === 'pipeline').missing, ['Distributed Runtime']);
  const orch = make({ tier: 3, gens: { agent: 1, 'terminal-worker': 1, 'script-runner': 1 }, upgrades: ['distributed-runtime'] });
  assert.ok(snapshot(orch, T0).synergies.find((x) => x.id === 'orchestration').active);
});

test('usage bonuses are capped in total', () => {
  const s = make({ gens: { 'terminal-worker': 10 }, pets: [], found: ['toolsmith', 'snippet-library'] });
  const saved = CONTENT.BALANCE.usageBonusCap;
  CONTENT.BALANCE.usageBonusCap = 0.01; // 0.02 + 0.03 > 0.01 → escala para caber
  try {
    near(production(s, T0).rate, 1 * (1 + 0.02 * 0.2));
  } finally { CONTENT.BALANCE.usageBonusCap = saved; }
});

/* ─────────────── tempo ─────────────── */
test('advance: exact piecewise integral with a burst ending mid-interval', () => {
  const s = make({ tier: 2, gens: { 'terminal-worker': 100 }, pets: ['byte'] });
  const rate = production(s, T0).rate;
  const r = run(s, { type: 'ability', id: 'compile-burst' }, T0);
  assert.equal(r.error, undefined);
  // 30 s a ×3 e depois 90 s normal
  near(produced(r.state, T0, T0 + 120e3), rate * 3 * 30 + rate * 90);
  const after = run(r.state, { type: 'tick' }, T0 + 120e3).state;
  near(after.run.resources.compute.amount, rate * 3 * 30 + rate * 90);
});

test('advance: online has no cap; offline is capped; clock going back gains nothing', () => {
  const s = make({ gens: { 'terminal-worker': 10 }, pets: [] });
  const rate = production(s, T0).rate;
  near(run(s, { type: 'tick' }, T0 + 20 * H).state.run.resources.compute.amount, rate * 20 * 3600);
  const off = run(s, { type: 'boot' }, T0 + 20 * H).state;
  near(off.run.resources.compute.amount, rate * 8 * 3600, 1e-3); // + achados dos pets = 0 (sem pets)
  assert.equal(offlineCapMs(make({ upgrades: ['offline-daemon'] })), 12 * H);
  const back = run(s, { type: 'tick' }, T0 - H).state;
  assert.equal(back.run.resources.compute.amount, 0);
  assert.equal(back.clock.lastUpdate, T0);
});

test('welcome: only after ≥ 15 min away, once, with deterministic pet finds', () => {
  const s = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'] });
  assert.equal(run(s, { type: 'boot' }, T0 + 10 * 60e3).state.pending.welcome, null);
  const a = run(s, { type: 'boot' }, T0 + 5 * H);
  const b = run(s, { type: 'boot' }, T0 + 5 * H);
  const w = a.state.pending.welcome;
  assert.equal(w.awayMs, 5 * H);
  assert.equal(w.finds.length, 2); // a cada 2 h
  assert.deepEqual(w.finds, b.state.pending.welcome.finds);
  assert.ok(w.discoveries.includes('night-shift'));
  assert.equal(run(a.state, { type: 'ackWelcome' }, T0 + 5 * H).state.pending.welcome, null);
  assert.equal(snapshot(a.state, T0 + 5 * H).welcome.awayMs, 5 * H);
});

/* ─────────────── habilidades ─────────────── */
test('abilities: need tier 2, cooldown blocks, instant grants production, recall halves cooldowns', () => {
  let s = make({ tier: 1, pets: ['byte'] });
  assert.equal(run(s, { type: 'ability', id: 'compile-burst' }).error, 'Habilidades liberam no tier 2');
  s = make({ tier: 2, gens: { 'index-worker': 10 }, pets: ['byte', 'query', 'memo'] });
  let r = run(s, { type: 'ability', id: 'compile-burst' });
  assert.equal(run(r.state, { type: 'ability', id: 'compile-burst' }, T0 + 60e3).error, 'Em recarga');
  const rate = production(r.state, T0 + 60e3).rate; // sem o burst (acabou em 30 s)
  const idx = run(r.state, { type: 'ability', id: 'index' }, T0 + 60e3);
  near(idx.log.find((x) => x.type === 'instant').gained, rate * 600);
  const rec = run(idx.state, { type: 'ability', id: 'recall' }, T0 + 60e3).state;
  near(rec.run.abilities['compile-burst'].readyAt, T0 + 60e3 + (T0 + 300e3 - (T0 + 60e3)) * 0.5);
  assert.deepEqual(abilitiesList(rec, T0 + 60e3).filter((a) => a.ready).map((a) => a.id), []);
});

/* ─────────────── descobertas ─────────────── */
test('discoveries: 100 events in one day = 1 day; distinct ids; rewards once', () => {
  let s = make({});
  for (let i = 0; i < 100; i++) s = run(s, { type: 'event', name: 'palette.opened' }, T0 + i * 1000).state;
  assert.equal(s.usage.days['palette.opened'].length, 1);
  assert.ok(!s.discoveries.found['shortcut-engine']);
  const r = run(s, { type: 'event', name: 'palette.opened' }, T0 + 24 * H);
  assert.ok(r.state.discoveries.found['shortcut-engine']);
  assert.ok(r.state.run.pets.noxi);
  assert.equal(r.log.filter((x) => x.type === 'discovery' && x.id === 'shortcut-engine').length, 1);
  assert.equal(run(r.state, { type: 'event', name: 'palette.opened' }, T0 + 48 * H).log.filter((x) => x.type === 'discovery').length, 0);

  let t = make({});
  for (const tool of ['sql', 'sql', 'xml']) t = run(t, { type: 'event', name: 'tool.used', data: { tool } }).state;
  assert.deepEqual(t.usage.distinct['tool.used'], ['sql', 'xml']);
  assert.ok(!t.discoveries.found.toolsmith);
  t = run(t, { type: 'event', name: 'tool.used', data: { tool: 'diff' } }).state;
  assert.ok(t.discoveries.found.toolsmith);
  // chave com caracteres estranhos é ignorada (nada de conteúdo do usuário no estado)
  t = run(t, { type: 'event', name: 'tool.used', data: { tool: 'x'.repeat(200) } }).state;
  assert.equal(t.usage.distinct['tool.used'].length, 3);
});

test('discoveries: economy eras set the tier; any/all conditions', () => {
  const s = make({});
  s.run.resources.compute.lifetime = 1e4;
  const r = run(s, { type: 'tick' });
  assert.equal(r.state.run.tier, 2);
  assert.ok(r.log.some((x) => x.type === 'tier' && x.tier === 2));
  let d = make({});
  d = run(d, { type: 'event', name: 'tool.opened', data: { tool: 'notes' } }).state;
  d = run(d, { type: 'event', name: 'tool.opened', data: { tool: 'notes' } }, T0 + 24 * H).state;
  assert.ok(d.discoveries.found['data-layer']); // "Notes buscadas" em 2 dias (any)
  assert.ok(d.run.pets.query);
});

test('upgrades: requirements, cost, mechanic unlocks; news only for unseen affordable upgrades', () => {
  let s = make({ compute: 1e6, gens: { 'terminal-worker': 9 } });
  assert.equal(run(s, { type: 'upgrade', id: 'terminal-optimization' }).error, 'Upgrade indisponível');
  s.run.generators['terminal-worker'].owned = 10;
  let v = snapshot(s, T0);
  assert.ok(v.hasNews && v.newUpgrades.includes('terminal-optimization'));
  s = run(s, { type: 'seen', upgrades: v.newUpgrades }).state;
  assert.equal(snapshot(s, T0).newUpgrades.length, 0);
  const r = run(s, { type: 'upgrade', id: 'terminal-optimization' });
  assert.equal(r.error, undefined);
  assert.equal(run(r.state, { type: 'upgrade', id: 'terminal-optimization' }).error, 'Upgrade indisponível');
});

/* ─────────────── estado ─────────────── */
test('state: JSON round trip and migration of partial/invalid files', () => {
  const s = run(make({ gens: { 'terminal-worker': 3 } }), { type: 'boot' }, T0 + H).state;
  const back = migrate(JSON.parse(JSON.stringify(s)), T0 + 2 * H);
  assert.deepEqual(back, JSON.parse(JSON.stringify(s)));
  const partial = migrate({ run: { resources: { compute: { amount: 5, lifetime: 5 } }, generators: {} } }, T0);
  assert.equal(partial.run.resources.compute.amount, 5);
  assert.ok(partial.usage && partial.discoveries && partial.meta && partial.clock.lastUpdate);
  assert.equal(migrate('lixo', T0).run.resources.compute.amount, CONTENT.BALANCE.start.compute);
});

test('dispatch is pure (input state untouched)', () => {
  const s = make({ compute: 1e6 });
  const before = JSON.stringify(s);
  run(s, { type: 'buy', gen: 'terminal-worker', qty: 'max' }, T0 + H);
  assert.equal(JSON.stringify(s), before);
});

test('format: pt-BR numbers and durations', () => {
  assert.equal(formatNum(12482.7), '12.482');
  assert.equal(formatNum(1.25e6), '1,25 M');
  assert.equal(formatNum(38.44, { rate: true }), '38,4');
  assert.equal(formatNum(3.4e9), '3,40 B');
  assert.equal(formatDuration(3 * H + 42 * 60e3), '3h 42m');
  assert.equal(formatDuration(45e3), '45s');
});

/* ─────────────── balanceamento ─────────────── */
test('balance: pacing stays inside the MVP targets', () => {
  const e = simulate(PROFILES.engaged);
  assert.ok(e.t2 >= 15 * 60e3 && e.t2 <= 60 * 60e3, 'T2 engajado: ' + e.t2 / 60e3 + ' min');
  assert.ok(e.maxCheapestSec <= 5 * 60, 'espera pela compra mais barata: ' + e.maxCheapestSec + ' s');
  const c = simulate(PROFILES.casual);
  assert.ok(c.t3 >= 1 * 86400e3 && c.t3 <= 3 * 86400e3, 'T3 casual: ' + c.t3 / 86400e3 + ' dias');
  assert.ok(c.pets.noxi != null && c.pets.query != null && c.pets.memo != null, 'todos os pets aparecem em uma semana de uso');
});

/* ─────────────── Event Bus e serviço (processo principal) ─────────────── */
const { createBus } = require('../electron/events.js');
const { createDevCoreService } = require('../electron/devcore/service.js');
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const pathMod = require('node:path');

test('bus: whitelist, throttle per name+key, payload sanitized', () => {
  let t = 0;
  const bus = createBus({ now: () => t });
  const got = [];
  bus.on('*', (name, data) => got.push([name, data]));
  assert.equal(bus.emit('hack.money', {}), false);
  assert.equal(bus.emit('tool.used', { tool: 'sql', content: 'SELECT * FROM segredo' }), true);
  assert.equal(bus.emit('tool.used', { tool: 'sql' }), false); // < 1 min
  assert.equal(bus.emit('tool.used', { tool: 'xml' }), true);  // outra chave
  t = 61e3;
  assert.equal(bus.emit('tool.used', { tool: 'sql' }), true);
  assert.deepEqual(got[0], ['tool.used', { tool: 'sql' }]); // conteúdo descartado
  assert.equal(bus.emit('tool.used', { tool: '../../etc' }), true);
  assert.deepEqual(got.at(-1)[1], {});
});

test('service: boot/persist/offline welcome/heartbeat/UI actions/events', async () => {
  const dir = mkdtempSync(pathMod.join(tmpdir(), 'devcore-'));
  const file = pathMod.join(dir, 'devcore.json');
  let clock = T0;
  const sent = [];
  try {
    let svc = createDevCoreService({ file, now: () => clock, broadcast: (m) => sent.push(m) });
    let v = await svc.init();
    assert.equal(v.welcome, null);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).clock.lastUpdate, T0);

    clock += 60e3;
    let r = await svc.act({ type: 'buy', gen: 'terminal-worker', qty: 'max' });
    assert.ok(r.ok, r.error);
    assert.equal((await svc.act({ type: 'boot' })).error, 'Ação não permitida');
    svc.onEvent('palette.opened', {});
    assert.ok(sent.length >= 1 && sent.at(-1).snapshot);
    await svc.flush();

    // App fechado por 3 h → novo processo: resumo de retorno e ganho.
    clock += 3 * H;
    svc = createDevCoreService({ file, now: () => clock });
    v = await svc.init();
    assert.ok(v.welcome && Math.abs(v.welcome.awayMs - 3 * H) < 1000, JSON.stringify(v.welcome));
    assert.ok(v.welcome.gained > 0);
    r = await svc.act({ type: 'ackWelcome' });
    assert.equal(r.snapshot.welcome, null);
    await svc.flush();

    // Arquivo corrompido → recomeça sem quebrar.
    writeFileSync(file, '{ não é json');
    svc = createDevCoreService({ file, now: () => clock });
    v = await svc.init();
    assert.equal(v.generators[0].owned, 1);
    await svc.flush();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ─────────────── aparência dos DevPets ─────────────── */
const { stageOf } = require('../src/devcore/engine/appearance.js');

test('appearance: stages by level; training emits evolve only when crossing', () => {
  assert.deepEqual([1, 4, 5, 9, 10, 12].map((l) => stageOf(l).name), ['Base', 'Base', 'Veterano', 'Veterano', 'Mestre', 'Mestre']);
  let s = make({ compute: 1e15, pets: ['byte'] });
  const evolves = [];
  for (let i = 0; i < 9; i++) {
    const r = run(s, { type: 'train', pet: 'byte' });
    s = r.state;
    for (const e of r.log) if (e.type === 'evolve') evolves.push([s.run.pets.byte.level, e.name]);
  }
  assert.deepEqual(evolves, [[5, 'Veterano'], [10, 'Mestre']]);
  const v = snapshot(s, T0).pets.find((p) => p.id === 'byte');
  assert.equal(v.stage.name, 'Mestre');
  assert.equal(v.stage.next, null);
});

test('appearance: skins unlock once, stay unlocked, and are chosen per pet', () => {
  let s = make({ compute: 1e15, pets: ['byte', 'noxi'] });
  assert.equal(run(s, { type: 'skin', pet: 'byte', skin: 'monokai' }).error, 'Visual bloqueado');
  s = run(s, { type: 'train', pet: 'byte' }).state;
  const r = run(s, { type: 'train', pet: 'byte' }); // nível 3 → Monokai
  assert.deepEqual(r.log.filter((e) => e.type === 'skin').map((e) => e.id), ['monokai']);
  s = r.state;
  assert.equal(run(s, { type: 'tick' }).log.filter((e) => e.type === 'skin').length, 0); // só uma vez
  let v = snapshot(s, T0);
  assert.ok(v.hasNews && v.freshSkins.includes('monokai'));
  assert.equal(v.skins.find((k) => k.id === 'neon').requirement, 'descoberta Toolsmith');
  s = run(s, { type: 'skin', pet: 'noxi', skin: 'monokai' }).state; // vale para qualquer pet
  v = snapshot(s, T0);
  const noxi = v.pets.find((p) => p.id === 'noxi');
  assert.equal(noxi.skin, 'monokai');
  assert.equal(noxi.color, '#F92672');
  assert.equal(v.pets.find((p) => p.id === 'byte').color, CONTENT.pet.byte.color);
  assert.ok(!v.freshSkins.includes('monokai')); // usar o visual tira o "NOVO"
  // Um reset da infraestrutura (futuro Rebuild) não tira visuais já desbloqueados.
  s.run.pets = { byte: { level: 1, station: false } };
  assert.ok(snapshot(run(s, { type: 'tick' }).state, T0).skins.find((k) => k.id === 'monokai').unlocked);
  assert.equal(run(s, { type: 'skin', pet: 'query', skin: 'default' }).error, 'DevPet indisponível');
});

test('appearance: old saves gain the cosmetics section; tier 3 unlocks Solarized', () => {
  const old = JSON.parse(JSON.stringify(make({})));
  delete old.cosmetics;
  const m = migrate(old, T0);
  assert.deepEqual(m.cosmetics, { skins: {}, unlocked: ['default'], fresh: [] });
  const t3 = make({ tier: 3 });
  assert.ok(run(t3, { type: 'tick' }).state.cosmetics.unlocked.includes('solarized'));
});
