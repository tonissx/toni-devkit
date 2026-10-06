// Testes do gerador de tipos e do conserto de JSON (puros): node --test scripts/test-json-types.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { generateTypes, singular, pascal } = require('../src/tools/json-visualizer/types.js');
const { repairJson } = require('../src/tools/json-visualizer/engine.js');

const sample = {
  empresa: 'Toni', versao: 1.4, ativo: true, ano: 2026,
  pedidos: [
    { id: 1, cliente: 'Ana', itens: [{ sku: 'A', qtd: 2 }], obs: null },
    { id: 2, cliente: 'Bia', itens: [], desconto: 0.1, obs: 'urgente' },
  ],
  'meta-dados': { criado: '2026-01-01' },
};

test('TypeScript: interfaces aninhadas, opcionais e uniões', () => {
  const ts = generateTypes(sample, 'ts');
  assert.match(ts, /export interface Root \{\n {2}empresa: string;\n {2}versao: number;\n {2}ativo: boolean;\n {2}ano: number;\n {2}pedidos: Pedido\[\];\n {2}"meta-dados": MetaDados;\n\}/);
  assert.match(ts, /export interface Pedido \{[\s\S]*itens: Item\[\];[\s\S]*obs: null \| string;[\s\S]*desconto\?: number;/);
  assert.match(ts, /export interface Item \{\n {2}sku: string;\n {2}qtd: number;\n\}/);
  assert.equal(generateTypes([1, 'a'], 'ts'), 'export type Root = (number | string)[];\n');
  assert.equal(generateTypes([], 'ts'), 'export type Root = unknown[];\n');
});

test('C#: classes com JsonPropertyName, List e anuláveis', () => {
  const cs = generateTypes(sample, 'cs');
  assert.match(cs, /using System\.Text\.Json\.Serialization;/);
  assert.match(cs, /public class Root\n\{/);
  assert.match(cs, /\[JsonPropertyName\("pedidos"\)\]\n {4}public List<Pedido> Pedidos \{ get; set; \}/);
  assert.match(cs, /\[JsonPropertyName\("meta-dados"\)\]\n {4}public MetaDados MetaDados \{ get; set; \}/);
  assert.match(cs, /public long Ano \{ get; set; \}/);
  assert.match(cs, /public double\? Desconto \{ get; set; \}/);
  assert.match(cs, /public string\? Obs \{ get; set; \}/);
});

test('JSON Schema: required só com o que aparece sempre', () => {
  const s = JSON.parse(generateTypes(sample, 'schema'));
  assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
  const pedido = s.properties.pedidos.items;
  assert.deepEqual(pedido.required, ['id', 'cliente', 'itens', 'obs']);
  assert.deepEqual(pedido.properties.obs, { type: ['null', 'string'] });
  assert.deepEqual(s.properties.ano, { type: 'integer' });
});

test('nomes', () => {
  assert.equal(singular('Pedidos'), 'Pedido');
  assert.equal(singular('Itens'), 'Item');
  assert.equal(singular('opções'), 'opção');
  assert.match(generateTypes({ opções: [{ a: 1 }] }, 'ts'), /opções: Opcao\[\];/);
  assert.equal(singular('Categories'), 'Category');
  assert.equal(singular('Status'), 'Status');
  assert.equal(singular('Root'), 'RootItem');
  assert.equal(pascal('meta-dados'), 'MetaDados');
  assert.equal(pascal('2fa'), 'T2fa');
});

test('consertar JSON: comentários, vírgulas, aspas, chaves, Python', () => {
  const r = repairJson("{\n  // comentário\n  nome: 'Ana',\n  \"ok\": True, /* x */ 'v': None,\n  lista: [1, 2, NaN,],\n}");
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.text), { nome: 'Ana', ok: true, v: null, lista: [1, 2, null] });
  assert.ok(r.changes.length >= 5, r.changes.join(' | '));
  // aspas dentro de aspas simples
  assert.deepEqual(JSON.parse(repairJson("{'a': 'diz \"oi\"', 'b': 'it\\'s'}").text), { a: 'diz "oi"', b: "it's" });
  // não estraga o que já é válido (URL com // dentro de string)
  const ok = '{"url":"http://x.com/a","n":-1.5e3,"t":true}';
  assert.deepEqual(repairJson(ok), { ok: true, text: ok, changes: [] });
  // o que não sabe consertar continua inválido
  assert.equal(repairJson('{"a": 1 "b": 2}').ok, false);
});
