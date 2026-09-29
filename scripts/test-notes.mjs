// Testes de Notes (domínio, formato, busca, persistência, serviço): node --test scripts/test-notes.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const N = require('../src/notes/note.js');
const E = require('../src/notes/edit.js');
const { serialize, parse } = require('../src/notes/format.js');
const { searchNotes, withinOne } = require('../src/notes/search.js');
const { createStore } = require('../electron/notes/store.js');
const { createNotesService } = require('../electron/notes/service.js');

const tmp = () => mkdtempSync(path.join(tmpdir(), 'devkit-notes-'));
const titles = (rs) => rs.map((r) => r.title);

/* ─────────────── note ─────────────── */
test('displayTitle: title, else first text line without markdown', () => {
  assert.equal(N.displayTitle({ title: ' SQL ', content: 'x' }), 'SQL');
  assert.equal(N.displayTitle({ title: '', content: '\n\n## **Query** `top`\ncorpo' }), 'Query top');
  assert.equal(N.displayTitle({ title: '', content: '- [ ] revisar [[RM - WebService]]' }), 'revisar RM - WebService');
  assert.equal(N.displayTitle({ title: '', content: '```sql\nselect 1\n```\n' }), 'Sem título');
  assert.equal(N.displayTitle({ title: '', content: 'usar COALESCE #sql no RH #rm' }), 'usar COALESCE no RH');
  assert.equal(N.displayTitle({ title: '', content: '#sql #rm\nsegunda linha' }), 'segunda linha');
});

test('inlineTags ignore code, headings and # inside words', () => {
  const md = '# Título\nusar #SQL e #fluig.\nissue#12 não\n`#nao` e\n```\n#tambemnao\n```\n(#rm)';
  assert.deepEqual(N.inlineTags(md), ['sql', 'fluig', 'rm']);
  assert.deepEqual(N.allTags({ tags: ['#Docker', 'sql'], content: 'x #sql' }), ['docker', 'sql']);
});

test('wikiLinks and snippetCode', () => {
  assert.deepEqual(N.wikiLinks('ver [[SQL - Paginação]] e [[RM|web service]] `[[não]]`'), ['SQL - Paginação', 'RM']);
  const s = { content: 'Buscar último:\n```sql\nSELECT TOP 1 *\nFROM t\n```\ne\n~~~\nb\n~~~' };
  assert.equal(N.snippetCode(s), 'SELECT TOP 1 *\nFROM t\n\nb');
  assert.equal(N.snippetCode({ content: '  git log --oneline  \n' }), 'git log --oneline');
});

test('excerpt centers on the match and reports highlight ranges', () => {
  const long = 'a '.repeat(100) + 'use COALESCE aqui ' + 'b '.repeat(100);
  const ex = N.excerpt(long, ['coalesce']);
  assert.ok(ex.text.startsWith('…') && ex.text.endsWith('…'));
  const [s, e] = ex.ranges[0];
  assert.equal(ex.text.slice(s, e), 'COALESCE');
  assert.equal(N.excerpt('início', ['zzz']).text, 'início');
});

test('tasksOf: order, nesting, metadata, code blocks ignored; indexes match toggleTaskAt', () => {
  const md = '```\n- [ ] no código\n```\n- [ ] a @2026-10-02 !1 #x\n  - [x] b\n1. [ ] c\n- [ ]\n* texto normal';
  const t = N.tasksOf(md);
  assert.deepEqual(t.map((x) => [x.index, x.line, x.checked, x.text]), [
    [0, 3, false, 'a #x'], [1, 4, true, 'b'], [2, 5, false, 'c'], [3, 6, false, ''],
  ]);
  assert.equal(t[0].due, '2026-10-02');
  assert.equal(t[0].priority, 1);
  assert.equal(t[1].indent, 2);
  assert.equal(t[2].due, null);
  assert.deepEqual(N.taskStats(md), { open: 3, done: 1 });
  assert.equal(N.toggleTaskAt(md, 1), md.replace('- [x] b', '- [ ] b'));
  assert.deepEqual(N.tasksOf(''), []);
});

