// Testes do mapa, batalhas e Patches do DevCore (docs/devcore-mapa-singularity.md): node --test scripts/test-devcore-map.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CONTENT, validate } = require('../src/devcore/content/index.js');
const { createState, migrate } = require('../src/devcore/engine/state.js');
const { dispatch } = require('../src/devcore/engine/index.js');
const { production } = require('../src/devcore/engine/production.js');
const { snapshot } = require('../src/devcore/engine/view.js');
const battle = require('../src/devcore/engine/battle.js');
const map = require('../src/devcore/engine/map.js');

const T0 = Date.UTC(2026, 0, 5, 12);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const run = (s, action, now = T0) => dispatch(s, action, now);

/** Estado no Tier 2 com pets em certos níveis e Compute; o mapa abre no primeiro dispatch. */
function make({ pets = { byte: 1 }, compute = 1e12, tier = 2, inventory = {}, patches = [] } = {}) {
  const s = createState(T0);
  s.run.tier = tier;
  s.run.resources.compute.amount = compute;
  s.run.pets = Object.fromEntries(Object.entries(pets).map(([id, level]) => [id, { level, station: false }]));
  s.run.inventory = { ...inventory };
  s.run.patches = [...patches];
  return run(s, { type: 'tick' }).state;
}
const squadOf = (pets, extra = {}) => ({ pets, front: pets.slice(0, 1), triggers: {}, items: [], ...extra });
/** Monta e resolve uma luta direto (sem mapa). */
const fight = (s, squad, enemies, col = 0, kind = 'battle', seed = 1) => battle.resolve(battle.setupBattle(s, squad, enemies, col, 'localhost', CONTENT, kind), seed);

/* ─────────────── conteúdo ─────────────── */
test('mapa: conteúdo válido (papéis, habilidades de batalha, inimigos, áreas, Patches, eventos)', () => {
  assert.deepEqual(validate(), []);
  for (const p of CONTENT.PETS) assert.ok(CONTENT.PET_ROLES[p.id], 'pet sem papel: ' + p.id);
  assert.equal(CONTENT.AREAS[0].id, 'localhost');
});

/* ─────────────── batalha ─────────────── */
test('batalha: determinística pela semente; atributos crescem com nível, estágio e raridade', () => {
  const s = make({ pets: { byte: 5, noxi: 5 } });
  const a = fight(s, squadOf(['byte', 'noxi']), ['bug', 'typo'], 2, 'battle', 7);
  const b = fight(s, squadOf(['byte', 'noxi']), ['bug', 'typo'], 2, 'battle', 7);
  assert.deepEqual(a, b);
  const st = (lvl) => battle.petStats(make({ pets: { byte: lvl } }), 'byte');
  assert.ok(st(10).atk > st(5).atk && st(5).atk > st(1).atk);
  near(st(10).atk, CONTENT.ROLES.attacker.atk * (1 + 0.15 * 9) * 1.25 * 1); // Mestre, comum
  const noxi = battle.petStats(make({ pets: { noxi: 1 } }), 'noxi');
  near(noxi.atk, CONTENT.ROLES.speed.atk * 1.1); // raro
});

test('batalha: Patches de batalha e o buff da próxima batalha entram nos atributos', () => {
  const base = battle.setupBattle(make({ pets: { byte: 1 } }), squadOf(['byte']), ['bug'], 0, 'localhost').pets[0];
  const s = make({ pets: { byte: 1 }, patches: ['pair-review', 'retry-policy', 'type-safety'] });
  s.run.battleBuff = { atk: 0.2 };
  const p = battle.setupBattle(s, squadOf(['byte']), ['bug'], 0, 'localhost').pets[0];
  near(p.atk, base.atk * (1 + 0.1 + 0.2));
  assert.equal(p.maxHp, Math.round(base.maxHp / 1 * 1.15));
  near(p.def, base.def * 1.25);
});

