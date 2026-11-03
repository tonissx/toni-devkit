import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createToolWindows } = require('../electron/toolwindows.js');

function fakeWin() {
  const w = {
    handlers: {}, shown: 0, focused: 0, restored: 0, closed: false, minimized: false, destroyed: false,
    on(evt, fn) { w.handlers[evt] = fn; },
    isDestroyed: () => w.destroyed,
    isMinimized: () => w.minimized,
    restore() { w.restored++; w.minimized = false; },
    show() { w.shown++; },
    focus() { w.focused++; },
    close() { w.closed = true; w.destroyed = true; w.handlers.closed && w.handlers.closed(); },
  };
  return w;
}

function setup({ detachable = (id) => id !== 'home' && id !== 'settings' } = {}) {
  const created = [];
  const broadcasts = [];
  const reg = createToolWindows({
    createWindow: (id) => { const w = fakeWin(); w.tool = id; created.push(w); return w; },
    broadcast: (ids) => broadcasts.push(ids),
    isDetachable: detachable,
  });
  return { reg, created, broadcasts };
}

test('detach cria a janela e avisa as demais', () => {
  const { reg, created, broadcasts } = setup();
  assert.equal(reg.detach('logs'), true);
  assert.equal(created.length, 1);
  assert.deepEqual(reg.list(), ['logs']);
  assert.deepEqual(broadcasts.at(-1), ['logs']);
});

test('detach de ferramenta já destacada foca a existente em vez de abrir outra', () => {
  const { reg, created } = setup();
  reg.detach('logs');
  created[0].minimized = true;
  assert.equal(reg.detach('logs'), true);
  assert.equal(created.length, 1);
  assert.equal(created[0].restored, 1);
  assert.equal(created[0].focused, 1);
});

test('não destaca Início, Configurações nem ids inválidos', () => {
  const { reg, created } = setup();
  assert.equal(reg.detach('home'), false);
  assert.equal(reg.detach('settings'), false);
  assert.equal(reg.detach(undefined), false);
  assert.equal(created.length, 0);
});

test('fechar a janela pelo X esquece o registro e avisa', () => {
  const { reg, created, broadcasts } = setup();
  reg.detach('db');
  created[0].handlers.closed();
  assert.deepEqual(reg.list(), []);
  assert.deepEqual(broadcasts.at(-1), []);
});

test('attach fecha a janela, avisa uma vez e devolve false se não havia', () => {
  const { reg, created, broadcasts } = setup();
  assert.equal(reg.attach('logs'), false);
  reg.detach('logs');
  const before = broadcasts.length;
  assert.equal(reg.attach('logs'), true);
  assert.equal(created[0].closed, true);
  assert.deepEqual(reg.list(), []);
  assert.equal(broadcasts.length, before + 1); // o evento "closed" não duplica o aviso
});

test('focusIfDetached só age quando a ferramenta está destacada', () => {
  const { reg, created } = setup();
  assert.equal(reg.focusIfDetached('notes'), false);
  reg.detach('notes');
  assert.equal(reg.focusIfDetached('notes'), true);
  assert.equal(created[0].focused, 1);
  created[0].destroyed = true;
  assert.equal(reg.focusIfDetached('notes'), false);
});

test('detach depois de a janela ter sido destruída cria outra', () => {
  const { reg, created } = setup();
  reg.detach('logs');
  created[0].destroyed = true; // sumiu sem passar pelo evento
  assert.equal(reg.detach('logs'), true);
  assert.equal(created.length, 2);
});

test('closeAll fecha todas', () => {
  const { reg, created } = setup();
  reg.detach('logs');
  reg.detach('db');
  reg.closeAll();
  assert.ok(created.every((w) => w.closed));
  assert.deepEqual(reg.list(), []);
});