test('edit: Enter continues a task list, exits on an empty task, ignores code and plain lines', () => {
  const { continueList } = E;
  let r = continueList('- [ ] a', 7);
  assert.deepEqual(r, { value: '- [ ] a\n- [ ] ', start: 14, end: 14 });
  r = continueList('  - [x] feito', 13);
  assert.equal(r.value, '  - [x] feito\n  - [ ] ');
  r = continueList('1. [ ] um', 9);
  assert.equal(r.value, '1. [ ] um\n2. [ ] ');
  r = continueList('- [ ] ab', 7); // no meio do texto: quebra a linha
  assert.equal(r.value, '- [ ] a\n- [ ] b');
  r = continueList('x\n- [ ] ', 8);
  assert.deepEqual(r, { value: 'x\n', start: 2, end: 2 });
  assert.equal(continueList('texto', 5), null);
  assert.equal(continueList('- item', 6), null);
  assert.equal(continueList('```\n- [ ] a\n```', 11), null);
  assert.equal(continueList('- [ ] a', 3), null); // cursor dentro do prefixo
});

test('edit: toggleTaskLines cycles text → open → done → text, also for selections', () => {
  const { toggleTaskLines: tg } = E;
  let r = tg('comprar leite', 3, 3);
  assert.deepEqual(r, { value: '- [ ] comprar leite', start: 9, end: 9 });
  r = tg('- [ ] comprar', 8, 8);
  assert.equal(r.value, '- [x] comprar');
  r = tg('- [x] comprar', 9, 9);
  assert.equal(r.value, 'comprar');
  assert.equal(r.start, 3);
  assert.equal(tg('- item', 4, 4).value, '- [ ] item');
  assert.equal(tg('1. item', 4, 4).value, '1. [ ] item');
  assert.equal(tg('', 0, 0).value, '- [ ] ');
  const md = 'a\n\nb\n- [x] c';
  assert.equal(tg(md, 0, md.length).value, '- [ ] a\n\n- [ ] b\n- [x] c');
  assert.equal(tg('```\nx\n```', 5, 5), null);
});

test('edit: "[] "/"todo " become a task and @hoje/@amanha become dates', () => {
  const { expandOnSpace: ex } = E;
  assert.deepEqual(ex('[]', 2), { value: '- [ ] ', start: 6, end: 6 });
  assert.equal(ex('  todo', 6).value, '  - [ ] ');
  assert.equal(ex('a todo', 6), null);
  const now = new Date(2026, 9, 31, 12); // 31/10/2026
  assert.equal(ex('- [ ] pagar @hoje', 17, now).value, '- [ ] pagar @2026-10-31 ');
  assert.equal(ex('- [ ] pagar @amanha', 19, now).value, '- [ ] pagar @2026-11-01 ');
  assert.equal(ex('a@hoje', 6, now), null);
});

test('folders: name validation (Windows-safe), path helpers and tree', () => {
  const F = require('../src/notes/folders.js');
  for (const ok of ['Trabalho', 'Fluig 2026', 'ação_1', 'a.b']) assert.equal(F.validFolderName(ok), null, ok);
  for (const bad of ['', '  ', ' x', 'x ', 'a/b', 'a\\b', 'a:b', 'a*', 'a?', 'a<b', '.oculta', '.trash', 'x.', 'CON', 'nul.txt', 'com1', 'a'.repeat(81)]) {
    assert.ok(F.validFolderName(bad), JSON.stringify(bad));
  }
  assert.equal(F.validFolderPath('a/b/c'), null);
  assert.ok(F.validFolderPath('a/../b'));
  assert.ok(F.validFolderPath('a/.trash'));
  assert.equal(F.normFolder('\\a//b\\c/'), 'a/b/c');
  assert.equal(F.folderOf('a/b/x.md'), 'a/b');
  assert.equal(F.folderOf('x.md'), '');
  assert.equal(F.baseName('a/b/x.md'), 'x.md');
  assert.equal(F.parentOf('a'), '');
  assert.equal(F.joinPath('a', '', 'b/c'), 'a/b/c');
  assert.ok(F.isDescendant('a/b', 'a') && !F.isDescendant('a', 'a') && !F.isDescendant('ab', 'a') && F.isDescendant('a', ''));
  const tree = F.buildTree([{ path: 'b/x', count: 2 }, { path: 'a', count: 1 }, { path: 'b', count: 0 }]);
  assert.deepEqual(tree.map((n) => [n.path, n.count, n.total]), [['a', 1, 1], ['b', 0, 2]]);
  assert.deepEqual(F.flattenTree(tree).map((n) => [n.path, n.depth]), [['a', 0], ['b', 0], ['b/x', 1]]);
  assert.deepEqual(F.buildTree([{ path: 'p/q', count: 1 }]).map((n) => [n.path, n.children[0].path]), [['p', 'p/q']]); // pai implícito
});

