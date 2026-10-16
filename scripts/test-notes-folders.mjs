// Testes das pastas das Notes (configuração por pasta, ordem, duplicar, mesclar, lixeira de pastas, links com pasta,
// configurações): node --test scripts/test-notes-folders.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const N = require('../src/notes/note.js');
const F = require('../src/notes/folders.js');
const M = require('../src/notes/foldermeta.js');
const { serialize } = require('../src/notes/format.js');
const { searchNotes } = require('../src/notes/search.js');
const { createNotesService } = require('../electron/notes/service.js');
const { createNotesSettings, DEFAULTS } = require('../electron/notes/settings.js');

const tmp = () => mkdtempSync(path.join(tmpdir(), 'devkit-notes-f-'));
const titles = (rs) => rs.map((r) => r.title);
const rm = (dir) => rmSync(dir, { recursive: true, force: true });
const treeOrder = (svc) => F.buildTree(svc.folders()).map((x) => x.path);

test('foldermeta: sanitize descarta o inválido, merge aplica patch e null remove, sortNotes ordena', () => {
  assert.deepEqual(M.sanitizeMeta(null), {});
  assert.deepEqual(M.sanitizeMeta({ color: 'blue', icon: 'code', tags: ['#SQL', 'sql', ' rm ', 'a b'], sort: 'title', pinned: true, order: 2, lixo: 1 }),
    { color: 'blue', icon: 'code', tags: ['sql', 'rm'], sort: 'title', pinned: true, order: 2 });
  assert.deepEqual(M.sanitizeMeta({ color: 'neon', icon: 'nao-existe', sort: 'updated', pinned: false, order: -1, template: '  ' }), {});
  assert.deepEqual(M.mergeMeta({ color: 'red', pinned: true }, { pinned: null, icon: 'bug' }), { color: 'red', icon: 'bug' });
  assert.deepEqual(M.mergeMeta({ tags: ['a'] }, { tags: [] }), {});
  assert.deepEqual(M.sanitizeMeta({ outline: true }), { outline: true });                       // vazado é opt-in; padrão = preenchido
  assert.deepEqual(M.sanitizeMeta({ outline: false }), {});
  assert.deepEqual(M.sanitizeMeta({ outline: 'sim' }), {});
  assert.deepEqual(M.mergeMeta({ color: 'red', outline: true }, { outline: null }), { color: 'red' });
  const list = [{ title: 'b', created: '2026-01-01' }, { title: 'A', created: '2026-03-01' }, { title: 'c', created: '2026-02-01' }];
  assert.deepEqual(M.sortNotes(list, 'title').map((n) => n.title), ['A', 'b', 'c']);
  assert.deepEqual(M.sortNotes(list, 'created').map((n) => n.title), ['A', 'c', 'b']);
  assert.deepEqual(M.sortNotes(list, 'updated').map((n) => n.title), ['b', 'A', 'c']); // padrão: ordem recebida
});

test('folders: árvore respeita a ordem manual, acha irmãs, filtra por nome e nomeia cópias', () => {
  const norm = require('../src/commands/search.js').normalize;
  const tree = F.buildTree([{ path: 'b', count: 1, order: 1 }, { path: 'a', count: 0 }, { path: 'c', count: 0, order: 2, color: 'red' }, { path: 'a/x', count: 2 }]);
  assert.deepEqual(tree.map((n) => n.path), ['b', 'c', 'a']);       // ordenadas primeiro, depois alfabética
  assert.equal(tree[1].meta.color, 'red');
  assert.equal(tree[2].total, 2);
  assert.equal(F.findNode(tree, 'a/x').name, 'x');
  assert.equal(F.findNode(tree, 'nada'), null);
  assert.deepEqual(F.siblingsOf(tree, 'c').map((s) => s.path), ['b', 'c', 'a']);
  assert.deepEqual(F.siblingsOf(tree, 'a/x').map((s) => s.path), ['a/x']);
  assert.deepEqual(F.matchFolders([{ path: 'Trabalho/Fluig' }, { path: 'Pessoal' }], 'fluig trab', norm).map((f) => f.path), ['Trabalho/Fluig']);
  assert.deepEqual(F.matchFolders([{ path: 'Pessoal' }], '  ', norm), []);
  assert.equal(F.copyName('Docs', ['Docs']), 'Docs (cópia)');
  assert.equal(F.copyName('Docs', ['docs (cópia)', 'Docs']), 'Docs (cópia 2)');
});

