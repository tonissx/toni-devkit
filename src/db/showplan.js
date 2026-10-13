// Banco — plano de execução (Showplan XML) → estrutura simples + insights. Puro (sem DOM): roda no renderer e nos testes.
//   parsePlan(xml)   → { statements: [{ text, cost, dop, grant, params, missing, tree, nodes, isActual, … }] } | { error }
//   analyze(stmt)    → { insights: [{ severity, kind, title, detail, nodeId, sql }], top: [nó], maxCost }
//   layout(tree)     → { pos: Map(id → { col, row }), cols, rows } — grade para desenhar (raiz à esquerda, folhas à direita)
// Um insight sempre diz o que viu, por que importa e o que fazer; a tela mostra ícone + texto (a cor só reforça).
const { missingIndexSql } = require('./health.js');

/* ─────────────── XML mínimo ─────────────── */

const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const unent = (s) => s.replace(/&(lt|gt|amp|quot|apos);|&#(x?[0-9a-fA-F]+);/g, (m, n, num) => {
  if (n) return ENT[m];
  const code = num[0] === 'x' ? parseInt(num.slice(1), 16) : parseInt(num, 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : m;
});

/** Elemento { name, attrs, children }. Ignora texto, comentários, CDATA e instruções; remove o prefixo de namespace. */
function parseXml(xml) {
  const src = String(xml || '').replace(/^﻿/, '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) { // fecha
      const name = m[1].replace(/^.*:/, '');
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === name) { stack.length = i; break; }
    } else if (m[2] !== undefined) { // abre
      const attrs = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[3]))) attrs[a[1].replace(/^.*:/, '')] = unent(a[2] !== undefined ? a[2] : a[3]);
      const el = { name: m[2].replace(/^.*:/, ''), attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root.children[0] || null;
}

const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => (el ? el.children.find((c) => c.name === name) || null : null);
/** Todos os descendentes com esse nome (sem entrar em RelOp, para não pegar o que é de outro operador). */
function deep(el, name, stopAtRelOp = true, out = []) {
  if (!el) return out;
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    if (stopAtRelOp && c.name === 'RelOp') continue;
    deep(c, name, stopAtRelOp, out);
  }
  return out;
}
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const flag = (v) => v === '1' || v === 'true' || v === 'True';

/* ─────────────── Operadores ─────────────── */

/** Ícone (lucide) e família do operador — para o desenho e para agrupar. */
function opInfo(physical, logical, lookup) {
  const p = String(physical || '');
  if (lookup) return { icon: 'key-round', family: 'lookup' };
  if (/Table Scan|Clustered Index Scan|^Index Scan|Columnstore Index Scan/i.test(p)) return { icon: 'scan-search', family: 'scan' };
  if (/Seek/i.test(p)) return { icon: 'search', family: 'seek' };
  if (/Nested Loops|Hash Match|Merge Join|Adaptive Join/i.test(p)) return { icon: 'git-merge', family: 'join' };
  if (/Sort/i.test(p)) return { icon: 'arrow-down-wide-narrow', family: 'sort' };
  if (/Aggregate/i.test(p)) return { icon: 'sigma', family: 'aggregate' };
  if (/Parallelism/i.test(p)) return { icon: 'split', family: 'parallel' };
  if (/Filter/i.test(p)) return { icon: 'filter', family: 'filter' };
  if (/Spool/i.test(p)) return { icon: 'layers', family: 'spool' };
  if (/Top/i.test(p)) return { icon: 'list-start', family: 'top' };
  if (/Compute Scalar|Segment|Sequence Project/i.test(p)) return { icon: 'calculator', family: 'scalar' };
  if (/Insert|Update|Delete|Merge$/i.test(p) || /Insert|Update|Delete/i.test(String(logical || ''))) return { icon: 'pencil-line', family: 'write' };
  if (/Constant Scan/i.test(p)) return { icon: 'hash', family: 'scan' };
  return { icon: 'box', family: 'other' };
}

const objName = (o) => (o ? [o.Database, o.Schema, o.Table].filter(Boolean).join('.').replace(/[[\]]/g, '') : '');

