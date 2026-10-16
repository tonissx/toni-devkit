// Testes do SQL Visualizer — explorador de schemas grandes: node --test scripts/test-sqlviz-explorer.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const X = require('../src/db/explorer.js');
const S = require('../src/db/schema.js');
const { ER, heightOf } = require('../src/db/erlayout.js');

/** Schema sintético estilo ERP: módulos TMOV, FLAN, PFUNC… com FKs dentro de cada cadeia. */
function bigSchema(n = 600) {
  const mods = ['TMOV', 'FLAN', 'PFUNC', 'GCOLIG', 'CTAB'];
  const tables = [], fks = [];
  for (let i = 0; i < n; i++) {
    const m = mods[i % mods.length];
    const name = i < mods.length ? m : `${m}_ITEM${i}`;
    const schema = i % 7 === 0 ? 'fin' : 'dbo';
    tables.push({ id: `${schema}.${name}`, schema, name, columns: [{ name: 'Id', type: 'int', nullable: false, pk: true }, { name: 'RefId', type: 'int', nullable: true }, { name: 'Descricao', type: 'varchar(50)', nullable: true }], pk: ['Id'] });
    if (i >= mods.length) fks.push({ name: `FK_${i}`, from: tables[i].id, fromCols: ['RefId'], to: tables[i - mods.length].id, toCols: ['Id'], oneToOne: false });
  }
  return { tables, fks, warnings: [] };
}

const hit = (u, v) => u.x < v.x + v.w && v.x < u.x + u.w && u.y < v.y + v.h && v.y < u.y + u.h;

test('filtro: busca em nome/coluna, schema e prefixos; começa-por vem primeiro', () => {
  const s = bigSchema(50);
  assert.equal(X.filterTables(s, {}).length, 50);
  const q = X.filterTables(s, { q: 'flan_item' });
  assert.ok(q.length > 0 && q.every((id) => /flan_item/i.test(id)));
  assert.equal(X.filterTables(s, { q: 'refid' }).length, 50); // casa por coluna
  const fin = X.filterTables(s, { schemas: new Set(['fin']) });
  assert.ok(fin.length > 0 && fin.every((id) => id.startsWith('fin.')));
  const pf = X.filterTables(s, { prefixes: X.parsePrefixes('TMOV, pfunc') });
  assert.ok(pf.length > 0 && pf.every((id) => /\.(TMOV|PFUNC)/.test(id)));
  assert.deepEqual(X.parsePrefixes(' a, b;c  d '), ['a', 'b', 'c', 'd']);
  assert.equal(X.filterTables(s, { q: 'item' }).length, 45);
});

test('módulos: por schema, prefixo antes de "_", CamelCase e primeiras letras', () => {
  const t = (name, schema = 'dbo') => ({ name, schema });
  assert.equal(X.moduleOf(t('TMOV_ITEM1', 'fin'), 'schema'), 'fin');
  assert.equal(X.moduleOf(t('TMOV_ITEM1'), 'prefix'), 'TMOV');
  assert.equal(X.moduleOf(t('PedidoItem'), 'prefix'), 'Pedido');
  assert.equal(X.moduleOf(t('PFUNC'), 'prefix'), 'PFUNC');
  assert.equal(X.moduleOf(t('flan'), 'letters', 3), 'FLA');
  assert.equal(X.moduleOf(t('x'), 'none'), '');
  assert.equal(X.moduleColor('TMOV'), X.moduleColor('TMOV')); // estável
  assert.notEqual(X.moduleColor('TMOV'), X.moduleColor('FLAN'));
});

