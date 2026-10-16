// Testes do SQL Visualizer — lineage de query (T-SQL): node --test scripts/test-sqlviz-lineage.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Lg = require('../src/db/lineage.js');
const { parseDdl } = require('../src/db/ddl.js');

const node = (g, kind, name) => g.nodes.find((n) => n.kind === kind && (name == null || n.name.toLowerCase() === name.toLowerCase()));
const out = (n) => n.columns.map((c) => c.name);
/** Colunas de origem (nó.coluna) de uma coluna de saída, um nível só. */
const srcOf = (g, n, colName) => {
  const i = n.columns.findIndex((c) => c.name.toLowerCase() === colName.toLowerCase());
  return g.colEdges.filter((e) => e.to.node === n.id && e.to.col === i).map((e) => {
    const f = g.nodes.find((x) => x.id === e.from.node);
    return `${f.name}.${f.columns[e.from.col].name}`;
  }).sort();
};

const Q1 = `SELECT c.Nome, SUM(p.Total) AS TotalPedidos, COUNT(*) n
FROM dbo.Cliente c
INNER JOIN dbo.Pedido p ON p.ClienteId = c.Id
WHERE p.Total > 100 AND c.Ativo = 1
GROUP BY c.Nome
HAVING SUM(p.Total) > 1000
ORDER BY c.Nome`;

test('SELECT com JOIN: origem de cada coluna, tipo e condição do JOIN, filtros e agregações', () => {
  const g = Lg.analyze(Q1);
  const res = node(g, 'result');
  assert.deepEqual(out(res), ['Nome', 'TotalPedidos', 'n']);
  assert.deepEqual(srcOf(g, res, 'Nome'), ['dbo.Cliente.Nome']);
  assert.deepEqual(srcOf(g, res, 'TotalPedidos'), ['dbo.Pedido.Total']);
  assert.equal(res.columns[1].kind, 'agg');
  assert.equal(res.columns[0].kind, 'direct');
  const join = g.edges.find((e) => e.label === 'INNER JOIN');
  assert.equal(join.cond, 'p.ClienteId = c.Id');
  assert.equal(g.nodes.find((n) => n.id === join.from).name, 'dbo.Pedido');
  const lines = Lg.infoLines(res);
  assert.ok(lines.some((l) => l.kind === 'join' && /INNER JOIN p ON p\.ClienteId = c\.Id/.test(l.text)));
  assert.ok(lines.some((l) => l.kind === 'filter' && l.tag === 'WHERE' && /p\.Total > 100 AND c\.Ativo = 1/.test(l.text)));
  assert.ok(lines.some((l) => l.tag === 'HAVING'));
  assert.ok(lines.some((l) => l.kind === 'agg' && /SUM\(p\.Total\)/.test(l.text)));
  assert.ok(lines.some((l) => l.tag === 'GROUP BY' && l.text === 'c.Nome'));
  // colunas das tabelas ficam marcadas pelo uso: Ativo só no filtro, ClienteId só no join
  const cli = node(g, 'table', 'dbo.Cliente');
  assert.deepEqual(cli.columns.find((c) => c.name === 'Ativo').flags, ['filter']);
  assert.ok(node(g, 'table', 'dbo.Pedido').columns.find((c) => c.name === 'ClienteId').flags.includes('join'));
});

test('CTEs encadeadas: tabela → CTE → resultado, rastreando por trás de expressões', () => {
  const g = Lg.analyze(`WITH a AS (SELECT Id, Nome FROM dbo.Cliente WHERE Ativo = 1),
    b AS (SELECT ClienteId, SUM(Total) AS Tot FROM dbo.Pedido GROUP BY ClienteId)
    SELECT a.Nome, b.Tot, UPPER(a.Nome) AS Maiusc FROM a LEFT JOIN b ON b.ClienteId = a.Id`);
  const res = node(g, 'result');
  assert.deepEqual(out(node(g, 'cte', 'a')), ['Id', 'Nome']);
  assert.deepEqual(srcOf(g, res, 'Tot'), ['b.Tot']);
  assert.deepEqual(srcOf(g, res, 'Maiusc'), ['a.Nome']);
  assert.equal(g.edges.find((e) => e.label === 'LEFT JOIN').cond, 'b.ClienteId = a.Id');
  // clicar em "Tot" do resultado: sobe até Pedido.Total passando por b
  const i = res.columns.findIndex((c) => c.name === 'Tot');
  const up = Lg.upstream(g, res.id, i);
  const names = [...up.cols].map((k) => { const [id, c] = k.split(':'); const n = g.nodes.find((x) => x.id === id); return `${n.name}.${n.columns[c].name}`; }).sort();
  assert.deepEqual(names, ['b.Tot', 'dbo.Pedido.Total', 'Resultado.Tot'].sort());
  assert.ok(!names.includes('dbo.Cliente.Nome')); // o que não participa não é destacado
});