function parseRelOp(el, state, parentId) {
  const a = el.attrs;
  // O elemento específico do operador (IndexScan, NestedLoops, Hash, Sort…): tudo que não é saída, runtime ou aviso.
  const body = el.children.filter((c) => !['OutputList', 'RunTimeInformation', 'RunTimePartitionSummary', 'Warnings', 'MemoryFractions'].includes(c.name));
  const scan = body.find((c) => c.name === 'IndexScan' || c.name === 'TableScan') || null;
  const lookup = !!(scan && flag(scan.attrs.Lookup)) || /lookup/i.test(a.LogicalOp || '');
  const objEl = (() => { for (const c of body) { const f = c.name === 'Object' ? c : kid(c, 'Object'); if (f) return f; } return deep(el, 'Object')[0] || null; })();
  const o = objEl ? objEl.attrs : null;
  const info = opInfo(a.PhysicalOp, a.LogicalOp, lookup);
  const preds = body.flatMap((c) => deep(c, 'Predicate')).map((p) => (kid(p, 'ScalarOperator') || {}).attrs).filter(Boolean).map((x) => x.ScalarString).filter(Boolean);
  const predicate = preds.filter((v, i, l) => l.indexOf(v) === i);
  const seekStr = body.flatMap((c) => deep(c, 'SeekPredicates')).flatMap((sp) => deep(sp, 'ScalarOperator', false)).map((x) => x.attrs.ScalarString).filter(Boolean);
  const seek = seekStr.filter((v, i, l) => l.indexOf(v) === i);
  const output = deep(kid(el, 'OutputList'), 'ColumnReference', false).map((c) => [c.attrs.Table, c.attrs.Column].filter(Boolean).join('.').replace(/[[\]]/g, '')).filter(Boolean);
  const rt = kid(el, 'RunTimeInformation');
  let runtime = null;
  if (rt) {
    runtime = { rows: 0, rowsRead: 0, executions: 0, elapsedMs: 0, cpuMs: 0, logicalReads: 0, physicalReads: 0 };
    for (const t of kids(rt, 'RunTimeCountersPerThread')) {
      const x = t.attrs;
      runtime.rows += num(x.ActualRows) || 0; runtime.rowsRead += num(x.ActualRowsRead) || 0; runtime.executions += num(x.ActualExecutions) || 0;
      runtime.elapsedMs = Math.max(runtime.elapsedMs, num(x.ActualElapsedms) || 0); runtime.cpuMs += num(x.ActualCPUms) || 0;
      runtime.logicalReads += num(x.ActualLogicalReads) || 0; runtime.physicalReads += num(x.ActualPhysicalReads) || 0;
    }
    state.actual = true;
  }
  const warnEl = kid(el, 'Warnings');
  const warnings = [];
  if (warnEl) {
    if (flag(warnEl.attrs.NoJoinPredicate)) warnings.push({ kind: 'noJoin' });
    for (const s of kids(warnEl, 'SpillToTempDb')) warnings.push({ kind: 'spill', level: num(s.attrs.SpillLevel), threads: num(s.attrs.SpilledThreadCount) });
    for (const s of kids(warnEl, 'SortSpillDetails')) warnings.push({ kind: 'spill', what: 'sort', writes: num(s.attrs.WritesToTempDb), reads: num(s.attrs.ReadsFromTempDb) });
    for (const s of kids(warnEl, 'HashSpillDetails')) warnings.push({ kind: 'spill', what: 'hash', writes: num(s.attrs.WritesToTempDb), reads: num(s.attrs.ReadsFromTempDb) });
    for (const s of kids(warnEl, 'ColumnsWithNoStatistics')) warnings.push({ kind: 'noStats', columns: kids(s, 'ColumnReference').map((c) => c.attrs.Column).filter(Boolean) });
    for (const s of kids(warnEl, 'Wait')) warnings.push({ kind: 'wait', type: s.attrs.WaitType, ms: num(s.attrs.WaitTime) });
    for (const s of kids(warnEl, 'PlanAffectingConvert')) warnings.push({ kind: 'convert', issue: s.attrs.ConvertIssue, expression: s.attrs.Expression });
  }
  const node = {
    id: num(a.NodeId) != null ? num(a.NodeId) : state.next++, parentId, physical: a.PhysicalOp || '?', logical: a.LogicalOp || '',
    label: lookup ? (/Key|RID/i.test(a.LogicalOp || '') ? a.LogicalOp : 'Key Lookup') : (a.PhysicalOp || '?'),
    icon: info.icon, family: info.family, lookup,
    estRows: num(a.EstimateRows), estIO: num(a.EstimateIO), estCPU: num(a.EstimateCPU), rowSize: num(a.AvgRowSize),
    subtreeCost: num(a.EstimatedTotalSubtreeCost) || 0, ownCost: 0, costPct: 0,
    parallel: flag(a.Parallel), mode: a.EstimatedExecutionMode || '', rebinds: num(a.EstimateRebinds), rewinds: num(a.EstimateRewinds), tableCard: num(a.TableCardinality),
    object: o ? { db: (o.Database || '').replace(/[[\]]/g, ''), schema: (o.Schema || '').replace(/[[\]]/g, ''), table: (o.Table || '').replace(/[[\]]/g, ''), index: (o.Index || '').replace(/[[\]]/g, ''), alias: (o.Alias || '').replace(/[[\]]/g, ''), kind: o.IndexKind || '', full: objName(o) } : null,
    predicate, seek, output, runtime, warnings, children: [],
  };
  state.nodes.push(node);
  const sub = [];
  const collect = (e) => { for (const c of e.children) { if (c.name === 'RelOp') sub.push(c); else if (!['OutputList', 'RunTimeInformation'].includes(c.name)) collect(c); } };
  for (const c of body) collect({ children: [c] });
  node.children = sub.map((c) => parseRelOp(c, state, node.id));
  const childCost = node.children.reduce((s, c) => s + c.subtreeCost, 0);
  node.ownCost = Math.max(0, node.subtreeCost - childCost);
  return node;
}

