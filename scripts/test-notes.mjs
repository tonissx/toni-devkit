// Testes de Notes (domínio, formato, busca, persistência, serviço): node --test scripts/test-notes.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const N = require('../src/notes/note.js');
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

test('markdown: toggleTask flips the n-th task, skipping code blocks', async () => {
  const { toggleTask } = await loadMarkdown();
  const md = '```\n- [ ] dentro do código\n```\n- [ ] a\n  - [x] b\n1. [ ] c';
  assert.equal(toggleTask(md, 0), md.replace('- [ ] a', '- [x] a'));
  assert.equal(toggleTask(md, 1), md.replace('- [x] b', '- [ ] b'));
  assert.equal(toggleTask(md, 2), md.replace('1. [ ] c', '1. [x] c'));
  assert.equal(toggleTask(md, 9), md);
});
