// Testes das sticky notes (regras + serviço com janelas falsas): node --test scripts/test-stickies.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const S = require('../src/stickies/sticky.js');
const { createStickiesService } = require('../electron/stickies/service.js');

const MAIN = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 1280, height: 984 };

test('normalizeState descarta inválidos, repetidos e o excesso', () => {
  const raw = {
    hidden: true,
    stickies: [
      { noteId: 'a', bounds: { x: 10, y: 20, width: 50, height: 400 }, color: 'string', onTop: true },
      { noteId: 'a', bounds: null },
      { noteId: '../etc', bounds: null },
      { noteId: 'b', color: 'rosa', collapsed: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ noteId: 'n' + i })),
    ],
  };
  const st = S.normalizeState(raw);
  assert.equal(st.hidden, true);
  assert.equal(st.stickies.length, S.MAX_STICKIES);
  assert.deepEqual(st.stickies[0], { noteId: 'a', bounds: { x: 10, y: 20, width: S.MIN_SIZE.width, height: 400 }, color: 'string', onTop: true, collapsed: false });
  assert.deepEqual(st.stickies[1], { noteId: 'b', bounds: null, color: 'accent', onTop: false, collapsed: false });
  assert.deepEqual(S.normalizeState('lixo'), { v: 1, hidden: false, stickies: [] });
});

test('fitBounds mantém a janela num monitor que existe', () => {
  const inside = { x: 100, y: 100, width: 300, height: 260 };
  assert.deepEqual(S.fitBounds(inside, [MAIN]), inside);
  // Saiu um pouco pela direita: encaixa na borda.
  assert.deepEqual(S.fitBounds({ x: 1800, y: 900, width: 300, height: 260 }, [MAIN]), { x: 1620, y: 780, width: 300, height: 260 });
  // Estava no 2º monitor, que foi desconectado: volta para o principal.
  assert.deepEqual(S.fitBounds({ x: 2500, y: 100, width: 300, height: 260 }, [MAIN]), { x: 1620, y: 100, width: 300, height: 260 });
  // Com os dois monitores, fica no 2º.
  assert.deepEqual(S.fitBounds({ x: 2500, y: 100, width: 300, height: 260 }, [MAIN, RIGHT]), { x: 2500, y: 100, width: 300, height: 260 });
  // Maior que o monitor: encolhe.
  assert.deepEqual(S.fitBounds({ x: 0, y: 0, width: 5000, height: 5000 }, [RIGHT]), { x: 1920, y: 0, width: 1280, height: 984 });
});

test('cascadeBounds: canto superior direito, em cascata', () => {
  const first = S.cascadeBounds([], MAIN);
  assert.deepEqual(first, { x: 1920 - 300 - 24, y: 24, ...S.DEFAULT_SIZE });
  const second = S.cascadeBounds([first], MAIN);
  assert.deepEqual(second, { x: first.x - 28, y: first.y + 28, ...S.DEFAULT_SIZE });
});

/* ─────────────── Serviço ─────────────── */

function fakeWindows() {
  const created = [];
  const createWindow = (noteId, opts) => {
    const handlers = {};
    const w = {
      noteId, opts, bounds: { ...opts.bounds }, onTop: opts.onTop, visible: false, destroyed: false, resizable: true,
      on: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
      emit: (evt) => (handlers[evt] || []).forEach((fn) => fn()),
      getBounds: () => ({ ...w.bounds }),
      setBounds: (b) => { w.bounds = { ...b }; },
      setAlwaysOnTop: (v) => { w.onTop = v; },
      setResizable: (v) => { w.resizable = v; },
      show: () => { w.visible = true; }, hide: () => { w.visible = false; }, focus: () => {},
      isVisible: () => w.visible,
      isDestroyed: () => w.destroyed,
      destroy: () => { if (!w.destroyed) { w.destroyed = true; w.emit('closed'); } },
    };
    created.push(w);
    return w;
  };
  return { created, createWindow };
}

function setup(dir, extra = {}) {
  const fw = fakeWindows();
  const events = [];
  const svc = createStickiesService({
    file: path.join(dir, 'stickies.json'),
    createWindow: fw.createWindow,
    workAreas: () => [MAIN],
    cursorWorkArea: () => MAIN,
    broadcast: (e) => events.push(e),
    saveDelay: 5,
    ...extra,
  });
  return { svc, fw, events };
}

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'devkit-stickies-'));
const readState = (dir) => JSON.parse(readFileSync(path.join(dir, 'stickies.json'), 'utf8'));

