// Testes do SQL Visualizer — diagrama ER (DDL, metadados, layout, DBML): node --test scripts/test-sqlviz-er.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseDdl } = require('../src/db/ddl.js');
const S = require('../src/db/schema.js');
const { layoutEr, toDbml } = require('../src/db/erlayout.js');
const Q = require('../src/db/queries.js');

const DDL = `
-- Vendas
CREATE TABLE [dbo].[Cliente] (
  [Id] INT IDENTITY(1,1) NOT NULL,
  [Nome] NVARCHAR(100) NOT NULL, /* razão social */
  [Email] VARCHAR(200) NULL UNIQUE,
  CONSTRAINT [PK_Cliente] PRIMARY KEY CLUSTERED ([Id] ASC)
);
GO
CREATE TABLE dbo.Pedido (
  Id int NOT NULL PRIMARY KEY,
  ClienteId int NOT NULL,
  Total decimal(18,2) NOT NULL DEFAULT (0),
  Obs nvarchar(max)
);
CREATE TABLE dbo.PedidoItem (
  PedidoId int NOT NULL,
  Linha int NOT NULL,
  ProdutoId int NULL REFERENCES dbo.Produto (Id),
  CONSTRAINT PK_PedidoItem PRIMARY KEY (PedidoId, Linha)
);
CREATE TABLE dbo.Produto (Id int primary key, "Descrição" varchar(50) not null);
CREATE TABLE dbo.PedidoExtra (PedidoId int NOT NULL UNIQUE);
ALTER TABLE dbo.Pedido WITH CHECK ADD CONSTRAINT FK_Pedido_Cliente FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente (Id);
ALTER TABLE [dbo].[PedidoItem] ADD CONSTRAINT [FK_Item_Pedido] FOREIGN KEY ([PedidoId]) REFERENCES [dbo].[Pedido] ([Id]);
ALTER TABLE dbo.PedidoExtra ADD CONSTRAINT FK_Extra FOREIGN KEY (PedidoId) REFERENCES dbo.Pedido (Id);
ALTER TABLE dbo.Pedido ADD CONSTRAINT FK_Fantasma FOREIGN KEY (ClienteId) REFERENCES dbo.NaoExiste (Id);
CREATE INDEX IX_x ON dbo.Pedido (ClienteId);
`;

test('DDL: tabelas, colunas, tipos, PK e nullability', () => {
  const m = parseDdl(DDL);
  assert.deepEqual(m.tables.map((t) => t.id), ['dbo.Cliente', 'dbo.Pedido', 'dbo.PedidoItem', 'dbo.Produto', 'dbo.PedidoExtra']);
  const cli = m.tables[0];
  assert.deepEqual(cli.pk, ['Id']);
  assert.equal(cli.columns[0].identity, true);
  assert.equal(cli.columns[1].type, 'nvarchar(100)');
  assert.equal(cli.columns[2].nullable, true);
  assert.equal(cli.columns[2].unique, true);
  const ped = m.tables[1];
  assert.deepEqual(ped.pk, ['Id']);
  assert.equal(ped.columns.find((c) => c.name === 'Total').type, 'decimal(18,2)');
  assert.equal(ped.columns.find((c) => c.name === 'Obs').type, 'nvarchar(max)');
  assert.deepEqual(m.tables[2].pk, ['PedidoId', 'Linha']); // composta
  assert.equal(m.tables[3].columns[1].name, 'Descrição'); // identificador entre aspas
});

test('DDL: FKs (inline, ALTER, composta) e cardinalidade', () => {
  const m = parseDdl(DDL);
  const by = (n) => m.fks.find((f) => f.name === n);
  assert.equal(m.fks.length, 4);
  assert.deepEqual([by('FK_Pedido_Cliente').from, by('FK_Pedido_Cliente').to], ['dbo.Pedido', 'dbo.Cliente']);
  assert.equal(by('FK_Pedido_Cliente').oneToOne, false);
  assert.equal(by('FK_Extra').oneToOne, true); // coluna UNIQUE
  assert.deepEqual(by('FK_Item_Pedido').toCols, ['Id']);
  assert.ok(m.fks.some((f) => f.from === 'dbo.PedidoItem' && f.to === 'dbo.Produto')); // inline REFERENCES
  assert.equal(m.tables[1].columns.find((c) => c.name === 'ClienteId').fk, true);
  assert.ok(m.warnings.some((w) => w.includes('NaoExiste'))); // FK para tabela ausente vira aviso, não quebra
});

test('DDL: entrada vazia ou sem CREATE TABLE dá erro claro em pt-BR', () => {
  assert.throws(() => parseDdl('   '), /Cole o DDL/);
  assert.throws(() => parseDdl('SELECT 1'), /Nenhum CREATE TABLE/);
  assert.doesNotThrow(() => parseDdl('CREATE TABLE t (a int, b varchar(10'));
});

