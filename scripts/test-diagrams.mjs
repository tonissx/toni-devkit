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
const { ddlToMermaid, typeOf } = require('../src/diagrams/ddlToMermaid.js');

const DDL = `
CREATE TABLE dbo.Cliente (Id INT IDENTITY(1,1) PRIMARY KEY, Nome NVARCHAR(100) NOT NULL, Email VARCHAR(200) UNIQUE);
CREATE TABLE dbo.Pedido (Id INT PRIMARY KEY, ClienteId INT NOT NULL, Total DECIMAL(10,2),
  CONSTRAINT FK_Pedido_Cliente FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente(Id));
CREATE TABLE dbo.ItemPedido (PedidoId INT NOT NULL, Linha INT NOT NULL, ProdutoId INT NULL,
  PRIMARY KEY (PedidoId, Linha), FOREIGN KEY (PedidoId) REFERENCES dbo.Pedido(Id));
CREATE TABLE vendas.[Meu Produto] (Id INT PRIMARY KEY);
ALTER TABLE dbo.ItemPedido ADD CONSTRAINT FK_Item_Prod FOREIGN KEY (ProdutoId) REFERENCES vendas.[Meu Produto](Id);
`;

test('ddlToMermaid: relacionamentos com cardinalidade pela nulabilidade e linha pela chave', () => {
  const { code, tables } = ddlToMermaid(DDL);
  assert.equal(tables, 4);
  assert.ok(code.startsWith('erDiagram\n'));
  // FK NOT NULL fora da PK do filho: pai "exatamente um", linha pontilhada
  assert.match(code, /^ {2}Cliente \|\|\.\.o\{ Pedido : "FK_Pedido_Cliente"$/m);
  // FK dentro da PK composta do filho: identificadora (linha cheia)
  assert.match(code, /^ {2}Pedido \|\|--o\{ ItemPedido : /m);
  // FK nulável: pai "zero ou um"; schema não-dbo vira prefixo
  assert.match(code, /^ {2}vendas_Meu_Produto \|o\.\.o\{ ItemPedido : "FK_Item_Prod"$/m);
});

test('ddlToMermaid: colunas com tipo, PK/FK/UK e identity; nome com espaço ganha rótulo', () => {
  const { code } = ddlToMermaid(DDL);
  assert.match(code, /^ {4}int Id PK "identity"$/m);
  assert.match(code, /^ {4}varchar\(200\) Email UK$/m);
  assert.match(code, /^ {4}int PedidoId PK, FK$/m);
  assert.match(code, /^ {4}int ProdutoId FK$/m);
  assert.match(code, /^ {4}decimal\(10_2\) Total$/m); // vírgula não é aceita no tipo do Mermaid
  assert.match(code, /^ {2}vendas_Meu_Produto\["vendas\.Meu Produto"\] \{$/m);
});

test('ddlToMermaid: FK 1:1 usa o| no filho; mesmo nome em schemas diferentes não colide', () => {
  const one = ddlToMermaid('CREATE TABLE a (id INT PRIMARY KEY); CREATE TABLE b (id INT PRIMARY KEY, a_id INT NOT NULL UNIQUE, FOREIGN KEY (a_id) REFERENCES a(id));').code;
  assert.match(one, /^ {2}a \|\|\.\.o\| b : /m);
  const two = ddlToMermaid('CREATE TABLE s1.t (id INT PRIMARY KEY); CREATE TABLE s2.t (id INT PRIMARY KEY);').code;
  assert.ok(two.includes('s1_t["s1.t"] {') && two.includes('s2_t["s2.t"] {'));
});

test('ddlToMermaid: aceita o JSON de metadados, ignora FK para tabela ausente e recusa entrada vazia', () => {
  const sem = ddlToMermaid('CREATE TABLE a (id INT PRIMARY KEY, b_id INT, FOREIGN KEY (b_id) REFERENCES b(id));').code;
  assert.ok(!sem.includes(' : "'), 'sem linha de relacionamento para tabela inexistente');
  assert.throws(() => ddlToMermaid('   '), /Cole o DDL/);
  assert.throws(() => ddlToMermaid('SELECT 1'), /CREATE TABLE/);
  const json = JSON.stringify({ tables: [{ schema: 'dbo', name: 'A', columns: [{ name: 'id', type: 'int', pk: true }] }, { schema: 'dbo', name: 'B', columns: [{ name: 'a_id', type: 'int', nullable: false }] }], fks: [{ name: 'fk_b_a', fromTable: 'B', fromCols: ['a_id'], toTable: 'A', toCols: ['id'] }] });
  assert.match(ddlToMermaid(json).code, /^ {2}A \|\|\.\.o\{ B : "fk_b_a"$/m);
});

test('typeOf: só caracteres aceitos pelo Mermaid; tipo estranho vira unknown', () => {
  assert.equal(typeOf('varchar(50)'), 'varchar(50)');
  assert.equal(typeOf('double precision'), 'double_precision');
  assert.equal(typeOf('decimal(10,2)'), 'decimal(10_2)');
  assert.equal(typeOf(''), 'unknown');
  assert.equal(typeOf('123'), 'unknown');
});

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
  assert.equal(t.fontFamily, 'inherit');  assert.equal(themeFromColors({ bg: '#000', font: 'Geist, sans-serif' }).fontFamily, 'Geist, sans-serif');
});