test('newId is sortable and file-safe', () => {
  const id = N.newId(new Date(2026, 8, 26, 14, 21, 0));
  assert.match(id, /^20260926-142100-[a-z0-9]{4}$/);
});

/* ─────────────── format ─────────────── */
test('serialize/parse round trip without loss', () => {
  const n = N.createNote({
    title: 'SQL — "NULL" handling: é', content: '# x\n\n---\ntexto com --- e: dois pontos\n', type: 'snippet',
    tags: ['sql', 'rm'], aliases: ['coalesce'], pinned: true, quick: false,
  });
  n.extra = { cssclass: 'wide' };
  const text = serialize(n);
  const back = parse(text, n.id + '.md');
  for (const k of ['id', 'title', 'content', 'type', 'tags', 'aliases', 'pinned', 'favorite', 'quick', 'created', 'updated']) assert.deepEqual(back[k], n[k], k);
  assert.deepEqual(back.extra, { cssclass: 'wide' });
  assert.equal(serialize(back), text);
});

test('parse tolerates files without front matter, CRLF, YAML lists and a leading <hr>', () => {
  const a = parse('Só texto\r\nlinha 2', 'minha-nota.md', new Date('2026-01-01T00:00:00Z'));
  assert.equal(a.id, 'minha-nota');
  assert.equal(a.content, 'Só texto\nlinha 2');
  assert.equal(a.created, '2026-01-01T00:00:00.000Z');
  const b = parse('---\ntitle: Git\ntags: [git, "cli"]\npinned: true\n---\ncorpo', 'b.md');
  assert.deepEqual([b.title, b.tags, b.pinned, b.content], ['Git', ['git', 'cli'], true, 'corpo']);
  const hr = parse('---\nisto não é front matter\n---\nfim', 'hr.md');
  assert.equal(hr.content, '---\nisto não é front matter\n---\nfim');
});

/* ─────────────── search ─────────────── */
const corpus = () => [
  N.createNote({ title: 'SQL — NULL handling', content: 'Use COALESCE(a, b) e ISNULL.\n#sql', updated: '2026-01-01' }),
  N.createNote({ title: 'Docker — comandos', content: 'docker compose up -d\ndocker ps', updated: '2026-01-02' }),
  N.createNote({ title: 'Docker — problemas comuns', content: 'volume sem permissão; compose antigo', updated: '2026-01-03' }),
  N.createNote({ title: 'Deploy — docker compose', content: 'passo a passo', updated: '2026-01-04' }),
  N.createNote({ title: 'PowerShell — npm.ps1 execution policy', content: 'Set-ExecutionPolicy RemoteSigned', aliases: ['npm bloqueado'], tags: ['powershell'], pinned: true, updated: '2025-12-01' }),
  N.createNote({ content: 'lembrar de usar COALESCE no relatório de RH', quick: true, updated: '2025-12-02' }),
  N.createNote({ title: 'Git — rebase', type: 'snippet', content: '```\ngit rebase -i HEAD~3\n```', tags: ['git'], updated: '2025-12-03' }),
];

test('content-only match (COALESCE) is found with an excerpt', () => {
  const r = searchNotes(corpus(), 'COALESCE');
  assert.deepEqual(titles(r).sort(), ['SQL — NULL handling', 'lembrar de usar COALESCE no relatório de RH'].sort());
  const sql = r.find((x) => x.title === 'SQL — NULL handling');
  assert.equal(sql.excerpt.text.slice(...sql.excerpt.ranges[0]), 'COALESCE');
});

