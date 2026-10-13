// Testes da Singularity e da Rede (docs/devcore-mapa-singularity.md §9): node --test scripts/test-devcore-singularity.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CONTENT, validate } = require('../src/devcore/content/index.js');
const { createState, migrate } = require('../src/devcore/engine/state.js');
const { dispatch, cooldownOf } = require('../src/devcore/engine/index.js');
const { production } = require('../src/devcore/engine/production.js');
const { snapshot } = require('../src/devcore/engine/view.js');
const battle = require('../src/devcore/engine/battle.js');
const map = require('../src/devcore/engine/map.js');
const S = require('../src/devcore/engine/singularity.js');
const { costOf } = require('../src/devcore/engine/economy.js');
const { costDivOf } = require('../src/devcore/engine/blueprints.js');
const { simulate, PROFILES } = require('../src/devcore/sim.js');

const T0 = Date.UTC(2026, 0, 5, 12);
const DAY = 86400e3;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const run = (s, action, now = T0) => dispatch(s, action, now);

/** Estado no Tier 2 (mapa aberto) com pets, Compute e nós da rede já comprados. */
function make({ pets = { byte: 5 }, compute = 1e12, tier = 2, tree = {}, insight = 0, inventory = {} } = {}) {
  const s = createState(T0);
  s.run.tier = tier;
  s.run.resources.compute.amount = compute;
  s.run.pets = Object.fromEntries(Object.entries(pets).map(([id, level]) => [id, { level, station: false }]));
  s.run.inventory = { ...inventory };
  s.meta.tree = { ...tree };
  s.meta.insight = insight;
  return run(s, { type: 'tick' }).state;
}
/** Estado pronto para a Singularity: os três chefes vencidos nesta run. */
function ready(opts = {}) {
  const s = make(opts);
  s.run.stats = { startedAt: T0 - 10 * DAY, elites: 3, bosses: ['localhost', 'staging', 'production'] };
  s.run.resources.compute.lifetime = 2e15;
  return s;
}
const has = (...ids) => Object.fromEntries(ids.map((id) => [id, 1]));

/* ─────────────── conteúdo ─────────────── */
test('rede: conteúdo válido; 6 setores com entrada, braços, notáveis, dois paradigmas excludentes, maestria e infinito', () => {
  assert.deepEqual(validate(), []);
  assert.equal(CONTENT.SECTORS.length, 6);
  for (const sec of CONTENT.SECTORS) {
    const ks = CONTENT.TREE.filter((k) => k.sector === sec.id);
    const count = (kind) => ks.filter((k) => k.kind === kind).length;
    assert.equal(count('notable'), 2, sec.id);
    assert.equal(count('keystone'), 2, sec.id);
    assert.equal(count('mastery'), 1, sec.id);
    assert.equal(count('repeat'), 1, sec.id);
    assert.equal(new Set(ks.filter((k) => k.kind === 'keystone').map((k) => k.excl)).size, 1, 'paradigmas no mesmo grupo: ' + sec.id);
  }
  // Uma sinapse entre cada par de setores vizinhos (o hexágono fecha).
  const bridges = CONTENT.TREE.filter((k) => k.kind === 'bridge');
  assert.equal(bridges.length, 6);
  CONTENT.SECTORS.forEach((sec, i) => {
    const nxt = CONTENT.SECTORS[(i + 1) % 6].id;
    assert.ok(bridges.some((b) => b.sectors.includes(sec.id) && b.sectors.includes(nxt)), `sinapse ${sec.id}–${nxt}`);
  });
});

/* ─────────────── comprar na rede ─────────────── */
test('rede: só compra nó ligado a outro comprado (começa no Núcleo), com Insight suficiente', () => {
  let s = make({ insight: 3 });
  assert.match(run(s, { type: 'treeBuy', id: 'inf-2a' }).error, /ligado/);
  let r = run(s, { type: 'treeBuy', id: 'inf-1' });
  assert.equal(r.error, undefined);
  s = r.state;
  assert.equal(s.meta.insight, 2);
  assert.equal(s.meta.tree['inf-1'], 1);
  assert.match(run(s, { type: 'treeBuy', id: 'inf-1' }).error, /já comprado/);
  r = run(s, { type: 'treeBuy', id: 'inf-2a' });
  assert.equal(r.error, undefined);
  assert.match(run(r.state, { type: 'treeBuy', id: 'inf-3a' }).error, /Insight insuficiente/); // custa 2, sobrou 1
  assert.match(run(s, { type: 'treeBuy', id: 'core' }).error, /inexistente/);
});

