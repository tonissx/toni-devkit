// Testes da command palette (busca, registro, providers): node --test scripts/test-palette.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { rank, scoreCommand, matchText, normalize, loadRecent, pushRecent } = require('../src/commands/search.js');
const { COMMANDS, CATEGORIES, WEB, categoryName } = require('../src/commands/registry.js');
const { draftMatches } = require('../src/commands/providers.js');
const { paletteKey, keyHint } = require('../src/commands/keys.js');

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const names = (q, opts) => rank(COMMANDS, q, { categoryName, ...opts }).map((r) => r.cmd.name);

test('normalize strips accents and case without changing length', () => {
  assert.equal(normalize('Configurações'), 'configuracoes');
  assert.equal(normalize('Configurações').length, 'Configurações'.length);
});

test('prefix beats word start beats contains beats fuzzy', () => {
  const p = matchText('Formatter', 'form', true).score;
  const w = matchText('SQL Formatter', 'form', true).score;
  const c = matchText('Reformatter', 'form', true).score;
  const f = matchText('Fast orm', 'form', true).score;
  assert.ok(p > w && w > c && c > f, [p, w, c, f].join(' > '));
});

test('scattered fuzzy matches are rejected', () => {
  assert.equal(matchText('Formatar SQL da área de transferência', 'ftx', true), null);
});

test('accent-insensitive search finds Configurações', () => {
  assert.equal(names('configuracoes')[0], 'Configurações');
});

test('keywords/aliases match (query → SQL Formatter, comparar → Diff Checker)', () => {
  assert.equal(names('query')[0], 'SQL Formatter');
  assert.equal(names('comparar')[0], 'Diff Checker');
});

test('description matches with lower weight than name', () => {
  const byName = scoreCommand({ name: 'Tema escuro', description: '' }, 'tema').score;
  const byDesc = scoreCommand({ name: 'Outro', description: 'Aplica o tema' }, 'tema').score;
  assert.ok(byName > byDesc);
});

test('multi-word queries need every term to match', () => {
  assert.equal(names('formatar xml')[0], 'Formatar XML da área de transferência');
  assert.deepEqual(names('xml zzz'), []);
});

test('highlight indices point at the matched name characters', () => {
  const r = rank(COMMANDS, 'diff', { categoryName })[0];
  assert.equal(r.cmd.name.slice(r.idx[0], r.idx[r.idx.length - 1] + 1), 'Diff');
});

test('empty query matches nothing; ties keep registry order', () => {
  assert.deepEqual(names(''), []);
  const same = ['a', 'b', 'c'].map((id) => ({ id, name: 'Abrir' }));
  assert.deepEqual(rank(same, 'abr').map((r) => r.cmd.id), ['a', 'b', 'c']);
  // Com o mesmo prefixo, o nome mais curto (casamento mais "justo") vem primeiro.
  assert.equal(names('tema')[0], 'Tema Claro');
  assert.equal(names('tema claro')[0], 'Tema Claro');
});

test('recent commands get a boost', () => {
  const plain = names('tema')[0];
  const boosted = names('tema', { recent: ['theme:dracula'] })[0];
  assert.notEqual(plain, 'Tema Dracula');
  assert.equal(boosted, 'Tema Dracula');
});

test('recent list keeps the last 8 unique ids, newest first', () => {
  const s = memStorage();
  for (let i = 0; i < 10; i++) pushRecent(s, 'c' + i);
  pushRecent(s, 'c5');
  const r = loadRecent(s);
  assert.equal(r.length, 8);
  assert.equal(r[0], 'c5');
  assert.equal(new Set(r).size, 8);
});

test('registry: unique ids, valid categories, required fields', () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const cats = [...CATEGORIES.map((c) => c.id), 'web', 'devcore'];
  for (const c of COMMANDS) {
    assert.ok(cats.includes(c.category), c.id);
    assert.ok(c.name && c.icon && typeof c.run === 'function', c.id);
  }
  assert.deepEqual(CATEGORIES.map((c) => c.key), ['t', 'a', 'n']);
  const noteKeys = COMMANDS.filter((c) => c.category === 'notes' && c.key).map((c) => c.key);
  assert.deepEqual(noteKeys, ['q', 'n', 'p', 'r']);
});

