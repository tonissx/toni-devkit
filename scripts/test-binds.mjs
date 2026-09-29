// Testes dos Smart Binds (atalhos globais → comandos da palette): node --test scripts/test-binds.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BINDABLE_IDS, DEFAULT_BINDS, acceleratorFromEvent, acceleratorLabel, normalizeBinds } = require('../src/commands/binds.js');
const { COMMANDS } = require('../src/commands/registry.js');

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
});

test('bindable commands exist and run without the palette UI', () => {
  for (const id of BINDABLE_IDS) {
    const cmd = COMMANDS.find((c) => c.id === id);
    assert.ok(cmd, id + ' não está no registry');
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