test('rede: paradigmas do mesmo setor se excluem', () => {
  const tree = has('inf-1', 'inf-2a', 'inf-2b', 'inf-3a', 'inf-3b', 'inf-3c', 'inf-4a', 'inf-4b');
  let s = make({ tree, insight: 40 });
  s = run(s, { type: 'treeBuy', id: 'inf-5a' }).state;
  assert.equal(s.meta.tree['inf-5a'], 1);
  assert.match(run(s, { type: 'treeBuy', id: 'inf-5b' }).error, /excludente.*Hyperscale/);
  const v = snapshot(s, T0).singularity.nodes.find((n) => n.id === 'inf-5b');
  assert.equal(v.status, 'excluded');
});

test('rede: sinapse exige um vizinho comprado dos dois setores', () => {
  const s = make({ tree: has('inf-1', 'inf-2b', 'inf-3c'), insight: 20 });
  assert.match(run(s, { type: 'treeBuy', id: 'br-autoscaling' }).error, /dois setores/);
  const s2 = make({ tree: has('inf-1', 'inf-2b', 'inf-3c', 'ops-1', 'ops-2a', 'ops-3a'), insight: 20 });
  assert.equal(run(s2, { type: 'treeBuy', id: 'br-autoscaling' }).error, undefined);
});

test('rede: maestria exige 7 nós do setor; infinito sobe de nível com custo crescente', () => {
  const six = has('cmb-1', 'cmb-2a', 'cmb-2b', 'cmb-3a', 'cmb-3b', 'cmb-5a'); // 5a sem 4a: só para contar
  let s = make({ tree: six, insight: 100 });
  assert.match(run(s, { type: 'treeBuy', id: 'cmb-6' }).error, /Maestria: precisa de 7/);
  s = make({ tree: { ...six, 'cmb-4a': 1 }, insight: 100 });
  s = run(s, { type: 'treeBuy', id: 'cmb-6' }).state;
  assert.equal(s.meta.tree['cmb-6'], 1);
  assert.equal(s.meta.insight, 88);
  const k = CONTENT.perk['cmb-r'];
  s = run(s, { type: 'treeBuy', id: 'cmb-r' }).state;
  s = run(s, { type: 'treeBuy', id: 'cmb-r' }).state;
  assert.equal(s.meta.tree['cmb-r'], 2);
  assert.equal(s.meta.insight, 88 - k.cost - (k.cost + k.step));
  assert.equal(S.spentInsight(s), 1 + 1 + 1 + 2 + 2 + 8 + 4 + 12 + k.cost + k.cost + k.step);
});

test('rede: reorganizar só na janela; devolve 100% do que é da janela e 80% do resto; o 1º passo no mapa fecha a janela', () => {
  let s = make({ tree: has('inf-1', 'inf-2a', 'inf-3a'), insight: 5 }); // 4 Insight de runs anteriores
  assert.match(run(s, { type: 'treeRespec' }).error, /logo depois de uma Singularity/);
  s.meta.respec = true;
  s = run(s, { type: 'treeBuy', id: 'inf-2b' }).state; // 1 nesta janela
  assert.equal(s.meta.insight, 4);
  assert.equal(S.respecRefund(s), 1 + Math.floor(4 * 0.8));
  const v = snapshot(s, T0).singularity;
  assert.equal(v.refund, 4);
  assert.equal(v.spent, 5);
  const r = run(s, { type: 'treeRespec' });
  assert.equal(r.error, undefined);
  assert.equal(r.state.meta.insight, 8);
  assert.deepEqual(r.state.meta.tree, {});
  assert.ok(r.log.some((e) => e.type === 'treeRespec' && e.refunded === 4 && e.lost === 1));
  // O que se compra depois de reorganizar (ainda na janela) também se desfaz de graça.
  let t = run(r.state, { type: 'treeBuy', id: 'inf-1' }).state;
  assert.equal(run(t, { type: 'treeUndo', id: 'inf-1' }).state.meta.insight, 8);
  // O primeiro passo no mapa fecha a janela: o que foi comprado fica.
  const first = Object.values(t.run.map.nodes).find((n) => n.col === 0);
  t = run(t, { type: 'mapFight', node: first.id, squad: { slots: { vanguard: 'byte' }, triggers: {}, items: [] } }).state;
  assert.equal(t.meta.respec, false);
  assert.deepEqual(t.meta.fresh, {});
  assert.match(run(t, { type: 'treeUndo', id: 'inf-1' }).error, /antes do primeiro passo/);
  assert.match(run(t, { type: 'treeRespec' }).error, /logo depois/);
});