test('search: filtro de pasta recursivo e o caminho da pasta entra na busca', () => {
  const mk = (title, file) => ({ ...N.createNote({ title, content: 'corpo' }), file });
  const all = [mk('Alfa', 'Trabalho/a.md'), mk('Beta', 'Trabalho/Fluig/b.md'), mk('Gama', 'Pessoal/c.md'), mk('Delta', 'd.md')];
  assert.deepEqual(titles(searchNotes(all, '', { filter: { folder: 'Trabalho' }, limit: 9 })).sort(), ['Alfa']);
  assert.deepEqual(titles(searchNotes(all, '', { filter: { folder: 'Trabalho', recursive: true }, limit: 9 })).sort(), ['Alfa', 'Beta']);
  assert.deepEqual(titles(searchNotes(all, '', { filter: { folder: '', recursive: true }, limit: 9 })).sort(), ['Alfa', 'Beta', 'Delta', 'Gama']);
  assert.deepEqual(titles(searchNotes(all, 'fluig', { limit: 9 })), ['Beta']);          // só a pasta tem "fluig"
  assert.deepEqual(titles(searchNotes(all, 'pessoal gama', { limit: 9 })), ['Gama']);
});

test('settings: validação, padrões e persistência', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'sub', 'notes-settings.json');
    const s = createNotesSettings(file);
    assert.deepEqual(s.get(), DEFAULTS);
    assert.deepEqual(s.set({ historyMax: 100, historyGapMin: 5 }), { historyMax: 100, historyGapMin: 5 });
    assert.throws(() => s.set({ historyMax: 2 }), /Versões por nota/);
    assert.throws(() => s.set({ historyGapMin: 9999 }), /Intervalo/);
    assert.throws(() => s.set({ dir: 'relativa/pasta' }), /pasta/);
    assert.equal(s.get().historyMax, 100);                     // patch inválido não mexe em nada
    s.set({ dir: path.join(dir, 'minhas notas') });
    assert.equal(createNotesSettings(file).raw().dir, path.join(dir, 'minhas notas')); // persistiu
    assert.equal(createNotesSettings(file).get().historyGapMin, 5);
    s.set({ dir: null, historyMax: null });
    assert.equal(s.raw().dir, undefined);
    assert.equal(s.get().historyMax, DEFAULTS.historyMax);
    writeFileSync(file, '{ não é json');
    assert.deepEqual(createNotesSettings(file).get(), DEFAULTS); // arquivo corrompido volta ao padrão
  } finally { rm(dir); }
});

