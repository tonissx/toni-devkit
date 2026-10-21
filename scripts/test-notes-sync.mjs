// Notes em pasta sincronizada (Dropbox/OneDrive/Syncthing): reload, conflitos, estado e vigia — node --test scripts/test-notes-sync.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, utimesSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createNotesService } = require('../electron/notes/service.js');
const { createStore } = require('../electron/notes/store.js');
const { createWatcher, relevant } = require('../electron/notes/watch.js');
const { createNotesSettings } = require('../electron/notes/settings.js');
const { serialize } = require('../src/notes/format.js');
const { createNote } = require('../src/notes/note.js');

const tmp = () => mkdtempSync(path.join(tmpdir(), 'devkit-sync-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serviço com o log de tudo que foi anunciado ao renderer. */
async function open(dir, opts = {}) {
  const events = [];
  const svc = createNotesService({ dir, broadcast: (e) => events.push(e), ...opts });
  await svc.init();
  return { svc, events };
}
/** Escreve um .md "de fora", como o cliente de sync do outro PC faria. */
const drop = (dir, rel, note) => { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, serialize(note)); };
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('reload: picks up notes created, edited and deleted by another PC', async () => {
  const dir = tmp();
  try {
    const { svc, events } = await open(dir);
    const a = await svc.save({ id: 'a', title: 'A', content: 'um' });
    await svc.save({ id: 'b', title: 'B', content: 'dois' });
    events.length = 0;

    drop(dir, 'a.md', createNote({ ...a, content: 'um (editado no outro PC)', updated: new Date(Date.now() + 5000).toISOString() }));
    rmSync(path.join(dir, 'b.md'));
    drop(dir, 'Trabalho/c.md', createNote({ id: 'c', title: 'C', content: 'novo' }));
    const r = await svc.reload();

    assert.deepEqual({ added: r.added, updated: r.updated, removed: r.removed, folders: r.folders }, { added: 1, updated: 1, removed: 1, folders: true });
    assert.equal(svc.get('a').content, 'um (editado no outro PC)');
    assert.equal(svc.get('b'), null);
    assert.equal(svc.get('c').folder, 'Trabalho');
    assert.ok(svc.folders().some((f) => f.path === 'Trabalho'));
    const types = events.map((e) => e.type + ':' + (e.id || ''));
    assert.ok(types.includes('saved:a') && types.includes('saved:c') && types.includes('removed:b') && types.includes('folders:'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reload right after the app\'s own writes announces nothing (no echo)', async () => {
  const dir = tmp();
  try {
    const { svc, events } = await open(dir);
    await svc.save({ id: 'a', title: 'A', content: 'x' });
    await svc.createFolder('Pasta');
    events.length = 0;
    const r = await svc.reload();
    assert.deepEqual(r, { added: 0, updated: 0, removed: 0, folders: false });
    assert.deepEqual(events, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reload: the local version overwritten by a remote edit goes to the history', async () => {
  const dir = tmp();
  try {
    const { svc } = await open(dir);
    const a = await svc.save({ id: 'a', title: 'A', content: 'minha versão' });
    drop(dir, 'a.md', createNote({ ...a, content: 'versão do outro PC', updated: new Date(Date.now() + 5000).toISOString() }));
    await svc.reload();
    const hist = await svc.history('a');
    assert.equal(hist.length, 1);
    assert.equal((await svc.version('a', hist[0].stamp)).content, 'minha versão');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reload: a note moved to another folder by the other PC is followed, not duplicated', async () => {
  const dir = tmp();
  try {
    const { svc } = await open(dir);
    await svc.createFolder('Z');
    const a = await svc.save({ id: 'a', title: 'A', content: 'x' });
    mkdirSync(path.join(dir, 'Z'), { recursive: true });
    renameSync(path.join(dir, a.file || 'a.md'), path.join(dir, 'Z', 'a.md'));
    const r = await svc.reload();
    assert.equal(r.updated, 1);
    assert.equal(svc.get('a').folder, 'Z');
    assert.equal(svc.list().length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('conflict copies (same id) keep the newest as the note and survive as "(conflito)" notes', async () => {
  const dir = tmp();
  try {
    const { svc } = await open(dir);
    const a = await svc.save({ id: 'a', title: 'Reunião', content: 'versão do PC 1' });
    drop(dir, 'a (conflicted copy).md', createNote({ ...a, content: 'versão do PC 2', updated: new Date(Date.now() - 60_000).toISOString() }));
    const r = await svc.reload();
    assert.equal(r.added, 1);
    assert.equal(svc.get('a').content, 'versão do PC 1'); // a mais recente continua sendo a nota
    const copy = svc.list().find((n) => n.id !== 'a');
    assert.equal(copy.title, 'Reunião (conflito)');
    assert.equal(svc.get(copy.id).content, 'versão do PC 2'); // nada foi descartado
    // o arquivo da cópia foi regravado com o id novo: a próxima leitura não vê mais duplicata
    const again = await svc.reload();
    assert.deepEqual(again, { added: 0, updated: 0, removed: 0, folders: false });
    assert.equal(svc.list().length, 2);
    assert.ok(svc.info().errors.length === 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('init resolves duplicate ids the same way (copy becomes a conflict note)', async () => {
  const dir = tmp();
  try {
    const n = createNote({ id: 'x', title: 'Nota', content: 'novo', updated: ago(0) });
    drop(dir, 'x.md', n);
    drop(dir, 'x - copia.md', createNote({ ...n, content: 'velho', updated: ago(120_000) }));
    const { svc } = await open(dir);
    assert.equal(svc.get('x').content, 'novo');
    assert.deepEqual(svc.list().map((s) => s.title).sort(), ['Nota', 'Nota (conflito)']);
    assert.equal(svc.info().errors.length, 1); // avisa que houve conflito
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('orphan grace: 10 min by default, 24 h in synced-folder mode (configurable live)', async () => {
  const dir = tmp();
  try {
    const { svc } = await open(dir);
    mkdirSync(path.join(dir, '.assets'));
    const f = path.join(dir, '.assets', 'a.pdf');
    writeFileSync(f, 'x');
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(f, old, old); // 2 h: órfão no modo normal
    assert.equal((await svc.orphanAssets()).count, 1);
    svc.configure({ syncFolder: true });
    assert.equal((await svc.orphanAssets()).count, 0); // pode estar esperando a nota chegar
    svc.configure({ syncFolder: false });
    assert.equal((await svc.orphanAssets()).count, 1);
    const synced = (await open(dir, { syncFolder: true })).svc; // já nasce no modo sincronizado
    assert.equal((await synced.orphanAssets()).count, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('state outside the notes folder: stateFile is used, legacy .devkit/state.json still read once', async () => {
  const dir = tmp(), ext = tmp();
  try {
    mkdirSync(path.join(dir, '.devkit'));
    writeFileSync(path.join(dir, '.devkit', 'state.json'), JSON.stringify({ viewed: [{ id: 'old' }] }));
    const stateFile = path.join(ext, 'notes-state.json');
    const st = createStore(dir, { stateFile });
    assert.deepEqual(await st.readState(), { viewed: [{ id: 'old' }] }); // migração
    await st.writeState({ viewed: [{ id: 'new' }] });
    await st.flush();
    assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), { viewed: [{ id: 'new' }] });
    assert.deepEqual(await st.readState(), { viewed: [{ id: 'new' }] }); // o novo vence
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, '.devkit', 'state.json'), 'utf8')), { viewed: [{ id: 'old' }] }); // nada novo na pasta das notas
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ext, { recursive: true, force: true }); }
});

test('settings: syncFolder is a validated boolean that persists and resets to false', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 's.json');
    const s = createNotesSettings(file);
    assert.equal(s.get().syncFolder, false);
    assert.equal(s.set({ syncFolder: true }).syncFolder, true);
    assert.equal(createNotesSettings(file).get().syncFolder, true);
    writeFileSync(file, JSON.stringify({ syncFolder: 'sim' }));
    assert.equal(createNotesSettings(file).get().syncFolder, false); // lixo no arquivo volta ao padrão
    assert.equal(s.set({ syncFolder: null }).syncFolder, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('watcher: which paths matter', () => {
  assert.equal(relevant('a.md'), true);
  assert.equal(relevant('Trabalho/Fluig/a.md'), true);
  assert.equal(relevant('Trabalho'), true); // pasta nova/renomeada
  assert.equal(relevant('Trabalho/.folder.json'), true);
  assert.equal(relevant('a.md.1234.tmp'), false); // escrita atômica em andamento
  assert.equal(relevant('.devkit/history/x/1.md'), false);
  assert.equal(relevant('.trash/a.md'), false);
  assert.equal(relevant('.assets/img.png'), false);
  assert.equal(relevant('~$a.md'), false);
  assert.equal(relevant('desktop.ini'), false);
  assert.equal(relevant('foto.png'), false);
});

test('watcher: debounces a burst of events into one onChange and ignores irrelevant ones', async () => {
  let handler; let closed = false;
  const fake = (_dir, _opts, cb) => { handler = cb; return { on() {}, close() { closed = true; } }; };
  let calls = 0;
  const w = createWatcher({ dir: 'x', debounceMs: 20, watch: fake, onChange: () => { calls++; } });
  assert.equal(w.start(), true);
  assert.equal(w.active, true);
  handler('rename', '.devkit/history/a/1.md');
  handler('change', 'a.md.9.tmp');
  await sleep(60);
  assert.equal(calls, 0);
  handler('change', 'a.md'); handler('change', 'a.md'); handler('rename', 'b.md');
  await sleep(60);
  assert.equal(calls, 1);
  handler('change', 'c.md');
  w.stop();
  await sleep(60);
  assert.equal(calls, 1); // parar cancela o que estava agendado
  assert.equal(closed, true);
  assert.equal(w.active, false);
});

test('watcher + reload end to end on a real folder', async () => {
  const dir = tmp();
  try {
    const { svc, events } = await open(dir);
    const w = createWatcher({ dir, debounceMs: 30, onChange: () => svc.reload() });
    if (!w.start()) return; // fs.watch recursivo indisponível nesta plataforma
    try {
      await sleep(100);
      drop(dir, 'remota.md', createNote({ id: 'r1', title: 'Veio de fora', content: 'oi' }));
      for (let i = 0; i < 40 && !svc.get('r1'); i++) await sleep(50);
      assert.equal(svc.get('r1').content, 'oi');
      assert.ok(events.some((e) => e.type === 'saved' && e.id === 'r1'));
    } finally { w.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