test('batalha: counters anulam os traços (dreno, esquiva, divisão, enxame, perfuração)', () => {
  const s = make({ pets: { byte: 10, query: 10, noxi: 10, relay: 12, armo: 12 } });
  const misses = (pets) => fight(s, squadOf(pets), ['flicker', 'flicker'], 3, 'battle', 3).log.filter((e) => e.k === 'miss').length;
  assert.ok(misses(['byte']) > 0, 'sem Noxi, Flicker esquiva');
  assert.equal(misses(['byte', 'noxi']), 0, 'com Noxi, todos acertam');
  const splits = (pets) => fight(s, squadOf(pets), ['forky'], 2, 'battle', 3).log.filter((e) => e.k === 'split').length;
  assert.equal(splits(['byte']), 2);
  assert.equal(splits(['byte', 'relay']), 0);
  // Dreno: sem Query/Memo o ataque do Byte cai a cada golpe no Leaky.
  // (habilidades no gatilho "aliado abaixo de 50%" para não misturar o Compile Burst/Index na medida)
  const quiet = (pets) => squadOf(pets, { triggers: Object.fromEntries(pets.map((id) => [id, 'allyLow'])) });
  const hits = (pets) => fight(s, quiet(pets), ['leaky'], 6, 'battle', 3).log.filter((e) => e.k === 'atk' && e.a === 'p0' && !e.c).map((e) => e.v);
  const drained = hits(['byte']);
  assert.ok(Math.min(...drained) < drained[0], 'o dano cai com o dreno: ' + drained);
  const clean = hits(['byte', 'query']);
  assert.ok(Math.min(...clean) >= clean[0], 'com Query, o dano nunca cai abaixo do primeiro golpe: ' + clean);
  // Enxame: só Armo na FRENTE anula; Perfuração: Armo no esquadrão; Fortificação não tem counter.
  assert.equal(battle.countered('swarm', { anyOf: new Set(['armo']), front: new Set(['armo']) }, CONTENT), true);
  assert.equal(battle.countered('swarm', { anyOf: new Set(['armo']), front: new Set() }, CONTENT), false);
  assert.equal(battle.countered('pierce', { anyOf: new Set(['armo']), front: new Set() }, CONTENT), true);
  assert.equal(battle.countered('fortify', { anyOf: new Set(['armo', 'byte']), front: new Set() }, CONTENT), false);
});

test('batalha: gatilhos das habilidades e consumíveis automáticos', () => {
  const s = make({ pets: { byte: 10, memo: 12 } });
  const start = fight(s, { pets: ['byte', 'memo'], front: ['byte'], triggers: { byte: 'start', memo: 'round3' }, items: [] }, ['broken-dep', 'broken-dep'], 4);
  const ab = start.log.filter((e) => e.k === 'ab');
  assert.equal(ab.find((e) => e.v === 'compile-burst').r, 1);
  const recall = ab.find((e) => e.v === 'recall');
  if (recall) assert.equal(recall.r, 3);
  const low = fight(s, { pets: ['byte', 'memo'], front: ['byte'], triggers: { byte: 'start', memo: 'allyLow' }, items: [] }, ['zero'], 5, 'elite');
  const rec = low.log.find((e) => e.k === 'ab' && e.v === 'recall');
  assert.ok(rec, 'Recall dispara quando um aliado fica abaixo de 50%');
  // Itens: Coffee e Hotfix na rodada 1; Rollback só se alguém cair; Cache Warmer só depois de uma habilidade.
  const r = fight(make({ pets: { byte: 1 }, inventory: { coffee: 1, hotfix: 1 } }), squadOf(['byte'], { items: ['coffee', 'hotfix'] }), ['bug'], 0);
  assert.deepEqual(r.usedItems.sort(), ['coffee', 'hotfix']);
  const easy = fight(make({ pets: { byte: 10 } }), squadOf(['byte'], { items: ['rollback'] }), ['typo'], 0);
  assert.deepEqual(easy.usedItems, [], 'Rollback não é gasto se ninguém cai');
  const hard = fight(make({ pets: { byte: 1 } }), squadOf(['byte'], { items: ['rollback'] }), ['zero'], 6, 'elite');
  assert.ok(hard.usedItems.includes('rollback') && hard.log.some((e) => e.k === 'revive'));
});

test('batalha: previsão é a fração de vitórias em N sementes', () => {
  const strong = battle.preview(battle.setupBattle(make({ pets: { byte: 10, noxi: 10, query: 10 } }), squadOf(['byte', 'noxi', 'query']), ['bug'], 0, 'localhost'), 1);
  assert.deepEqual(strong, { chance: 1, label: 'favorável' });
  const weak = battle.preview(battle.setupBattle(make({ pets: { byte: 1 } }), squadOf(['byte']), ['legacy-monolith'], 9, 'localhost', CONTENT, 'boss'), 1);
  assert.deepEqual(weak, { chance: 0, label: 'muito arriscado' });
});