test('service: configuração da pasta persiste em .folder.json, acompanha rename/mover e some com a pasta', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    await svc.createFolder('Trabalho');
    await svc.createFolder('Trabalho/Fluig');
    await svc.createFolder('Templates');
    const tpl = await svc.create({ title: 'Chamado', content: 'x', folder: 'Templates' });
    const plain = await svc.create({ title: 'Solta', content: 'x' });

    const m = await svc.setFolderMeta('Trabalho/Fluig', { color: 'teal', icon: 'code', tags: ['#Fluig', 'rm'], sort: 'title', template: tpl.id, pinned: true });
    assert.deepEqual(m, { color: 'teal', icon: 'code', template: tpl.id, tags: ['fluig', 'rm'], sort: 'title', pinned: true });
    assert.ok(existsSync(path.join(dir, 'Trabalho', 'Fluig', '.folder.json')));
    assert.deepEqual(svc.folders().find((f) => f.path === 'Trabalho/Fluig'), { path: 'Trabalho/Fluig', count: 0, ...m });
    assert.deepEqual(svc.folders().find((f) => f.path === 'Trabalho'), { path: 'Trabalho', count: 0 }); // sem config: forma antiga
    await assert.rejects(svc.setFolderMeta('Trabalho', { template: plain.id }), /template/i);   // só notas de Templates
    await assert.rejects(svc.setFolderMeta('Templates', { color: 'red' }), /Templates/);
    await assert.rejects(svc.setFolderMeta('Nada', { color: 'red' }), /não existe/);
    assert.ok(!svc.list().some((n) => n.title === '.folder'));                                    // o .json nunca vira nota

    // Tags padrão: nota nova na pasta já nasce com elas (sem duplicar as que vieram)
    const n = await svc.create({ title: 'Dataset', content: 'x', tags: ['fluig', 'extra'], folder: 'Trabalho/Fluig' });
    assert.deepEqual(svc.get(n.id).tags.slice().sort(), ['extra', 'fluig', 'rm']);
    const outside = await svc.create({ title: 'Fora', content: 'x', tags: ['z'] });
    assert.deepEqual(svc.get(outside.id).tags, ['z']);

    // Acompanha rename e mover; sobrevive a reiniciar
    await svc.renameFolder('Trabalho', 'Work');
    await svc.createFolder('Arquivo');
    await svc.moveFolder('Work/Fluig', 'Arquivo');
    assert.equal(svc.folders().find((f) => f.path === 'Arquivo/Fluig').color, 'teal');
    const svc2 = createNotesService({ dir });
    await svc2.init();
    assert.deepEqual(svc2.folders().find((f) => f.path === 'Arquivo/Fluig').tags, ['fluig', 'rm']);

    // Limpar tudo apaga o arquivo; excluir a pasta leva a config junto, e o desfazer devolve
    await svc.setFolderMeta('Arquivo/Fluig', { color: null, icon: null, tags: [], sort: null, template: null, pinned: null });
    assert.ok(!existsSync(path.join(dir, 'Arquivo', 'Fluig', '.folder.json')));
    await svc.setFolderMeta('Arquivo/Fluig', { color: 'red' });
    const snap = await svc.removeFolder('Arquivo/Fluig');
    assert.deepEqual(snap.meta, { 'Arquivo/Fluig': { color: 'red' } });
    assert.deepEqual(snap.kept, []);
    assert.ok(!existsSync(path.join(dir, 'Arquivo', 'Fluig')));
    await svc.restoreFolder(snap);
    assert.equal(svc.folders().find((f) => f.path === 'Arquivo/Fluig').color, 'red');
    assert.ok(existsSync(path.join(dir, 'Arquivo', 'Fluig', '.folder.json')));
  } finally { rm(dir); }
});

test('service: moveFolderOrder reordena as irmãs de forma manual', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    for (const f of ['a', 'b', 'c']) await svc.createFolder(f);
    assert.deepEqual(treeOrder(svc), ['a', 'b', 'c']);
    assert.equal(await svc.moveFolderOrder('c', -1), true);
    assert.deepEqual(treeOrder(svc), ['a', 'c', 'b']);
    assert.equal(await svc.moveFolderOrder('c', -1), true);
    assert.deepEqual(treeOrder(svc), ['c', 'a', 'b']);
    assert.equal(await svc.moveFolderOrder('c', -1), false);              // já é a primeira
    assert.equal(await svc.moveFolderOrder('b', 1), false);               // e b a última
    await svc.createFolder('d');                                          // pasta nova entra no fim
    assert.deepEqual(treeOrder(svc), ['c', 'a', 'b', 'd']);
    const svc2 = createNotesService({ dir });
    await svc2.init();
    assert.deepEqual(treeOrder(svc2), ['c', 'a', 'b', 'd']);              // a ordem sobrevive a reiniciar
  } finally { rm(dir); }
});

