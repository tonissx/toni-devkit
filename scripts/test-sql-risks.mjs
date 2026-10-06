// Testes dos riscos de SQL (puro): node --test scripts/test-sql-risks.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sqlRisks } = require('../src/sql/risks.js');

const has = (sql, re) => sqlRisks(sql).some((r) => re.test(r.text));
const levels = (sql) => sqlRisks(sql).map((r) => r.level);

test('UPDATE/DELETE sem WHERE', () => {
  assert.ok(has('UPDATE clientes SET ativo = 0', /UPDATE sem WHERE/));
  assert.ok(has('delete from t', /DELETE sem WHERE/));
  assert.ok(!has('UPDATE c SET a = 1 WHERE id = 2', /sem WHERE/));
  // WHERE só dentro de subconsulta não conta
  assert.ok(has('DELETE FROM t WHERE_x = 1; UPDATE c SET a = (SELECT b FROM d WHERE d.id = 1)', /UPDATE sem WHERE/));
  // palavra em comentário ou string não conta
  assert.ok(has("UPDATE c SET nota = 'where' -- where", /UPDATE sem WHERE/));
  assert.deepEqual(levels('UPDATE c SET a = 1'), ['danger']);
});

test('SELECT *, JOIN sem ON, FROM com vírgula', () => {
  assert.ok(has('select * from t', /SELECT \*/));
  assert.ok(has('SELECT TOP 10 * FROM t', /SELECT \*/));
  assert.ok(!has('SELECT a.* , b FROM t a', /SELECT \*/));
  assert.ok(has('SELECT a FROM t JOIN u WHERE t.id = 1', /JOIN sem ON/));
  assert.ok(!has('SELECT a FROM t LEFT JOIN u ON u.id = t.id JOIN v USING (id)', /JOIN sem ON/));
  assert.ok(!has('SELECT a FROM t CROSS JOIN u', /JOIN sem ON/));
  assert.ok(has('SELECT a FROM t, u', /produto cartesiano/));
  assert.ok(!has('SELECT a FROM t, u WHERE t.id = u.id', /vírgula/));
});

test('NOT IN, função na coluna, LIKE com % no começo, AND/OR', () => {
  assert.ok(has('SELECT a FROM t WHERE id NOT IN (SELECT x FROM u)', /NOT EXISTS/));
  assert.ok(has('SELECT a FROM t WHERE UPPER(nome) = \'ANA\'', /índice/));
  assert.ok(has("SELECT a FROM t WHERE nome LIKE '%ana'", /LIKE '%/));
  assert.ok(!has("SELECT a FROM t WHERE nome LIKE 'ana%'", /LIKE '%/));
  assert.ok(has('SELECT a FROM t WHERE x = 1 OR y = 2 AND z = 3', /precedência/));
  assert.deepEqual(sqlRisks('SELECT a, b FROM t WHERE id = 1'), []);
});

test('TRUNCATE e DROP', () => {
  assert.ok(has('TRUNCATE TABLE t', /TRUNCATE/));
  assert.ok(has('drop table t', /DROP/));
});
