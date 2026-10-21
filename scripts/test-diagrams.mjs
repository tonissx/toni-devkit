// Testes de Diagramas (tipo de nota, cena do Excalidraw, integração com Notes): node --test scripts/test-diagrams.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const N = require('../src/notes/note.js');
const { serialize, parse } = require('../src/notes/format.js');
const { createNotesService } = require('../electron/notes/service.js');
const S = require('../src/diagrams/scene.js');

const rect = (id, extra = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: false, ...extra });
const tmp = () => mkdtempSync(path.join(tmpdir(), 'devkit-diagrams-'));

/* ─────────────── tipo de nota ─────────────── */
test("createNote aceita o tipo 'diagram' e cai em 'note' para tipos desconhecidos", () => {
  assert.equal(N.createNote({ type: 'diagram' }).type, 'diagram');
  assert.equal(N.createNote({ type: 'whiteboard' }).type, 'note');
});

/* ─────────────── cena do Excalidraw (src/diagrams/scene.js) ─────────────── */
test('parseScene: vazio vira cena em branco; cena válida volta intacta', () => {
  for (const blank of ['', '   \n', null, undefined]) {
    const r = S.parseScene(blank);
    assert.deepEqual(r.scene.elements, []);
    assert.equal(r.scene.type, 'excalidraw');
    assert.ok(!r.error);
  }
  const text = S.serializeScene([rect('a'), rect('b')], { viewBackgroundColor: '#112233' }, {});
  const r = S.parseScene(text);
  assert.equal(r.scene.elements.length, 2);
  assert.equal(r.scene.appState.viewBackgroundColor, '#112233');
});

test('parseScene: texto que não é uma cena (Mermaid antigo, JSON alheio) devolve erro com o texto original', () => {
  const mermaid = 'erDiagram\n  A ||--o{ B : tem\n';
  const r = S.parseScene(mermaid);
  assert.ok(r.error && !r.scene);
  assert.equal(r.raw, mermaid); // o editor mostra isto e NÃO grava por cima
  assert.ok(S.parseScene('{"foo":1}').error);
  assert.ok(S.parseScene('[1,2]').error);
  assert.ok(S.parseScene('{"type":"excalidraw","elements":"x"}').error);
  assert.ok(!S.parseScene('{"type":"excalidraw"}').error, 'sem elements é tolerado (cena vazia)');
});

test('serializeScene: só elementos vivos, só imagens usadas, só a cor de fundo do appState', () => {
  const els = [rect('a'), rect('b', { isDeleted: true }), { id: 'i1', type: 'image', fileId: 'f1', isDeleted: false }, { id: 'i2', type: 'image', fileId: 'f2', isDeleted: true }];
  const files = { f1: { id: 'f1', dataURL: 'data:image/png;base64,AAA' }, f2: { id: 'f2', dataURL: 'data:image/png;base64,BBB' }, f3: { id: 'f3' } };
  const out = JSON.parse(S.serializeScene(els, { viewBackgroundColor: '#fff', zoom: { value: 3 }, scrollX: 99, selectedElementIds: { a: true } }, files));
  assert.deepEqual(out.elements.map((e) => e.id), ['a', 'i1']);
  assert.deepEqual(Object.keys(out.files), ['f1']);
  assert.deepEqual(out.appState, { viewBackgroundColor: '#fff' });
  assert.equal(out.type, 'excalidraw');
});

test('serializeScene: entradas ausentes não quebram', () => {
  const out = JSON.parse(S.serializeScene(undefined, undefined, undefined));
  assert.deepEqual(out.elements, []);
  assert.equal(out.appState.viewBackgroundColor, '#ffffff');
});

test('sceneIsEmpty ignora elementos apagados', () => {
  assert.ok(S.sceneIsEmpty(S.emptyScene()));
  assert.ok(S.sceneIsEmpty({ elements: [rect('a', { isDeleted: true })] }));
  assert.ok(!S.sceneIsEmpty({ elements: [rect('a')] }));
  assert.ok(S.sceneIsEmpty(null));
});

test('nota de diagrama com a cena sobrevive ao ciclo do arquivo .md (front matter + JSON)', () => {
  const content = S.serializeScene([rect('a', { text: 'linha: com "aspas" e --- traços' })], { viewBackgroundColor: '#fff' }, {});
  const n = N.createNote({ title: 'Quadro', type: 'diagram', content });
  const back = parse(serialize(n));
  assert.equal(back.type, 'diagram');
  assert.equal(JSON.parse(back.content).elements[0].text, 'linha: com "aspas" e --- traços');
  assert.equal(S.parseScene(back.content).scene.elements.length, 1);
});

test('safeFileName: sem caracteres proibidos no Windows, "diagrama" se sobrar nada, no máximo 80 caracteres', () => {
  assert.equal(S.safeFileName('Pedidos: v2? <final>'), 'Pedidos v2 final');
  assert.equal(S.safeFileName('  a/b\\c  '), 'a b c');
  assert.equal(S.safeFileName('???'), 'diagrama');
  assert.equal(S.safeFileName('nome.'), 'nome');
  assert.equal(S.safeFileName(''), 'diagrama');
  assert.equal(S.safeFileName('x'.repeat(200)).length, 80);
});

