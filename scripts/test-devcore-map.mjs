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
  // Na retaguarda (só bônus de velocidade), para medir só Patches e buff.
  const rear = { slots: { rear: 'byte' }, triggers: {}, items: [] };
  const base = battle.setupBattle(make({ pets: { byte: 1 } }), rear, ['bug'], 0, 'localhost').pets[0];
  const s = make({ pets: { byte: 1 }, patches: ['pair-review', 'retry-policy', 'type-safety'] });
  s.run.battleBuff = { atk: 0.2 };
  const p = battle.setupBattle(s, rear, ['bug'], 0, 'localhost').pets[0];
  near(p.atk, base.atk * (1 + 0.1 + 0.2));
  assert.equal(p.maxHp, Math.round(base.maxHp / 1 * 1.15));
  near(p.def, base.def * 1.25);
});

test('slots: bônus por slot (e extra do papel certo), alvo pela ordem dos slots, cura da retaguarda, formato antigo', () => {
  const s = make({ pets: { armo: 10, byte: 10, memo: 12 } });
  const stats = (id) => battle.petStats(s, id);
  const setup = battle.setupBattle(s, { slots: { vanguard: 'armo', center: 'byte', rear: 'memo' }, triggers: {}, items: [] }, ['bug'], 0, 'localhost');
  const [armo, byte, memo] = setup.pets;
  assert.deepEqual(setup.pets.map((u) => u.slot), ['vanguard', 'center', 'rear']);
  near(armo.def, stats('armo').def * (1 + 0.15 + 0.3));        // vanguarda + tanque
  assert.equal(armo.maxHp, Math.round(stats('armo').hp * 1.15));
  near(byte.atk, stats('byte').atk * (1 + 0.1 + 0.25));        // centro + atacante
  assert.equal(memo.spd, stats('memo').spd + 2);               // retaguarda
  assert.equal(memo.healMult, 1.5);                            // retaguarda + suporte
  // Fora do papel: tanque no centro só ganha o bônus geral do centro.
  const off = battle.setupBattle(s, { slots: { center: 'armo' } }, ['bug'], 0, 'localhost').pets[0];
  near(off.atk, stats('armo').atk * 1.1);
  near(off.def, stats('armo').def);
  // Alvo: os inimigos batem na vanguarda; o centro só apanha depois que ela cai.
  const r = battle.resolve(battle.setupBattle(make({ pets: { git: 1, byte: 10 } }), { slots: { vanguard: 'git', center: 'byte' }, triggers: { git: 'allyLow', byte: 'allyLow' } }, ['zero', 'zero', 'zero'], 6, 'localhost', CONTENT, 'elite'), 3);
  const hits = r.log.filter((e) => e.k === 'atk' && e.a[0] === 'e');
  const downAt = r.log.findIndex((e) => e.k === 'down' && e.t === 'p0');
  assert.ok(hits.length && hits[0].t === 'p0', 'primeiro golpe na vanguarda');
  assert.ok(r.log.slice(0, downAt).filter((e) => e.k === 'atk' && e.a[0] === 'e').every((e) => e.t === 'p0'), 'centro intocado enquanto a vanguarda está de pé');
  // Formato antigo (pets + front) vira slots: frente primeiro.
  assert.deepEqual(battle.slotsOf({ pets: ['byte', 'armo', 'memo'], front: ['armo'] }), { vanguard: 'armo', center: 'byte', rear: 'memo' });
  // Enxame: só o Armo na vanguarda anula.
  assert.equal(battle.setupBattle(s, { slots: { vanguard: 'armo' } }, ['swarm-bot'], 0, 'localhost').counters.front.has('armo'), true);
  assert.equal(battle.setupBattle(s, { slots: { rear: 'armo', vanguard: 'byte' } }, ['swarm-bot'], 0, 'localhost').counters.front.has('armo'), false);
  // O mapa guarda os slots.
  const m = run(s, { type: 'mapSquad', squad: { slots: { vanguard: 'armo', rear: 'memo' }, triggers: {}, items: [] }, node: '0-0' }).state;
  assert.deepEqual(m.run.squad.slots, { vanguard: 'armo', center: null, rear: 'memo' });
  assert.deepEqual(m.run.squad.pets, ['armo', 'memo']);
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
  assert.deepEqual(strong, { chance: 1, label: 'favorável', timeouts: 0 });
  const weak = battle.preview(battle.setupBattle(make({ pets: { byte: 1 } }), squadOf(['byte']), ['legacy-monolith'], 9, 'localhost', CONTENT, 'boss'), 1);
  assert.equal(weak.chance, 0);
  assert.equal(weak.label, 'muito arriscado');
});