/* ─────────────── Statement ─────────────── */

function parseStatement(el, index) {
  const qp = kid(el, 'QueryPlan');
  const a = el.attrs;
  const state = { nodes: [], next: 1, actual: false };
  const rootEl = qp ? kid(qp, 'RelOp') : null;
  const root = rootEl ? parseRelOp(rootEl, state, -1) : null;
  const cost = num(a.StatementSubTreeCost) != null ? num(a.StatementSubTreeCost) : root ? root.subtreeCost : 0;
  for (const n of state.nodes) n.costPct = cost > 0 ? (n.ownCost / cost) * 100 : 0;
  const q = qp ? qp.attrs : {};
  const mg = kid(qp, 'MemoryGrantInfo');
  const qts = kid(qp, 'QueryTimeStats');
  const stmt = {
    index, text: String(a.StatementText || '').trim(), type: a.StatementType || '', cost, estRows: num(a.StatementEstRows),
    optLevel: a.StatementOptmLevel || '', earlyAbort: a.StatementOptmEarlyAbortReason || '', cardinalityModel: num(a.CardinalityEstimationModelVersion),
    queryHash: a.QueryHash || '', planHash: a.QueryPlanHash || '', parameterizedText: a.ParameterizedText || '',
    dop: num(q.DegreeOfParallelism), nonParallelReason: q.NonParallelPlanReason || '',
    grant: mg ? { requestedKb: num(mg.attrs.RequestedMemory), grantedKb: num(mg.attrs.GrantedMemory), usedKb: num(mg.attrs.MaxUsedMemory), waitMs: num(mg.attrs.GrantWaitTime), desiredKb: num(mg.attrs.DesiredMemory) }
      : (num(q.MemoryGrant) != null ? { requestedKb: null, grantedKb: num(q.MemoryGrant), usedKb: null, waitMs: null, desiredKb: null } : null),
    compile: { timeMs: num(q.CompileTime), cpuMs: num(q.CompileCPU), memoryKb: num(q.CompileMemory), planSizeKb: num(q.CachedPlanSize) },
    timeStats: qts ? { cpuMs: num(qts.attrs.CpuTime), elapsedMs: num(qts.attrs.ElapsedTime) } : null,
    params: deep(kid(qp, 'ParameterList'), 'ColumnReference', false).map((c) => ({ name: c.attrs.Column, type: c.attrs.ParameterDataType || '', compiled: c.attrs.ParameterCompiledValue ?? null, runtime: c.attrs.ParameterRuntimeValue ?? null })),
    waits: deep(kid(qp, 'WaitStats'), 'Wait', false).map((w) => ({ type: w.attrs.WaitType, ms: num(w.attrs.WaitTimeMs), count: num(w.attrs.WaitCount) })),
    missing: deep(kid(qp, 'MissingIndexes'), 'MissingIndexGroup', false).map((g) => {
      const mi = kid(g, 'MissingIndex'); if (!mi) return null;
      const cols = (usage) => kids(mi, 'ColumnGroup').filter((c) => c.attrs.Usage === usage).flatMap((c) => kids(c, 'Column').map((x) => x.attrs.Name)).join(', ');
      return { impact: num(g.attrs.Impact), database: mi.attrs.Database, schema: mi.attrs.Schema, table: mi.attrs.Table, equality: cols('EQUALITY'), inequality: cols('INEQUALITY'), included: cols('INCLUDE') };
    }).filter(Boolean),
    statsUsage: deep(kid(qp, 'OptimizerStatsUsage'), 'StatisticsInfo', false).map((s) => ({ table: (s.attrs.Table || '').replace(/[[\]]/g, ''), name: (s.attrs.Statistics || '').replace(/[[\]]/g, ''), modifications: num(s.attrs.ModificationCount), sampling: num(s.attrs.SamplingPercent), lastUpdate: s.attrs.LastUpdate || '' })),
    warnings: [],
    isActual: state.actual,
    nodes: state.nodes, tree: null,
  };
  const wEl = kid(qp, 'Warnings');
  if (wEl) {
    for (const c of kids(wEl, 'PlanAffectingConvert')) stmt.warnings.push({ kind: 'convert', issue: c.attrs.ConvertIssue, expression: c.attrs.Expression });
    for (const c of kids(wEl, 'MemoryGrantWarning')) stmt.warnings.push({ kind: 'grant', grantKind: c.attrs.GrantWarningKind, requestedKb: num(c.attrs.RequestedMemory), grantedKb: num(c.attrs.GrantedMemory), usedKb: num(c.attrs.MaxUsedMemory) });
    for (const c of kids(wEl, 'ColumnsWithNoStatistics')) stmt.warnings.push({ kind: 'noStats', columns: kids(c, 'ColumnReference').map((x) => x.attrs.Column).filter(Boolean) });
  }
  // Raiz virtual (a própria instrução: SELECT, UPDATE…) para o desenho começar nela.
  stmt.tree = { id: -1, parentId: null, virtual: true, physical: a.StatementType || 'Instrução', label: a.StatementType || 'Instrução', icon: 'terminal-square', family: 'root', subtreeCost: cost, ownCost: 0, costPct: 0, estRows: stmt.estRows, warnings: [], predicate: [], seek: [], output: [], object: null, runtime: null, children: root ? [root] : [] };
  return stmt;
}

