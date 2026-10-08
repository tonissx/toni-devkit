// Teste: node --test scripts/test-sql-comments.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { convertLineComments } = require('../electron/sql/lineComments.js');
const { unwrapJsConcat } = require('../electron/sql/jsConcat.js');

test('troca // por -- no fim da linha e em linha própria', () => {
  assert.equal(convertLineComments('SELECT 1 // um\n// tudo\nFROM T'), 'SELECT 1 -- um\n-- tudo\nFROM T');
});

test('não mexe em // dentro de literais, colchetes, blocos ou comentários --', () => {
  const src = "SELECT 'http://x', \"a//b\", [c//d] /* e//f */ -- g//h\nFROM T";
  assert.equal(convertLineComments(src), src);
});

test('aspas não fechadas não quebram', () => {
  assert.equal(convertLineComments("SELECT 'abc // x"), "SELECT 'abc // x");
});

test('concatenação JS: comentário entre os pedaços vira -- em linha própria', () => {
  const r = unwrapJsConcat('var sql = "SELECT A " + // colunas\n"FROM T WHERE X = \'" + ID + "\'";');
  assert.equal(r.sql, "DECLARE @ID VARCHAR(100) = ID;\nSELECT A\n-- colunas\nFROM T WHERE X = @ID");
});

test('concatenação JS: sem comentário o resultado não muda', () => {
  const r = unwrapJsConcat('"A = \'" + V + "\' AND B"');
  assert.equal(r.sql, 'DECLARE @V VARCHAR(100) = V;\nA = @V AND B');
});