test('rede: desfazer devolve 100%, só o que é da janela, e não deixa nó solto', () => {
  let s = make({ tree: has('cmb-1'), insight: 20 });
  s.meta.respec = true;
  for (const id of ['cmb-2a', 'cmb-3a']) s = run(s, { type: 'treeBuy', id }).state;
  assert.equal(s.meta.insight, 17);
  assert.match(run(s, { type: 'treeUndo', id: 'cmb-1' }).error, /run anterior/);
  assert.match(run(s, { type: 'treeUndo', id: 'cmb-2a' }).error, /dependem deste/);
  const v = snapshot(s, T0).singularity.nodes;
  assert.equal(v.find((n) => n.id === 'cmb-2a').undo, null);
  assert.equal(v.find((n) => n.id === 'cmb-3a').undo, 2);
  s = run(s, { type: 'treeUndo', id: 'cmb-3a' }).state;
  s = run(s, { type: 'treeUndo', id: 'cmb-2a' }).state;
  assert.equal(s.meta.insight, 20);
  assert.deepEqual(s.meta.tree, { 'cmb-1': 1 });
  // Infinito: desfaz um nível por vez (o mais caro primeiro).
  let r = make({ tree: { ...has('inf-1', 'inf-2a', 'inf-2b', 'inf-3a', 'inf-3b', 'inf-3c', 'inf-4a', 'inf-4b', 'inf-5a', 'inf-6'), 'inf-r': 1 }, insight: 40 });
  r.meta.respec = true;
  const k = CONTENT.perk['inf-r'];
  r = run(r, { type: 'treeBuy', id: 'inf-r' }).state;
  r = run(r, { type: 'treeUndo', id: 'inf-r' }).state;
  assert.equal(r.meta.tree['inf-r'], 1);
  assert.equal(r.meta.insight, 40);
  assert.match(run(r, { type: 'treeUndo', id: 'inf-r' }).error, /run anterior/);
  void k;
});

test('rede: desfazer não derruba maestria nem sinapse que dependem do nó', () => {
  let s = make({ tree: has('inf-1', 'inf-2b', 'ops-1', 'ops-2a'), insight: 20 });
  s.meta.respec = true;
  s = run(s, { type: 'treeBuy', id: 'inf-3c' }).state;
  s = run(s, { type: 'treeBuy', id: 'ops-3a' }).state;
  s = run(s, { type: 'treeBuy', id: 'br-autoscaling' }).state;
  assert.match(run(s, { type: 'treeUndo', id: 'inf-3c' }).error, /dependem deste/);
  const m = make({ tree: has('cmb-1', 'cmb-2a', 'cmb-2b', 'cmb-3a', 'cmb-3b', 'cmb-4a', 'cmb-5a', 'cmb-6'), insight: 5 });
  m.meta.respec = true; m.meta.fresh = { 'cmb-3b': 1 };
  assert.match(run(m, { type: 'treeUndo', id: 'cmb-3b' }).error, /dependem deste/); // a maestria cairia abaixo de 7
});

test('rede: nó de início comprado na janela vale já na run atual e não se desfaz de graça', () => {
  let s = run(ready({ pets: { byte: 10, memo: 9 } }), { type: 'singularity' }).state; // rede vazia: run nova no básico
  assert.equal(s.run.generators['terminal-worker'].owned, 1);
  const before = s.run.resources.compute.amount;
  s = run(s, { type: 'treeBuy', id: 'arc-1' }).state;               // Bootstrap Script
  assert.equal(s.run.resources.compute.amount, before + 5000);
  assert.equal(s.run.generators['terminal-worker'].owned, 10);
  assert.match(run(s, { type: 'treeUndo', id: 'arc-1' }).error, /run anterior|reorganizando/);
  s = run(s, { type: 'treeBuy', id: 'pet-1' }).state;                // Muscle Memory: pets no nível 3 já
  assert.equal(s.run.pets.byte.level, 3);
  assert.equal(s.run.pets.memo.level, 3);
  s = run(s, { type: 'treeBuy', id: 'arc-2a' }).state;               // Supply Cache
  assert.equal(s.run.inventory.coffee, 2);
  s = run(s, { type: 'treeBuy', id: 'inf-1' }).state;                // nó comum: desfaz de graça
  assert.equal(run(s, { type: 'treeUndo', id: 'inf-1' }).error, undefined);
  // Warm Start na janela abre o mapa na hora.
  s.meta.insight = 10;
  s = run(s, { type: 'treeBuy', id: 'arc-2b' }).state;
  s = run(s, { type: 'treeBuy', id: 'arc-3a' }).state;
  assert.equal(s.run.tier, 2);
  assert.ok(s.run.map, 'o mapa abriu');
});