test('"docker compose": title phrase > title words > content', () => {
  const r = titles(searchNotes(corpus(), 'docker compose'));
  assert.deepEqual(r, ['Deploy — docker compose', 'Docker — comandos', 'Docker — problemas comuns']);
});

test('multi-word, accents, typos, aliases, tags and type', () => {
  assert.equal(titles(searchNotes(corpus(), 'npm execution policy'))[0], 'PowerShell — npm.ps1 execution policy');
  assert.equal(titles(searchNotes(corpus(), 'relatorio'))[0], 'lembrar de usar COALESCE no relatório de RH');
  assert.ok(titles(searchNotes(corpus(), 'COALESE')).includes('SQL — NULL handling'));
  assert.equal(titles(searchNotes(corpus(), 'bloqueado'))[0], 'PowerShell — npm.ps1 execution policy');
  assert.equal(titles(searchNotes(corpus(), '#git'))[0], 'Git — rebase');
  assert.equal(titles(searchNotes(corpus(), 'snippet'))[0], 'Git — rebase');
  assert.deepEqual(searchNotes(corpus(), 'kubernetes'), []);
});

test('filters and empty query (most recent first)', () => {
  const c = corpus();
  assert.deepEqual(titles(searchNotes(c, '', { filter: { pinned: true } })), ['PowerShell — npm.ps1 execution policy']);
  assert.equal(searchNotes(c, '', { filter: { quick: true } }).length, 1);
  assert.equal(searchNotes(c, '', { filter: { type: 'snippet' } }).length, 1);
  assert.equal(searchNotes(c, '', { filter: { tag: 'sql' } }).length, 1);
  assert.equal(searchNotes(c, '')[0].title, 'Deploy — docker compose');
});

test('withinOne edit distance', () => {
  assert.ok(withinOne('coalese', 'coalesce'));
  assert.ok(withinOne('coalescx', 'coalesce'));
  assert.ok(!withinOne('colase', 'coalesce'));
});

test('2,000 notes search in under 20 ms', () => {
  const words = ['sql', 'fluig', 'dataset', 'docker', 'git', 'rm', 'webservice', 'powershell', 'query', 'index'];
  const notes = Array.from({ length: 2000 }, (_, i) => N.createNote({
    title: `${words[i % 10]} — nota ${i}`,
    content: Array.from({ length: 60 }, (_, k) => words[(i + k) % 10] + ' texto ' + k).join('\n'),
  }));
  searchNotes(notes, 'aquecer'); // monta o cache de campos normalizados
  const t0 = performance.now();
  const r = searchNotes(notes, 'dataset webservice');
  const ms = performance.now() - t0;
  assert.ok(r.length > 0);
  assert.ok(ms < 20, 'levou ' + ms.toFixed(1) + ' ms');
});

