// Testes do SQL Visualizer — plano de execução (.sqlplan colado/arquivo): node --test scripts/test-sqlviz-plan.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parsePlan, analyze, decodePlan } = require('../src/db/showplan.js');

// O exemplo embutido na tela é o plano real de teste (Scan em tabela grande, Sort com spill, estimativa errada, índice faltando).
const src = fs.readFileSync(new URL('../src/tools/sqlviz/PlanTab.jsx', import.meta.url), 'utf8');
const SAMPLE = src.match(/const SAMPLE = `([\s\S]*?)`;/)[1];

test('exemplo embutido: parseia como plano real com 4 operadores', () => {
  const r = parsePlan(SAMPLE);
  assert.ok(r.statements, r.error);
  const s = r.statements[0];
  assert.equal(s.isActual, true);
  assert.equal(s.nodes.length, 4);
  assert.equal(s.cost, 12.5);
  assert.deepEqual(s.nodes.map((n) => n.label), ['Sort', 'Nested Loops', 'Clustered Index Scan', 'Clustered Index Seek']);
});

test('custo relativo (%) e operador mais caro', () => {
  const s = parsePlan(SAMPLE).statements[0];
  const an = analyze(s);
  assert.equal(an.top[0].label, 'Clustered Index Scan'); // custo próprio 8,7
  assert.equal(Math.round(an.top[0].costPct), 70);
  const pctSum = s.nodes.reduce((a, n) => a + n.costPct, 0);
  assert.ok(pctSum > 95 && pctSum <= 100.5, 'soma dos % próprios perto de 100: ' + pctSum);
});

test('linhas estimadas × reais e espessura: guarda os dois valores por operador', () => {
  const s = parsePlan(SAMPLE).statements[0];
  const scan = s.nodes[2];
  assert.equal(scan.estRows, 120);
  assert.equal(scan.runtime.rows, 48000);
  assert.equal(scan.runtime.rowsRead, 2000000);
});

test('destaques: scan grande, spill, estimativa errada, índice faltante com CREATE INDEX', () => {
  const an = analyze(parsePlan(SAMPLE).statements[0]);
  const kinds = an.insights.map((i) => i.kind);
  for (const k of ['scan', 'spill', 'estimate', 'missingIndex']) assert.ok(kinds.includes(k), 'faltou ' + k + ' em ' + kinds);
  const mi = an.insights.find((i) => i.kind === 'missingIndex');
  assert.match(mi.sql, /CREATE NONCLUSTERED INDEX/);
  assert.match(mi.sql, /\[Total\]/);
  assert.match(mi.sql, /INCLUDE \(\[ClienteId\]\)/);
  assert.equal(an.insights[0].severity, 'error'); // o spill vem primeiro
  const scan = an.insights.find((i) => i.kind === 'scan');
  assert.match(scan.detail, /Total/); // cita o filtro
});

test('Key Lookup é detectado e avisa quantas vezes', () => {
  const xml = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"><BatchSequence><Batch><Statements>
   <StmtSimple StatementText="SELECT 1" StatementType="SELECT" StatementSubTreeCost="5"><QueryPlan>
    <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="5000" EstimatedTotalSubtreeCost="5"><NestedLoops>
     <RelOp NodeId="1" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="5000" EstimatedTotalSubtreeCost="0.5"><IndexScan><Object Table="[T]" Index="[IX]"/></IndexScan></RelOp>
     <RelOp NodeId="2" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="4"><IndexScan Lookup="1"><Object Table="[T]" Index="[PK]"/></IndexScan></RelOp>
    </NestedLoops></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;
  const an = analyze(parsePlan(xml).statements[0]);
  const lk = an.insights.find((i) => i.kind === 'lookup');
  assert.ok(lk);
  assert.match(lk.title, /5,0 mil|5000/);
  assert.equal(lk.severity, 'warn');
});

test('arquivo: decodifica UTF-16 LE com BOM (SSMS), UTF-16 sem BOM e UTF-8 com BOM', () => {
  const bom16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, 'utf16le')]);
  const raw16 = Buffer.from(SAMPLE, 'utf16le');
  const bom8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE, 'utf8')]);
  for (const b of [bom16, raw16, bom8]) {
    const txt = decodePlan(new Uint8Array(b));
    assert.equal(txt, SAMPLE);
    assert.ok(parsePlan(txt).statements);
  }
});

test('entradas inválidas dão erro claro e não lançam', () => {
  assert.match(parsePlan('<html><body/></html>').error, /não parece um plano/);
  assert.match(parsePlan('texto solto').error, /não parece um plano/);
  assert.match(parsePlan('<ShowPlanXML><BatchSequence/></ShowPlanXML>').error, /não tem operadores/);
  assert.doesNotThrow(() => parsePlan('<ShowPlanXML><RelOp'));
});

test('segurança: nomes hostis ficam como texto (o React escapa) e o parser não resolve entidades externas', () => {
  const xml = SAMPLE.replace('[PK_Pedido]', '[&lt;img src=x onerror=alert(1)&gt;]').replace('<ShowPlanXML', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><ShowPlanXML');
  const r = parsePlan(xml);
  assert.ok(r.statements);
  assert.equal(r.statements[0].nodes[2].object.index, '<img src=x onerror=alert(1)>'); // texto puro, nunca HTML
  assert.doesNotMatch(JSON.stringify(r), /root:|passwd/);
});