/* ─────────────── Singularity ─────────────── */
test('singularity: só depois de vencer o chefe do Pico Production', () => {
  const s = make();
  assert.match(run(s, { type: 'singularity' }).error, /Pico Production/);
  assert.equal(snapshot(s, T0).singularity.ready, false);
  assert.equal(snapshot(ready(), T0).singularity.ready, true);
});

test('singularity: Insight = chefes + elites + rapidez + profundidade, × multiplicadores da rede', () => {
  const s = ready();
  const br = S.insightBreakdown(s, T0);
  assert.equal(br.bosses, 12);
  assert.equal(br.elites, 3);
  assert.equal(br.speed, 4);   // 10 dias de run: 4 dias inteiros abaixo dos 14
  assert.equal(br.depth, 2);   // 2e15 = 20 × 1e14: duas triplicações (×9) acima de 1e14, não três (×27)
  assert.equal(br.total, br.raw);
  const s2 = ready({ tree: has('arc-1', 'arc-2a', 'arc-3b') });
  const b2 = S.insightBreakdown(s2, T0);
  near(b2.mult, 1.15);
  assert.equal(b2.total, Math.floor(b2.raw * 1.15));
});

test('singularity: zera a run, mantém os pets (no nível inicial), meta e descobertas; semente nova', () => {
  let s = ready({ pets: { byte: 10, noxi: 8 }, inventory: { coffee: 3 } });
  s.run.upgrades = { 'faster-shell': T0 };
  s.run.patches = ['build-cache'];
  s.discoveries.found['tier-2'] = T0;
  const seed = s.seed;
  const br = S.insightBreakdown(s, T0);
  const r = run(s, { type: 'singularity' });
  assert.equal(r.error, undefined);
  s = r.state;
  assert.ok(r.log.some((e) => e.type === 'singularity' && e.gained === br.total));
  assert.equal(s.meta.insight, br.total);
  assert.equal(s.meta.earned, br.total);
  assert.equal(s.meta.singularities, 1);
  assert.equal(s.meta.respec, true);
  assert.equal(s.meta.lifetime, 2e15);
  assert.notEqual(s.seed, seed);
  assert.equal(s.run.resources.compute.amount, CONTENT.BALANCE.start.compute);
  assert.deepEqual(s.run.upgrades, {});
  assert.deepEqual(s.run.patches, []);
  assert.deepEqual(s.run.inventory, {});
  assert.equal(s.run.map, null);
  assert.equal(s.run.tier, 1);
  assert.deepEqual(Object.keys(s.run.pets).sort(), ['byte', 'noxi']);
  assert.equal(s.run.pets.byte.level, 1);
  assert.deepEqual(s.run.stats.bosses, []);
  assert.equal(s.run.stats.startedAt, T0);
  assert.ok(s.discoveries.found['tier-2'], 'descobertas ficam');
  // Núcleo: +10% de produção por Singularity.
  const base = createState(T0);
  near(production(s, T0).rate, production(base, T0).rate * 1.1);
});

test('singularity: os tiers voltam pelas descobertas quando o Compute da run nova chega lá (sem anunciar de novo)', () => {
  let s = run(ready(), { type: 'singularity' }).state;
  s.discoveries.found['era-automation'] = T0;
  const era = CONTENT.DISCOVERIES.find((d) => d.rewards.some((x) => x.tier === 2));
  s.discoveries.found[era.id] = T0;
  s.run.resources.compute.lifetime = era.when.lifetime;
  const r = run(s, { type: 'tick' });
  assert.equal(r.state.run.tier, 2);
  assert.ok(r.log.some((e) => e.type === 'tier' && e.tier === 2));
  assert.ok(!r.log.some((e) => e.type === 'discovery' && e.id === era.id));
});

test('singularity: bônus de início da rede (Bootstrap, Supply Cache, Warm Start, Muscle Memory, Patch Library, Seed Funding)', () => {
  const tree = has('arc-1', 'arc-2a', 'arc-3a', 'arc-4b', 'pet-1', 'pet-2a', 'pet-3b', 'inf-1', 'inf-2b', 'inf-3c', 'br-seed');
  const s = run(ready({ tree, pets: { byte: 10 } }), { type: 'singularity' }).state;
  assert.equal(s.run.tier, 2);
  assert.ok(s.run.map, 'Warm Start: o mapa abre na hora');
  assert.ok(s.run.resources.compute.amount >= 5e4);
  assert.equal(s.run.generators['terminal-worker'].owned, 25);
  assert.equal(s.run.generators['script-runner'].owned, 25);
  assert.equal(s.run.inventory.coffee, 2);
  assert.equal(s.run.inventory.hotfix, 1);
  assert.equal(s.run.inventory['health-check'], 1);
  assert.equal(s.run.pets.byte.level, 5); // Veterans
  assert.equal(s.run.patches.length, 1);
  assert.equal(CONTENT.patch[s.run.patches[0]].rarity, 'common');
});