/* ─────────────── store ─────────────── */
test('store: atomic write, load, concurrent writes keep the last, trash', async () => {
  const dir = tmp();
  try {
    const st = createStore(dir);
    const n = N.createNote({ title: 'A', content: 'v1' });
    await Promise.all([1, 2, 3, 4, 5].map((v) => st.write({ ...n, content: 'v' + v })));
    assert.equal(parse(readFileSync(path.join(dir, n.id + '.md'), 'utf8')).content, 'v5');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    writeFileSync(path.join(dir, 'solta.md'), 'nota criada fora do app');
    const { notes, errors } = await st.loadAll();
    assert.equal(notes.length, 2);
    assert.deepEqual(errors, []);
    await st.trash({ ...n, file: n.id + '.md' });
    assert.ok(!existsSync(path.join(dir, n.id + '.md')));
    assert.ok(existsSync(path.join(dir, '.trash', n.id + '.md')));
    await st.writeState({ viewed: [{ id: 'x' }] });
    assert.deepEqual(await st.readState(), { viewed: [{ id: 'x' }] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('store: loadAll recurses, lists empty folders, skips dot-dirs, and same file name in two folders is fine', async () => {
  const dir = tmp();
  try {
    const st = createStore(dir);
    const mk = (rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };
    mk('a.md', 'raiz');
    mk('Trabalho/a.md', 'em pasta');
    mk('Trabalho/Fluig/b.md', 'funda');
    mk('.trash/lixo.md', 'não carrega');
    mk('.git/x.md', 'não carrega');
    mk('Trabalho/leia.txt', 'não é nota');
    mkdirSync(path.join(dir, 'Vazia'));
    const { notes, errors, folders } = await st.loadAll();
    assert.deepEqual(errors, []);
    assert.deepEqual(folders, ['Trabalho', 'Trabalho/Fluig', 'Vazia']);
    assert.deepEqual(notes.map((n) => n.file).sort(), ['Trabalho/Fluig/b.md', 'Trabalho/a.md', 'a.md']);
    assert.equal(new Set(notes.map((n) => n.id)).size, 3); // ids derivados do caminho não colidem
    // write cria a subpasta; caminho fora da pasta das notas é recusado
    const n = N.createNote({ title: 'X', content: 'x' });
    await st.write({ ...n, file: 'Nova/Sub/' + n.id + '.md' });
    assert.ok(existsSync(path.join(dir, 'Nova', 'Sub', n.id + '.md')));
    assert.throws(() => st.write({ ...n, file: '../fora.md' }), /inválido|fora/);
    assert.throws(() => st.write({ ...n, file: 'a/../../fora.md' }), /inválido|fora/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('store: move never overwrites, trash keeps the subfolder, folders can be created/renamed/removed', async () => {
  const dir = tmp();
  try {
    const st = createStore(dir);
    const a = N.createNote({ title: 'A', content: 'a' }), b = N.createNote({ title: 'B', content: 'b' });
    await st.write({ ...a, file: 'a.md' });
    await st.write({ ...b, file: 'P/a.md' });
    // mover a.md (raiz) para P/a.md que já existe → P/a (2).md
    assert.equal(await st.move({ ...a, file: 'a.md' }, 'P/a.md'), 'P/a (2).md');
    assert.equal(readFileSync(path.join(dir, 'P', 'a (2).md'), 'utf8').includes('title: "A"'), true);
    assert.ok(!existsSync(path.join(dir, 'a.md')));
    assert.equal(await st.move({ ...a, file: 'P/a (2).md' }, 'P/a (2).md'), 'P/a (2).md'); // mesmo lugar: nada a fazer
    await assert.rejects(st.move({ ...a, file: 'sumiu.md' }, 'Q/sumiu.md'), /não foi encontrado/);
    // trash mantém a subpasta
    await st.trash({ ...b, file: 'P/a.md' });
    assert.ok(existsSync(path.join(dir, '.trash', 'P', 'a.md')));
    // pastas
    await st.mkdir('P/Sub');
    await assert.rejects(st.mkdir('p/SUB'), /Já existe/); // sem diferenciar maiúsculas
    await st.renameDir('P/Sub', 'P/Outra');
    assert.ok(existsSync(path.join(dir, 'P', 'Outra')));
    await st.mkdir('P/Dois');
    await assert.rejects(st.renameDir('P/Outra', 'P/dois'), /Já existe/);
    await st.renameDir('P/Outra', 'P/OUTRA'); // só maiúsculas: permitido
    assert.ok(readdirSync(path.join(dir, 'P')).includes('OUTRA'));
    assert.equal(await st.rmdir('P'), false); // ainda tem nota
    assert.equal(await st.rmdir('P/OUTRA'), true);
    assert.equal(await st.rmdir('naoexiste'), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('store: unreadable .md is skipped and reported, the rest loads', async () => {
  const dir = tmp();
  const fsp = require('node:fs/promises');
  const readFile = fsp.readFile;
  try {
    writeFileSync(path.join(dir, 'ok.md'), 'ok');
    writeFileSync(path.join(dir, 'ruim.md'), 'x');
    fsp.readFile = (f, ...a) => (String(f).endsWith('ruim.md') ? Promise.reject(new Error('EIO: falha de leitura')) : readFile(f, ...a));
    const { notes, errors } = await createStore(dir).loadAll();
    assert.deepEqual(notes.map((n) => n.id), ['ok']);
    assert.deepEqual(errors.map((e) => e.file), ['ruim.md']);
  } finally {
    fsp.readFile = readFile;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ─────────────── service ─────────────── */
test('service: save/get/search/recent/links/remove/restore and broadcasts', async () => {
  const dir = tmp();
  const events = [];
  try {
    const svc = createNotesService({ dir, broadcast: (e) => events.push(e.type) });
    await svc.init();
    const empty = N.createNote();
    assert.equal(await svc.save({ id: empty.id, content: '   ' }), null); // Quick Note vazia não grava
    const q = N.createNote({ quick: true });
    const saved = await svc.save({ id: q.id, content: 'lembrar COALESCE #sql', quick: true });
    assert.equal(saved.quick, true);
    assert.deepEqual(saved.tagsAll, ['sql']);
    const promoted = await svc.save({ id: q.id, title: 'SQL — NULL handling' });
    assert.equal(promoted.quick, false);
    const before = promoted.updated;
    const again = await svc.save({ id: q.id, title: 'SQL — NULL handling' }); // sem mudança → não grava
    assert.equal(again.updated, before);
    const other = await svc.create({ title: 'Fluig — Dataset', content: 'ver [[sql — null handling]]', type: 'snippet' });
    assert.equal(svc.resolveLink('SQL — NULL HANDLING'), q.id);
    assert.equal(svc.search('coalesce')[0].id, q.id);
    svc.markViewed(other.id);
    const rec = svc.recent();
    assert.equal(rec.viewed[0].id, other.id);
    assert.equal(rec.edited.length, 2);
    assert.deepEqual(svc.tags(), [{ tag: 'sql', count: 1 }]);

    // Reabrir a pasta encontra tudo igual.
    await svc.flush();
    const svc2 = createNotesService({ dir });
    const info = await svc2.init();
    assert.equal(info.count, 2);
    assert.equal(svc2.get(q.id).title, 'SQL — NULL handling');
    assert.equal(svc2.recent().viewed[0].id, other.id);

    const snap = svc.get(other.id);
    await svc.remove(other.id);
    assert.equal(svc.get(other.id), null);
    await svc.restore(snap);
    assert.equal(svc.get(other.id).title, 'Fluig — Dataset');
    assert.deepEqual([...new Set(events)], ['saved', 'removed']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('service: write failure surfaces an error and keeps memory unchanged', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    const n = N.createNote();
    await svc.save({ id: n.id, content: 'v1' });
    svc.store.write = () => Promise.reject(new Error('EACCES: disco sem permissão'));
    await assert.rejects(svc.save({ id: n.id, content: 'v2' }), /EACCES/);
    assert.equal(svc.get(n.id).content, 'v1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('service: tasks aggregate (order, filters), toggleTask and appendTask to the Inbox', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    const a = await svc.create({ title: 'A', content: '- [ ] sem data\n- [ ] urgente @2026-10-01 !1 #x\n- [x] feita', tags: ['proj'] });
    const b = await svc.create({ title: 'B', content: '- [ ] depois @2026-12-01\n```\n- [ ] código\n```' });
    await svc.create({ title: 'Snip', type: 'snippet', content: '- [ ] ignorada' });

    let open = svc.tasks();
    assert.deepEqual(open.map((t) => t.text), ['urgente #x', 'depois', 'sem data']); // vencimento, depois sem data
    assert.equal(open[0].noteId, a.id);
    assert.equal(svc.tasks({ status: 'done' }).length, 1);
    assert.equal(svc.tasks({ status: 'all' }).length, 4);
    assert.deepEqual(svc.tasks({ tag: 'proj' }).map((t) => t.text), ['urgente #x', 'sem data']);
    assert.deepEqual(svc.list().find((n) => n.id === a.id).tasksOpen, 2);

    await svc.toggleTask(a.id, 0);
    assert.match(svc.get(a.id).content, /^- \[x\] sem data/);
    assert.equal(svc.tasks().length, 2);
    await assert.rejects(svc.toggleTask('nope', 0), /não encontrada/);

    await svc.appendTask('revisar PR #42');
    await svc.appendTask('segunda');
    const inbox = svc.get(svc.resolveLink('Inbox'));
    assert.equal(inbox.content, '- [ ] revisar PR #42\n- [ ] segunda\n');
    assert.equal(svc.list().filter((n) => n.title === 'Inbox').length, 1);
    await assert.rejects(svc.appendTask('  '), /vazia/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('service: folders — create, new note in folder, move, rename/move folder, remove + undo, filter', async () => {
  const dir = tmp();
  try {
    const events = [];
    const svc = createNotesService({ dir, broadcast: (e) => events.push(e.type) });
    await svc.init();
    assert.deepEqual(svc.folders(), []);

    await svc.createFolder('Trabalho');
    await svc.createFolder('Trabalho/Fluig');
    await assert.rejects(svc.createFolder('trabalho'), /Já existe/);       // sem diferenciar maiúsculas
    await assert.rejects(svc.createFolder('Nada/Sub'), /não existe/);      // pai inexistente
    await assert.rejects(svc.createFolder('a:b'), /caracteres/);
    await assert.rejects(svc.createFolder('../fora'), /./);
    assert.deepEqual(svc.folders(), [{ path: 'Trabalho', count: 0 }, { path: 'Trabalho/Fluig', count: 0 }]);

    // nota nova dentro de uma pasta; pasta inexistente cai na raiz; nota existente ignora `folder`
    const a = await svc.create({ title: 'A', content: 'a', folder: 'Trabalho/Fluig' });
    const b = await svc.create({ title: 'B', content: 'b', folder: 'Inexistente' });
    assert.equal(a.folder, 'Trabalho/Fluig');
    assert.equal(a.file, 'Trabalho/Fluig/' + a.id + '.md');
    assert.equal(b.folder, '');
    await svc.save({ id: b.id, content: 'b2', folder: 'Trabalho' });
    assert.equal(svc.get(b.id).folder, '');
    assert.ok(existsSync(path.join(dir, 'Trabalho', 'Fluig', a.id + '.md')));

    // filtro por pasta (exato) e resumo
    assert.deepEqual(svc.list({ folder: 'Trabalho/Fluig' }).map((n) => n.id), [a.id]);
    assert.deepEqual(svc.list({ folder: '' }).map((n) => n.id), [b.id]);
    assert.equal(svc.list().find((n) => n.id === a.id).folder, 'Trabalho/Fluig');

    // mover nota
    await svc.moveNote(b.id, 'Trabalho');
    assert.equal(svc.get(b.id).folder, 'Trabalho');
    assert.ok(existsSync(path.join(dir, 'Trabalho', b.id + '.md')) && !existsSync(path.join(dir, b.id + '.md')));
    await assert.rejects(svc.moveNote(b.id, 'Nao/existe'), /não existe/);
    await assert.rejects(svc.moveNote('nope', ''), /não encontrada/);
    await svc.moveNote(b.id, '');
    assert.equal(svc.get(b.id).folder, '');
    // auto-save depois de mover continua no lugar novo
    await svc.save({ id: b.id, content: 'b3' });
    assert.ok(existsSync(path.join(dir, b.id + '.md')));

    // renomear e mover pasta atualizam as notas de dentro
    await svc.renameFolder('Trabalho', 'Work');
    assert.equal(svc.get(a.id).file, 'Work/Fluig/' + a.id + '.md');
    assert.deepEqual(svc.folders().map((f) => f.path), ['Work', 'Work/Fluig']);
    await svc.createFolder('Arquivo');
    await assert.rejects(svc.moveFolder('Work', 'Work/Fluig'), /dentro dela mesma/);
    await assert.rejects(svc.moveFolder('Work', 'Work'), /dentro dela mesma/);
    await svc.moveFolder('Work/Fluig', 'Arquivo');
    assert.equal(svc.get(a.id).file, 'Arquivo/Fluig/' + a.id + '.md');
    assert.deepEqual(svc.list({ folder: 'Arquivo/Fluig' }).map((n) => n.id), [a.id]);
    await assert.rejects(svc.renameFolder('Work', 'a/b'), /caracteres/);
    // salvar depois do rename grava no caminho novo, não recria o antigo
    await svc.save({ id: a.id, content: 'a2' });
    assert.ok(existsSync(path.join(dir, 'Arquivo', 'Fluig', a.id + '.md')) && !existsSync(path.join(dir, 'Work', 'Fluig')));

    // recarregar a pasta reconstrói tudo igual (inclusive pasta vazia)
    await svc.flush();
    const svc2 = createNotesService({ dir });
    await svc2.init();
    assert.deepEqual(svc2.folders().map((f) => [f.path, f.count]), [['Arquivo', 0], ['Arquivo/Fluig', 1], ['Work', 0]]);

    // excluir pasta manda as notas para .trash com a estrutura, e dá para desfazer
    const snap = await svc.removeFolder('Arquivo');
    assert.equal(snap.notes.length, 1);
    assert.deepEqual(snap.folders, ['Arquivo', 'Arquivo/Fluig']);
    assert.equal(svc.get(a.id), null);
    assert.ok(existsSync(path.join(dir, '.trash', 'Arquivo', 'Fluig', a.id + '.md')));
    assert.ok(!existsSync(path.join(dir, 'Arquivo')));
    await svc.restoreFolder(snap);
    assert.equal(svc.get(a.id).file, 'Arquivo/Fluig/' + a.id + '.md');
    assert.ok(svc.folders().some((f) => f.path === 'Arquivo/Fluig' && f.count === 1));
    assert.ok(events.includes('folders'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ─────────────── markdown (bundled with esbuild, as in the app) ─────────────── */
async function loadMarkdown() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({ entryPoints: ['src/notes/markdown.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

test('markdown: code highlight, tasks, tables, wikilinks; raw HTML and js: links are neutralized', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const md = '# T\n\n```sql\nSELECT 1\n```\n\n- [ ] a\n- [x] b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[[Existe]] [[Falta|texto]] <img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.com)';
  const { html, blocks } = renderMarkdown(md, { resolve: (t) => (t === 'Existe' ? 'id' : null) });
  assert.match(html, /<span class="tk-syn-keyword">SELECT<\/span>/);
  assert.deepEqual(blocks, ['SELECT 1']);
  assert.match(html, /data-task="0"(?! checked)/);
  assert.match(html, /data-task="1" checked/);
  assert.match(html, /<table>/);
  assert.match(html, /class="md-wikilink" data-note="Existe"/);
  assert.match(html, /class="md-wikilink is-missing" data-note="Falta"[^>]*>texto</);
  assert.ok(!/<img/.test(html) && html.includes('&lt;img'));
  assert.ok(!/javascript:/.test(html));
  assert.match(html, /<a href="https:\/\/a.com" target="_blank" rel="noreferrer">ok<\/a>/);
});

test('markdown: @date and !1..!3 become chips; lookalikes stay text', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('- [ ] pagar @2020-01-05 !1 ok\n- [ ] email a@2020-01-05 e wow!1');
  assert.match(html, /<span class="md-due is-late" title="Prazo">📅 05\/01<\/span>/);
  assert.match(html, /<span class="md-pri is-p1" title="Prioridade 1">!1<\/span>/);
  assert.equal((html.match(/md-due/g) || []).length, 1);
  assert.equal((html.match(/md-pri/g) || []).length, 1);
});

test('markdown: toggleTask flips the n-th task, skipping code blocks', async () => {
  const { toggleTask } = await loadMarkdown();
  const md = '```\n- [ ] dentro do código\n```\n- [ ] a\n  - [x] b\n1. [ ] c';
  assert.equal(toggleTask(md, 0), md.replace('- [ ] a', '- [x] a'));
  assert.equal(toggleTask(md, 1), md.replace('- [x] b', '- [ ] b'));
  assert.equal(toggleTask(md, 2), md.replace('1. [ ] c', '1. [x] c'));
  assert.equal(toggleTask(md, 9), md);
});