test('service: excluir pasta avisa as que ficaram no disco (arquivo que não é nota)', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    await svc.createFolder('Docs');
    await svc.create({ title: 'N', content: 'x', folder: 'Docs' });
    writeFileSync(path.join(dir, 'Docs', 'planilha.xlsx'), 'binario');
    const snap = await svc.removeFolder('Docs');
    assert.deepEqual(snap.kept, ['Docs']);
    assert.deepEqual(snap.folders, []);
    assert.ok(existsSync(path.join(dir, 'Docs', 'planilha.xlsx')));       // nada de apagar o que não é nota
    assert.ok(svc.folders().some((f) => f.path === 'Docs'));              // continua listada
  } finally { rm(dir); }
});

test('service: duplicar pasta copia subpastas, notas (ids novos) e config, menos fixada/posição', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    await svc.createFolder('Docs');
    await svc.createFolder('Docs/Sub');
    const a = await svc.create({ title: 'A', content: 'um', folder: 'Docs' });
    const b = await svc.create({ title: 'B', content: 'dois', folder: 'Docs/Sub', tags: ['x'] });
    await svc.setFolderMeta('Docs', { color: 'blue', pinned: true });
    const to = await svc.duplicateFolder('Docs');
    assert.equal(to, 'Docs (cópia)');
    assert.deepEqual(svc.folders().map((f) => f.path), ['Docs', 'Docs (cópia)', 'Docs (cópia)/Sub', 'Docs/Sub']);
    const copy = svc.folders().find((f) => f.path === 'Docs (cópia)');
    assert.equal(copy.color, 'blue');
    assert.equal(copy.pinned, undefined);
    const inCopy = svc.list({ folder: 'Docs (cópia)' }), inSub = svc.list({ folder: 'Docs (cópia)/Sub' });
    assert.deepEqual(inCopy.map((n) => n.title), ['A']);
    assert.deepEqual(inSub.map((n) => [n.title, n.tags]), [['B', ['x']]]);
    assert.notEqual(inCopy[0].id, a.id);                                  // ids novos: nada de "id duplicado"
    assert.notEqual(inSub[0].id, b.id);
    assert.equal(svc.get(a.id).folder, 'Docs');
    assert.equal(await svc.duplicateFolder('Docs'), 'Docs (cópia 2)');
    const svc2 = createNotesService({ dir });
    const info = await svc2.init();
    assert.equal(info.errors.length, 0);                                  // recarrega sem conflito de id
    assert.equal(info.count, 6);
  } finally { rm(dir); }
});

test('service: mesclar — folderClash avisa, sem merge recusa, com merge junta pastas e notas', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    for (const f of ['A', 'A/Sub', 'B', 'B/Sub', 'B/Outra', 'Raiz']) await svc.createFolder(f);
    const x = await svc.create({ title: 'X', content: 'x', folder: 'A' });
    const y = await svc.create({ title: 'Y', content: 'y', folder: 'A/Sub' });
    const z = await svc.create({ title: 'Z', content: 'z', folder: 'B' });
    const w = await svc.create({ title: 'W', content: 'w', folder: 'B/Outra' });
    await svc.setFolderMeta('B', { color: 'red' });
    await svc.setFolderMeta('B/Outra', { icon: 'bug' });
    assert.equal(svc.folderClash('B', { newName: 'a' }), 'A');
    assert.equal(svc.folderClash('B', { newName: 'b' }), null);            // só mudou a caixa dela mesma
    assert.equal(svc.folderClash('B', { newName: 'Livre' }), null);
    assert.equal(svc.folderClash('B/Sub', { newParent: 'A' }), 'A/Sub');
    await assert.rejects(svc.renameFolder('B', 'A'), /Já existe/);
    await assert.rejects(svc.moveFolder('B/Sub', 'A'), /Já existe/);
    assert.equal(await svc.renameFolder('B', 'A', { merge: true }), 'A');
    assert.deepEqual(svc.folders().map((f) => f.path), ['A', 'A/Outra', 'A/Sub', 'Raiz']);
    assert.equal(svc.get(z.id).folder, 'A');
    assert.equal(svc.get(w.id).folder, 'A/Outra');
    assert.equal(svc.get(x.id).folder, 'A');
    assert.equal(svc.get(y.id).folder, 'A/Sub');
    const meta = Object.fromEntries(svc.folders().map((f) => [f.path, f.color || f.icon || null]));
    assert.deepEqual(meta, { A: 'red', 'A/Outra': 'bug', 'A/Sub': null, Raiz: null }); // A não tinha config: herda a de B
    assert.ok(!existsSync(path.join(dir, 'B')));
  } finally { rm(dir); }
});