test('singularity: Clean Slate desliga início e o que atravessa; Time Capsule e Design Docs fazem atravessar', () => {
  const clean = run(ready({ tree: has('arc-1', 'arc-2a', 'arc-3a', 'arc-4b', 'arc-5b', 'arc-2b', 'arc-3b', 'arc-4a', 'arc-3c'), pets: { byte: 10 } }), { type: 'singularity' }).state;
  assert.equal(clean.run.tier, 1);
  assert.deepEqual(clean.run.inventory, {});
  assert.equal(clean.run.pets.byte.level, 1);
  near(S.insightBreakdown(ready({ tree: has('arc-5b', 'arc-3b') }), T0).mult, 1.5 * 1.15);

  const s = ready({ tree: has('arc-1', 'arc-2a', 'arc-2b', 'arc-3a', 'arc-3b', 'arc-4a', 'arc-4b', 'arc-5a'), inventory: { coffee: 4, rollback: 1 } });
  s.run.blueprints = { 'terminal-worker': { mk: 3, parts: {} }, 'agent': { mk: 2, parts: {} } };
  s.run.scrap = 7;
  const t = run(s, { type: 'singularity' }).state;
  assert.equal(t.run.inventory.coffee, 5); // 4 que atravessaram + 2 do Supply Cache, no teto (5)
  assert.equal(t.run.inventory.rollback, 1);
  assert.equal(t.run.blueprints['terminal-worker'].mk, 2);
  assert.equal(t.run.blueprints.agent.mk, 2);
  assert.equal(t.run.scrap, 7);
  assert.ok(t.run.patches.some((id) => CONTENT.patch[id].rarity === 'rare'), 'Time Capsule: Patch raro');
});

test('singularity: save antigo no meio da run conta os chefes já vencidos', () => {
  const s = make();
  delete s.run.stats;
  s.run.map = map.createMap(s, CONTENT.area.production);
  s.run.map.cleared = true;
  const m = migrate(JSON.parse(JSON.stringify(s)), T0);
  assert.deepEqual(m.run.stats.bosses, ['localhost', 'staging', 'production']);
  assert.equal(snapshot(m, T0).singularity.ready, true);
});

/* ─────────────── produção e economia ─────────────── */
test('rede: efeitos de produção (soma, ×, por categoria ativa, infinito por nível)', () => {
  const base = make();
  const p0 = production(base, T0).rate;
  const g = production(base, T0).agg.get('global') || { add: 0, mul: 1 };
  const withAdd = (x) => p0 * (1 + g.add + x) / (1 + g.add); // somas entram junto com as outras somas globais
  near(production(make({ tree: has('inf-1') }), T0).rate, withAdd(0.15));
  near(production(make({ tree: { 'inf-1': 1, 'inf-r': 3 } }), T0).rate, withAdd(0.45));
  near(production(make({ tree: has('inf-5a') }), T0).rate, p0 * 2);
  const act = production(base, T0).active.size;
  near(production(make({ tree: has('inf-4b') }), T0).rate, withAdd(0.08 * act));
});

test('rede: custos de geradores, upgrades, treino, fabricação e peças; recarga e duração das habilidades', () => {
  const g = CONTENT.gen['terminal-worker'];
  const s = make({ tree: has('inf-3a', 'inf-4a') });
  near(costOf(g, 1, 1, costDivOf(s, g.id)), costOf(g, 1, 1, 1) * 0.8 * 0.7);
  const hyper = make({ tree: has('inf-5a') });
  near(costOf(g, 1, 1, costDivOf(hyper, g.id)), costOf(g, 1, 1, 1) * 1.5);

  const v0 = snapshot(make(), T0);
  const v1 = snapshot(make({ tree: has('inf-3c', 'pet-2b', 'ops-2b') }), T0);
  const up0 = v0.upgrades.find((u) => u.status === 'available');
  near(v1.upgrades.find((u) => u.id === up0.id).cost, up0.cost * 0.7);
  near(v1.pets.find((p) => p.id === 'byte').trainCost, v0.pets.find((p) => p.id === 'byte').trainCost * 0.7);
  near(v1.inventory[0].craftCost, v0.inventory[0].craftCost * 0.6);

  const def = CONTENT.ability['compile-burst'];
  const fast = make({ tree: has('ops-1', 'ops-3a') });
  near(cooldownOf(fast, def), def.cooldownSec * 0.85 * 0.85);
  const r = run(make({ tree: has('ops-2a') }), { type: 'ability', id: 'compile-burst' });
  near(r.state.run.abilities['compile-burst'].activeUntil - T0, def.effect.durationSec * 1.3 * 1000);
});