/* ─────────────── mapa ─────────────── */
test('mapa: abre no Tier 2 (não antes) e é determinístico pela semente', () => {
  assert.equal(make({ tier: 1 }).run.map, null);
  const s = make();
  assert.ok(s.run.map && s.run.map.area === 'localhost');
  const again = make();
  assert.deepEqual(again.run.map.nodes, s.run.map.nodes);
  const r = run(s, { type: 'tick' }, T0 + 1000);
  assert.ok(!r.log.some((e) => e.type === 'mapOpen'), 'abre uma vez só');
});

test('mapa: estrutura — colunas fixas, chefe no fim, tudo alcançável, atalhos só de elite para a coluna +2', () => {
  for (let seed = 1; seed < 40; seed++) {
    const area = CONTENT.area.localhost;
    const m = map.generate(area, seed * 7919);
    const nodes = Object.values(m.nodes);
    assert.equal(nodes.length, area.lanes * area.columns + 1);
    const col = (n) => nodes.filter((x) => x.col === n).map((x) => x.type);
    assert.deepEqual(col(0), ['battle', 'battle', 'battle']);
    assert.deepEqual([...col(4)].sort(), ['event', 'rest', 'shop']);
    assert.deepEqual(col(8), ['rest', 'rest', 'rest']);
    assert.equal(m.nodes.boss.type, 'boss');
    // Alcançável a partir da coluna 0, e todo ponto leva ao chefe.
    const seen = new Set(col(0).map((_, l) => '0-' + l));
    for (let c = 0; c < area.columns; c++) for (const n of nodes.filter((x) => x.col === c && seen.has(x.id))) n.next.forEach((id) => seen.add(id));
    assert.equal(seen.size, nodes.length, 'seed ' + seed);
    for (const n of nodes) {
      if (n.type !== 'boss') assert.ok(n.next.length > 0);
      for (const id of n.next) assert.equal(m.nodes[id].col, n.col + 1);
      if (n.shortcut) { assert.equal(n.type, 'elite'); assert.equal(m.nodes[n.shortcut].col, n.col + 2); }
      if (n.type === 'battle' || n.type === 'elite') assert.ok(n.group.length > 0);
    }
  }
});

test('mapa: lutar cobra a entrada; derrota mantém a posição, vitória avança e dá recompensa', () => {
  let s = make({ pets: { byte: 1 }, compute: 1e12, inventory: { hotfix: 1 } });
  const cost = map.nodeCost(s, s.run.map.nodes['0-0']);
  // Força uma derrota: inimigos da coluna 0 trocados por um elite muito forte.
  s.run.map.nodes['0-0'].group = ['legacy-monolith', 'legacy-monolith', 'zero', 'zero'];
  let r = run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte'], { items: ['hotfix'] }) });
  assert.equal(r.error, undefined);
  assert.equal(r.state.run.map.lastBattle.win, false);
  assert.equal(r.state.run.map.at, null, 'derrota não move');
  assert.equal(r.state.run.map.attempts['0-0'], 1);
  near(r.state.run.resources.compute.amount, 1e12 - cost);
  assert.equal(r.state.run.inventory.hotfix, 0, 'consumível usado é gasto');
  assert.equal(r.state.arena.losses, 1);
  // Vitória
  s = make({ pets: { byte: 10, noxi: 10, query: 10 } });
  r = run(s, { type: 'mapFight', node: '0-1', squad: squadOf(['byte', 'noxi', 'query']) });
  assert.equal(r.state.run.map.lastBattle.win, true);
  assert.equal(r.state.run.map.at, '0-1');
  assert.ok(r.state.run.map.lastBattle.rewards.length >= 1);
  assert.equal(r.state.arena.wins, 1);
  assert.deepEqual(map.reachable(r.state), r.state.run.map.nodes['0-1'].next);
});