test('service: mesclar nunca sobrescreve — arquivo de mesmo nome vira "(2)"', async () => {
  const dir = tmp();
  try {
    const seed = createNotesService({ dir });
    await seed.init();
    await seed.createFolder('P');
    await seed.createFolder('Q');
    writeFileSync(path.join(dir, 'Q', 'x.md'), serialize(N.createNote({ title: 'QX', content: 'q' })));
    writeFileSync(path.join(dir, 'P', 'x.md'), serialize(N.createNote({ title: 'PX', content: 'p' })));
    const svc = createNotesService({ dir });
    await svc.init();
    assert.equal(await svc.renameFolder('Q', 'p', { merge: true }), 'P');   // "p" é a P existente (outra caixa)
    assert.deepEqual(svc.list({ folder: 'P' }).map((n) => n.title).sort(), ['PX', 'QX']);
    assert.ok(existsSync(path.join(dir, 'P', 'x (2).md')));
    assert.ok(!existsSync(path.join(dir, 'Q')));
  } finally { rm(dir); }
});

test('service: lixeira de pastas — lista as excluídas e restaura a pasta inteira com a configuração', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    await svc.createFolder('Projeto');
    await svc.createFolder('Projeto/Sub');
    await svc.createFolder('Projeto/Vazia');
    const a = await svc.create({ title: 'A', content: 'a', folder: 'Projeto' });
    const b = await svc.create({ title: 'B', content: 'b', folder: 'Projeto/Sub' });
    await svc.setFolderMeta('Projeto', { color: 'amber' });
    await svc.setFolderMeta('Projeto/Vazia', { icon: 'star' });
    await svc.removeFolder('Projeto');
    assert.deepEqual(await svc.trashFolders(), [{ path: 'Projeto', notes: 2 }]);
    assert.deepEqual(svc.folders(), []);
    await assert.rejects(svc.restoreFolderFromTrash('NaoExiste'), /não está na lixeira/);
    const r = await svc.restoreFolderFromTrash('Projeto');
    assert.deepEqual(r, { folder: 'Projeto', notes: 2 });
    assert.deepEqual(svc.folders().map((f) => f.path), ['Projeto', 'Projeto/Sub', 'Projeto/Vazia']);
    assert.equal(svc.get(a.id).folder, 'Projeto');
    assert.equal(svc.get(b.id).folder, 'Projeto/Sub');
    assert.equal(svc.folders().find((f) => f.path === 'Projeto').color, 'amber');
    assert.equal(svc.folders().find((f) => f.path === 'Projeto/Vazia').icon, 'star');
    assert.deepEqual(await svc.trashFolders(), []);
    assert.equal(await svc.trashCount(), 0);
    assert.ok(!existsSync(path.join(dir, '.trash', 'Projeto')));            // sem sobras (nem o .folder.json)
    // Subpasta excluída com a pai ainda existindo: aparece pelo caminho da subpasta
    await svc.removeFolder('Projeto/Sub');
    assert.deepEqual(await svc.trashFolders(), [{ path: 'Projeto/Sub', notes: 1 }]);
    await svc.emptyTrash();
    assert.deepEqual(await svc.trashFolders(), []);
  } finally { rm(dir); }
});