test('rede: Bigger Pockets sobe o limite; Batch Jobs às vezes fabrica dois; Full Automation dispara habilidades', () => {
  let s = make({ tree: has('ops-3b'), inventory: { coffee: 5 } });
  assert.equal(snapshot(s, T0).inventory.find((k) => k.id === 'coffee').cap, 6);
  s = run(s, { type: 'craft', item: 'coffee' }).state;
  assert.equal(s.run.inventory.coffee, 6);
  assert.match(run(s, { type: 'craft', item: 'coffee' }).error, /Estoque cheio/);

  let doubles = 0;
  for (let i = 0; i < 20; i++) {
    const r = run(make({ tree: has('ops-4a') }), { type: 'craft', item: 'hotfix' }, T0 + i * 1000);
    if (r.state.run.inventory.hotfix === 2) doubles++;
  }
  assert.ok(doubles > 2 && doubles < 18, 'Batch Jobs ~50%: ' + doubles);

  const auto = make({ tree: has('ops-5a') }); // o próprio tick de make já dispara
  assert.ok(auto.run.abilities['compile-burst'], 'disparou sozinha');
  near(auto.run.abilities['compile-burst'].activeUntil - T0, CONTENT.ability['compile-burst'].effect.durationSec * 0.75 * 1000);
  assert.ok(!make().run.abilities['compile-burst'], 'sem o nó, nada dispara');
});

/* ─────────────── batalha ─────────────── */
const squad = (slots, extra = {}) => ({ slots, triggers: {}, items: [], ...extra });
test('rede: bônus de batalha no esquadrão (ataque, vida, defesa, velocidade, curas) e regras da luta', () => {
  const sq = squad({ vanguard: 'byte' });
  const a = battle.setupBattle(make(), sq, ['bug'], 0, 'localhost').pets[0];
  const b = battle.setupBattle(make({ tree: has('cmb-1', 'cmb-2a', 'cmb-2b', 'cmb-6') }), sq, ['bug'], 0, 'localhost');
  const p = b.pets[0];
  near(p.atk, a.atk * 1.1, 1e-6); // Code Review (a vanguarda não tem bônus de ataque)
  assert.ok(p.maxHp > a.maxHp && p.def > a.def);
  assert.equal(p.spd, a.spd + 3);
  near(b.rules.critMult, CONTENT.BATTLE.critMult + 0.4);
  const f = battle.setupBattle(make({ tree: has('cmb-5b') }), sq, ['bug'], 0, 'localhost');
  assert.equal(f.rules.maxRounds, CONTENT.BATTLE.maxRounds + 10);
  const res = battle.resolve(f, 1);
  assert.equal(res.maxRounds, CONTENT.BATTLE.maxRounds + 10);
  assert.ok(battle.setupBattle(make({ tree: has('cmb-4a') }), sq, ['bug'], 0, 'localhost').firstCrit);
});

test('rede: Specialists dobra o bônus de papel; Generalists dá o bônus de papel a qualquer pet', () => {
  const base = battle.slotBonus('vanguard', 'armo', CONTENT, make());
  const spec = battle.slotBonus('vanguard', 'armo', CONTENT, make({ tree: has('pet-5a') }));
  near(spec.hp, base.hp * 2);
  const off = battle.slotBonus('vanguard', 'byte', CONTENT, make({ tree: has('pet-5a') }));
  near(off.atk, -0.1);
  const gen = battle.slotBonus('vanguard', 'byte', CONTENT, make({ tree: has('pet-5b') }));
  near(gen.hp, CONTENT.SLOTS[0].roles.tank.hp);
  near(gen.def, CONTENT.SLOTS[0].bonus.def * 0.5 + CONTENT.SLOTS[0].roles.tank.def);
});