test('tabela derivada, SELECT * sobre CTE/derivada e alias sem AS', () => {
  const g = Lg.analyze('SELECT x.* FROM (SELECT Nome n, Id FROM dbo.Cliente) x');
  const res = node(g, 'result');
  assert.deepEqual(out(res), ['n', 'Id']);
  assert.deepEqual(srcOf(g, res, 'n'), ['subconsulta.n'.replace('subconsulta', 'x')]);
  const g2 = Lg.analyze('SELECT total = SUM(p.Total), p.ClienteId FROM dbo.Pedido p GROUP BY p.ClienteId');
  assert.deepEqual(out(node(g2, 'result')), ['total', 'ClienteId']); // alias = expressão do T-SQL
  assert.equal(node(g2, 'result').columns[0].kind, 'agg');
});

test('UNION: cada ramo alimenta a coluna de mesma posição', () => {
  const g = Lg.analyze('SELECT a.Id AS k, a.Nome FROM dbo.A a UNION ALL SELECT b.Codigo, b.Descr FROM dbo.B b');
  const res = node(g, 'result');
  assert.deepEqual(out(res), ['k', 'Nome']);
  assert.equal(g.nodes.filter((n) => n.kind === 'branch').length, 2);
  const up = Lg.upstream(g, res.id, 0);
  const names = [...up.cols].map((k) => { const [id, c] = k.split(':'); const n = g.nodes.find((x) => x.id === id); return `${n.name}.${n.columns[c].name}`; });
  assert.ok(names.includes('dbo.A.Id') && names.includes('dbo.B.Codigo'));
  assert.ok(!names.includes('dbo.B.Descr'));
  assert.ok(g.edges.some((e) => e.label === 'UNION ALL'));
});

test('subconsultas: escalar correlacionada (na lista) e EXISTS / IN (no filtro)', () => {
  const g = Lg.analyze(`SELECT c.Nome, (SELECT MAX(p.Total) FROM dbo.Pedido p WHERE p.ClienteId = c.Id) AS Maior
    FROM dbo.Cliente c WHERE EXISTS (SELECT 1 FROM dbo.Fatura f WHERE f.ClienteId = c.Id) AND c.Id IN (SELECT ClienteId FROM dbo.Vip)`);
  const res = node(g, 'result');
  assert.deepEqual(srcOf(g, res, 'Maior'), ['subconsulta.MAX(p.Total)']);
  assert.ok(node(g, 'table', 'dbo.Fatura') && node(g, 'table', 'dbo.Vip'));
  // a correlação com c.Id marca a coluna de Cliente como usada em filtro/join
  assert.ok(node(g, 'table', 'dbo.Cliente').columns.find((c) => c.name === 'Id'));
  assert.equal(g.edges.filter((e) => e.label === 'subconsulta' || e.label === 'WHERE').length, 3);
});

test('CROSS APPLY enxerga o alias da esquerda; JOIN ON com várias tabelas', () => {
  const g = Lg.analyze(`SELECT c.Nome, t.Total FROM dbo.Cliente c
    CROSS APPLY (SELECT TOP 1 p.Total FROM dbo.Pedido p WHERE p.ClienteId = c.Id ORDER BY p.Id DESC) t`);
  const res = node(g, 'result');
  assert.deepEqual(srcOf(g, res, 'Total'), ['t.Total']);
  assert.ok(g.edges.some((e) => e.label === 'CROSS APPLY'));
  const sub = node(g, 'subquery', 't');
  assert.equal(sub.info.top, 'TOP 1');
});

