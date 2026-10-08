// Teste: node --test scripts/test-git-logstats.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../src/git/parse.js');

const rec = (hash, ...lines) => '\x1e' + hash + '\n' + (lines.length ? '\n' + lines.join('\n') + '\n' : '');

test('soma arquivos e linhas por commit', () => {
  const out = rec('a'.repeat(40), '10\t2\tsrc/a.js', '0\t5\tsrc/b.js', '3\t0\tREADME.md');
  assert.deepEqual(P.parseLogStats(out), { ['a'.repeat(40)]: { files: 3, added: 13, deleted: 7 } });
});

test('binário conta como arquivo, sem linhas', () => {
  const out = rec('b'.repeat(40), '-\t-\timg/logo.png', '4\t1\tx.txt');
  assert.deepEqual(P.parseLogStats(out)['b'.repeat(40)], { files: 2, added: 4, deleted: 1 });
});

test('merge e commit vazio (sem linhas de numstat) ficam null', () => {
  const out = rec('c'.repeat(40)) + rec('d'.repeat(40), '1\t1\tf');
  const r = P.parseLogStats(out);
  assert.equal(r['c'.repeat(40)], null);
  assert.deepEqual(r['d'.repeat(40)], { files: 1, added: 1, deleted: 1 });
});

test('renomeado com -M é um arquivo só', () => {
  const out = rec('e'.repeat(40), '2\t2\tsrc/{old => new}/f.js');
  assert.deepEqual(P.parseLogStats(out)['e'.repeat(40)], { files: 1, added: 2, deleted: 2 });
});

test('saída vazia', () => {
  assert.deepEqual(P.parseLogStats(''), {});
  assert.deepEqual(P.parseLogStats(undefined), {});
});