test('rede: Hot Standby — a reserva entra no lugar do primeiro pet que cair', () => {
  const s = make({ pets: { byte: 1, armo: 6 }, tree: has('cmb-4b') });
  const sq = squad({ vanguard: 'byte' }, { reserve: 'armo' });
  assert.equal(map.squadError(s, sq), null);
  assert.match(map.squadError(make({ pets: { byte: 1, armo: 6 } }), sq), /Hot Standby/);
  const setup = battle.setupBattle(s, sq, ['legacy-monolith'], 8, 'localhost', CONTENT, 'boss');
  assert.ok(setup.reserve && setup.reserve.id === 'armo');
  const r = battle.resolve(setup, 3);
  const enter = r.log.find((e) => e.k === 'enter');
  assert.ok(enter, 'a reserva entrou');
  const down = r.log.find((e) => e.k === 'down' && e.t === enter.a);
  assert.ok(down && r.log.indexOf(down) < r.log.indexOf(enter));
  assert.ok(r.units.some((u) => u.reserve && u.id === 'armo'));
});

test('rede: consumíveis em batalha mais fortes (Hardened Builds) e 3 por batalha (Chaos Engineering)', () => {
  const sq = squad({ vanguard: 'byte' }, { items: ['hotfix'] });
  const hit = (tree) => battle.resolve(battle.setupBattle(make({ tree, inventory: { hotfix: 1 } }), sq, ['legacy-monolith'], 8, 'localhost', CONTENT, 'boss'), 1).log.find((e) => e.a === 'item').v;
  near(hit(has('ops-3c')), Math.round(hit({}) * 1.4), 0.02);
  const s = make({ pets: { byte: 5 }, tree: has('br-chaos'), inventory: { coffee: 1, hotfix: 1, rollback: 1 } });
  assert.equal(map.squadError(s, squad({ vanguard: 'byte' }, { items: ['coffee', 'hotfix', 'rollback'] })), null);
  assert.match(map.squadError(make({ inventory: { coffee: 1, hotfix: 1, rollback: 1 } }), squad({ vanguard: 'byte' }, { items: ['coffee', 'hotfix', 'rollback'] })), /até 2/);
});

test('rede: recuperação de vida mais rápida (Fast Recovery) ou mais lenta (Speedrun)', () => {
  const at = (tree) => { const s = make({ tree }); s.run.pets.byte.hp = 0.2; s.run.pets.byte.hpAt = T0; return battle.petHp(s, 'byte', T0 + 3600e3); };
  near(at({}), 0.2 + 0.25);
  near(at(has('pet-3c')), 0.2 + 0.25 * 1.5);
  near(at(has('map-5a')), 0.2 + 0.25 * 0.7);
});

/* ─────────────── mapa ─────────────── */
test('rede: custos do mapa, deploy expresso, loja e eventos grátis', () => {
  const s0 = make();
  const s1 = make({ tree: has('map-1', 'map-3b', 'map-2b', 'map-4b') });
  const n = Object.values(s0.run.map.nodes).find((x) => x.type === 'battle');
  near(map.nodeCost(s1, n), map.nodeCost(s0, n) * 0.9 * 0.85);
  const ex = { ...n, type: 'express' };
  near(map.nodeCost(s1, ex), map.nodeCost(s0, ex) * 0.9 * 0.85 * 0.5);
  near(map.shopPrice(s1, { price: 100 }), 75);
  assert.equal(map.choiceCost(s1, { cost: 2 }, 3), 0);
  assert.ok(map.choiceCost(s0, { cost: 2 }, 3) > 0);
});

test('rede: Shortcuts dá atalho a toda elite elegível; Treasure Hunter dá Patch em toda vitória comum', () => {
  const s = make({ tree: has('map-3a') });
  const area = CONTENT.area.localhost;
  for (const n of Object.values(s.run.map.nodes)) if (n.type === 'elite' && n.col >= 1 && n.col <= area.columns - 3) assert.ok(n.shortcut, 'atalho em ' + n.id);

  let t = make({ pets: { byte: 10, armo: 10, memo: 10 }, tree: has('map-5b') });
  const first = Object.values(t.run.map.nodes).find((x) => x.col === 0);
  const r = run(t, { type: 'mapFight', node: first.id, squad: squad({ vanguard: 'armo', center: 'byte', rear: 'memo' }) });
  assert.ok(r.state.run.map.lastBattle.win);
  assert.ok(r.state.run.patches.length >= 1, 'Treasure Hunter: Patch garantido');
});