test('batalha: o fim diz o motivo — vitória, esquadrão derrubado ou tempo esgotado (limite de rodadas)', () => {
  const s = make({ pets: { byte: 10, armo: 12 } });
  assert.equal(fight(s, squadOf(['byte']), ['typo'], 0).reason, 'win');
  assert.equal(fight(make({ pets: { byte: 1 } }), squadOf(['byte']), ['zero', 'zero'], 6, 'elite').reason, 'wiped');
  // Armo (tanque) quase não apanha e quase não bate: três Monoliths fortificando seguram até o limite.
  const r = fight(s, squadOf(['armo']), ['legacy-monolith', 'legacy-monolith', 'legacy-monolith'], 0);
  assert.equal(r.reason, 'timeout');
  assert.equal(r.rounds, CONTENT.BATTLE.maxRounds);
  assert.deepEqual(r.log.at(-1), { r: CONTENT.BATTLE.maxRounds, k: 'end', v: 0, why: 'timeout' });
  const p = battle.preview(battle.setupBattle(s, squadOf(['armo']), ['legacy-monolith', 'legacy-monolith', 'legacy-monolith'], 0, 'localhost'), 1);
  assert.ok(p.timeouts >= 0.75, 'a previsão conta as derrotas por tempo: ' + p.timeouts);
  // No mapa: tempo esgotado ganha a desculpa de "lore" de quem ficou de pé (o chefe primeiro).
  const m = make({ pets: { armo: 12 } });
  m.run.map.nodes['0-0'].group = ['legacy-monolith', 'legacy-monolith', 'legacy-monolith'];
  const after = run(m, { type: 'mapFight', node: '0-0', squad: squadOf(['armo']) }).state;
  const lb = snapshot(after, T0).map.lastBattle;
  if (lb.reason === 'timeout') assert.equal(lb.timeoutLore, CONTENT.enemy['legacy-monolith'].timeout);
  const won = snapshot(run(make({ pets: { byte: 10 } }), { type: 'mapFight', node: '0-0', squad: squadOf(['byte']) }).state, T0).map.lastBattle;
  assert.equal(won.timeoutLore, null);
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

test('mapa: com o estoque cheio, a vitória (e o evento) rende peça ou sucata — nunca nada', () => {
  const full = Object.fromEntries(CONTENT.CONSUMABLES.map((k) => [k.id, k.cap]));
  for (let seed = 0; seed < 12; seed++) {
    const s = make({ pets: { byte: 10, noxi: 10, query: 10 }, inventory: full });
    s.seed += seed * 7919;
    const r = run(s, { type: 'mapFight', node: '0-0', squad: squadOf(['byte', 'noxi', 'query']) }).state.run.map.lastBattle;
    assert.ok(r.win && r.rewards.length > 0, 'vitória sem recompensa (seed ' + seed + ')');
    assert.ok(r.rewards.every((x) => ['part', 'scrap', 'patch'].includes(x.type)), JSON.stringify(r.rewards));
  }
  let s = before('event', { event: 'so-down', inventory: full });
  s = run(s, { type: 'mapMove', node: '1-0' }).state;
  const r = run(s, { type: 'mapChoose', index: 0 });
  const got = r.log.find((e) => e.type === 'mapChoice').rewards;
  assert.ok(got.length === 1 && ['part', 'scrap'].includes(got[0].type), 'comprar consumível com o estoque cheio vira peça: ' + JSON.stringify(got));
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

/* ─────────────── Área 2 — Pântano Staging ─────────────── */
/** Luta no Pântano (várias sementes) → todos os eventos do log. */
const swampLogs = (s, squad, enemies, seeds = 30, col = 3, kind = 'battle') => {
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) out.push(...battle.resolve(battle.setupBattle(s, squad, enemies, col, 'staging', CONTENT, kind), seed).log);
  return out;
};

test('pântano: traços novos agem sem o counter e somem com o pet certo (Lint, Memo, Git)', () => {
  const s = make({ pets: { byte: 12, armo: 12, query: 12, lint: 12, memo: 12, git: 12 } });
  const base = squadOf(['armo', 'byte', 'query']);
  // Instável: falhas e golpes em dobro; o Lint estabiliza.
  const flaky = swampLogs(s, base, ['flaky-test', 'flaky-test']);
  assert.ok(flaky.some((e) => e.k === 'miss' && e.f === 'flaky'));
  assert.ok(flaky.some((e) => e.k === 'atk' && e.f === 'flaky'));
  assert.ok(!swampLogs(s, squadOf(['armo', 'byte', 'lint']), ['flaky-test', 'flaky-test']).some((e) => e.f === 'flaky'));
  // Corrida: age duas vezes às vezes; o Memo trava.
  assert.ok(swampLogs(s, base, ['race-condition', 'race-condition']).some((e) => e.k === 'race'));
  assert.ok(!swampLogs(s, squadOf(['armo', 'byte', 'memo']), ['race-condition', 'race-condition']).some((e) => e.k === 'race'));
  // Deriva: o ataque muda a cada rodada dentro da faixa; o Git fixa.
  const drift = swampLogs(s, base, ['config-drift']).filter((e) => e.k === 'drift');
  assert.ok(drift.length > 0);
  const D = CONTENT.TRAITS.drift;
  assert.ok(drift.every((e) => e.v >= D.min * 100 - 1 && e.v <= D.max * 100 + 1));
  assert.ok(new Set(drift.map((e) => e.v)).size > 3);
  assert.ok(!swampLogs(s, squadOf(['armo', 'byte', 'git']), ['config-drift']).some((e) => e.k === 'drift'));
});

test('pântano: Merge — a cabeça caída volta (uma vez) se a outra seguir de pé', () => {
  const s = make({ pets: { byte: 12, armo: 12, relay: 12, query: 12 } });
  const sq = squadOf(['query', 'byte', 'relay'], { slots: { vanguard: 'query', center: 'byte', rear: 'relay' } });
  let revives = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = battle.resolve(battle.setupBattle(s, sq, ['conflict-main', 'conflict-feature'], 8, 'staging', CONTENT, 'boss'), seed);
    const back = r.log.filter((e) => e.k === 'revive' && e.f === 'merge');
    revives += back.length;
    for (const uid of ['e0', 'e1']) assert.ok(back.filter((e) => e.t === uid).length <= 1, 'cada cabeça volta no máximo uma vez');
    for (const e of back) near(e.v, Math.round(r.units.find((u) => u.uid === e.t).maxHp * CONTENT.TRAITS.merge.value), 1);
  }
  assert.ok(revives > 0);
  // Sozinha (sem a outra cabeça), não volta.
  const solo = battle.resolve(battle.setupBattle(s, sq, ['conflict-main'], 0, 'staging', CONTENT, 'boss'), 1);
  assert.ok(!solo.log.some((e) => e.k === 'revive'));
});

test('pântano: vencer o Legacy Monolith libera a travessia; o Pântano começa do zero e os Patches seguem', () => {
  const s = make({ pets: { byte: 10, noxi: 10, query: 10 }, patches: ['mentoring'] });
  assert.equal(run(s, { type: 'mapAdvance' }).error, 'Vença o chefe da área antes de seguir');
  assert.equal(snapshot(s, T0).map.next.id, 'staging');
  const m = s.run.map;
  m.at = '8-1'; m.visited = ['8-1'];
  m.nodes.boss.group = ['typo'];
  let r = run(s, { type: 'mapFight', node: 'boss', squad: squadOf(['byte', 'noxi', 'query']) });
  const fought = r.state.run.map.battles;
  r = run(r.state, { type: 'mapAdvance' });
  assert.equal(r.error, undefined);
  const st = r.state.run.map;
  assert.equal(st.battles, fought, 'a numeração das lutas segue depois da travessia (a arena precisa ver a luta nova)');
  assert.equal(st.area, 'staging');
  assert.equal(st.at, null);
  assert.equal(st.cleared, false);
  assert.ok(r.state.run.patches.includes('mentoring'));
  assert.ok(r.log.some((e) => e.type === 'mapOpen' && e.area === 'staging' && e.from === 'localhost'));
  const v = snapshot(r.state, T0).map;
  assert.equal(v.area.name, 'Pântano Staging');
  assert.equal(v.next.id, 'production');
  assert.equal(v.nodes.find((n) => n.type === 'boss').enemies.length, 2);
  // Pântano → Pico; o Pico é a última área (por enquanto): atravessar de lá é recusado mesmo depois do chefe.
  r.state.run.map.cleared = true;
  r = run(r.state, { type: 'mapAdvance' });
  assert.equal(r.state.run.map.area, 'production');
  assert.equal(snapshot(r.state, T0).map.next, null);
  r.state.run.map.cleared = true;
  assert.equal(run(r.state, { type: 'mapAdvance' }).error, 'A próxima área ainda não existe');
});

/* ─────────────── Área 3 — Pico Production ─────────────── */
const peakLogs = (s, squad, enemies, seeds = 20, col = 3, kind = 'battle') => {
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) out.push(battle.resolve(battle.setupBattle(s, squad, enemies, col, 'production', CONTENT, kind), seed));
  return out;
};

test('pico: traços novos agem sem o counter e somem com o pet certo (Relay, Lint, Query)', () => {
  const s = make({ pets: { byte: 12, armo: 12, git: 12, relay: 12, lint: 12, query: 12 } });
  const base = squadOf(['armo', 'byte', 'git']);
  // Partida a frio: lento nas primeiras rodadas e aquece depois; o Relay pré-aquece (sem o bônus).
  const cold = peakLogs(s, base, ['cold-start', 'cold-start'], 5, 8, 'elite').flatMap((r) => r.log);
  assert.ok(cold.some((e) => e.k === 'warm' && e.r === CONTENT.TRAITS.coldstart.rounds + 1));
  assert.ok(!peakLogs(s, squadOf(['armo', 'byte', 'relay']), ['cold-start', 'cold-start'], 5, 8, 'elite').some((r) => r.log.some((e) => e.k === 'warm')));
  // Inundação: chama mais corvos (até o limite); o Lint faz o rate limiting.
  const flood = peakLogs(s, squadOf(['armo', 'git', 'query']), ['ddos', 'ddos'], 10, 6);
  assert.ok(flood.some((r) => r.log.some((e) => e.k === 'split' && e.f === 'flood')));
  for (const r of flood) assert.ok(r.units.filter((u) => u.side === 'enemy').length <= CONTENT.TRAITS.flood.max);
  assert.ok(!peakLogs(s, squadOf(['armo', 'git', 'lint']), ['ddos', 'ddos'], 10, 6).some((r) => r.log.some((e) => e.f === 'flood')));
  // Vazamento: cresce a cada rodada; o Query libera a memória.
  const grow = peakLogs(s, squadOf(['armo', 'byte', 'git']), ['leak-giant'], 3).flatMap((r) => r.log).filter((e) => e.k === 'grow');
  assert.ok(grow.length > 0 && grow.every((e) => e.v > 0));
  assert.ok(!peakLogs(s, squadOf(['query', 'byte', 'git']), ['leak-giant'], 3).some((r) => r.log.some((e) => e.k === 'grow')));
});

test('pico: Apagão — a cada N rodadas o esquadrão leva dano e perde a vez', () => {
  const s = make({ pets: { byte: 12, armo: 12, relay: 12 } });
  const sq = squadOf(['armo', 'byte', 'relay'], { slots: { vanguard: 'armo', center: 'byte', rear: 'relay' } });
  const B = CONTENT.TRAITS.blackout;
  const r = battle.resolve(battle.setupBattle(s, sq, ['production-outage'], 8, 'production', CONTENT, 'boss'), 3);
  const outs = r.log.filter((e) => e.k === 'blackout');
  assert.ok(outs.length > 0 && outs.every((e) => e.r % B.every === 0));
  for (const o of outs) {
    // nenhum pet age (ataca ou cura por conta própria) na rodada do apagão; todos levam o raio
    assert.ok(!r.log.some((e) => e.r === o.r && ['p0', 'p1', 'p2'].includes(e.a) && (e.k === 'atk' || e.k === 'heal')));
    assert.equal(r.log.filter((e) => e.r === o.r && e.a === 'storm').length, r.units.filter((u) => u.side === 'pet').length);
  }
});

test('ritmo: o robô vence as três áreas — o jogo completo leva ~2 semanas no uso casual', () => {
  const { simulate, PROFILES } = require('../src/devcore/sim.js');
  const m = simulate({ ...PROFILES.casual, days: 17 });
  const day = (t) => (t - Date.UTC(2026, 0, 5, 9)) / 86400e3;
  for (const id of ['localhost', 'staging', 'production']) assert.ok(m.map.areas[id] != null, 'área concluída: ' + id);
  const total = day(m.map.areas.production);
  assert.ok(total >= 9 && total <= 17, `Pico concluído no dia ${total.toFixed(1)}`);
  assert.ok(day(m.map.areas.production) - day(m.map.areas.staging) >= 2, 'o Pico não acaba numa tarde');
});

test('ritmo: o robô vence as duas áreas — o Pântano leva alguns dias depois da Floresta', () => {
  const { simulate, PROFILES } = require('../src/devcore/sim.js');
  const m = simulate({ ...PROFILES.casual, days: 12 });
  const day = (t) => (t - Date.UTC(2026, 0, 5, 9)) / 86400e3;
  assert.ok(m.map.areas.localhost != null && m.map.areas.staging != null, 'as duas áreas concluídas');
  const gap = day(m.map.areas.staging) - day(m.map.areas.localhost);
  assert.ok(gap >= 3 && gap <= 9, `Pântano em ${gap.toFixed(1)} dias depois da Floresta`);
});