test('serviço: abrir, limite, fechar e persistir', async () => {
  const dir = tmp();
  try {
    const { svc, fw, events } = setup(dir);
    await svc.init();
    const a = await svc.open('nota-a');
    assert.equal(fw.created.length, 1);
    assert.equal(fw.created[0].visible, true);
    assert.deepEqual(a.bounds, S.cascadeBounds([], MAIN));
    assert.equal(events.at(-1).noteId, 'nota-a');
    // Abrir de novo só traz para frente.
    await svc.open('nota-a');
    assert.equal(fw.created.length, 1);
    for (let i = 1; i < S.MAX_STICKIES; i++) await svc.open('n' + i);
    await assert.rejects(svc.open('demais'), /Máximo de 6/);
    assert.equal(readState(dir).stickies.length, S.MAX_STICKIES);
    // Cores diferentes em sequência.
    assert.deepEqual(readState(dir).stickies.slice(0, 3).map((s) => s.color), ['accent', 'keyword', 'string']);

    assert.equal(await svc.close('nota-a'), true);
    assert.equal(fw.created[0].destroyed, true);
    assert.equal(readState(dir).stickies.some((s) => s.noteId === 'nota-a'), false);
    assert.equal(await svc.close('nota-a'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: mover/redimensionar grava; reabre no mesmo lugar ao reiniciar', async () => {
  const dir = tmp();
  try {
    let { svc, fw } = setup(dir);
    await svc.init();
    await svc.open('x', { color: 'bool' });
    const w = fw.created[0];
    w.setBounds({ x: 50, y: 60, width: 320, height: 300 });
    w.emit('moved');
    await svc.flush();
    assert.deepEqual(readState(dir).stickies[0].bounds, { x: 50, y: 60, width: 320, height: 300 });

    // O app sai: as janelas fecham, mas a sticky continua no estado.
    svc.setQuitting();
    w.destroy();
    await svc.flush();
    assert.equal(readState(dir).stickies.length, 1);

    ({ svc, fw } = setup(dir));
    await svc.init();
    svc.restore();
    assert.equal(fw.created.length, 1);
    assert.deepEqual(fw.created[0].opts.bounds, { x: 50, y: 60, width: 320, height: 300 });
    assert.equal(svc.get('x').color, 'bool');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: Alt+F4 (fechar a janela por fora) tira da tela', async () => {
  const dir = tmp();
  try {
    const { svc, fw } = setup(dir);
    await svc.init();
    await svc.open('y');
    fw.created[0].destroy();
    await svc.flush();
    assert.equal(svc.list().stickies.length, 0);
    assert.equal(readState(dir).stickies.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: cor, sempre por cima e recolher', async () => {
  const dir = tmp();
  try {
    const { svc, fw } = setup(dir);
    await svc.init();
    await svc.open('z');
    const w = fw.created[0];
    await svc.set('z', { color: 'number', onTop: true });
    assert.equal(w.onTop, true);
    assert.equal(svc.get('z').color, 'number');
    await svc.set('z', { color: 'inexistente' });
    assert.equal(svc.get('z').color, 'number');

    const open = w.getBounds();
    await svc.set('z', { collapsed: true });
    assert.equal(w.getBounds().height, S.COLLAPSED_HEIGHT);
    assert.equal(w.resizable, false);
    // Mover recolhida não perde a altura aberta.
    w.setBounds({ ...w.getBounds(), x: 10, y: 10 });
    w.emit('moved');
    await svc.set('z', { collapsed: false });
    assert.deepEqual(w.getBounds(), { ...open, x: 10, y: 10 });
    assert.equal(w.resizable, true);
    await assert.rejects(svc.set('nao-existe', { onTop: true }), /não está mais na tela/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: ocultar/mostrar todas e reiniciar oculto', async () => {
  const dir = tmp();
  try {
    let { svc, fw } = setup(dir);
    await svc.init();
    assert.equal((await svc.toggleAll()).hidden, false); // nada fixado: nada muda
    await svc.open('a');
    await svc.open('b');
    assert.equal((await svc.toggleAll()).hidden, true);
    assert.ok(fw.created.every((w) => !w.visible));
    assert.equal((await svc.toggleAll()).hidden, false);
    assert.ok(fw.created.every((w) => w.visible));
    await svc.toggleAll();

    // Reiniciou com elas ocultas: nenhuma janela até mostrar (ou fixar outra nota).
    ({ svc, fw } = setup(dir));
    await svc.init();
    svc.restore();
    assert.equal(fw.created.length, 0);
    await svc.open('c');
    assert.equal(svc.list().hidden, false);
    assert.deepEqual(fw.created.map((w) => w.noteId).sort(), ['a', 'b', 'c']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: nota excluída fecha a sticky; arquivo ilegível começa vazio', async () => {
  const dir = tmp();
  try {
    const { svc, fw } = setup(dir);
    await svc.init();
    await svc.open('apagada');
    svc.noteRemoved('apagada');
    await svc.flush();
    assert.equal(fw.created[0].destroyed, true);
    assert.equal(svc.list().stickies.length, 0);
    svc.noteRemoved('outra'); // sem sticky: nada acontece

    writeFileSync(path.join(dir, 'stickies.json'), '{ quebrado');
    const again = setup(dir).svc;
    assert.deepEqual(await again.init(), { hidden: false, stickies: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: monitor desconectado — sticky volta para um monitor existente', async () => {
  const dir = tmp();
  try {
    writeFileSync(path.join(dir, 'stickies.json'), JSON.stringify({ v: 1, stickies: [{ noteId: 'longe', bounds: { x: 2600, y: 100, width: 300, height: 260 } }] }));
    const { svc, fw } = setup(dir);
    await svc.init();
    svc.restore();
    assert.deepEqual(fw.created[0].opts.bounds, { x: 1620, y: 100, width: 300, height: 260 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