test('rede: Loot Tables sobe a raridade; Field Trip cura na vitória; Self-Healing devolve consumíveis', () => {
  let ups = 0;
  for (let i = 0; i < 40; i++) {
    const s = make({ tree: has('map-4a') });
    const id = map.grantPatch(s, 'common', (() => { let x = i / 40; return () => (x = (x * 9301 + 0.49297) % 1); })());
    if (CONTENT.patch[id].rarity === 'rare') ups++;
  }
  assert.ok(ups > 2 && ups < 25, 'Loot Tables ~25%: ' + ups);

  const sq = squad({ vanguard: 'armo', center: 'byte', rear: 'memo' }, { items: ['coffee'] });
  const play = (tree) => {
    const s = make({ pets: { byte: 10, armo: 10, memo: 10 }, tree, inventory: { coffee: 1 } });
    const first = Object.values(s.run.map.nodes).find((x) => x.col === 0);
    return run(s, { type: 'mapFight', node: first.id, squad: sq }).state;
  };
  const a = play({});
  const b = play(has('br-fieldtrip'));
  const hurt = (st) => Math.min(...['armo', 'byte', 'memo'].map((id) => st.run.pets[id].hp == null ? 1 : st.run.pets[id].hp));
  assert.ok(hurt(b) >= Math.min(1, hurt(a)), 'curou na vitória');
  const back = play(has('ops-6'));
  assert.equal(back.run.inventory.coffee + (back.run.map.lastBattle.refunded.length ? 0 : 0), back.run.map.lastBattle.refunded.includes('coffee') ? 1 : 0);
});

test('rede: chefes e elites vencidos contam na run; Continuous Deployment e Patch Notes ao trocar de área', () => {
  let s = make({ pets: { byte: 10, query: 10, relay: 10 }, tree: has('map-6', 'br-patchnotes') });
  const m = s.run.map;
  m.at = '8-1'; m.visited = ['8-1'];
  const sq = squad({ vanguard: 'query', center: 'byte', rear: 'relay' }); // Query anula o traço do Monolith
  let r;
  for (let i = 0; i < 6; i++) { r = run(s, { type: 'mapFight', node: 'boss', squad: sq }); s = r.state; if (s.run.map.cleared) break; for (const id of ['byte', 'query', 'relay']) { s.run.pets[id].hp = 1; s.run.pets[id].ko = false; } }
  assert.ok(s.run.map.cleared, 'venceu o Monolith');
  assert.deepEqual(s.run.stats.bosses, ['localhost']);
  assert.ok(s.run.patches.some((id) => CONTENT.patch[id].rarity === 'rare'), 'Continuous Deployment: Patch raro');
  const before = s.run.patches.length;
  s.run.pets.byte.hp = 0.3; s.run.pets.byte.hpAt = T0;
  r = run(s, { type: 'mapAdvance' });
  assert.equal(r.state.run.pets.byte.hp, 1, 'área nova com o time de vida cheia');
  assert.equal(r.state.run.patches.length, before + 1, 'Patch Notes');
  assert.ok(r.log.some((e) => e.type === 'mapGift'));
});

/* ─────────────── view ─────────────── */
test('view: a aba aparece com o mapa; nós com estado, custo e motivo; o que a próxima run traz', () => {
  const s0 = createState(T0);
  assert.equal(snapshot(s0, T0).singularity.visible, false);
  const v = snapshot(make({ tree: has('arc-1', 'pet-1'), insight: 1 }), T0).singularity;
  assert.equal(v.visible, true);
  assert.equal(v.nodes.find((n) => n.id === 'core').status, 'owned');
  assert.equal(v.nodes.find((n) => n.id === 'arc-1').status, 'owned');
  const n2 = v.nodes.find((n) => n.id === 'arc-2a');
  assert.equal(n2.status, 'available');
  assert.equal(n2.affordable, true);
  assert.match(v.nodes.find((n) => n.id === 'arc-3a').reason, /ligado/);
  assert.equal(v.start.petLevel, 3);
  assert.equal(v.start.compute, 5000);
  assert.equal(v.spent, 2);
});

/* ─────────────── ritmo (simulador) ─────────────── */
test('ritmo: 1ª Singularity em ~2 semanas (casual) com ~12–18 Insight; a rede deixa a run seguinte bem mais curta', () => {
  const m = simulate({ ...PROFILES.casual, days: 23, singularity: true });
  assert.ok(m.runs.length >= 2, 'duas Singularities em 23 dias');
  const [a, b] = m.runs;
  assert.ok(a.days >= 12 && a.days <= 16, '1ª run: ' + a.days.toFixed(1) + ' dias');
  assert.ok(a.insight >= 12 && a.insight <= 18, '1ª Singularity: ' + a.insight + ' Insight');
  assert.ok(a.bought.length >= 8, 'o 1º Insight já compra um anel inteiro de nós');
  assert.ok(b.days <= a.days * 0.7, '2ª run mais curta: ' + b.days.toFixed(1) + ' dias');
  assert.ok(b.insight > a.insight, 'run mais rápida rende mais Insight');
});
