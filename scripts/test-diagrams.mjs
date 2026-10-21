// Testes de Diagramas (tipo de nota, formato): node --test scripts/test-diagrams.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const N = require('../src/notes/note.js');
const { serialize, parse } = require('../src/notes/format.js');

const ER = 'erDiagram\n  USER ||--o{ ORDER : faz\n';

test("createNote aceita o tipo 'diagram' e cai em 'note' para tipos desconhecidos", () => {
  assert.equal(N.createNote({ type: 'diagram' }).type, 'diagram');
  assert.equal(N.createNote({ type: 'whiteboard' }).type, 'note');
});

test('diagrama sobrevive ao ciclo serialize → parse com o texto Mermaid intacto', () => {
  const n = N.createNote({ title: 'Pedidos', type: 'diagram', content: ER, tags: ['er', 'Vendas'] });
  const back = parse(serialize(n));
  assert.equal(back.type, 'diagram');
  assert.equal(back.title, 'Pedidos');
  assert.equal(back.content.trim(), ER.trim());
  assert.deepEqual(back.tags, ['er', 'vendas']);
});

const { themeFromColors } = require('../src/diagrams/theme.js');
const { TEMPLATES, fromTemplate, diagramKind } = require('../src/diagrams/templates.js');
const { viewBoxOf, standaloneSvg, safeFileName } = require('../src/diagrams/svg.js');

const MERMAID_SVG = '<svg id="dgm-svg-1" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="-8 -4 200.5 100" style="max-width: 200.5px;" role="graphics-document"><g/></svg>';

test('viewBoxOf lê origem e tamanho; sem viewBox devolve null', () => {
  assert.deepEqual(viewBoxOf(MERMAID_SVG), { x: -8, y: -4, w: 200.5, h: 100 });
  assert.equal(viewBoxOf('<svg></svg>'), null);
});

test('standaloneSvg: tamanho em px, sem max-width, fundo do tema por baixo de tudo', () => {
  const out = standaloneSvg(MERMAID_SVG, '#0E0E10');
  assert.match(out, /^<svg width="201" height="100" id="dgm-svg-1"/);
  assert.ok(!/width="100%"/.test(out) && !/max-width/.test(out));
  assert.ok(out.includes('<rect x="-8" y="-4" width="200.5" height="100" fill="#0E0E10"/><g/>'), 'fundo antes do conteúdo');
  assert.ok(out.endsWith('</svg>'));
});

test('standaloneSvg: garante xmlns e devolve o original se não for um SVG com viewBox', () => {
  assert.match(standaloneSvg('<svg viewBox="0 0 10 10"><g/></svg>', null), /^<svg width="10" height="10" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 10 10">/);
  assert.equal(standaloneSvg('<svg><g/></svg>', '#000'), '<svg><g/></svg>');
  assert.equal(standaloneSvg('', '#000'), '');
});

test('safeFileName tira caracteres proibidos no Windows e cai em "diagrama"', () => {
  assert.equal(safeFileName('Pedidos: v2? <final>'), 'Pedidos v2 final');
  assert.equal(safeFileName('  a/b\\c  '), 'a b c');
  assert.equal(safeFileName('???'), 'diagrama');
  assert.equal(safeFileName('nome.'), 'nome');
  assert.equal(safeFileName(''), 'diagrama');
  assert.equal(safeFileName('x'.repeat(200)).length, 80);
});

test('todo template vira uma nota de diagrama e começa com um tipo Mermaid reconhecido', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids, ['er', 'flow', 'sequence', 'state']);
  for (const id of ids) {
    const f = fromTemplate(id);
    assert.equal(f.type, 'diagram');
    assert.ok(f.title);
    assert.ok(diagramKind(f.content), `template ${id} sem tipo reconhecido`);
  }
  assert.equal(fromTemplate('inexistente').title, TEMPLATES[0].title);
});

test('diagramKind ignora comentários e linhas em branco', () => {
  assert.equal(diagramKind('%% nota\n\n  flowchart LR\n A-->B'), 'flowchart');
  assert.equal(diagramKind('stateDiagram-v2\n[*] --> A'), 'stateDiagram-v2');
  assert.equal(diagramKind('qualquer coisa'), '');
  assert.equal(diagramKind(''), '');
});

test('themeFromColors usa as cores do DS e liga o modo escuro', () => {
  const t = themeFromColors({ bg: '#000', node: '#111', border: '#222', text: '#fff', dim: '#888', accent: '#0f0', key: '#0ff' });
  assert.equal(t.darkMode, true);
  assert.equal(t.background, '#000');
  assert.equal(t.primaryColor, '#111');
  assert.equal(t.primaryTextColor, '#fff');
  assert.equal(t.lineColor, '#888');
  assert.equal(t.noteBorderColor, '#0f0');
  assert.equal(t.fontFamily, 'inherit');
  assert.equal(themeFromColors({ bg: '#000', font: 'Geist, sans-serif' }).fontFamily, 'Geist, sans-serif');
});
