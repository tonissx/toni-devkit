// Testes da busca do diagrama ER (tabelas + colunas, navegação): node --test scripts/test-sqlviz-search.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { searchSchema, colKey, stepIndex } = require('../src/db/ersearch.js');

const schema = {
  tables: [
    { id: 'dbo.Cliente', columns: [{ name: 'Id' }, { name: 'Nome' }, { name: 'Email' }] },
    { id: 'dbo.Pedido', columns: [{ name: 'Id' }, { name: 'ClienteId' }, { name: 'CriadoEm' }] },
    { id: 'dbo.Produto', columns: [{ name: 'Id' }, { name: 'Descricao' }] },
  ],
};

test('consulta vazia não filtra', () => {
  assert.equal(searchSchema(schema, ''), null);
  assert.equal(searchSchema(schema, '   '), null);
  assert.equal(searchSchema(null, 'id'), null);
});

test('acha pelo nome da coluna, sem diferenciar maiúsculas', () => {
  const r = searchSchema(schema, 'clienteid');
  assert.deepEqual(r.tables, ['dbo.Pedido']);
  assert.ok(r.columns.has(colKey('dbo.Pedido', 'ClienteId')));
  assert.equal(r.columns.size, 1);
});

test('acha pelo nome da tabela sem marcar colunas', () => {
  const r = searchSchema(schema, 'produto');
  assert.deepEqual(r.tables, ['dbo.Produto']);
  assert.equal(r.columns.size, 0);
});

test('tabela e coluna casando: mantém a ordem do schema e marca só as colunas', () => {
  const r = searchSchema(schema, 'cliente');
  assert.deepEqual(r.tables, ['dbo.Cliente', 'dbo.Pedido']);
  assert.ok(r.columns.has(colKey('dbo.Pedido', 'ClienteId')));
  assert.equal(r.columns.size, 1);
});

test('uma coluna comum aparece em várias tabelas', () => {
  const r = searchSchema(schema, 'id');
  assert.equal(r.tables.length, 3);
  assert.ok(r.columns.has(colKey('dbo.Cliente', 'Id')));
  assert.ok(r.columns.has(colKey('dbo.Pedido', 'ClienteId')));
});

test('stepIndex anda em círculo nos dois sentidos', () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
});