test('mapa: validações — alcance, Compute, preparação e tipo de ponto', () => {
  const s = make({ pets: { byte: 5 }, compute: 10 });
  assert.equal(run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte']) }).error, 'Compute insuficiente');
  const rich = make({ pets: { byte: 5 } });
  assert.equal(run(rich, { type: 'mapFight', node: '1-0', squad: squadOf(['byte']) }).error, 'Ponto fora de alcance');
  assert.equal(run(rich, { type: 'mapFight', node: '0-0', squad: squadOf([]) }).error, 'Escolha ao menos um DevPet');
  assert.equal(run(rich, { type: 'mapFight', node: '0-0', squad: squadOf(['noxi']) }).error, 'DevPet indisponível');
  assert.equal(run(rich, { type: 'mapFight', node: '0-0', squad: squadOf(['byte'], { items: ['coffee'] }) }).error, 'Consumível indisponível');
  assert.equal(run(rich, { type: 'mapMove', node: '0-0' }).error, 'Esse ponto é uma batalha');
  assert.equal(run(make({ tier: 1 }), { type: 'mapMove', node: '0-0' }).error, 'O mapa abre no Tier 2');
});

/** Estado posicionado logo antes de um ponto de um tipo (troca o tipo do ponto alcançável, se preciso). */
function before(type, extra = {}) {
  const s = make({ pets: { byte: 10, noxi: 10, query: 10 }, ...extra });
  const m = s.run.map;
  const n = m.nodes['1-0'];
  n.type = type;
  delete n.group;
  if (type === 'event') n.event = extra.event || 'legacy-code';
  if (type === 'shop') n.offers = [{ kind: 'item', id: 'coffee', price: 10, index: 0, bought: false }, { kind: 'part', price: 10, index: 1, bought: false }, { kind: 'patch', rarity: 'common', price: 10, index: 2, bought: false }];
  m.at = '0-0'; m.visited = ['0-0'];
  return s;
}

test('mapa: evento bloqueia o avanço até a escolha; escolhas custam e dão recompensa', () => {
  let s = before('event');
  let r = run(s, { type: 'mapMove', node: '1-0' });
  assert.equal(r.error, undefined);
  s = r.state;
  assert.equal(s.run.map.pending.kind, 'event');
  assert.match(run(s, { type: 'mapMove', node: s.run.map.nodes['1-0'].next[0] }).error, /evento/);
  const amount = s.run.resources.compute.amount;
  r = run(s, { type: 'mapChoose', index: 0 });
  assert.equal(r.error, undefined);
  near(r.state.run.resources.compute.amount, amount - 2 * CONTENT.area.localhost.costs[1]);
  assert.equal(r.state.run.patches.length, 1, 'Refatorar dá um Patch comum');
  assert.equal(r.state.run.map.pending, null);
  // Code review do Lint exige um Patch comum.
  s = run(before('event', { event: 'lint-review' }), { type: 'mapMove', node: '1-0' }).state;
  assert.equal(run(s, { type: 'mapChoose', index: 0 }).error, 'Você não tem um Patch comum');
});

test('mapa: descanso (treino respeita o nível máximo) e loja (compra uma vez, estoque cheio)', () => {
  let s = run(before('rest'), { type: 'mapMove', node: '1-0' }).state;
  s.run.squad.pets = ['byte', 'noxi'];
  s.run.pets.noxi.level = 4;
  const train = CONTENT.REST_OPTIONS.findIndex((o) => o.id === 'train');
  const r = run(s, { type: 'mapChoose', index: train });
  assert.equal(r.state.run.pets.noxi.level, 5, 'o de menor nível do esquadrão sobe');
  s = run(before('shop', { inventory: { coffee: 4 } }), { type: 'mapMove', node: '1-0' }).state;
  assert.equal(s.run.map.pending.kind, 'shop');
  let b = run(s, { type: 'mapBuy', offer: 0 });
  assert.equal(b.state.run.inventory.coffee, 5);
  assert.equal(run(b.state, { type: 'mapBuy', offer: 0 }).error, 'Oferta indisponível');
  b = run(b.state, { type: 'mapBuy', offer: 2 });
  assert.equal(b.state.run.patches.length, 1);
  // Loja não bloqueia: dá para seguir sem comprar.
  assert.notEqual(run(s, { type: 'mapMove', node: s.run.map.nodes['1-0'].next[0] }).error, 'Escolha uma opção do evento antes de seguir');
});

test('mapa: vencer o chefe conclui a área', () => {
  const s = make({ pets: { byte: 10, noxi: 10, query: 10 } });
  const m = s.run.map;
  m.at = '8-1'; m.visited = ['8-1'];
  m.nodes.boss.group = ['typo']; // chefe trivial só para o teste
  const r = run(s, { type: 'mapFight', node: 'boss', squad: squadOf(['byte', 'noxi', 'query']) });
  assert.equal(r.state.run.map.cleared, true);
  assert.equal(r.state.arena.areas.localhost, 1);
  assert.ok(r.state.run.patches.some((id) => CONTENT.patch[id].rarity === 'epic'));
  assert.equal(run(r.state, { type: 'mapMove', node: '0-0' }).error, 'Área concluída');
});

/* ─────────────── Patches ─────────────── */
test('patches: produção (como upgrades), treino mais barato e habilidades mais longas', () => {
  const s = make({ pets: { byte: 1 } });
  s.run.generators = { 'terminal-worker': { owned: 10 } };
  const base = production(s, T0).rate;
  s.run.patches = ['hotpatch-shell'];
  // Shell: +15% do Byte (nível 1) → +30% com o Patch (soma no mesmo alvo, como um upgrade 'add').
  near(production(s, T0).rate, base * 1.3 / 1.15);
  s.run.patches = ['mentoring', 'warm-cache'];
  s.run.resources.compute.amount = 1e9;
  const v = snapshot(s, T0).pets.find((p) => p.id === 'byte');
  near(v.trainCost, CONTENT.pet.byte.trainCost * 0.75);
  const a = run(s, { type: 'ability', id: 'compile-burst' }, T0 + 1000).state.run.abilities['compile-burst'];
  assert.equal(a.activeUntil, T0 + 1000 + 30e3 * 1.25);
});

/* ─────────────── view e saves ─────────────── */
test('view: previsão só para o ponto preparado; última batalha com sprites; saves antigos migram', () => {
  let s = make({ pets: { byte: 5 } });
  assert.equal(snapshot(s, T0).map.forecast, null);
  s = run(s, { type: 'mapSquad', squad: squadOf(['byte']), node: '0-0' }).state;
  const f = snapshot(s, T0).map.forecast;
  assert.equal(f.node, '0-0');
  assert.ok(f.chance >= 0 && f.chance <= 1);
  s = run(s, { type: 'mapFight', node: '0-0' }).state;
  const lb = snapshot(s, T0).map.lastBattle;
  assert.ok(lb.units.filter((u) => u.side === 'enemy').every((u) => u.sprite && u.color));
  assert.ok(lb.log.at(-1).k === 'end');
  // Save sem nada do mapa (versão anterior): ganha os campos e o mapa abre no Tier 2.
  const old = createState(T0);
  delete old.run.map; delete old.run.patches; delete old.run.squad; delete old.run.battleBuff; delete old.arena;
  old.run.tier = 2;
  const m = run(migrate(JSON.parse(JSON.stringify(old)), T0), { type: 'tick' }).state;
  assert.ok(m.run.map && Array.isArray(m.run.patches) && m.arena.wins === 0);
  assert.equal(snapshot(make({ tier: 1 }), T0).map.unlocked, false);
});

/* ─────────────── ritmo (simulador) ─────────────── */
const { simulate, PROFILES } = require('../src/devcore/sim.js');

test('ritmo: no uso casual o mapa abre nas primeiras horas e a Área 1 cai em ~2–5 dias, sem travar', () => {
  const m = simulate({ ...PROFILES.casual, days: 7 });
  const t0 = Date.UTC(2026, 0, 5, 9);
  const day = (t) => (t - t0) / 86400e3;
  assert.ok(m.map.opened != null && day(m.map.opened) < 0.5, 'abre no Tier 2');
  assert.ok(m.map.cleared != null, 'o robô conclui a Área 1 na semana');
  const d = day(m.map.cleared);
  assert.ok(d >= 2 && d <= 5, `Área 1 concluída em ${d.toFixed(1)} dias`);
  assert.ok(m.state.run.patches.length >= 2, 'Patches conquistados');
});

/* ─────────────── vida entre batalhas ─────────────── */
const H = 3600e3;

test('vida: persiste depois da luta e recupera 25% por hora (também com o app fechado)', () => {
  let s = make({ pets: { byte: 3, noxi: 3, query: 3 } });
  s.run.map.nodes['0-0'].group = ['zero', 'leaky', 'flicker'];
  s = run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte', 'noxi', 'query']) }).state;
  const lb = s.run.map.lastBattle;
  const hurt = lb.units.filter((u) => u.side === 'pet' && u.end < u.maxHp);
  assert.ok(hurt.length > 0, 'alguém saiu machucado');
  for (const u of lb.units.filter((x) => x.side === 'pet')) near(battle.petHp(s, u.id, T0), u.end / u.maxHp);
  const id = hurt[0].id;
  const after = battle.petHp(s, id, T0);
  near(battle.petHp(s, id, T0 + H), Math.min(1, after + 0.25));
  assert.equal(battle.petHp(s, id, T0 + 5 * H), 1, 'cheia em até 4 h');
  // Fechado (boot com o app fora 3 h): a recuperação conta igual.
  const back = run(s, { type: 'boot' }, T0 + 3 * H).state;
  near(battle.petHp(back, id, T0 + 3 * H), Math.min(1, after + 0.75));
});

test('vida: a próxima luta começa com a vida atual; a previsão e a arena também', () => {
  const s = make({ pets: { byte: 10 } });
  battle.setPetHp(s, 'byte', 0.4, T0);
  const setup = battle.setupBattle(s, squadOf(['byte']), ['bug'], 0, 'localhost', CONTENT, 'battle', T0);
  assert.equal(setup.pets[0].hp, Math.round(setup.pets[0].maxHp * 0.4));
  const full = battle.setupBattle(s, squadOf(['byte']), ['bug'], 0, 'localhost', CONTENT, 'battle', T0 + 4 * H);
  assert.equal(full.pets[0].hp, full.pets[0].maxHp);
  const r = run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte']) }).state;
  const u = r.run.map.lastBattle.units.find((x) => x.side === 'pet');
  assert.equal(u.hp, Math.round(u.maxHp * 0.4), 'a arena começa da vida atual');
});

test('vida: fora de combate não luta até recuperar 25%; Health Check e cura do descanso', () => {
  let s = make({ pets: { byte: 10, noxi: 10 }, inventory: { 'health-check': 1 } });
  battle.setPetHp(s, 'byte', 0, T0);
  assert.equal(battle.petDown(s, 'byte', T0), true);
  assert.match(run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte']) }).error, /Byte está fora de combate \(volta em 1h 00m\)/);
  assert.equal(battle.petDown(s, 'byte', T0 + H), false, 'volta com 25% depois de 1 h');
  // Health Check sem pet indicado cura o mais machucado (+50%) e o tira do fora de combate.
  const healed = run(s, { type: 'use', item: 'health-check' });
  assert.equal(healed.error, undefined);
  near(battle.petHp(healed.state, 'byte', T0), 0.5);
  assert.equal(battle.petDown(healed.state, 'byte', T0), false);
  assert.equal(healed.state.run.inventory['health-check'], 0);
  assert.equal(run(make({ pets: { byte: 10 }, inventory: { 'health-check': 1 } }), { type: 'use', item: 'health-check' }).error, 'Nenhum DevPet machucado');
  // Descanso: cura completa do time.
  s = before('rest');
  battle.setPetHp(s, 'byte', 0.1, T0); battle.setPetHp(s, 'noxi', 0, T0);
  s = run(s, { type: 'mapMove', node: '1-0' }).state;
  s = run(s, { type: 'mapChoose', index: CONTENT.REST_OPTIONS.findIndex((o) => o.id === 'heal') }).state;
  assert.deepEqual(['byte', 'noxi', 'query'].map((id) => battle.petHp(s, id, T0)), [1, 1, 1]);
  // View: vida, fora de combate e quando volta.
  const v = make({ pets: { byte: 10 } });
  battle.setPetHp(v, 'byte', 0, T0);
  const p = snapshot(v, T0 + 0.5 * H).map.roster.find((x) => x.id === 'byte');
  assert.equal(p.down, true);
  near(p.life, 0.125);
  near(p.backInMs, 0.5 * H);
  near(p.fullInMs, 3.5 * H);
});

test('vida: saves sem vida guardada começam cheios', () => {
  const s = make({ pets: { byte: 5 } });
  delete s.run.pets.byte.hp;
  assert.equal(battle.petHp(s, 'byte', T0), 1);
  assert.equal(battle.petDown(s, 'byte', T0), false);
});