function parsePlan(xml) {
  let el;
  try { el = parseXml(xml); } catch (e) { return { error: 'XML do plano inválido' }; }
  if (!el || el.name !== 'ShowPlanXML') return { error: 'Isto não parece um plano de execução (ShowPlanXML)' };
  const out = [];
  const walk = (e) => {
    for (const c of e.children) {
      if (/^Stmt/.test(c.name) && kid(c, 'QueryPlan')) out.push(parseStatement(c, out.length));
      walk(c); // StmtCond e afins: as instruções de dentro do IF
    }
  };
  walk(el);
  if (!out.length) return { error: 'O plano não tem operadores (instrução sem plano, ex.: DECLARE/SET)' };
  return { statements: out, version: el.attrs.Version || '', build: el.attrs.Build || '' };
}

/* ─────────────── Insights ─────────────── */

const SEV = { error: 0, warn: 1, info: 2 };
const fmt = (n) => (n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' mil' : String(Math.round(n * 10) / 10).replace('.', ','));
const pct = (n) => (n < 1 ? '<1' : Math.round(n)) + '%';
const MB = (kb) => (kb == null ? '—' : kb >= 1024 ? (kb / 1024).toFixed(kb >= 10240 ? 0 : 1).replace('.', ',') + ' MB' : kb + ' KB');