/* ─────────────── integração com o serviço de Notes ─────────────── */
test('serviço: diagrama tem preview vazio na lista, fica de fora das tarefas e é filtrável por tipo', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    // "- [ ] x" dentro do texto de um elemento não pode virar tarefa; o JSON não pode virar preview
    const content = S.serializeScene([rect('a', { text: '- [ ] tarefa falsa\n- [x] outra' })], {}, {});
    const d = await svc.create({ title: 'Quadro', type: 'diagram', content });
    await svc.create({ title: 'Nota comum', content: '- [ ] tarefa de verdade' });
    const list = svc.list({ type: 'diagram' });
    assert.deepEqual(list.map((x) => x.id), [d.id]);
    assert.equal(list[0].preview, '');
    assert.deepEqual(svc.tasks().map((t) => t.text), ['tarefa de verdade']);
    assert.equal(svc.list().find((x) => x.type === 'note').preview.includes('tarefa de verdade'), true, 'nota comum continua com preview');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ─────────────── ```mermaid voltou a ser um bloco de código comum (bundle com esbuild, como no app) ─────────────── */
async function loadMarkdown() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({ entryPoints: ['src/notes/markdown.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

test('markdown: ```mermaid é um bloco de código comum (com Copiar), sem marcador de diagrama', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html, blocks } = renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```');
  assert.ok(!html.includes('md-mermaid'));
  assert.match(html, /class="md-code"/);
  assert.match(html, /data-copy="0"/);
  assert.deepEqual(blocks, ['flowchart TD\n  A --> B']);
});

/* ─────────────── ![[Diagrama]]: embed dentro do texto de uma nota ─────────────── */
const ids = (t) => (t === 'Diag' || t === 'Fluxo de aprovação' ? 'id-' + t : null); // resolve(): só estes existem

test('embed: ![[Diagrama]] entre textos vira um marcador na posição certa, com o id já resolvido', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('Antes do diagrama.\n\n![[Diag]]\n\nDepois do diagrama.', { resolve: ids, embeds: true });
  assert.match(html, /<span class="md-embed" data-embed="Diag" data-note-id="id-Diag" title="Abrir em Diagramas">/);
  assert.ok(!html.includes('md-wikilink'), 'não vira link comum');
  const i = html.indexOf('Antes do diagrama'), j = html.indexOf('md-embed'), k = html.indexOf('Depois do diagrama');
  assert.ok(i >= 0 && i < j && j < k, 'texto → diagrama → texto');
});

test('embed: legenda com |, e o título com acento e espaço', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('![[Fluxo de aprovação|Fluxo geral]]', { resolve: ids, embeds: true });
  assert.match(html, /data-embed="Fluxo de aprovação" data-note-id="id-Fluxo de aprovação" data-caption="Fluxo geral"/);
  assert.match(html, /Diagrama: Fluxo geral/);
});

test('embed: alvo que não existe vira etiqueta inerte (sem id, sem link que cria nota)', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('![[Inexistente]]', { resolve: ids, embeds: true });
  assert.match(html, /class="md-embed is-missing" data-embed="Inexistente"/);
  assert.ok(!html.includes('data-note-id') && !html.includes('md-wikilink') && !html.includes('data-note="'), 'não pode oferecer "Criar nota"');
});

test('embed: desligado (padrão) o ![[x]] sai como "!" + link, como sempre', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('veja ![[Diag]] aqui', { resolve: ids });
  assert.ok(!html.includes('md-embed'));
  assert.match(html, /!<a href="#" class="md-wikilink" data-note="Diag"/);
});

test('embed: dentro de code fence ou `código inline` não é embed; [[link]] comum e !1 seguem iguais', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const fenced = renderMarkdown('```\n![[Diag]]\n```', { resolve: ids, embeds: true }).html;
  assert.ok(!fenced.includes('md-embed'));
  assert.ok(!renderMarkdown('use `![[Diag]]` assim', { resolve: ids, embeds: true }).html.includes('md-embed'));
  const mixed = renderMarkdown('[[Diag]] e ![[Diag]] - [ ] tarefa !1', { resolve: ids, embeds: true }).html;
  assert.match(mixed, /<a href="#" class="md-wikilink" data-note="Diag"/);
  assert.match(mixed, /class="md-embed"/);
  assert.match(mixed, /class="md-pri is-p1"/);
});

test('embed: o alvo é escapado no HTML', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const { html } = renderMarkdown('![[a"><img src=x onerror=alert(1)>]]', { resolve: () => 'i"d', embeds: true });
  assert.ok(!html.includes('<img'), 'sem HTML injetado');
  assert.ok(!html.includes('data-note-id="i"d"'), 'id escapado');
});

test('embed conta como link: backlinks, grafo e renomear mantêm o ![[…]] conectado (e o "!")', async () => {
  const dir = tmp();
  try {
    const svc = createNotesService({ dir });
    await svc.init();
    const d = await svc.create({ title: 'Fluxo', type: 'diagram', content: S.serializeScene([rect('a')], {}, {}) });
    const doc = await svc.create({ title: 'Documento', content: 'antes\n\n![[Fluxo]]\n\ne depois, veja [[Fluxo]] também' });
    const outra = await svc.create({ title: 'Outra', content: '`![[Fluxo]]` em código não conta' });
    assert.deepEqual(svc.backlinks(d.id).map((x) => x.id), [doc.id], 'só a nota com o embed (e o link), não a de código');
    assert.deepEqual(svc.graph().links.filter((l) => l.target === d.id).map((l) => l.source), [doc.id]);
    await svc.save({ id: d.id, title: 'Fluxo novo' });
    assert.equal(await svc.renameLinks('Fluxo', 'Fluxo novo', d.id), 1);
    assert.equal(svc.get(doc.id).content, 'antes\n\n![[Fluxo novo]]\n\ne depois, veja [[Fluxo novo]] também', 'o "!" do embed é preservado');
    assert.equal(svc.get(outra.id).content, '`![[Fluxo]]` em código não conta');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