test('placeNear: ao lado da vizinha, sem sobrepor; sem âncora vai abaixo de tudo', () => {
  const size = { w: ER.w, h: 100 };
  const a = { x: 0, y: 0, w: ER.w, h: 100 };
  const p1 = X.placeNear([a], a, size);
  assert.ok(p1.x >= a.x + a.w);
  const b = { ...size, ...p1 };
  const p2 = X.placeNear([a, b], a, size); // mesmo lugar ocupado → desce
  assert.equal(hit({ ...size, ...p2 }, b), false);
  assert.deepEqual(X.placeNear([], null, size), { x: 0, y: 0 });
  assert.ok(X.placeNear([a, b], null, size).y >= 100);
  // 200 tabelas ligadas à mesma âncora: nenhuma sobrepõe outra
  const boxes = [a];
  for (let i = 0; i < 200; i++) boxes.push({ ...X.placeNear(boxes, a, size), ...size });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(hit(boxes[i], boxes[j]), false);
});

test('expandir vizinhas: 1 e 2 níveis sobre um schema grande', () => {
  const s = bigSchema(600);
  const root = s.tables[10].id; // tem pai (i-5) e filho (i+5)
  assert.equal(S.expand(s, root, 1).size, 3);
  assert.equal(S.expand(s, root, 2).size, 5);
  assert.equal(S.subset(s, S.expand(s, root, 2)).fks.length, 4);
});

test('layout por módulo: cada módulo num bloco; sem sobreposição entre tabelas nem entre módulos', () => {
  const s = bigSchema(120);
  const groupOf = (id) => X.moduleOf(s.tables.find((t) => t.id === id), 'prefix');
  const pos = X.layoutAll(s, groupOf);
  assert.equal(Object.keys(pos).length, 120);
  const nodes = X.boxesOf(s, s.tables.map((t) => t.id), pos);
  const ids = Object.keys(nodes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.equal(hit(nodes[ids[i]], nodes[ids[j]]), false, `${ids[i]} × ${ids[j]}`);
  const rects = X.groupRects(nodes, groupOf);
  assert.equal(rects.length, 5);
  assert.ok(rects.every((r) => r.w > 0 && r.h > 0 && r.count > 0));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(hit(rects[i], rects[j]), false);
  assert.ok(heightOf(s.tables[0]) > 0);
});

test('layouts nomeados: ida e volta; tabela removida do banco é ignorada com contagem', () => {
  const s = bigSchema(30);
  const ids = [s.tables[0].id, s.tables[5].id, s.tables[9].id];
  const saved = JSON.parse(JSON.stringify(X.serializeLayout({ ids, pos: { [ids[0]]: { x: 1.4, y: 2.6 }, [ids[1]]: { x: 300, y: 0 }, [ids[2]]: { x: 0, y: 500 } }, group: { mode: 'prefix', n: 2 } })));
  const r = X.restoreLayout(s, saved);
  assert.deepEqual(r.ids, ids);
  assert.deepEqual(r.pos[ids[0]], { x: 1, y: 3 });
  assert.equal(r.group.mode, 'prefix');
  const r2 = X.restoreLayout({ ...s, tables: s.tables.filter((t) => t.id !== ids[1]) }, saved);
  assert.equal(r2.ids.length, 2);
  assert.equal(r2.missing, 1);
  assert.deepEqual(X.restoreLayout(s, null).ids, []);
  assert.equal(X.schemaKey('srv · Vendas', s), 'srv · Vendas');
  assert.match(X.schemaKey('', s), /^texto\|30\|/);
});

test('escala: filtrar 5000 tabelas e organizar 80 no canvas é rápido', () => {
  const s = bigSchema(5000);
  const t0 = Date.now();
  assert.ok(X.filterTables(s, { q: 'item4', prefixes: ['TMOV'] }).length > 0);
  const sub = S.subset(s, X.filterTables(s, {}).slice(0, 80));
  const pos = X.layoutAll(sub, (id) => X.moduleOf(sub.tables.find((t) => t.id === id), 'prefix'));
  assert.equal(Object.keys(pos).length, 80);
  assert.ok(Date.now() - t0 < 3000, `demorou ${Date.now() - t0} ms`);
});
