// Testes dos Smart Binds (atalhos globais → comandos da palette): node --test scripts/test-binds.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BINDABLE_IDS, UI_BINDABLE_IDS, SELECTION_BIND_IDS, DEFAULT_BINDS, acceleratorFromEvent, acceleratorLabel, normalizeBinds } = require('../src/commands/binds.js');
const { COMMANDS, detectClipboardKind } = require('../src/commands/registry.js');

const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('keydown becomes an Electron accelerator, by physical key', () => {
  assert.equal(acceleratorFromEvent(key('KeyS', { ctrlKey: true, altKey: true, shiftKey: true })), 'Control+Alt+Shift+S');
  assert.equal(acceleratorFromEvent(key('Digit1', { altKey: true })), 'Alt+1');
  assert.equal(acceleratorFromEvent(key('F9', { ctrlKey: true })), 'Control+F9');
  assert.equal(acceleratorFromEvent(key('ArrowUp', { ctrlKey: true, shiftKey: true })), 'Control+Shift+Up');
  assert.equal(acceleratorFromEvent(key('Numpad5', { ctrlKey: true })), 'Control+num5');
});

test('keys that cannot be a global shortcut are rejected', () => {
  assert.equal(acceleratorFromEvent(key('KeyS')), null, 'sem modificador');
  assert.equal(acceleratorFromEvent(key('KeyS', { shiftKey: true })), null, 'só Shift');
  assert.equal(acceleratorFromEvent(key('ControlLeft', { ctrlKey: true })), null, 'só modificador');
  assert.equal(acceleratorFromEvent(key('AltRight', { ctrlKey: true, altKey: true })), null, 'AltGr sozinho');
  assert.equal(acceleratorFromEvent(key('IntlRo', { ctrlKey: true })), null, 'tecla sem nome no Electron');
  assert.equal(acceleratorFromEvent(null), null);
});

test('labels use Ctrl/Win', () => {
  assert.equal(acceleratorLabel('Control+Alt+Shift+S'), 'Ctrl+Alt+Shift+S');
  assert.equal(acceleratorLabel('Super+Alt+X'), 'Win+Alt+X');
  assert.equal(acceleratorLabel(null), '');
});

test('normalizeBinds drops unknown ids, non-strings, the palette shortcut and duplicates', () => {
  assert.deepEqual(normalizeBinds({
    'clipboard:sql': ' Control+Alt+S ',
    'clipboard:xml': 'control+alt+s', // mesmo atalho do SQL
    'theme:toggle': 'Control+Alt+Space', // reservado
    'app:quit': 'Control+Alt+Q', // não bindável
  }), { 'clipboard:sql': 'Control+Alt+S' });
  assert.deepEqual(normalizeBinds({ 'clipboard:sql': 42 }), {});
  assert.deepEqual(normalizeBinds(null), {});
  assert.deepEqual(normalizeBinds('x'), {});
});

test('defaults are valid and survive normalization', () => {
  assert.deepEqual(normalizeBinds(DEFAULT_BINDS), DEFAULT_BINDS);
  assert.deepEqual(DEFAULT_BINDS, { 'clipboard:auto': 'Control+Alt+Shift+F', 'snippets:paste': 'Control+Alt+Shift+P' });
});

test('clipboard kind: leading < means XML, anything else is SQL', () => {
  assert.equal(detectClipboardKind('<a/>'), 'xml');
  assert.equal(detectClipboardKind('﻿  \n <?xml version="1.0"?><a/>'), 'xml');
  assert.equal(detectClipboardKind('<!-- c --><a/>'), 'xml');
  assert.equal(detectClipboardKind('select 1'), 'sql');
  assert.equal(detectClipboardKind("select '<a>' from t"), 'sql');
  assert.equal(detectClipboardKind('-- <nota>\nselect 1'), 'sql');
  assert.equal(detectClipboardKind(''), 'sql');
});

test('clipboard:auto picks the formatter from the content', async () => {
  const cmd = COMMANDS.find((c) => c.id === 'clipboard:auto');
  let clip = '';
  const sqlCalls = [];
  const ctx = {
    clipboard: { read: async () => clip, write: async (t) => { clip = t; } },
    sql: { format: async (text, opts) => { sqlCalls.push({ text, opts }); return { result: 'SELECT 1' }; } },
    storage: { getItem: (k) => (k === 'tk.sql.options' ? JSON.stringify({ keyword_case: 'upper' }) : null) },
  };
  clip = '  <a><b>1</b></a>';
  assert.equal(await cmd.run(ctx), 'XML formatado e copiado');
  assert.match(clip, /\n\s+<b>1<\/b>/);
  assert.equal(sqlCalls.length, 0);

  clip = 'select 1';
  assert.equal(await cmd.run(ctx), 'SQL formatado e copiado');
  assert.equal(clip, 'SELECT 1');
  assert.equal(sqlCalls[0].opts.keyword_case, 'upper', 'usa as opções salvas do SQL Formatter');

  clip = ' \n ';
  await assert.rejects(() => cmd.run(ctx), /vazia/);
});

test('bindable commands exist and run without the palette UI', () => {
  for (const id of BINDABLE_IDS) {
    const cmd = COMMANDS.find((c) => c.id === id);
    assert.ok(cmd, id + ' não está no registry');
    if (UI_BINDABLE_IDS.includes(id)) continue; // o processo principal mostra a palette para esses
    assert.ok(!cmd.keepOpen && !cmd.takesQuery, id + ' depende da UI da palette');
  }
});

test('clipboard:xml run headless formats the clipboard and reports a message', async () => {
  const cmd = COMMANDS.find((c) => c.id === 'clipboard:xml');
  let clip = '<a><b>1</b></a>';
  const ctx = {
    clipboard: { read: async () => clip, write: async (t) => { clip = t; } },
    storage: { getItem: () => null },
  };
  const msg = await cmd.run(ctx);
  assert.equal(typeof msg, 'string');
  assert.match(clip, /\n\s+<b>1<\/b>/);
  clip = '   ';
  await assert.rejects(() => cmd.run(ctx), /vazia/);
});

test('selection binds are bindable commands', () => {
  for (const id of SELECTION_BIND_IDS) assert.ok(BINDABLE_IDS.includes(id), id);
});

test('copySelection returns the selected text, or restores the clipboard when nothing is selected', async () => {
  const { createSelectionCopier } = require('../electron/selection.js');
  const mk = (onCopy) => {
    const c = { text: 'antes' };
    const clipboard = { readText: () => c.text, writeText: (t) => { c.text = t; } };
    return { c, copy: createSelectionCopier({ clipboard, win: { copy: async () => onCopy(c) }, sleep: async () => {} }) };
  };
  const ok = mk((c) => { c.text = 'select 1'; });
  assert.equal(await ok.copy(), 'select 1');
  assert.equal(ok.c.text, 'select 1');

  const none = mk(() => {});
  await assert.rejects(() => none.copy(), /Nenhum texto selecionado/);
  assert.equal(none.c.text, 'antes');

  const blocked = mk(() => { const e = new Error('x'); e.code = 'BLOCKED'; throw e; });
  await assert.rejects(() => blocked.copy(), /bloqueou/);
  assert.equal(blocked.c.text, 'antes');

  // Electron recente: readText() devolve Promise.
  const c = { text: 'antes' };
  const asyncClip = { readText: async () => c.text, writeText: (t) => { c.text = t; } };
  const viaPromise = createSelectionCopier({ clipboard: asyncClip, win: { copy: async () => { c.text = '"SELECT 1"'; } }, sleep: async () => {} });
  assert.equal(await viaPromise(), '"SELECT 1"');
});
