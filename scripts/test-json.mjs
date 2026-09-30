// Testes do engine do JSON Visualizer (puro, sem DOM): node --test scripts/test-json.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseJson, formatJson, minifyJson, buildGraph, layoutTree, toJsonPath, query, toYaml, toCsv,
} = require('../src/tools/json-visualizer/engine.js');

test('parseJson: válido', () => {
  const r = parseJson('{"a":[1,2]}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: [1, 2] });
});

test('parseJson: erro traz linha e coluna', () => {
  const r = parseJson('{\n  "a": 1,\n  "b": ,\n}');
  assert.equal(r.ok, false);
  assert.equal(r.line, 3);
  assert.ok(r.col >= 1);
  assert.ok(r.error.length > 0);
});

test('parseJson: vazio é erro amigável', () => {
  const r = parseJson('   ');
  assert.equal(r.ok, false);
});

test('formatJson / minifyJson', () => {
  const v = { b: 1, a: { d: 1, c: 2 } };
  assert.equal(formatJson(v, 2), '{\n  "b": 1,\n  "a": {\n    "d": 1,\n    "c": 2\n  }\n}');
  assert.equal(formatJson(v, 'tab').split('\n')[1], '\t"b": 1,');
  assert.equal(formatJson(v, 2, true), '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}');
  assert.equal(minifyJson(v), '{"b":1,"a":{"d":1,"c":2}}');
});

test('toJsonPath', () => {
  assert.equal(toJsonPath([]), '$');
  assert.equal(toJsonPath(['a', 0, 'b c', 'd']), "$.a[0]['b c'].d");
});

test('buildGraph: objeto com filhos', () => {
  const g = buildGraph({ nome: 'x', n: 1, cfg: { on: true }, lista: [1, { z: null }] });
  const root = g.nodes[0];
  assert.equal(root.path, '$');
  assert.equal(root.kind, 'object');
  assert.deepEqual(root.rows.map((r) => r.key), ['nome', 'n']);
  assert.equal(root.rows[0].type, 'string');
  assert.equal(root.rows[1].type, 'number');
  // cfg, lista → 2 arestas a partir da raiz; lista[1] → 1 aresta
  assert.equal(g.edges.filter((e) => e.from === root.id).length, 2);
  assert.equal(g.nodes.length, 4);
  const lista = g.nodes.find((n) => n.path === '$.lista');
  assert.equal(lista.kind, 'array');
  assert.deepEqual(lista.rows.map((r) => r.key), ['[0]']);
  assert.ok(g.nodes.find((n) => n.path === '$.lista[1]'));
});

test('buildGraph: primitivo na raiz', () => {
  const g = buildGraph(42);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].rows[0].value, '42');
});

test('buildGraph: colapso esconde descendentes', () => {
  const v = { a: { b: { c: 1 } } };
  const g = buildGraph(v, { collapsed: new Set(['$.a']) });
  assert.equal(g.nodes.length, 2);
  const a = g.nodes.find((n) => n.path === '$.a');
  assert.equal(a.collapsed, true);
  assert.equal(a.hiddenChildren, 1);
});

test('layoutTree: colunas por profundidade e sem sobreposição', () => {
  const v = { a: { x: 1, y: { z: 1 } }, b: { k: [1, { q: 1 }, { w: 2 }] }, c: { m: 1 } };
  const g = buildGraph(v);
  const { width, height } = layoutTree(g);
  assert.ok(width > 0 && height > 0);
  for (const n of g.nodes) assert.ok(n.w > 0 && n.h > 0);
  // filho fica à direita do pai
  for (const e of g.edges) {
    const p = g.nodes[e.from], c = g.nodes[e.to];
    assert.ok(c.x >= p.x + p.w);
  }
  // nós da mesma coluna não se sobrepõem em y
  const byDepth = new Map();
  for (const n of g.nodes) (byDepth.get(n.depth) || byDepth.set(n.depth, []).get(n.depth)).push(n);
  for (const col of byDepth.values()) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) assert.ok(col[i].y >= col[i - 1].y + col[i - 1].h);
  }
});

test('query: JSONPath básico', () => {
  const v = { loja: { livros: [{ t: 'A', p: 1 }, { t: 'B', p: 2 }], nome: 'x' } };
  assert.deepEqual(query(v, '$.loja.nome').map((r) => r.value), ['x']);
  assert.deepEqual(query(v, '$.loja.livros[1].t').map((r) => r.value), ['B']);
  assert.deepEqual(query(v, '$.loja.livros[*].t').map((r) => r.value), ['A', 'B']);
  assert.deepEqual(query(v, '$..p').map((r) => r.value), [1, 2]);
  assert.deepEqual(query(v, "$['loja']['nome']").map((r) => r.path), ["$.loja.nome"]);
  assert.deepEqual(query(v, '$.nada'), []);
  assert.throws(() => query(v, 'loja'));
});

test('toYaml', () => {
  const y = toYaml({ a: 1, b: 'x: y', c: [1, { d: true }], e: {}, f: [], g: null, h: 'multi\nlinha' });
  assert.equal(y, [
    'a: 1',
    'b: "x: y"',
    'c:',
    '  - 1',
    '  - d: true',
    'e: {}',
    'f: []',
    'g: null',
    'h: "multi\\nlinha"',
  ].join('\n'));
});

test('toCsv', () => {
  const csv = toCsv([{ a: 1, b: { c: 'x,y' } }, { a: 2, d: 'q"r' }]);
  assert.equal(csv, ['a,b.c,d', '1,"x,y",', '2,,"q""r"'].join('\n'));
});

test('toCsv: objeto na raiz vira uma linha, arrays viram colunas indexadas', () => {
  const csv = toCsv({ nome: 'x', r: { tel: ['1', '2'] }, f: [{ id: 'a' }, { id: 'b' }], vazio: [], nada: null });
  assert.equal(csv, ['nome,r.tel[0],r.tel[1],f[0].id,f[1].id,vazio,nada', 'x,1,2,a,b,[],'].join('\n'));
  assert.equal(toCsv(42), 'value\n42');
  assert.equal(toCsv([1, 2]), 'value\n1\n2');
});