test('metadados JSON: lê o formato da SCHEMA_QUERY, inclusive em pedaços', () => {
  const json = {
    tables: [
      { schema: 'dbo', name: 'A', columns: [{ name: 'Id', type: 'int', nullable: false, identity: true, pk: 1 }, { name: 'X', type: 'varchar(5)', nullable: true, pk: 0 }] },
      { schema: 'fin', name: 'B', columns: [{ name: 'Id', type: 'int', nullable: false, pk: 1 }, { name: 'AId', type: 'int', nullable: true, pk: 0 }] },
    ],
    fks: [{ name: 'FK_B_A', fromSchema: 'fin', fromTable: 'B', fromCols: ['AId'], toSchema: 'dbo', toTable: 'A', toCols: ['Id'] }],
  };
  const m = S.fromMetadata(JSON.stringify(json));
  assert.deepEqual(m.tables.map((t) => t.id), ['dbo.A', 'fin.B']);
  assert.deepEqual(m.fks[0], { name: 'FK_B_A', from: 'fin.B', fromCols: ['AId'], to: 'dbo.A', toCols: ['Id'], oneToOne: false });
  const txt = JSON.stringify(json);
  const chunks = [txt.slice(0, 50), txt.slice(50, 120), txt.slice(120)].map((p) => ({ 'JSON_F52E2B61': p }));
  assert.equal(S.fromMetadata(chunks).tables.length, 2);
  assert.equal(S.parseSchemaInput(txt).fks.length, 1); // autodetecção
  assert.equal(S.parseSchemaInput(DDL).tables.length, 5);
  assert.throws(() => S.fromMetadata('{oops'), /JSON inválido/);
  assert.throws(() => S.fromMetadata('{"a":1}'), /tables/);
});

test('SCHEMA_QUERY: só catálogo, sem dados de tabela e sem escrita', () => {
  assert.match(Q.SCHEMA_QUERY, /sys\.tables/);
  assert.match(Q.SCHEMA_QUERY, /sys\.foreign_keys/);
  assert.doesNotMatch(Q.SCHEMA_QUERY, /\b(INSERT|UPDATE|DELETE|DROP|EXEC)\b/i);
});

test('vizinhas e subconjunto por FK', () => {
  const m = parseDdl(DDL);
  assert.deepEqual([...S.neighbors(m, 'dbo.Pedido')].sort(), ['dbo.Cliente', 'dbo.PedidoExtra', 'dbo.PedidoItem']);
  assert.equal(S.expand(m, 'dbo.Cliente', 1).size, 2);
  assert.equal(S.expand(m, 'dbo.Cliente', 2).size, 4);
  const sub = S.subset(m, ['dbo.Cliente', 'dbo.Pedido']);
  assert.equal(sub.tables.length, 2);
  assert.equal(sub.fks.length, 1);
});

test('layout: pais à esquerda dos filhos, sem sobreposição, ciclo tolerado', () => {
  const m = parseDdl(DDL);
  const L = layoutEr(m);
  assert.ok(L.nodes['dbo.Cliente'].x < L.nodes['dbo.Pedido'].x);
  assert.ok(L.nodes['dbo.Pedido'].x < L.nodes['dbo.PedidoItem'].x);
  const boxes = Object.values(L.nodes);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(overlap, false);
  }
  const cyc = parseDdl('CREATE TABLE a (id int primary key, b_id int); CREATE TABLE b (id int primary key, a_id int);'
    + 'ALTER TABLE a ADD CONSTRAINT f1 FOREIGN KEY (b_id) REFERENCES b (id); ALTER TABLE b ADD CONSTRAINT f2 FOREIGN KEY (a_id) REFERENCES a (id);');
  assert.equal(Object.keys(layoutEr(cyc).nodes).length, 2);
});