function analyze(stmt) {
  const ins = [];
  const add = (severity, kind, title, detail, nodeId = null, extra = {}) => ins.push({ severity, kind, title, detail, nodeId, ...extra });
  const byId = new Map(stmt.nodes.map((n) => [n.id, n]));
  const where = (n) => (n.object && n.object.table ? `${n.object.table}${n.object.index ? ` (${n.object.index})` : ''}` : n.label);

  for (const n of stmt.nodes) {
    const execs = n.runtime && n.runtime.executions ? n.runtime.executions : null;
    if (n.family === 'scan' && !/Constant/i.test(n.physical) && (n.costPct >= 10 || (n.estRows || 0) >= 50000)) {
      const filt = n.predicate.length ? ` Há filtro (${n.predicate[0].slice(0, 90)}): um índice nas colunas filtradas evitaria ler tudo.` : ' Sem filtro: lê a tabela inteira — confirme se é isso mesmo que a consulta precisa.';
      add(n.costPct >= 25 ? 'warn' : 'info', 'scan', `${n.label} em ${where(n)} · ${pct(n.costPct)} do custo`, `Lê ${fmt(n.tableCard || n.estRows)} linhas${n.runtime ? ` (lidas de fato: ${fmt(n.runtime.rowsRead || n.runtime.rows)})` : ''}.${filt}`, n.id);
    }
    if (n.lookup) {
      const parent = byId.get(n.parentId);
      const outer = parent && parent.children.length ? parent.children[0] : null;
      const times = execs != null ? execs : outer && outer !== n ? outer.estRows : n.estRows;
      add(times >= 1000 || n.costPct >= 15 ? 'warn' : 'info', 'lookup', `Key Lookup em ${where(n)} · ~${fmt(times)} vez(es)`, `Para cada linha achada no índice, volta à tabela buscar colunas que faltam. Incluir essas colunas no índice (INCLUDE) elimina o lookup${n.output.length ? `: ${n.output.slice(0, 5).join(', ')}` : ''}.`, n.id);
    }
    for (const w of n.warnings) {
      if (w.kind === 'spill') add('error', 'spill', `${n.label} derramou para o tempdb`, `A memória reservada não bastou e o operador gravou dados em disco${w.writes != null ? ` (${fmt(w.writes)} páginas gravadas)` : ''}. Costuma vir de estimativa de linhas errada ou grant pequeno — confira estatísticas e o estimado × real.`, n.id);
      if (w.kind === 'noJoin') add('error', 'noJoin', `${n.label} sem predicado de junção`, 'O join não tem condição: vira produto cartesiano. Quase sempre é um ON faltando.', n.id);
      if (w.kind === 'noStats') add('warn', 'noStats', `Sem estatísticas em ${w.columns.join(', ') || 'coluna'}`, 'O otimizador está chutando a cardinalidade. Crie/atualize estatísticas (ou ative AUTO_CREATE_STATISTICS).', n.id);
      if (w.kind === 'convert') add(w.issue === 'Seek Plan' ? 'error' : 'warn', 'convert', 'Conversão implícita no operador', `${w.expression || ''} — ${w.issue === 'Seek Plan' ? 'impede o uso de Seek no índice' : 'distorce a estimativa de linhas'}. Alinhe o tipo do parâmetro com o da coluna.`, n.id);
    }
    if (n.runtime && n.estRows != null) {
      const per = execs ? n.runtime.rows / execs : n.runtime.rows;
      const hi = Math.max(per, n.estRows), lo = Math.max(1, Math.min(per, n.estRows));
      if (hi >= 1000 && hi / lo >= 10) add('warn', 'estimate', `Estimativa errada em ${n.label}: ${fmt(n.estRows)} estimadas × ${fmt(per)} reais`, `O otimizador ${per > n.estRows ? 'subestimou' : 'superestimou'} ${Math.round(hi / lo)}×. Daí saem joins, grants e paralelismo mal escolhidos. Estatísticas desatualizadas, parameter sniffing ou predicados não sargáveis são os suspeitos.`, n.id);
    }
    if (n.family === 'sort' && n.costPct >= 20) add('info', 'sort', `Ordenação consome ${pct(n.costPct)} do custo`, 'Um índice na ordem do ORDER BY / GROUP BY / join (ou menos linhas antes de ordenar) evita o Sort.', n.id);
    if (/Nested Loops/i.test(n.physical) && n.children[1] && n.children[1].runtime && n.children[1].runtime.executions >= 10000) add('info', 'loops', `Nested Loops repetiu o lado interno ${fmt(n.children[1].runtime.executions)} vezes`, 'Com muitas linhas no lado externo, Hash ou Merge Join costuma ser mais barato — veja a estimativa do lado externo.', n.id);
    if (/Spool/i.test(n.physical) && n.costPct >= 10) add('info', 'spool', `${n.label} · ${pct(n.costPct)} do custo`, 'O spool materializa linhas em tempdb para reuso. Pode indicar subconsulta correlacionada ou falta de índice.', n.id);
  }
  for (const w of stmt.warnings) {
    if (w.kind === 'convert') add(w.issue === 'Seek Plan' ? 'error' : 'warn', 'convert', w.issue === 'Seek Plan' ? 'Conversão implícita impede o Seek' : 'Conversão implícita afeta a estimativa', `${w.expression || ''}. Compare o tipo do parâmetro com o da coluna (ex.: nvarchar × varchar, datetime × date) e converta o parâmetro, não a coluna.`);
    if (w.kind === 'grant') add('warn', 'grant', `Aviso de memory grant: ${w.grantKind || ''}`, `Pedido ${MB(w.requestedKb)} · concedido ${MB(w.grantedKb)} · usado ${MB(w.usedKb)}.`);
    if (w.kind === 'noStats') add('warn', 'noStats', `Sem estatísticas em ${w.columns.join(', ')}`, 'Crie ou atualize estatísticas nessas colunas.');
  }
  for (const m of stmt.missing) {
    const sql = missingIndexSql({ table_name: [m.database, m.schema, m.table].filter(Boolean).join('.'), equality_columns: m.equality, inequality_columns: m.inequality, included_columns: m.included });
    add((m.impact || 0) >= 50 ? 'warn' : 'info', 'missingIndex', `Índice sugerido em ${(m.table || '').replace(/[[\]]/g, '')} · ganho estimado ${Math.round(m.impact || 0)}%`, 'O otimizador sentiu falta deste índice. Revise antes de criar: índices demais pesam nas gravações e podem se sobrepor a um existente.', null, { sql });
  }
  const g = stmt.grant;
  if (g && g.grantedKb) {
    if (g.waitMs > 1000) add('warn', 'grantWait', `Esperou ${Math.round(g.waitMs / 100) / 10} s por memory grant`, 'A consulta ficou na fila por memória (RESOURCE_SEMAPHORE). Reduzir o grant (estimativas melhores, menos colunas/linhas ordenadas) libera concorrência.');
    if (g.usedKb != null && g.grantedKb >= 10240 && g.usedKb < g.grantedKb * 0.1) add('info', 'grantBig', `Memory grant de ${MB(g.grantedKb)} usou só ${MB(g.usedKb)}`, 'Reserva muito maior que o uso: tira memória de outras consultas. Costuma vir de estimativa de linhas inflada.');
  }
  if (stmt.nonParallelReason) add('info', 'serial', `Plano serial: ${stmt.nonParallelReason}`, 'O SQL Server não paralelizou esta consulta. Se ela é pesada, veja o motivo (função escalar, variável de tabela, custo baixo…).');
  if (/TimeOut|MemoryLimit/i.test(stmt.earlyAbort)) add('warn', 'abort', `Otimizador desistiu cedo (${stmt.earlyAbort})`, 'O plano pode não ser o melhor que existia: consultas com joins demais ou muito complexas estouram o tempo de otimização. Simplificar ou quebrar em etapas ajuda.');
  const ps = stmt.params.filter((p) => p.compiled != null && p.runtime != null && p.compiled !== p.runtime);
  if (ps.length) add('info', 'sniffing', `Parameter sniffing possível (${ps.map((p) => p.name).join(', ')})`, `O plano foi compilado com ${ps.map((p) => `${p.name}=${p.compiled}`).join(', ')} e rodou com ${ps.map((p) => `${p.name}=${p.runtime}`).join(', ')}. Se os valores têm volumes muito diferentes, o plano serve bem para um e mal para outro (OPTION (RECOMPILE) ou OPTIMIZE FOR).`);
  for (const s of stmt.statsUsage) {
    const card = (stmt.nodes.find((n) => n.object && n.object.table === s.table.split('.').pop() && n.tableCard) || {}).tableCard;
    if (card && s.modifications != null && s.modifications / card >= 0.2) add('warn', 'stale', `Estatística ${s.name || s.table} com ${Math.round((s.modifications / card) * 100)}% de linhas alteradas`, `${fmt(s.modifications)} modificações desde a última atualização${s.lastUpdate ? ` (${s.lastUpdate.slice(0, 10)})` : ''}. UPDATE STATISTICS na tabela ${s.table} costuma corrigir estimativas ruins.`);
  }
  ins.sort((x, y) => SEV[x.severity] - SEV[y.severity] || ((byId.get(y.nodeId) || {}).costPct || 0) - ((byId.get(x.nodeId) || {}).costPct || 0));
  const top = [...stmt.nodes].sort((x, y) => y.ownCost - x.ownCost).slice(0, 3).filter((n) => n.ownCost > 0);
  return { insights: ins, top, maxCost: stmt.nodes.reduce((m, n) => Math.max(m, n.ownCost), 0) };
}