test('sem schema: coluna sem alias com 2 tabelas é ambígua e avisa; com schema resolve certinho', () => {
  const sql = 'SELECT Nome, Total FROM dbo.Cliente c JOIN dbo.Pedido p ON p.ClienteId = c.Id';
  const g = Lg.analyze(sql);
  assert.ok(g.warnings.some((w) => /Nome/.test(w) && /sem alias/.test(w)));
  assert.ok(g.colEdges.some((e) => e.ambiguous));
  const schema = parseDdl('CREATE TABLE dbo.Cliente (Id int primary key, Nome varchar(50), Ativo bit); CREATE TABLE dbo.Pedido (Id int primary key, ClienteId int, Total decimal(18,2));');
  const g2 = Lg.analyze(sql, { schema });
  assert.deepEqual(g2.warnings, []);
  assert.deepEqual(srcOf(g2, node(g2, 'result'), 'Nome'), ['dbo.Cliente.Nome']);
  assert.deepEqual(srcOf(g2, node(g2, 'result'), 'Total'), ['dbo.Pedido.Total']);
  // SELECT * expande com o schema
  const g3 = Lg.analyze('SELECT * FROM dbo.Cliente', { schema });
  assert.deepEqual(out(node(g3, 'result')), ['Id', 'Nome', 'Ativo']);
  const g4 = Lg.analyze('SELECT * FROM dbo.Cliente');
  assert.deepEqual(out(node(g4, 'result')), ['*']);
  assert.ok(g4.warnings.some((w) => /SELECT \*/.test(w)));
});

test('script: SELECT INTO #temp reaproveitada, INSERT … SELECT vira destino, GO separa lotes', () => {
  const g = Lg.analyze(`SELECT c.Id, c.Nome INTO #base FROM dbo.Cliente c
GO
INSERT INTO dbo.Resumo (Cod, Nm) SELECT b.Id, b.Nome FROM #base b WHERE b.Id > 10
GO
SELECT * FROM #base`);
  const base = node(g, 'temp', '#base');
  assert.deepEqual(out(base), ['Id', 'Nome']);
  const alvo = node(g, 'target', 'dbo.Resumo');
  assert.deepEqual(out(alvo), ['Cod', 'Nm']); // nomes da lista de colunas do INSERT
  assert.deepEqual(srcOf(g, alvo, 'Cod'), ['#base.Id']);
  assert.equal(g.nodes.filter((n) => n.kind === 'temp').length, 1); // a #base é uma só, reutilizada
  const last = g.nodes.filter((n) => n.kind === 'result').pop();
  assert.deepEqual(out(last), ['Id', 'Nome']); // * expandido pelo que a #temp produz
});

test('CTE recursiva não gera laço infinito', () => {
  const g = Lg.analyze('WITH r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT n FROM r');
  assert.ok(node(g, 'cte', 'r'));
  assert.ok(g.notes.some((n) => /recursiva/.test(n)));
  assert.doesNotThrow(() => Lg.layoutLineage(g));
});

test('pré-processamento: GO, OPTION, WITHIN GROUP, TRY_CAST, EXCEPT, WITH TIES — e texto de string/identificador fica intacto', () => {
  const p = Lg.preprocess("SELECT TOP 5 WITH TIES TRY_CAST(a AS int) x, STRING_AGG(n, ',') WITHIN GROUP (ORDER BY n) s FROM t WHERE nome = 'OPTION (x) EXCEPT GO' AND [OPTION] = 1 OPTION (RECOMPILE)\nGO\nSELECT a FROM t EXCEPT SELECT a FROM u");
  assert.doesNotMatch(p.sql, /WITH TIES|WITHIN GROUP|TRY_CAST|OPTION \(RECOMPILE\)|EXCEPT SELECT/);
  assert.match(p.sql, /'OPTION \(x\) EXCEPT GO'/); // dentro de string: intacto
  assert.match(p.sql, /\[OPTION\]/);
  assert.match(p.sql, /CAST\(a AS int\)/);
  assert.match(p.sql, /UNION SELECT a FROM u/);
  assert.ok(p.notes.length >= 5);
  const g = Lg.analyze("SELECT TOP 5 WITH TIES TRY_CAST(a AS int) x FROM t OPTION (MAXDOP 1)");
  assert.deepEqual(out(node(g, 'result')), ['x']);
  assert.ok(g.notes.some((n) => /TRY_CAST/.test(n)));
  const g2 = Lg.analyze('SELECT a FROM t1 EXCEPT SELECT a FROM t2');
  assert.equal(g2.nodes.filter((n) => n.kind === 'branch').length, 2);
});