test('DBML: tabelas, atributos e Refs (> = N:1, - = 1:1), nomes estranhos entre aspas', () => {
  const dbml = toDbml(parseDdl(DDL));
  assert.match(dbml, /Table Cliente \{\n  Id int \[pk, increment\]/);
  assert.match(dbml, /Nome nvarchar\(100\) \[not null\]/);
  assert.match(dbml, /Email varchar\(200\) \[unique\]/);
  assert.match(dbml, /"Descrição" varchar\(50\)/);
  assert.match(dbml, /indexes \{\n    \(PedidoId, Linha\) \[pk\]/);
  assert.match(dbml, /Ref FK_Pedido_Cliente: Pedido\.ClienteId > Cliente\.Id/);
  assert.match(dbml, /Ref FK_Extra: PedidoExtra\.PedidoId - Pedido\.Id/);
});

test('escala: 600 tabelas em cadeia/árvore sem estourar a pilha nem demorar', () => {
  const tables = [], fks = [];
  for (let i = 0; i < 600; i++) {
    tables.push({ id: `dbo.T${i}`, schema: 'dbo', name: `T${i}`, columns: [{ name: 'Id', type: 'int', nullable: false, pk: true }, { name: 'PaiId', type: 'int', nullable: true }], pk: ['Id'] });
    if (i) fks.push({ name: `FK${i}`, from: `dbo.T${i}`, fromCols: ['PaiId'], to: `dbo.T${i - 1}`, toCols: ['Id'], oneToOne: false });
  }
  const t0 = Date.now();
  const L = layoutEr({ tables, fks });
  assert.equal(Object.keys(L.nodes).length, 600);
  assert.ok(Date.now() - t0 < 2000);
});

test('SVG exportado: escapa nomes (anti-injeção) e inclui todas as tabelas e FKs', async () => {
  const { erToSvg } = await import('../src/tools/sqlviz/erExport.js');
  const m = parseDdl('CREATE TABLE [x<script>alert(1)</script>] ([a"b] int primary key, c int); CREATE TABLE y (id int primary key, x int references [x<script>alert(1)</script>] ([a"b]));');
  const L = layoutEr(m);
  const colors = { bg: '#000', box: '#111', head: '#222', border: '#333', edge: '#444', text: '#eee', dim: '#999', pk: '#fc0', fk: '#0c6' };
  const { svg, width, height } = erToSvg(m, L.nodes, colors);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /x&lt;script&gt;/);
  assert.match(svg, /a&quot;b/);
  assert.equal((svg.match(/<path d="M[\d.]+ [\d.]+ C/g) || []).length, 1); // uma FK
  assert.ok(width > 0 && height > 0);
});

test('schemaQueryIn: nome do banco escapado, aspas do texto interno dobradas', () => {
  const sql = Q.schemaQueryIn("a]b'c");
  assert.match(sql, /EXEC \[a\]\]b'c\]\.sys\.sp_executesql N'/);
  const inner = sql.slice(sql.indexOf("N'") + 2, sql.lastIndexOf("'"));
  assert.equal(inner.replace(/''/g, "'"), Q.SCHEMA_QUERY); // só dobrou aspas; texto interno intacto
  assert.match(Q.SCHEMA_QUERY, /AS \[json\];$/); // o JSON sai numa célula só, não em pedaços
});

test('FK liga coluna a coluna: a aresta sai da linha da coluna FK e chega à da PK, com a mesma cor', async () => {
  const { fkGeom, linkedColumns, erToSvg } = await import('../src/tools/sqlviz/erExport.js');
  const { ER, colY, fkColor } = require('../src/db/erlayout.js');
  const m = parseDdl(DDL);
  const L = layoutEr(m);
  const byId = new Map(m.tables.map((t) => [t.id, t]));
  const f = m.fks.find((x) => x.name === 'FK_Pedido_Cliente'); // Pedido.ClienteId → Cliente.Id
  const g = fkGeom(f, L.nodes, (id) => byId.get(id));
  const ped = L.nodes['dbo.Pedido'], cli = L.nodes['dbo.Cliente'];
  const rowTop = (n, i) => n.y + ER.head + ER.pad + i * ER.row;
  assert.equal(g.p.y1, rowTop(ped, 1) + ER.row / 2); // ClienteId é a 2ª coluna do Pedido
  assert.equal(g.p.y2, rowTop(cli, 0) + ER.row / 2); // Id é a 1ª do Cliente
  assert.equal(colY(ped, byId.get('dbo.Pedido'), 'NaoExiste'), ped.y + ER.head / 2); // coluna desconhecida → cabeçalho
  // PK e FK da mesma ligação compartilham a cor; FKs diferentes têm cores diferentes
  const links = linkedColumns(m);
  assert.equal(links.get('dbo.Pedido').get('ClienteId'), links.get('dbo.Cliente').get('Id'));
  assert.equal(links.get('dbo.Cliente').get('Id'), fkColor('FK_Pedido_Cliente'));
  assert.notEqual(fkColor('FK_Pedido_Cliente'), fkColor('FK_Item_Pedido'));
  // o SVG exportado leva a cor da FK na aresta e na faixa das colunas
  const colors = { bg: '#000', box: '#111', head: '#222', border: '#333', edge: '#444', text: '#eee', dim: '#999', pk: '#fc0', fk: '#0c6' };
  const { svg } = erToSvg(m, L.nodes, colors);
  assert.ok(svg.split(fkColor('FK_Pedido_Cliente')).length > 5); // aresta + 2 pontas + 2 faixas (×2 rects)
});
