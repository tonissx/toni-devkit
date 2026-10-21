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
