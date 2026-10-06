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
const { simulate, PROFILES, incidentLoss } = require('../src/devcore/sim.js');

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
  assert.ok(CONTENT.PETS.length >= 3 && CONTENT.PETS.length <= 8);
  assert.ok(CONTENT.UPGRADES.length >= 10 && CONTENT.UPGRADES.length <= 20);
  assert.ok(CONTENT.DISCOVERIES.length >= 5 && CONTENT.DISCOVERIES.length <= 14);
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

test('pets: level scales bonus; station doubles it (tier 2+: 1 slot, tier 3: 2 slots)', () => {
  const base = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'], tier: 3 });
  base.run.pets.byte.level = 3; // +20%
  near(production(base, T0).rate, 1 * (1 + 0.15 * 1.2) * (1 + 0.05 * 1.2));
  let r = run(base, { type: 'station', pet: 'byte', on: true });
  assert.equal(r.error, undefined);
  near(production(r.state, T0).rate, 1 * (1 + 0.15 * 1.2 * 2) * (1 + 0.05 * 1.2 * 2));
  const t2 = make({ tier: 2, pets: ['byte', 'noxi'] });
  r = run(t2, { type: 'station', pet: 'byte', on: true });
  assert.equal(r.error, undefined);
  assert.equal(run(r.state, { type: 'station', pet: 'noxi', on: true }).error, 'Sem estações livres');
  const t3 = make({ tier: 3, pets: ['byte', 'noxi', 'query'] });
  r = run(run(t3, { type: 'station', pet: 'byte', on: true }).state, { type: 'station', pet: 'noxi', on: true });
  assert.equal(r.error, undefined);
  assert.equal(run(r.state, { type: 'station', pet: 'query', on: true }).error, 'Sem estações livres');
  assert.equal(run(make({ tier: 1, pets: ['byte'] }), { type: 'station', pet: 'byte', on: true }).error, 'Estações liberam no tier 2');
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
  for (const id of ['noxi', 'query', 'memo', 'relay', 'armo']) assert.ok(c.pets[id] != null, id + ' aparece em uma semana de uso');
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

/* ─────────────── DevPets de Agents e Infra ─────────────── */
test('every production category has a DevPet', () => {
  const covered = new Set(CONTENT.PETS.map((p) => p.category));
  for (const cat of CONTENT.CATEGORIES) assert.ok(covered.has(cat.id), 'sem pet: ' + cat.id);
});

test('Relay: Command Center needs tier 3 + 5 distinct commands', () => {
  let s = make({ tier: 2 });
  for (const id of ['a', 'b', 'c', 'd', 'e']) s = run(s, { type: 'event', name: 'command.executed', data: { id } }).state;
  assert.ok(!s.run.pets.relay); // tier 2 ainda
  s.run.tier = 3;
  const r = run(s, { type: 'tick' });
  assert.ok(r.state.run.pets.relay);
  assert.ok(r.log.some((e) => e.type === 'discovery' && e.id === 'command-center' && e.finder === 'noxi'));
});

test('Armo: Always On needs tier 3 + DevKit used on 5 different days (same day = 1)', () => {
  let s = make({ tier: 3 });
  for (let i = 0; i < 20; i++) s = run(s, { type: 'event', name: 'tool.opened', data: { tool: 'sql' } }, T0 + i * 60e3).state;
  assert.ok(!s.run.pets.armo);
  for (let d = 1; d <= 4; d++) s = run(s, { type: 'event', name: 'tool.opened', data: { tool: 'notes' } }, T0 + d * 24 * H).state;
  assert.ok(s.run.pets.armo);
});

test('Armo global bonus scales with active categories; new abilities burst their category', () => {
  const two = make({ tier: 3, gens: { 'local-cluster': 1, 'terminal-worker': 1 }, pets: ['armo'] });
  const three = make({ tier: 3, gens: { 'local-cluster': 1, 'terminal-worker': 1, 'script-runner': 1 }, pets: ['armo'] });
  const shell = (s) => production(s, T0).gens['terminal-worker'];
  near(shell(two), 0.1 * (1 + 0.02 * 2));
  near(shell(three), 0.1 * (1 + 0.02 * 3));
  assert.ok(snapshot(two, T0).pets.find((p) => p.id === 'armo').bonus.some((b) => b.endsWith('por categoria ativa')));
  const s = make({ tier: 3, gens: { agent: 1, 'local-cluster': 1 }, pets: ['relay', 'armo'] });
  const base = production(s, T0).gens;
  let r = run(s, { type: 'ability', id: 'orchestrate' });
  near(production(r.state, T0).gens.agent, base.agent * 4);
  near(production(r.state, T0).gens['local-cluster'], base['local-cluster']);
  r = run(r.state, { type: 'ability', id: 'scale-out' });
  near(production(r.state, T0).gens['local-cluster'], base['local-cluster'] * 3);
});

test('director: never more than 2 pets in the same spot while there is room', () => {
  const { plan } = require('../src/devcore/director.js');
  const pets = CONTENT.PETS.map((p) => ({ id: p.id, category: p.category, lines: p.lines }));
  const stations = CONTENT.CATEGORIES.map((c) => ({ id: c.id }));
  for (let t = 0; t < 600e3; t += 1000) {
    const counts = {};
    for (const d of plan(pets, stations, T0 + t)) counts[d.spot] = (counts[d.spot] || 0) + 1;
    assert.ok(Math.max(...Object.values(counts)) <= 2, JSON.stringify(counts));
  }
  // Sem estações: todos descansam (não há para onde ir).
  assert.ok(plan(pets, [], T0).every((d) => d.spot === -1));
});

/* ─────────────── Incidentes ("pets do mal") e consumíveis ─────────────── */
const { itemsList } = require('../src/devcore/engine/view.js');
const { craftCost } = require('../src/devcore/engine/index.js');

/** Estado no tier dado com o próximo incidente forçado. */
function withNext(opts, id, inMs = H, durMin = 60) {
  const s = make(opts);
  s.run.incidents.next = { id, at: T0 + inMs, durationMs: durMin * 60e3 };
  return s;
}

test('incidents: deterministic schedule; only unlocked types; none in tier 1 or quiet mode', () => {
  const a = run(make({ tier: 2 }), { type: 'tick' }).state.run.incidents.next;
  const b = run(make({ tier: 2 }), { type: 'tick' }).state.run.incidents.next;
  assert.deepEqual(a, b);
  const h = (a.at - T0) / H;
  assert.ok(h >= 3 && h <= 6, 'intervalo ' + h);
  let s = make({ tier: 2 });
  const seen = new Set();
  for (let i = 0; i < 40; i++) { s = run(s, { type: 'tick' }, T0 + i * 7 * H).state; if (s.run.incidents.next) seen.add(s.run.incidents.next.id); }
  assert.deepEqual([...seen].sort(), ['flaky-pipeline', 'memory-leak']); // tier 2: só esses
  assert.equal(run(make({ tier: 1 }), { type: 'tick' }).state.run.incidents.next, null);
  const q = run(make({ tier: 2 }), { type: 'quiet', on: true }).state;
  assert.equal(q.run.incidents.next, null);
  assert.equal(run(q, { type: 'tick' }, T0 + 30 * H).state.run.incidents.history.length, 0);
});

test('incidents: exact integral with an escaped incident in the middle of the interval', () => {
  const s = withNext({ tier: 2, gens: { 'index-worker': 10, 'terminal-worker': 10 }, pets: [] }, 'memory-leak', 10 * 60e3, 30);
  const g = production(s, T0).gens;
  const rate = g['index-worker'] + g['terminal-worker'];
  const hit = g['index-worker'] * 0.8 + g['terminal-worker'];
  // 10 min normal + 30 min com Data ×0,8 + 20 min normal
  near(produced(s, T0, T0 + H), rate * 600 + hit * 1800 + rate * 1200);
});

test('incidents: containment at start by the right station, Rollback shield, Zero-day ignores stations', () => {
  let s = withNext({ tier: 2, pets: ['query'] }, 'memory-leak');
  s.run.pets.query.station = true;
  let r = run(s, { type: 'tick' }, T0 + H + 1000);
  assert.ok(r.log.some((e) => e.type === 'contained' && e.by === 'query' && e.item));
  assert.equal(r.state.bestiary.leaky.contained, 1);
  // Contido: o vilão é barrado e some em ~1 min, sem efeito.
  assert.equal(r.state.run.incidents.active.end - r.state.run.incidents.active.start, CONTENT.BALANCE.incidents.blockedSec * 1000);

  s = withNext({ tier: 3, pets: ['query'] }, 'zero-day');
  s.run.pets.query.station = true;
  r = run(s, { type: 'tick' }, T0 + H + 1000);
  assert.equal(r.state.run.incidents.active.contained, false); // estação não segura o Zero
  s = withNext({ tier: 3 }, 'zero-day');
  s.run.shields = 1;
  r = run(s, { type: 'tick' }, T0 + H + 1000);
  assert.equal(r.state.run.incidents.active.by, 'rollback');
  assert.equal(r.state.run.shields, 0);
});

test('incidents: 8 h offline processes several incidents in order; production only up to the cap', () => {
  const s = make({ tier: 2, gens: { 'terminal-worker': 10 }, pets: ['byte'] });
  const r = run(s, { type: 'boot' }, T0 + 20 * H);
  const starts = r.log.filter((e) => e.type === 'incidentStart').map((e) => e.at);
  assert.ok(starts.length >= 2, 'incidentes: ' + starts.length);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(starts.at(-1) > T0 + 8 * H); // incidentes continuam depois do teto de produção
  assert.equal(r.state.pending.welcome.incidents.length, starts.length);
  assert.equal(r.state.pending.welcome.countedMs, 8 * H);
});

test('incidents: loss never below the floor; Merge Conflict locks abilities until Hotfix', () => {
  for (const i of CONTENT.INCIDENTS) for (const e of i.effects) assert.ok(e.value >= CONTENT.BALANCE.incidents.lossFloor);
  let s = withNext({ tier: 3, pets: ['byte', 'relay'] }, 'merge-conflict', 1000);
  s.run.inventory.hotfix = 1;
  s = run(s, { type: 'tick' }, T0 + 5000).state;
  assert.match(run(s, { type: 'ability', id: 'compile-burst' }, T0 + 6000).error, /Merge Conflict/);
  const r = run(s, { type: 'use', item: 'hotfix' }, T0 + 6000);
  assert.equal(r.state.run.incidents.active, null);
  assert.equal(r.state.bestiary.forky.defeated, 1);
  assert.equal(run(r.state, { type: 'ability', id: 'compile-burst' }, T0 + 7000).error, undefined);
});

test('consumables: use each, caps, craft cost scales with production, Cache Warmer', () => {
  const s = make({ tier: 2, compute: 1e9, gens: { 'terminal-worker': 10 }, pets: ['byte'] });
  const rate = production(s, T0).rate;
  s.run.inventory = { coffee: 2, rollback: 1, 'cache-warmer': 1, hotfix: 1 };
  let r = run(s, { type: 'use', item: 'coffee' });
  near(production(r.state, T0).rate, rate * 1.5);
  r = run(r.state, { type: 'use', item: 'coffee' });
  assert.equal(r.state.run.boosts.length, 1); // estende, não empilha
  assert.equal(r.state.run.boosts[0].until, T0 + 1200e3);
  assert.equal(run(r.state, { type: 'use', item: 'coffee' }).error, 'Item indisponível');
  assert.equal(run(r.state, { type: 'use', item: 'hotfix' }).error, 'Nenhum incidente para corrigir');
  assert.equal(run(r.state, { type: 'use', item: 'cache-warmer' }).error, 'Nenhuma habilidade em recarga');
  r = run(r.state, { type: 'ability', id: 'compile-burst' });
  r = run(r.state, { type: 'use', item: 'cache-warmer' }, T0 + 60e3);
  assert.equal(r.state.run.abilities['compile-burst'].readyAt, T0 + 60e3);
  r = run(r.state, { type: 'use', item: 'rollback' }, T0 + 60e3);
  assert.equal(r.state.run.shields, 1);
  const k = CONTENT.consumable.coffee;
  near(craftCost(s, k, T0), Math.max(50, k.craftMinutes * 60 * rate));
  let c = make({ compute: 1e12, tier: 2 });
  for (let i = 0; i < k.cap; i++) c = run(c, { type: 'craft', item: 'coffee' }).state;
  assert.equal(run(c, { type: 'craft', item: 'coffee' }).error, 'Estoque cheio');
  assert.deepEqual(itemsList(c, T0).map((x) => x.id), ['coffee']);
});

test('pet finds may bring consumables (seeded) and fall back to Compute when full', () => {
  // Vários "retornos" (seeds diferentes): aparecem caches, consumíveis e peças; o mesmo seed repete o resultado.
  const finds = [];
  for (let k = 0; k < 12; k++) {
    const s = make({ gens: { 'terminal-worker': 10 }, pets: ['byte', 'noxi'] });
    s.seed = 1000 + k;
    const w = run(s, { type: 'boot' }, T0 + 8 * H).state.pending.welcome;
    assert.equal(w.finds.length, 4);
    finds.push(...w.finds);
  }
  assert.ok(finds.some((f) => f.item) && finds.some((f) => f.amount) && finds.some((f) => f.part), 'tipos de achado');
  const a = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'] });
  assert.deepEqual(run(a, { type: 'boot' }, T0 + 8 * H).state.pending.welcome.finds, run(a, { type: 'boot' }, T0 + 8 * H).state.pending.welcome.finds);
  // Estoque cheio e sem peça nova possível → vira cache de Compute.
  const full = make({ gens: { 'terminal-worker': 10 }, pets: ['byte'] });
  for (const k of CONTENT.CONSUMABLES) full.run.inventory[k.id] = k.cap;
  full.run.blueprints = { 'terminal-worker': { mk: 3, parts: {} }, 'script-runner': { mk: 3, parts: {} } };
  assert.ok(run(full, { type: 'boot' }, T0 + 8 * H).state.pending.welcome.finds.every((f) => f.amount > 0));
});

test('ops view: forecast hidden until 2 h before; bestiary survives a run reset; old saves migrate', () => {
  const s = withNext({ tier: 2, pets: ['query'] }, 'memory-leak', 3 * H);
  assert.ok(snapshot(s, T0).ops.forecast.hidden);
  const f = snapshot(s, T0 + 1.5 * H).ops.forecast;
  assert.equal(f.villain.name, 'Leaky');
  assert.deepEqual(f.counters.map((x) => [x.id, x.owned, x.station]), [['query', true, false], ['memo', false, false]]);
  assert.equal(f.covered, false);
  const r = run(s, { type: 'tick' }, T0 + 4 * H).state;
  r.run = make({}).run; // "Rebuild"
  assert.equal(r.bestiary.leaky.seen, 1);
  const old = JSON.parse(JSON.stringify(make({})));
  delete old.bestiary; delete old.settings; delete old.run.incidents; delete old.run.inventory;
  const m = migrate(old, T0);
  assert.deepEqual([m.bestiary, m.settings.quiet, m.run.incidents.history, m.run.inventory], [{}, false, [], {}]);
});

test('balance: incidents cost little, preparation pays off, 1–3 items per day', () => {
  const passive = incidentLoss({ ...PROFILES.casual, strategy: 'passive' });
  const prepared = incidentLoss({ ...PROFILES.casual, strategy: 'prepared' });
  assert.ok(passive.loss <= 0.08, 'perda passiva ' + passive.loss);
  assert.ok(prepared.loss <= 0.02, 'perda preparada ' + prepared.loss);
  assert.ok(prepared.marks.incidents.contained > passive.marks.incidents.contained * 2, 'preparar deve conter bem mais');
  const perDay = prepared.marks.items / PROFILES.casual.days;
  assert.ok(perDay >= 1 && perDay <= 3, 'itens/dia ' + perDay);
});

test('director: villain takes a spot, stationed pets stay home, the container talks about it', () => {
  const { plan, villainSpot } = require('../src/devcore/director.js');
  const pets = CONTENT.PETS.map((p) => ({ id: p.id, category: p.category, lines: p.lines, station: p.id === 'query' }));
  const stations = CONTENT.CATEGORIES.map((c) => ({ id: c.id }));
  const spot = villainSpot('data', stations);
  assert.equal(spot, 2);
  assert.equal(villainSpot(null, stations), 2); // Zero: meio da cena
  for (let t = 0; t < 300e3; t += 1000) {
    const d = plan(pets, stations, T0 + t, [], { villain: { spot, name: 'Leaky', contained: true, by: 'query' } });
    const q = d.find((x) => x.id === 'query');
    assert.equal(q.spot, 2);
    assert.equal(q.line, 'segurando Leaky...');
    // No lugar do vilão: ele + no máximo 1 pet (o que está em estação ali tem prioridade).
    assert.ok(d.filter((x) => x.spot === spot).length <= 2);
  }
});

/* ─────────────── marcos e blueprints ─────────────── */
const BP = require('../src/devcore/engine/blueprints.js');
const { partCost } = require('../src/devcore/engine/index.js');
const setOf = (gen, mk) => [0, 1, 2, 3].map((i) => BP.partId(gen, mk, i));
const give = (s, gen, mk, n = 4) => {
  const cur = s.run.blueprints[gen] || (s.run.blueprints[gen] = { mk: 1, parts: {} });
  for (const id of setOf(gen, mk).slice(0, n)) cur.parts[id] = true;
};

test('milestones: multiplier exactly at 25/50/100…; nextMilestone', () => {
  const M = CONTENT.BALANCE.milestones;
  const mult = (n) => BP.generatorMult(make({ gens: { 'terminal-worker': n } }), 'terminal-worker');
  assert.equal(mult(24), 1);
  near(mult(25), M.mult[0]);
  near(mult(49), M.mult[0]);
  near(mult(50), M.mult[0] * M.mult[1]);
  near(mult(100), M.mult[0] * M.mult[1] * M.mult[2]);
  assert.deepEqual(BP.nextMilestone(85), { at: 100, from: 50, left: 15, mult: M.mult[2] });
  assert.equal(BP.nextMilestone(300), null);
  // A produção do gerador sobe na mesma proporção (efeito mul gen:<id>).
  const r = (n) => production(make({ gens: { 'terminal-worker': n } }), T0).rate / n;
  near(r(25) / r(24), M.mult[0]);
});

test('blueprints: Refactor needs the full set, consumes it, ×3 then ×15, cheaper units; Mk III only after Mk II', () => {
  const s = make({ gens: { 'terminal-worker': 10 } });
  const base = production(s, T0).rate;
  give(s, 'terminal-worker', 2, 3);
  assert.equal(run(s, { type: 'refactor', gen: 'terminal-worker' }).error, 'Conjunto incompleto');
  assert.equal(run(s, { type: 'buyPart', part: BP.partId('terminal-worker', 3, 0) }).error, 'Faça o Mk II antes');
  give(s, 'terminal-worker', 2);
  let r = run(s, { type: 'refactor', gen: 'terminal-worker' });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.state.run.blueprints['terminal-worker'], { mk: 2, parts: {} });
  assert.ok(r.log.some((e) => e.type === 'refactor' && e.mk === 2 && e.category === 'shell'));
  near(production(r.state, T0).rate, base * 3);
  const g = CONTENT.gen['terminal-worker'];
  near(snapshot(r.state, T0).generators.find((x) => x.id === g.id).cost1, costOf(g, 10) / 4);
  give(r.state, 'terminal-worker', 3);
  r = run(r.state, { type: 'refactor', gen: 'terminal-worker' });
  near(production(r.state, T0).rate, base * 15);
  assert.equal(run(r.state, { type: 'refactor', gen: 'terminal-worker' }).error, 'Nível máximo');
  assert.equal(snapshot(r.state, T0).generators.find((x) => x.id === g.id).mk, 3);
});

test('blueprints: buy costs N hours of production and refuses owned parts; scrap trades 5 (Mk II)', () => {
  const s = make({ compute: 1e12, gens: { 'terminal-worker': 10 } });
  const rate = production(s, T0).rate;
  const id = BP.partId('terminal-worker', 2, 1);
  near(partCost(s, 2, T0), Math.max(500, CONTENT.BALANCE.blueprints.buyMinutes[2] * 60 * rate));
  let r = run(s, { type: 'buyPart', part: id });
  assert.equal(r.error, undefined);
  near(r.state.run.resources.compute.amount, 1e12 - partCost(s, 2, T0));
  assert.equal(run(r.state, { type: 'buyPart', part: id }).error, 'Peça já obtida');
  const poor = make({ gens: { 'terminal-worker': 10 } });
  assert.equal(run(poor, { type: 'buyPart', part: id }).error, 'Compute insuficiente');
  const need = CONTENT.BALANCE.blueprints.scrapPerPart[2];
  poor.run.scrap = need - 1;
  assert.match(run(poor, { type: 'scrapPart', part: id }).error, /Sucata insuficiente/);
  poor.run.scrap = need;
  r = run(poor, { type: 'scrapPart', part: id });
  assert.equal(r.state.run.scrap, 0);
  assert.ok(r.state.run.blueprints['terminal-worker'].parts[id]);
  assert.equal(run(poor, { type: 'buyPart', part: 'nope:mk2:0' }).error, 'Peça inexistente');
});

test('blueprints: contained villain drops a part of the attacked category; escaped drops none; Zero gives Mk III', () => {
  for (let k = 0; k < 6; k++) {
    const s = withNext({ tier: 2, pets: ['query'] }, 'memory-leak');
    s.seed = 77 + k;
    s.run.pets.query.station = true;
    const r = run(s, { type: 'tick' }, T0 + H + 1000);
    const p = r.log.find((e) => e.type === 'part' && e.source === 'incident');
    assert.equal(p.gen, 'index-worker'); // único gerador de Data
    assert.equal(p.mk, 2);
  }
  const esc = run(withNext({ tier: 2 }, 'memory-leak'), { type: 'tick' }, T0 + 3 * H);
  assert.ok(!esc.log.some((e) => e.type === 'part'));
  // Zero segurado pelo Rollback → peça Mk III de quem já tem o Mk II.
  const z = withNext({ tier: 3 }, 'zero-day');
  z.run.shields = 1;
  z.run.blueprints['agent'] = { mk: 2, parts: {} };
  const zp = run(z, { type: 'tick' }, T0 + H + 1000).log.find((e) => e.type === 'part');
  assert.deepEqual([zp.gen, zp.mk], ['agent', 3]);
  // Zero derrotado com Hotfix também.
  const h = withNext({ tier: 3 }, 'zero-day', 1000);
  h.run.inventory.hotfix = 1;
  h.run.blueprints['local-cluster'] = { mk: 2, parts: {} };
  const hs = run(h, { type: 'tick' }, T0 + 5000).state;
  const hr = run(hs, { type: 'use', item: 'hotfix' }, T0 + 6000);
  assert.ok(hr.log.some((e) => e.type === 'part' && e.mk === 3 && e.gen === 'local-cluster' && e.source === 'boss'));
});

test('blueprints: duplicates and exhausted levels become scrap; drops are seeded', () => {
  const s = make({ gens: { 'terminal-worker': 1 } });
  give(s, 'terminal-worker', 2); give(s, 'script-runner', 2);
  const d = BP.dropPart(s, () => 0.1, { mk2Only: true });
  assert.equal(d.dup, true);
  assert.equal(s.run.scrap, 1);
  s.run.blueprints = { 'terminal-worker': { mk: 3, parts: {} }, 'script-runner': { mk: 3, parts: {} } };
  assert.equal(BP.dropPart(s, () => 0.5, {}).type, 'scrap');
  assert.equal(s.run.scrap, 2);
  const seq = (x) => { let i = 0; const r = () => (i++ * 0.37) % 1; return [0, 1, 2, 3].map(() => BP.dropPart(x, r, { category: 'automation' })); };
  assert.deepEqual(seq(make({ tier: 2 })), seq(make({ tier: 2 })));
  assert.ok(seq(make({ tier: 2 })).every((p) => ['script-runner', 'automation-worker'].includes(p.gen)));
});

test('blueprints: old saves migrate; view exposes Mk, milestone and the set', () => {
  const old = JSON.parse(JSON.stringify(make({})));
  delete old.run.blueprints; delete old.run.scrap;
  const m = migrate(old, T0);
  assert.deepEqual([m.run.blueprints, m.run.scrap], [{}, 0]);
  const s = make({ gens: { 'terminal-worker': 30 } });
  give(s, 'terminal-worker', 2, 2);
  const v = snapshot(s, T0);
  const g = v.generators.find((x) => x.id === 'terminal-worker');
  assert.equal(g.mk, 1);
  assert.equal(g.nextMilestone.at, 50);
  assert.deepEqual([g.blueprint.mk, g.blueprint.owned, g.blueprint.complete, g.blueprint.parts.length], [2, 2, false, 4]);
  assert.equal(v.scrap, 0);
});

test('balance: blueprints — 1st Mk II within ~2–4.5 days, Mk III reachable in 2 weeks; T3 casual 1–3 days', () => {
  const m = simulate({ ...PROFILES.casual, days: 14, strategy: 'prepared' });
  assert.ok(m.t3 >= 1 * 86400e3 && m.t3 <= 3 * 86400e3, 't3 ' + m.t3 / 86400e3);
  assert.ok(m.firstMk2 && m.firstMk2 >= 2 * 86400e3 && m.firstMk2 <= 4.5 * 86400e3, 'mk2 ' + m.firstMk2 / 86400e3);
  assert.ok(m.firstMk3 && m.firstMk3 <= 14 * 86400e3, 'mk3');
});

/* ─────────────── missões diárias ─────────────── */
/** Dispara no estado os eventos que completam todas as missões do dia. */
function doAllQuests(s, now) {
  let r = run(s, { type: 'tick' }, now); // rola o dia
  for (const id of r.state.quests.ids) {
    const w = CONTENT.quest[id].when;
    const [name, key] = w.event.split(':');
    const keys = key ? [key] : ['sql', 'xml', 'diff'].slice(0, w.distinct || 1);
    for (const k of keys) r = run(r.state, { type: 'event', name, data: key || w.distinct ? { tool: k, id: k } : undefined }, now);
  }
  return r;
}

test('quests: 3 missões por dia, determinísticas, e trocam no dia seguinte sem perder nada', () => {
  const a = run(make(), { type: 'tick' });
  assert.equal(a.state.quests.ids.length, CONTENT.BALANCE.quests.perDay);
  assert.equal(new Set(a.state.quests.ids).size, a.state.quests.ids.length);
  assert.deepEqual(run(make(), { type: 'tick' }).state.quests.ids, a.state.quests.ids); // mesma seed + dia
  const done = doAllQuests(make(), T0);
  assert.equal(done.state.quests.total, 3);
  const next = run(done.state, { type: 'tick' }, T0 + 24 * H);
  assert.equal(next.state.quests.total, 3, 'o contador vitalício fica');
  assert.deepEqual(next.state.quests.done, []);
  assert.notEqual(next.state.quests.day, done.state.quests.day);
});

test('quests: concluir não gera Compute nem mexe na produção (só contador e consumível)', () => {
  const s = make({ gens: { 'terminal-worker': 10 } });
  const before = production(s, T0, CONTENT).rate;
  const r = doAllQuests(s, T0);
  assert.equal(r.state.quests.total, 3);
  near(production(r.state, T0, CONTENT).rate, before);
  assert.equal(r.state.run.resources.compute.lifetime, 0);
});

test('quests: cada missão conta uma vez por dia; consumível respeita o estoque máximo', () => {
  const s = make();
  s.run.inventory = Object.fromEntries(CONTENT.CONSUMABLES.map((k) => [k.id, k.cap])); // tudo cheio
  const r = doAllQuests(s, T0);
  for (const k of CONTENT.CONSUMABLES) assert.equal(r.state.run.inventory[k.id], k.cap);
  const again = doAllQuests(r.state, T0);
  assert.equal(again.state.quests.total, 3, 'repetir eventos no mesmo dia não conta de novo');
});

test('quests: marcos liberam visuais; visual exclusivo só serve ao DevPet dele', () => {
  const s = make({ pets: ['byte', 'memo'] });
  s.quests.total = 9;
  s.quests.byPet.memo = 4;
  let r = run(s, { type: 'tick' });
  assert.ok(!r.state.cosmetics.unlocked.includes('dracula'));
  r.state.quests.total = 10; r.state.quests.byPet.memo = 5;
  r = run(r.state, { type: 'tick' });
  assert.ok(r.state.cosmetics.unlocked.includes('dracula'));
  assert.ok(r.state.cosmetics.unlocked.includes('pergaminho'));
  assert.equal(run(r.state, { type: 'skin', pet: 'byte', skin: 'pergaminho' }).error, 'Visual exclusivo de outro DevPet');
  assert.equal(run(r.state, { type: 'skin', pet: 'memo', skin: 'pergaminho' }).error, undefined);
  const v = snapshot(r.state, T0);
  assert.equal(v.quests.items.length, 3);
  assert.equal(v.skins.find((k) => k.id === 'pergaminho').pet, 'memo');
});

test('quests: saves antigos (sem quests) migram', () => {
  const old = createState(T0);
  delete old.quests;
  const s = migrate(old, T0);
  assert.equal(s.quests.total, 0);
  assert.equal(run(s, { type: 'tick' }).state.quests.ids.length, 3);
});

test('pets: Git e Lint chegam por uso do Diff / JSON-XML e têm sprite e habilidade', () => {
  assert.ok(CONTENT.pet.git && CONTENT.pet.lint);
  let s = make();
  for (const day of [0, 1]) s = run(s, { type: 'event', name: 'tool.used', data: { tool: 'diff' } }, T0 + day * 24 * H).state;
  assert.ok(s.run.pets.git, 'Git aparece após 2 dias usando o Diff');
  for (const day of [0, 1]) s = run(s, { type: 'event', name: 'tool.used', data: { tool: 'json' } }, T0 + day * 24 * H).state;
  assert.ok(s.run.pets.lint, 'Lint aparece após 2 dias usando o JSON');
  s.run.tier = 2;
  assert.equal(run(s, { type: 'ability', id: 'branch-off' }, T0 + 2 * 24 * H).error, undefined);
});

/* ─────────────── Hotfix em vilão comum ─────────────── */
test('hotfix: derrotar um vilão comum sempre rende algo (sucata ou peça), menos que conter', () => {
  const hotfix = (seedTweak = 0) => {
    const s = withNext({ tier: 2, pets: ['byte'] }, 'memory-leak', 1000);
    s.seed += seedTweak;
    s.run.inventory.hotfix = 1;
    const started = run(s, { type: 'tick' }, T0 + 5000).state;
    assert.equal(started.run.incidents.active.contained, false);
    const scrap0 = started.run.scrap;
    const r = run(started, { type: 'use', item: 'hotfix' }, T0 + 6000);
    assert.equal(r.state.run.incidents.active, null);
    assert.equal(r.state.bestiary.leaky.defeated, 1);
    return { r, scrapGain: r.state.run.scrap - scrap0 };
  };
  let parts = 0;
  for (let i = 0; i < 40; i++) {
    const { r, scrapGain } = hotfix(i * 7919);
    const part = r.log.find((e) => e.type === 'part' && e.source === 'hotfix' && !e.dup);
    assert.ok(scrapGain >= 1 || part, 'o Hotfix nunca rende nada: seed +' + i * 7919);
    if (part) parts++;
    assert.ok(r.state.run.incidents.history[0].part, 'o histórico do Ops mostra o prêmio');
    assert.equal(r.log.filter((e) => e.type === 'item').length, 1); // só o Hotfix gasto: nenhum consumível volta
  }
  assert.ok(parts > 0 && parts < 40, 'peça é uma chance, não garantia: ' + parts + '/40');
});

/* ─────────────── Legado (Rebuild + Árvore de perks) ─────────────── */
const legacy = require('../src/devcore/engine/legacy.js');

/** Run no tier 3 com Compute acumulado, pronta para o Rebuild. */
function ripe(lifetime = 27e9, extra = {}) {
  const s = make({ compute: 1e6, gens: { 'terminal-worker': 120, agent: 5 }, tier: 3, pets: ['byte', 'noxi', 'relay'], upgrades: ['hot-reload'], ...extra });
  s.run.resources.compute.lifetime = lifetime;
  s.discoveries.found['automation-era'] = T0; s.discoveries.found['agent-era'] = T0;
  s.discoveries.found['command-center'] = T0;
  s.run.pets.byte.level = 7;
  return s;
}

test('legacy: fragmentos = cbrt(Compute de todas as runs / 1 B), com retorno decrescente', () => {
  assert.equal(legacy.fragmentsFor(0), 0);
  assert.equal(legacy.fragmentsFor(1e9), 1);
  assert.equal(legacy.fragmentsFor(8e9 - 1), 1);
  assert.equal(legacy.fragmentsFor(8e9), 2);
  assert.equal(legacy.fragmentsFor(1e12), 10);
  assert.equal(legacy.fragmentsFor(1e15), 100);
  const s = ripe(27e9);
  assert.equal(legacy.pendingFragments(s), 3);
  s.meta.earned = 2;
  assert.equal(legacy.pendingFragments(s), 1, 'só rende a diferença para os já ganhos');
});

test('legacy: Rebuild só no tier 3 e quando rende ≥ 1 fragmento', () => {
  assert.match(run(ripe(27e9, { tier: 2 }), { type: 'rebuild' }).error, /Tier 3/);
  assert.match(run(ripe(1e8), { type: 'rebuild' }).error, /nenhum fragmento/);
  assert.equal(run(ripe(27e9), { type: 'rebuild' }).error, undefined);
});

test('legacy: Rebuild zera a run e guarda o permanente; pets e tiers voltam pelas descobertas', () => {
  const s = ripe(27e9);
  s.cosmetics.unlocked.push('neon'); s.bestiary.leaky = { seen: 2, contained: 1, escaped: 1, defeated: 0 };
  s.usage.days['palette.opened'] = ['2026-01-01', '2026-01-02'];
  s.discoveries.found['shortcut-engine'] = T0;
  s.run.incidents.seq = 17;
  const r = run(s, { type: 'rebuild' });
  const n = r.state;
  assert.ok(r.log.some((e) => e.type === 'rebuild' && e.gained === 3));
  assert.deepEqual([n.meta.fragments, n.meta.earned, n.meta.rebuilds, n.meta.lifetime], [3, 3, 1, 27e9]);
  assert.equal(n.run.tier, 1);
  assert.equal(n.run.resources.compute.lifetime, 0);
  assert.equal(n.run.resources.compute.amount, CONTENT.BALANCE.start.compute);
  assert.deepEqual(n.run.upgrades, {});
  assert.equal(n.run.generators['terminal-worker'].owned, 1);
  assert.equal(n.run.generators.agent, undefined);
  assert.equal(n.run.pets.byte.level, 1);
  assert.ok(n.run.pets.noxi, 'Noxi volta: a condição de uso (palette em 2 dias) continua valendo');
  assert.equal(n.run.pets.relay, undefined, 'Relay só volta no tier 3 (Command Center)');
  assert.equal(n.run.incidents.seq, 17, 'a sequência de incidentes continua (não repete a da run anterior)');
  assert.ok(n.cosmetics.unlocked.includes('neon') && n.bestiary.leaky.seen === 2 && n.discoveries.found['agent-era']);
  assert.ok(n.cosmetics.unlocked.includes('phoenix'), 'o primeiro Rebuild libera um visual');
  // Tier volta pelo Compute da run nova, sem anunciar a descoberta de novo.
  const back = structuredClone(n);
  back.run.resources.compute.lifetime = 1e4;
  const t2 = run(back, { type: 'tick' }, T0 + 2000);
  assert.equal(t2.state.run.tier, 2);
  assert.ok(t2.log.some((e) => e.type === 'tier' && e.tier === 2));
  assert.ok(!t2.log.some((e) => e.type === 'discovery'));
});

test('legacy: nível de Legado multiplica a produção (+1% por fragmento ganho, gasto ou não)', () => {
  const s = make({ gens: { 'terminal-worker': 10 } });
  const base = production(s, T0).rate;
  s.meta.earned = 20; s.meta.fragments = 0;
  near(production(s, T0).rate, base * 1.2);
  s.meta.perks['hall-of-fame'] = T0;
  near(production(s, T0).rate, base * 1.4);
});

test('legacy: perks — requisitos da árvore, custo em fragmentos, permanentes', () => {
  const s = make();
  s.meta.fragments = 3;
  assert.match(run(s, { type: 'perk', id: 'bootstrap' }).error, /perk anterior/);
  let r = run(s, { type: 'perk', id: 'legacy-core' });
  assert.equal(r.error, undefined);
  assert.equal(r.state.meta.fragments, 2);
  assert.match(run(r.state, { type: 'perk', id: 'legacy-core' }).error, /já adquirido/);
  r = run(r.state, { type: 'perk', id: 'bootstrap' });
  assert.equal(r.error, undefined);
  assert.equal(r.state.meta.fragments, 0);
  assert.match(run(r.state, { type: 'perk', id: 'muscle-memory' }).error, /insuficientes/);
  // Capstone: qualquer ramo completo.
  const t = make(); t.meta.fragments = 100;
  assert.match(run(t, { type: 'perk', id: 'hall-of-fame' }).error, /perk anterior/);
  t.meta.perks.monorepo = T0;
  assert.equal(run(t, { type: 'perk', id: 'hall-of-fame' }).error, undefined);
});

test('legacy: perks mudam como o Rebuild começa e o que atravessa', () => {
  const s = ripe(27e9);
  for (const id of ['legacy-core', 'bootstrap', 'warm-start', 'economies-of-scale', 'muscle-memory', 'runbook', 'incident-playbook', 'sustained-load', 'supply-chain', 'nightly-build', 'scavenger', 'blueprint-archive', 'design-docs']) s.meta.perks[id] = T0;
  s.run.inventory = { coffee: 4, 'cache-warmer': 2 };
  s.run.scrap = 3;
  s.run.blueprints = {
    'terminal-worker': { mk: 3, parts: {} },
    'script-runner': { mk: 2, parts: { 'script-runner:mk3:0': true } },
    'index-worker': { mk: 1, parts: { 'index-worker:mk2:1': true } },
  };
  const n = run(s, { type: 'rebuild' }).state;
  assert.equal(n.run.tier, 2);
  assert.equal(n.run.resources.compute.amount, 2e5);
  assert.equal(n.run.generators['terminal-worker'].owned, 10);
  assert.equal(n.run.pets.byte.level, 3);
  assert.equal(n.run.shields, 1);
  assert.deepEqual([n.run.inventory.coffee, n.run.inventory.hotfix, n.run.inventory['cache-warmer']], [5, 2, 2], 'estoque mantido + kit inicial, no teto');
  assert.equal(n.run.blueprints['terminal-worker'].mk, 2, 'Design Docs: Mk III volta como Mk II');
  assert.ok(n.run.blueprints['script-runner'].parts['script-runner:mk3:0'], 'peça solta do próximo nível fica');
  assert.ok(n.run.blueprints['index-worker'].parts['index-worker:mk2:1']);
  assert.equal(n.run.scrap, 3);
  // Mods: recarga −20%, burst +50%, geradores −25%, +4 h offline.
  const t = run(n, { type: 'ability', id: 'compile-burst' }, T0 + 1000).state;
  assert.equal(t.run.abilities['compile-burst'].readyAt, T0 + 1000 + 300e3 * 0.8);
  assert.equal(t.run.abilities['compile-burst'].activeUntil, T0 + 1000 + 30e3 * 1.5);
  const g = CONTENT.gen['script-runner'];
  near(snapshot(n, T0).generators.find((x) => x.id === g.id).cost1, costOf(g, 0, 1, 4 / 0.75));
  assert.equal(offlineCapMs(n) / H, CONTENT.BALANCE.offlineCapHours + 4);
});

test('legacy: sem perks de Arquivo, peças e sucata não atravessam; a view expõe a árvore', () => {
  const s = ripe(27e9);
  s.run.scrap = 9;
  s.run.blueprints = { 'terminal-worker': { mk: 2, parts: { 'terminal-worker:mk3:2': true } } };
  const n = run(s, { type: 'rebuild' }).state;
  assert.equal(n.run.scrap, 0);
  assert.deepEqual(n.run.blueprints, {});
  const v = snapshot(n, T0).legacy;
  assert.equal(v.level, 3); assert.equal(v.fragments, 3); assert.equal(v.rebuilds, 1);
  assert.equal(v.perks.length, CONTENT.PERKS.length);
  assert.equal(v.perks.find((k) => k.id === 'legacy-core').status, 'available');
  assert.equal(v.perks.find((k) => k.id === 'bootstrap').status, 'locked');
  assert.ok(v.nextLeft > 0 && v.nextPct >= 0 && v.nextPct <= 100);
  assert.equal(v.canRebuild, false);
});

/* ─────────────── Combos entre geradores ─────────────── */
const { collectEffects } = require('../src/devcore/engine/production.js');

test('combo: o alvo ganha +value a cada N unidades da fonte (contínuo), só com o upgrade', () => {
  const without = make({ gens: { 'terminal-worker': 30, 'script-runner': 10 } });
  const r0 = production(without, T0).gens['script-runner'];
  const withUp = make({ gens: { 'terminal-worker': 30, 'script-runner': 10 }, upgrades: ['shell-pipes'] });
  near(production(withUp, T0).gens['script-runner'], r0 * 1.1); // 30 Terminals / 3 × 1% = +10%
  // Terminal Worker não muda: o combo só mexe no alvo.
  near(production(withUp, T0).gens['terminal-worker'], production(without, T0).gens['terminal-worker']);
  withUp.run.generators['terminal-worker'].owned = 31;
  near(production(withUp, T0).gens['script-runner'], r0 * (1 + 0.01 * 31 / 3));
});

test('combo: fonte ainda bloqueada pelo tier não conta; exclude tira os combos de uma fonte', () => {
  const s = make({ gens: { 'index-worker': 40, 'automation-worker': 10 }, upgrades: ['indexed-artifacts'], tier: 1 });
  assert.ok(!collectEffects(s, T0).effects.some((e) => String(e.source).startsWith('combo:')));
  s.run.tier = 2;
  assert.ok(collectEffects(s, T0).effects.some((e) => e.source === 'combo:index-worker' && e.target === 'gen:automation-worker'));
  assert.ok(!collectEffects(s, T0, CONTENT, { exclude: 'index-worker' }).effects.some((e) => e.source === 'combo:index-worker'));
});

test('combo: a view mostra quem impulsiona quem e quanto isso rende', () => {
  const s = make({ gens: { 'terminal-worker': 60, 'script-runner': 10 }, upgrades: ['shell-pipes'] });
  const v = snapshot(s, T0);
  const term = v.generators.find((g) => g.id === 'terminal-worker');
  const script = v.generators.find((g) => g.id === 'script-runner');
  assert.deepEqual(term.boosts.map((b) => [b.id, Math.round(b.pct * 100)]), [['script-runner', 20]]);
  assert.deepEqual(script.boostedBy.map((b) => b.id), ['terminal-worker']);
  near(term.boostRate, production(s, T0).rate - production(s, T0, CONTENT, { exclude: 'terminal-worker' }).rate);
  near(term.boostRate, script.rate - script.rate / 1.2);
  near(term.share + script.share, 1);
  const card = v.upgrades.find((u) => u.id === 'shell-pipes');
  assert.equal(card.kind, 'combo');
  assert.match(card.effects[0], /Script Runner a cada 3 Terminal Worker/);
});

test('combo: validate pega combo inválido', () => {
  const bad = (e) => validate({ ...CONTENT, UPGRADES: [...CONTENT.UPGRADES, { id: 'x', kind: 'combo', name: 'x', cost: 1, effects: [e] }] });
  assert.ok(bad({ type: 'per', gen: 'nope', per: 3, target: 'gen:agent', value: 0.01 }).some((m) => /gerador inexistente nope/.test(m)));
  assert.ok(bad({ type: 'per', gen: 'agent', per: 3, target: 'gen:agent', value: 0.01 }).some((m) => /outro gerador/.test(m)));
  assert.ok(bad({ type: 'per', gen: 'agent', per: 0, target: 'gen:local-cluster', value: 0.01 }).some((m) => /per\/value/.test(m)));
});

test('legacy: saves antigos (meta do MVP) migram', () => {
  const old = createState(T0);
  old.meta = { fragments: 0, rebuilds: 0, perks: {} };
  const s = migrate(JSON.parse(JSON.stringify(old)), T0);
  assert.deepEqual([s.meta.earned, s.meta.lifetime], [0, 0]);
  assert.equal(snapshot(s, T0).legacy.pending, 0);
});
