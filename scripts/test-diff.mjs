// Testes do motor do Diff Checker: node --test scripts/test-diff.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { diffLines, diffInline, applyHunk, pairRows } = require('../src/tools/diff-checker/engine.js');

const kinds = (r) => r.ops.map((o) => o.t[0]).join('');
const changed = (line, segs) => segs.filter((s) => s[2]).map((s) => line.slice(s[0], s[1]));

test('identical texts have no changes and 100% similarity', () => {
  const r = diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(r.hunks.length, 0);
  assert.equal(r.stats.similarity, 100);
});

test('empty vs text is one modified line', () => {
  const r = diffLines('', 'x');
  assert.equal(kinds(r), 'da');
  assert.deepEqual(pairRows(r).map((x) => x.t), ['mod']);
});

test('insertion, deletion and change in the middle', () => {
  assert.equal(kinds(diffLines('a\nc', 'a\nb\nc')), 'eae');
  assert.equal(kinds(diffLines('a\nb\nc', 'a\nc')), 'ede');
  assert.equal(kinds(diffLines('a\nb\nc', 'a\nX\nc')), 'edae');
});

test('multiple hunks get the right boundaries', () => {
  const r = diffLines('1\n2\n3\n4\n5\n6', '1\nX\n3\n4\n6\n7');
  assert.deepEqual(r.hunks.map((h) => [h.aStart, h.aEnd, h.bStart, h.bEnd]), [[1, 2, 1, 2], [4, 5, 4, 4], [6, 6, 5, 6]]);
  assert.deepEqual([r.stats.added, r.stats.removed], [2, 2]);
});

test('finds a minimal diff on shuffled content', () => {
  const r = diffLines('a\nb\nc\na\nb\nb\na', 'c\nb\na\nb\na\nc');
  assert.equal(r.stats.added + r.stats.removed, 5); // clássico exemplo do artigo do Myers: D = 5
});

test('ignoreWhitespace / ignoreCase make lines equal but keep original text', () => {
  const r = diffLines('  Foo  bar', 'foo bar', { ignoreWhitespace: true, ignoreCase: true });
  assert.equal(r.hunks.length, 0);
  assert.equal(r.a[0], '  Foo  bar');
  assert.equal(r.b[0], 'foo bar');
  assert.equal(diffLines('Foo', 'foo').hunks.length, 1);
});

test('CRLF and LF are the same line breaks', () => {
  assert.equal(diffLines('a\r\nb', 'a\nb').hunks.length, 0);
});

test('diffInline char mode highlights exact characters', () => {
  const [a, b] = diffInline('id=10', 'id=12', 'char');
  assert.deepEqual(changed('id=10', a), ['0']);
  assert.deepEqual(changed('id=12', b), ['2']);
});

test('diffInline word mode highlights whole words and absorbs gaps', () => {
  const [a, b] = diffInline('the quick brown fox', 'the slow red fox', 'word');
  assert.deepEqual(changed('the quick brown fox', a), ['quick brown']);
  assert.deepEqual(changed('the slow red fox', b), ['slow red']);
});

test('diffInline smart picks char for small edits, word for bigger ones', () => {
  const [a] = diffInline('id=10', 'id=12', 'smart');
  assert.deepEqual(changed('id=10', a), ['0']);
  const [w] = diffInline('SELECT nome FROM clientes WHERE ativo = 1', 'SELECT email FROM usuarios WHERE ativo = 1', 'smart');
  assert.deepEqual(changed('SELECT nome FROM clientes WHERE ativo = 1', w), ['nome', 'clientes']);
});

test('diffInline smart returns null when lines are too different', () => {
  assert.equal(diffInline('completely different', 'nothing alike here', 'smart'), null);
});

test('segments cover the whole line', () => {
  const line = 'const x = 1;', line2 = 'let x = 2; // ok';
  const [a, b] = diffInline(line, line2, 'word');
  assert.equal(a.map((s) => line.slice(s[0], s[1])).join(''), line);
  assert.equal(b.map((s) => line2.slice(s[0], s[1])).join(''), line2);
});

test('applyHunk in both directions converges to an empty diff', () => {
  const L = 'a\nb\nc\nd\ne', R = 'a\nB\nc\ne\nf';
  for (const dir of ['toRight', 'toLeft']) {
    let s = { left: L, right: R };
    for (;;) {
      const r = diffLines(s.left, s.right);
      if (!r.hunks.length) break;
      s = applyHunk(s.left, s.right, r.hunks[0], dir);
    }
    assert.equal(s.left, s.right);
    assert.equal(s.left, dir === 'toRight' ? L : R);
  }
});

test('applyHunk keeps CRLF line endings of the target', () => {
  const r = diffLines('a\nX\nc', 'a\r\nb\r\nc');
  const s = applyHunk('a\nX\nc', 'a\r\nb\r\nc', r.hunks[0], 'toRight');
  assert.equal(s.right, 'a\r\nX\r\nc');
});

test('5,000 lines with ~1% changes diff quickly', () => {
  const a = Array.from({ length: 5000 }, (_, i) => 'linha ' + i + ' ' + ((i * 7919) % 1000));
  const b = a.map((l, i) => (i % 97 === 0 ? l + ' alterada' : l));
  const t0 = performance.now();
  const r = diffLines(a.join('\n'), b.join('\n'));
  const ms = performance.now() - t0;
  assert.equal(r.stats.added, 52);
  assert.ok(ms < 200, 'levou ' + ms.toFixed(0) + ' ms');
});

test('completely different 3,000-line files still finish', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join('\n');
  const r = diffLines(a, b);
  assert.deepEqual([r.stats.added, r.stats.removed], [3000, 3000]);
});