test('service: [[Pasta/Título]] desambigua notas de mesmo título em pastas diferentes', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    await svc.createFolder('Trabalho');
    await svc.createFolder('Pessoal');
    const w = await svc.create({ title: 'Reunião', content: 'trabalho', folder: 'Trabalho' });
    const p = await svc.create({ title: 'Reunião', content: 'pessoal', folder: 'Pessoal' });
    const solta = await svc.create({ title: 'Ideias', content: 'x' });
    assert.ok(svc.resolveLink('Reunião') === w.id || svc.resolveLink('Reunião') === p.id); // sem pasta: a primeira que achar
    assert.equal(svc.resolveLink('Pessoal/Reunião'), p.id);
    assert.equal(svc.resolveLink('trabalho/reuniao'), w.id);                // sem acento/maiúscula
    assert.equal(svc.resolveLink('Pessoal/Ideias'), null);                  // a nota está na raiz
    assert.equal(svc.resolveLink('Ideias'), solta.id);
    const src = await svc.create({ title: 'Índice', content: 'ver [[Pessoal/Reunião]] e [[Trabalho/Reunião]]' });
    assert.deepEqual(svc.backlinks(p.id).map((x) => x.id), [src.id]);
    assert.deepEqual(svc.backlinks(w.id).map((x) => x.id), [src.id]);
    const g = svc.graph();
    assert.equal(g.links.filter((l) => l.source === src.id).length, 2);
    assert.ok(!g.nodes.some((nd) => nd.ghost));                             // os dois links resolveram
  } finally { rm(dir); }
});

test('service: configure ajusta o histórico (versões por nota e intervalo) sem reiniciar', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir, historyGapMs: 60 * 60 * 1000 });
    await svc.init();
    const n = await svc.create({ title: 'H', content: 'v0' });
    await svc.save({ id: n.id, content: 'v1' });
    await svc.save({ id: n.id, content: 'v2' });
    assert.equal((await svc.history(n.id)).length, 1);                      // intervalo de 1 h: uma só versão
    svc.configure({ historyGapMs: 0, historyMax: 2 });
    for (let i = 3; i <= 7; i++) await svc.save({ id: n.id, content: 'v' + i });
    assert.equal((await svc.history(n.id)).length, 2);                      // o limite novo vale na hora
  } finally { rm(dir); }
});

test('IA: perguntar às notas ignora Templates e privado, e respeita o escopo de pasta', async () => {
  const { gatherNotes } = require('../src/ai/notesContext.js');
  const calls = [];
  const all = [
    { id: 'a', title: 'Proxy do Fluig', folder: 'Trabalho', tags: [], score: 9 },
    { id: 'b', title: 'Modelo de chamado', folder: 'Templates', tags: [], score: 8 },
    { id: 'c', title: 'Senhas', folder: 'Trabalho', tags: ['privado'], score: 7 },
    { id: 'd', title: 'Proxy de casa', folder: 'Pessoal', tags: [], score: 6 },
  ];
  const api = {
    search: async (q, opts) => { calls.push(opts); return all.filter((n) => !opts.filter || n.folder === opts.filter.folder || n.folder.startsWith(opts.filter.folder + '/')); },
    get: async (id) => ({ id, content: 'texto de ' + id, tags: [] }),
  };
  const r = await gatherNotes('como configurei o proxy', 6, { api });
  assert.deepEqual(r.notes.map((n) => n.id), ['a', 'd']);                  // sem o template (b) nem o privado (c)
  const scoped = await gatherNotes('como configurei o proxy', 6, { api, folder: 'Trabalho' });
  assert.deepEqual(scoped.notes.map((n) => n.id), ['a']);                  // só a pasta (c é privado, b é template)
  assert.deepEqual(calls.at(-1).filter, { folder: 'Trabalho', recursive: true });
});
