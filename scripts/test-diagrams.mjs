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

test('themeFromColors usa as cores do DS e liga o modo escuro', () => {
  const t = themeFromColors({ bg: '#000', node: '#111', border: '#222', text: '#fff', dim: '#888', accent: '#0f0', key: '#0ff' });
  assert.equal(t.darkMode, true);
  assert.equal(t.background, '#000');
  assert.equal(t.primaryColor, '#111');
  assert.equal(t.primaryTextColor, '#fff');
  assert.equal(t.lineColor, '#888');
  assert.equal(t.noteBorderColor, '#0f0');
});