test('web search commands encode the query, or open the home page', () => {
  const g = COMMANDS.find((c) => c.id === 'web:google');
  assert.equal(g.url('a & b/ç'), 'https://www.google.com/search?q=a%20%26%20b%2F%C3%A7');
  assert.equal(g.url('  '), WEB[0].home);
  for (const c of COMMANDS.filter((x) => x.takesQuery)) assert.match(c.url('x'), /^https:\/\//);
});

test('clipboard XML action formats and reports errors', async () => {
  let written = null;
  const ctx = (clip) => ({ storage: memStorage(), clipboard: { read: async () => clip, write: async (t) => { written = t; } } });
  const cmd = COMMANDS.find((c) => c.id === 'clipboard:xml');
  assert.equal(await cmd.run(ctx('<a><b/></a>')), 'XML formatado e copiado');
  assert.equal(written, '<a>\n    <b />\n</a>\n');
  await assert.rejects(cmd.run(ctx('   ')), /vazia/);
  await assert.rejects(cmd.run(ctx('<a>')), /./);
});

test('draftMatches finds lines in saved drafts, capped at 5', () => {
  const s = memStorage({
    'tk.sql.draft': JSON.stringify({ text: 'select *\nfrom pfunc f\nwhere f.chapa = 1', file: 'q.sql' }),
    'tk.diff.draft': JSON.stringify({ left: 'pfunc a\npfunc b\npfunc c', right: 'pfunc d\npfunc e' }),
    'tk.xml.draft': 'não é json',
  });
  const r = draftMatches('PFUNC', s);
  assert.equal(r.length, 3); // 1 do SQL + 2 do diff (máx. 2 por fonte)
  assert.equal(r[0].name, 'from pfunc f');
  assert.equal(r[0].description, 'SQL Formatter · rascunho (q.sql), linha 2');
  assert.match(r[1].description, /Diff Checker · Original, linha 1/);
  assert.deepEqual(draftMatches('p', s), []);
  const many = memStorage({ 'tk.sql.draft': JSON.stringify({ text: 'ab\n'.repeat(50) }) });
  assert.ok(draftMatches('ab', many).length <= 5);
});

test('paletteKey: letters are text; Alt+letter navigates; Ctrl stays with the input', () => {
  const k = (code, mods = {}, scope = null) => paletteKey({ code, altKey: true, ...mods }, scope);
  assert.equal(paletteKey({ code: 'KeyS', key: 's' }, null), null); // "sql" é texto
  assert.equal(paletteKey({ code: 'KeyT', key: 't' }, null), null);
  assert.deepEqual(k('KeyT'), { type: 'scope', scope: 'tools' });
  assert.deepEqual(k('KeyA', {}, 'tools'), { type: 'scope', scope: 'actions' });
  assert.deepEqual(k('KeyN'), { type: 'scope', scope: 'notes' });
  assert.deepEqual(k('KeyQ'), { type: 'command', id: 'notes:quick' });
  assert.deepEqual(k('KeyQ', {}, 'actions'), { type: 'command', id: 'notes:quick' });
  assert.deepEqual(k('KeyN', {}, 'notes'), { type: 'command', id: 'notes:new' });
  assert.deepEqual(k('KeyP', {}, 'notes'), { type: 'command', id: 'notes:pinned' });
  assert.deepEqual(k('KeyR', {}, 'notes:pinned'), { type: 'command', id: 'notes:recent' });
  assert.equal(k('KeyP'), null); // Pinned só dentro de Notes
  assert.equal(k('KeyS'), null); // não existe mais Search como categoria
  assert.equal(paletteKey({ code: 'KeyA', ctrlKey: true }, null), null); // Ctrl+A = selecionar tudo
  assert.equal(k('KeyT', { ctrlKey: true }), null); // Ctrl+Alt (AltGr) não é atalho
  assert.equal(k('KeyT', { shiftKey: true }), null);
  assert.equal(k('Digit1'), null);
  assert.equal(keyHint('t'), 'Alt+T');
});