test('colunas e tabelas com colchetes, espaços, schema e três partes', () => {
  const g = Lg.analyze('SELECT t.[Nome Completo] AS [Nome do Cliente] FROM [Vendas].[dbo].[Cliente Final] AS t');
  const res = node(g, 'result');
  assert.deepEqual(out(res), ['Nome do Cliente']);
  assert.match(srcOf(g, res, 'Nome do Cliente')[0], /Nome Completo$/);
});

test('erros claros em pt-BR, sem lançar coisa estranha', () => {
  assert.throws(() => Lg.analyze('   '), /Cole uma query/);
  assert.throws(() => Lg.analyze('SELEC a FRM'), /Não consegui interpretar o SQL/);
  assert.throws(() => Lg.analyze('MERGE dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN MATCHED THEN DELETE;'), /MERGE ainda não/);
  assert.throws(() => Lg.analyze("UPDATE dbo.T SET a = 1"), /Nada para mostrar/);
  assert.throws(() => Lg.analyze('DECLARE @a int = 1'), /Nada para mostrar/);
  // um UPDATE no meio de um script não derruba o resto
  const g = Lg.analyze('UPDATE dbo.T SET a = 1; SELECT a FROM dbo.T');
  assert.ok(g.notes.some((n) => /UPDATE ignorado/.test(n)));
});

test('segurança: texto hostil nos nomes é só dado (o React escapa); nada é executado', () => {
  const g = Lg.analyze('SELECT [<img src=x onerror=alert(1)>] AS [<script>] FROM [x"y].[t&1]');
  const res = node(g, 'result');
  assert.equal(res.columns[0].name, '<script>');
  assert.ok(g.nodes.some((n) => n.name.includes('<img') || n.columns.some((c) => c.name.includes('<img'))));
});

test('layout: camadas da esquerda para a direita, sem sobreposição; colCenterY cai dentro da caixa', () => {
  const g = Lg.analyze(Q1);
  const lay = Lg.layoutLineage(g);
  const res = node(g, 'result'), cli = node(g, 'table', 'dbo.Cliente');
  assert.ok(lay.pos[cli.id].x < lay.pos[res.id].x);
  const boxes = Object.values(lay.pos);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.equal(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, false);
  }
  const y = Lg.colCenterY(g, lay.pos, res.id, 1);
  assert.ok(y > lay.pos[res.id].y && y < lay.pos[res.id].y + lay.pos[res.id].h);
});

test('escala: 80 CTEs encadeadas e 150 colunas analisadas e posicionadas rápido', () => {
  const cols = Array.from({ length: 150 }, (_, i) => `c${i}`).join(', ');
  let sql = `WITH s0 AS (SELECT ${cols} FROM dbo.Big)`;
  for (let i = 1; i < 80; i++) sql += `, s${i} AS (SELECT ${cols} FROM s${i - 1} WHERE c0 > ${i})`;
  sql += ' SELECT c1, c149 FROM s79';
  const t0 = Date.now();
  const g = Lg.analyze(sql);
  const lay = Lg.layoutLineage(g);
  assert.equal(g.nodes.filter((n) => n.kind === 'cte').length, 80);
  assert.equal(Object.keys(lay.pos).length, g.nodes.length);
  assert.ok(Date.now() - t0 < 3000, `demorou ${Date.now() - t0} ms`);
  const res = node(g, 'result');
  const up = Lg.upstream(g, res.id, 0);
  assert.ok(up.nodes.size >= 81); // sobe por toda a cadeia até dbo.Big
});