/* ─────────────── Desenho ─────────────── */

/** Grade: coluna = profundidade (raiz à esquerda), linha = folhas em ordem; o pai fica no meio dos filhos. */
function layout(tree) {
  const pos = new Map();
  let row = 0; let cols = 0;
  const place = (n, depth) => {
    cols = Math.max(cols, depth + 1);
    if (!n.children.length) { pos.set(n.id, { col: depth, row: row++ }); return pos.get(n.id).row; }
    const ys = n.children.map((c) => place(c, depth + 1));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    pos.set(n.id, { col: depth, row: y });
    return y;
  };
  place(tree, 0);
  return { pos, cols, rows: Math.max(row, 1) };
}

/**
 * O que vai para a IA: um resumo do plano (nunca o XML inteiro) — instrução, números, achados já calculados e os
 * operadores mais caros. A IA explica e prioriza; os fatos vêm daqui, não de adivinhação.
 */
function aiSummary(stmt, an) {
  const a = an || analyze(stmt);
  const g = stmt.grant;
  return {
    sql: stmt.text,
    plan: {
      cost: stmt.cost, estRows: stmt.estRows, operators: stmt.nodes.length, dop: stmt.dop, serialReason: stmt.nonParallelReason || '', actual: stmt.isActual,
      grant: g ? { grantedKb: g.grantedKb, usedKb: g.usedKb, waitMs: g.waitMs } : null,
      elapsedMs: stmt.timeStats ? stmt.timeStats.elapsedMs : null, cardinalityModel: stmt.cardinalityModel,
    },
    insights: a.insights.slice(0, 14).map((i) => ({ severity: i.severity, title: i.title, detail: i.detail, sql: i.sql || '' })),
    operators: [...stmt.nodes].sort((x, y) => y.ownCost - x.ownCost).slice(0, 12).map((n) => ({
      id: n.id, op: n.label, object: n.object ? `${n.object.table}${n.object.index ? ` (${n.object.index})` : ''}` : '', costPct: Math.round(n.costPct * 10) / 10,
      estRows: n.estRows, actualRows: n.runtime ? n.runtime.rows : null, executions: n.runtime ? n.runtime.executions : null,
      predicate: n.predicate.concat(n.seek).slice(0, 2),
    })),
    params: stmt.params.map((p) => ({ name: p.name, type: p.type, compiled: p.compiled, runtime: p.runtime })),
  };
}

module.exports = { parseXml, parsePlan, analyze, aiSummary, layout, opInfo };
