'use strict';
/**
 * SQL Visualizer — lineage de uma query T-SQL (estilo SQLFlow). Puro: só LÊ o texto, nunca executa nada.
 * Parser: node-sql-parser (dialeto transactsql), com um pré-processamento para o que ele não entende (ver preprocess()).
 *
 * analyze(sql, { schema? }) → { nodes, edges, colEdges, warnings, notes }
 *   nodes:    { id, kind: 'table'|'temp'|'func'|'values'|'cte'|'subquery'|'branch'|'result'|'target', name,
 *               columns: [{ name, flags: ['select'|'join'|'filter'|'group'|'order'], expr?, kind?: 'direct'|'expr'|'agg' }], info }
 *   edges:    { from, to, label, cond, alias }   — fluxo entre blocos (FROM/JOIN/subconsulta/UNION), com tipo e condição do JOIN
 *   colEdges: { from: { node, col }, to: { node, col }, kind, ambiguous? }   — de qual coluna de origem cada coluna deriva
 * `schema` (opcional, modelo de src/db/schema.js) deixa o app resolver `SELECT *` e colunas sem alias com precisão.
 */
const LIMITATIONS = [
  'Só leitura: o SQL nunca é executado. Suporta SELECT, CTE (inclusive recursiva), UNION, subconsultas, tabelas derivadas, CROSS/OUTER APPLY, INSERT … SELECT e SELECT … INTO (#temp reaproveitada nas instruções seguintes).',
  'MERGE, UPDATE e DELETE ainda não são analisados (a instrução é ignorada com aviso). Procedures, SQL dinâmico (EXEC / sp_executesql) e triggers não entram.',
  'PIVOT / UNPIVOT: as colunas geradas não são rastreadas até a origem. Funções com valor de tabela (TVF) aparecem como uma caixa só, sem as colunas internas.',
  'Sem o schema, `SELECT *` sobre tabela não é expandido e coluna sem alias com mais de uma tabela é marcada como ambígua (carregue o schema na aba Explorador para resolver).',
  'O parser não entende TOP … WITH TIES, OPTION (…), WITHIN GROUP (…), AT TIME ZONE, TRY_CAST, EXCEPT e INTERSECT: o app remove ou troca esses trechos antes de ler (TRY_CAST vira CAST, EXCEPT/INTERSECT viram UNION) e avisa; o grafo não é afetado.',
  'Expressões aparecem como texto resumido; CASE, funções e operações viram uma coluna derivada de todas as colunas que usam.',
];

const lower = (s) => String(s == null ? '' : s).toLowerCase();

/* ─────────────── Pré-processamento ─────────────── */

/** Texto com strings, [identificadores], "aspas" e comentários trocados por filler (mesmo tamanho): dá para achar palavras e parênteses sem cair dentro deles. */
function mask(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; out += ' '.repeat(j - i); i = j; continue; }
    if (c === '/' && n === '*') {
      let j = sql.indexOf('*/', i + 2); j = j < 0 ? sql.length : j + 2;
      out += sql.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
    }
    if (c === "'" || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === close) { if (sql[j + 1] === close) { j += 2; continue; } break; } j++; }
      j = Math.min(j + 1, sql.length);
      out += '\u0001'.repeat(j - i); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Fim do parêntese que abre em `open` (índice do "("), sobre o texto mascarado. */
function closeParen(m, open) {
  let d = 0;
  for (let i = open; i < m.length; i++) { if (m[i] === '(') d++; else if (m[i] === ')') { d--; if (!d) return i; } }
  return m.length - 1;
}

/** Ajusta o T-SQL para o parser. Retorna { sql, notes } — notes dizem o que foi removido/trocado. */
function preprocess(input) {
  const src = String(input == null ? '' : input).replace(/\r\n/g, '\n');
  const m = mask(src);
  const edits = []; // { s, e, to }
  const notes = new Set();
  let r;

  const goRe = /^[ \t]*GO[ \t]*\d*[ \t]*$/gim;
  while ((r = goRe.exec(m))) edits.push({ s: r.index, e: r.index + r[0].length, to: ';' });

  for (const [re, note] of [[/\bOPTION\s*\(/gi, 'OPTION (…) removido (dicas de execução não afetam a linhagem)'], [/\bWITHIN\s+GROUP\s*\(/gi, 'WITHIN GROUP (…) removido']]) {
    while ((r = re.exec(m))) { edits.push({ s: r.index, e: closeParen(m, r.index + r[0].length - 1) + 1, to: '' }); notes.add(note); }
  }
  const tz = /\bAT\s+TIME\s+ZONE\s+(?:\u0001+|\w+)/gi;
  while ((r = tz.exec(m))) { edits.push({ s: r.index, e: r.index + r[0].length, to: '' }); notes.add('AT TIME ZONE removido'); }
  const ties = /\bWITH\s+TIES\b/gi;
  while ((r = ties.exec(m))) { edits.push({ s: r.index, e: r.index + r[0].length, to: '' }); notes.add('TOP … WITH TIES: o WITH TIES foi ignorado'); }
  const tc = /\bTRY_CAST(?=\s*\()/gi;
  while ((r = tc.exec(m))) { edits.push({ s: r.index, e: r.index + r[0].length, to: 'CAST' }); notes.add('TRY_CAST lido como CAST'); }
  const setop = /\b(EXCEPT|INTERSECT)\b/gi;
  while ((r = setop.exec(m))) { edits.push({ s: r.index, e: r.index + r[0].length, to: 'UNION' }); notes.add(`${r[1].toUpperCase()} lido como UNION (a linhagem é a mesma)`); }

  // aplica da direita para a esquerda; edições que se sobrepõem (ex.: dentro de um trecho já removido) são descartadas
  edits.sort((a, b) => b.s - a.s);
  let out = src, lastStart = Infinity;
  for (const ed of edits) {
    if (ed.e > lastStart) continue;
    out = out.slice(0, ed.s) + ed.to + out.slice(ed.e);
    lastStart = ed.s;
  }
  return { sql: out, notes: [...notes] };
}

/* ─────────────── Texto das expressões ─────────────── */

const fnName = (n) => (n && n.name ? n.name.map((x) => x.value).join('.') : String(n || ''));
const tableName = (it) => [it.db, it.schema, it.table].filter(Boolean).join('.');

function exprText(e) {
  if (e == null) return '';
  if (typeof e !== 'object') return String(e);
  let t;
  switch (e.type) {
    case 'column_ref': t = (e.table ? e.table + '.' : '') + e.column; break;
    case 'number': t = String(e.value); break;
    case 'single_quote_string': case 'string': case 'var_string': case 'natural_string': case 'double_quote_string': t = `'${e.value}'`; break;
    case 'bool': t = e.value ? '1' : '0'; break;
    case 'null': t = 'NULL'; break;
    case 'star': t = '*'; break;
    case 'param': t = '@' + e.value; break;
    case 'binary_expr': t = `${exprText(e.left)} ${e.operator} ${exprText(e.right)}`; break;
    case 'unary_expr': t = `${e.operator} ${exprText(e.expr)}`; break;
    case 'expr_list': t = (e.value || []).map(exprText).join(', '); break;
    case 'function': t = `${fnName(e.name)}(${e.args ? exprText(e.args) : ''})`; break;
    case 'aggr_func': t = `${e.name}(${e.args && e.args.distinct ? 'DISTINCT ' : ''}${e.args ? exprText(e.args.expr) : ''})${e.over ? ' OVER (…)' : ''}`; break;
    case 'case': t = 'CASE … END'; break;
    case 'cast': t = `CAST(${exprText(e.expr)} AS ${(e.target || []).map((x) => x.dataType).join('')})`; break;
    default: t = e.ast ? '(subconsulta)' : (e.value != null && typeof e.value !== 'object' ? String(e.value) : '…');
  }
  return e.parentheses ? `(${t})` : t;
}
const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Colunas, agregações e subconsultas dentro de uma expressão (não entra em subconsultas: devolve o AST delas). */
function collect(e, acc = { refs: [], subs: [], aggs: [], star: false }) {
  if (!e || typeof e !== 'object') return acc;
  if (Array.isArray(e)) { for (const x of e) collect(x, acc); return acc; }
  if (e.ast && e.ast.type) { acc.subs.push(e.ast); return acc; }
  if (e.type === 'column_ref') { acc.refs.push(e); return acc; }
  if (e.type === 'aggr_func') acc.aggs.push(e);
  for (const k of Object.keys(e)) if (k !== 'loc') collect(e[k], acc);
  return acc;
}

const OPEN_KINDS = new Set(['table', 'temp', 'func', 'values']);
const isOpen = (n) => OPEN_KINDS.has(n.kind) && !n.closed;

/* ─────────────── Análise ─────────────── */

function parseMessage(e) {
  const loc = e && e.location && e.location.start;
  const where = loc ? ` (linha ${loc.line}, coluna ${loc.column})` : '';
  const found = e && e.found ? ` Perto de “${String(e.found).slice(0, 20)}”.` : '';
  return `Não consegui interpretar o SQL${where}.${found} Confira se é T-SQL válido; veja as limitações do dialeto.`;
}

let _parser = null;
function getParser() {
  if (!_parser) { const { Parser } = require('node-sql-parser/build/transactsql'); _parser = new Parser(); }
  return _parser;
}

function analyze(sqlText, opts = {}) {
  const text = String(sqlText == null ? '' : sqlText);
  if (!text.trim()) throw new Error('Cole uma query (SELECT, CTE…) para ver a linhagem.');
  if (/(^|;|\n)\s*MERGE\b/i.test(mask(text))) throw new Error('MERGE ainda não é suportado. Cole a parte SELECT que alimenta o MERGE.');
  const pre = preprocess(text);
  let ast;
  try { ast = getParser().astify(pre.sql, { database: 'transactsql' }); } catch (e) { throw new Error(parseMessage(e)); }
  const stmts = (Array.isArray(ast) ? ast : [ast]).filter(Boolean);

  const nodes = [], edges = [], colEdges = [];
  const warnings = new Set();
  const notes = [...pre.notes];
  const baseTables = new Map();
  const defined = new Map(); // #temp produzida por instrução anterior do script
  let seq = 0;

  const schemaIdx = new Map();
  if (opts.schema && opts.schema.tables) {
    const byName = new Map();
    for (const t of opts.schema.tables) {
      schemaIdx.set(lower(t.id), t);
      (byName.get(lower(t.name)) || byName.set(lower(t.name), []).get(lower(t.name))).push(t);
    }
    for (const [k, v] of byName) if (v.length === 1 && !schemaIdx.has(k)) schemaIdx.set(k, v[0]);
  }

  const mk = (kind, name, extra = {}) => {
    const n = { id: 'n' + (++seq), kind, name, columns: [], info: { joins: [], where: [], having: [], groupBy: [], orderBy: [], aggs: [], top: '', distinct: false }, ...extra };
    nodes.push(n);
    return n;
  };
  const colIdx = (n, name) => n.columns.findIndex((c) => lower(c.name) === lower(name));
  const addFlag = (c, flag) => { if (flag && !c.flags.includes(flag)) c.flags.push(flag); };
  const ensureCol = (n, name, flag) => {
    let i = colIdx(n, name);
    if (i < 0) { n.columns.push({ name, flags: [] }); i = n.columns.length - 1; }
    addFlag(n.columns[i], flag);
    return i;
  };
  const warn = (m) => warnings.add(m);

  /** Resolve uma referência de coluna no escopo (e nos escopos de fora, para subconsultas correlacionadas). */
  function resolve(ref, scope, flag) {
    const col = ref.column;
    const touch = (src, ambiguous) => {
      let i;
      if (isOpen(src)) i = ensureCol(src, col, flag);
      else {
        i = colIdx(src, col);
        if (i < 0) { warn(`A coluna “${col}” não existe em ${src.name}.`); return null; }
        addFlag(src.columns[i], flag);
      }
      return { node: src, idx: i, ambiguous };
    };
    for (let s = scope; s; s = s.parent) {
      if (ref.table) {
        const src = s.aliases.get(lower(ref.table));
        if (src) { const r = touch(src, false); return r ? [r] : []; }
        continue;
      }
      const known = s.sources.filter((x) => !isOpen(x) && colIdx(x, col) >= 0);
      if (known.length === 1) return [touch(known[0], false)].filter(Boolean);
      if (known.length > 1) { warn(`A coluna “${col}” existe em mais de uma fonte (${known.map((k) => k.name).join(', ')}); use o alias.`); return known.map((k) => touch(k, true)).filter(Boolean); }
      const open = s.sources.filter(isOpen);
      if (open.length === 1) return [touch(open[0], false)].filter(Boolean);
      if (open.length > 1) {
        warn(`A coluna “${col}” está sem alias e há mais de uma tabela (${open.map((o) => o.name).join(', ')}): sem o schema não dá para saber de qual vem.`);
        return open.map((o) => touch(o, true));
      }
    }
    if (ref.table) warn(`Alias “${ref.table}” não encontrado.`);
    return [];
  }

  function baseNode(item, env) {
    const name = tableName(item);
    const plain = !item.db && !item.schema;
    if (plain && env.ctes.has(lower(item.table))) return env.ctes.get(lower(item.table));
    const temp = /^#/.test(item.table);
    if (temp && defined.has(lower(item.table))) return defined.get(lower(item.table));
    const key = lower(name);
    if (baseTables.has(key)) return baseTables.get(key);
    const kind = temp ? 'temp' : /^@/.test(item.table) ? 'temp' : 'table';
    const n = mk(kind, name || item.table, { shortName: item.table });
    const hit = kind === 'table' ? (schemaIdx.get(lower(name.includes('.') ? name : 'dbo.' + name)) || schemaIdx.get(lower(item.table))) : null;
    if (hit) { n.closed = true; n.columns = hit.columns.map((c) => ({ name: c.name, flags: [], type: c.type })); n.name = hit.id; }
    baseTables.set(key, n);
    return n;
  }

  function addSource(item, first, scope, env, joins) {
    let src, alias, label;
    const isApply = /APPLY/i.test(item.join || '');
    if (item.expr && item.expr.ast) {
      src = mk('subquery', item.as || 'subconsulta');
      processQuery(item.expr.ast, { ...env, scope: isApply ? scope : env.scope }, src);
      alias = item.as;
    } else if (item.type === 'expr' && item.expr && item.expr.type === 'function') {
      src = mk('func', `${fnName(item.expr.name)}()`);
      alias = item.as;
      const acc = collect(item.expr.args);
      for (const ref of acc.refs) resolve(ref, scope, 'join');
      notes.push(`Função de tabela ${src.name}: colunas internas não são rastreadas.`);
    } else if (item.table) {
      src = baseNode(item, env);
      alias = item.as || item.table;
    } else {
      src = mk('values', item.as || 'VALUES');
      alias = item.as;
    }
    if (alias) scope.aliases.set(lower(alias), src);
    if (item.table) { scope.aliases.set(lower(item.table), scope.aliases.get(lower(item.table)) || src); if (item.db) scope.aliases.set(lower(`${item.db}.${item.table}`), src); }
    if (!scope.sources.includes(src)) scope.sources.push(src);
    label = item.join ? String(item.join).toUpperCase() : (first ? 'FROM' : 'CROSS JOIN');
    if (src !== scope.node && !(env.defining && env.defining.has(src))) edges.push({ from: src.id, to: scope.node.id, label, cond: '', alias: alias && lower(alias) !== lower(src.name) ? alias : '' });
    else notes.push(`${src.name} é recursiva: a referência a si mesma não foi desenhada.`);
    joins.push({ item, edge: edges.length - 1, src, label, alias });
    return src;
  }

  function processSubs(subs, scope, env, labelForEdge, targetOutCol) {
    for (const sub of subs) {
      const sn = mk('subquery', 'subconsulta');
      processQuery(sub, { ...env, scope }, sn);
      edges.push({ from: sn.id, to: scope.node.id, label: labelForEdge, cond: '', alias: '' });
      if (targetOutCol != null) {
        sn.columns.forEach((_, i) => colEdges.push({ from: { node: sn.id, col: i }, to: { node: scope.node.id, col: targetOutCol }, kind: 'expr' }));
      }
    }
  }

  function processSelect(ast, env, node) {
    const scope = { node, aliases: new Map(), sources: [], parent: env.scope || null };
    const joins = [];
    (ast.from || []).forEach((item, i) => addSource(item, i === 0, scope, env, joins));

    // JOIN … ON: tipo e condição rotulam a aresta; as colunas do ON ficam marcadas como "join"
    for (const j of joins) {
      if (j.item.on) {
        const cond = exprText(j.item.on);
        edges[j.edge].cond = cond;
        const acc = collect(j.item.on);
        for (const ref of acc.refs) resolve(ref, scope, 'join');
        processSubs(acc.subs, scope, env, 'JOIN');
        node.info.joins.push({ type: j.label, table: j.alias || j.src.name, cond });
      } else if (j.item.using) {
        node.info.joins.push({ type: j.label, table: j.alias || j.src.name, cond: 'USING (' + j.item.using.map((u) => u.column || u.value || u).join(', ') + ')' });
      } else node.info.joins.push({ type: j.label, table: j.alias || j.src.name, cond: '' });
    }

    // lista de colunas
    const outCols = [];
    for (const item of ast.columns === '*' ? [{ expr: { type: 'column_ref', table: null, column: '*' }, as: null }] : ast.columns || []) {
      let expr = item.expr, alias = item.as;
      if (expr && expr.type === 'binary_expr' && expr.operator === '=' && !alias && expr.left && expr.left.type === 'column_ref' && !expr.left.table && !expr.parentheses) {
        alias = expr.left.column; expr = expr.right; // T-SQL: alias = expressão
      }
      if (expr && expr.type === 'column_ref' && expr.column === '*') {
        const targets = expr.table ? [scope.aliases.get(lower(expr.table))].filter(Boolean) : scope.sources;
        if (expr.table && !targets.length) warn(`Alias “${expr.table}” não encontrado em ${expr.table}.*`);
        for (const src of targets) {
          if (!isOpen(src)) {
            src.columns.forEach((c, i) => {
              addFlag(c, 'select');
              node.columns.push({ name: c.name, flags: [], expr: `${src.shortName || src.name}.${c.name}`, kind: 'direct' });
              colEdges.push({ from: { node: src.id, col: i }, to: { node: node.id, col: node.columns.length - 1 }, kind: 'direct' });
            });
          } else {
            const i = ensureCol(src, '*', 'select');
            node.columns.push({ name: targets.length > 1 || expr.table ? `${src.shortName || src.name}.*` : '*', flags: [], expr: '*', kind: 'direct' });
            colEdges.push({ from: { node: src.id, col: i }, to: { node: node.id, col: node.columns.length - 1 }, kind: 'direct' });
            warn(`SELECT * em ${src.name}: sem o schema as colunas não são expandidas.`);
          }
        }
        continue;
      }
      const acc = collect(expr);
      const kind = expr && expr.type === 'column_ref' ? 'direct' : acc.aggs.length ? 'agg' : 'expr';
      const name = alias || (expr && expr.type === 'column_ref' ? expr.column : short(exprText(expr), 40) || '(sem nome)');
      const out = { name, flags: [], expr: kind === 'direct' ? undefined : short(exprText(expr), 120), kind };
      node.columns.push(out);
      const idx = node.columns.length - 1;
      for (const ref of acc.refs) {
        for (const r of resolve(ref, scope, 'select')) colEdges.push({ from: { node: r.node.id, col: r.idx }, to: { node: node.id, col: idx }, kind, ambiguous: !!r.ambiguous });
      }
      processSubs(acc.subs, scope, env, 'subconsulta', idx);
      for (const a of acc.aggs) node.info.aggs.push(short(exprText(a), 70));
      outCols.push(idx);
    }

    const filt = (expr, list, flag, label) => {
      if (!expr) return;
      list.push(short(exprText(expr), 200));
      const acc = collect(expr);
      for (const ref of acc.refs) resolve(ref, scope, flag);
      processSubs(acc.subs, scope, env, label);
    };
    filt(ast.where, node.info.where, 'filter', 'WHERE');
    filt(ast.having, node.info.having, 'filter', 'HAVING');
    for (const g of ast.groupby ? (Array.isArray(ast.groupby) ? ast.groupby : ast.groupby.columns || []) : []) filt(g, node.info.groupBy, 'group', 'GROUP BY');
    for (const o of ast.orderby || []) filt(o.expr, node.info.orderBy, 'order', 'ORDER BY');
    if (ast.top) node.info.top = `TOP ${ast.top.percent ? `${exprText(ast.top.value)} PERCENT` : exprText(ast.top.value)}`;
    if (ast.distinct) node.info.distinct = true;
  }

  function processQuery(ast, env, node) {
    let ctes = env.ctes;
    if (ast.with && ast.with.length) {
      ctes = new Map(env.ctes);
      for (const w of ast.with) {
        const cn = mk('cte', w.name.value);
        ctes.set(lower(w.name.value), cn); // antes do corpo, para a CTE recursiva se enxergar
        processQuery(w.stmt.ast, { ...env, ctes, scope: env.scope, defining: new Set([...(env.defining || []), cn]) }, cn);
        if (w.columns && w.columns.length) w.columns.forEach((c, i) => { if (cn.columns[i]) cn.columns[i].name = c.column; });
      }
    }
    const env2 = { ...env, ctes };
    if (ast._next) {
      const chain = [];
      for (let a = ast; a; a = a._next) chain.push({ ast: a, op: a.set_op });
      const branches = [];
      chain.forEach((c, i) => {
        const b = mk('branch', `SELECT ${i + 1}`);
        processSelect(c.ast, env2, b);
        branches.push(b);
        // as colunas do bloco saem do 1º ramo já antes dos demais: é o que a parte recursiva de uma CTE enxerga
        if (i === 0) node.columns = b.columns.map((col) => ({ name: col.name, flags: [], expr: col.expr, kind: 'direct' }));
      });
      branches.forEach((b, bi) => {
        edges.push({ from: b.id, to: node.id, label: bi === 0 ? 'FROM' : String((chain[bi - 1].op || 'union')).toUpperCase(), cond: '', alias: '' });
        b.columns.forEach((c, i) => { if (node.columns[i]) colEdges.push({ from: { node: b.id, col: i }, to: { node: node.id, col: i }, kind: 'direct' }); });
        if (bi > 0 && b.columns.length !== branches[0].columns.length) warn(`Os ramos do UNION têm quantidades de colunas diferentes (${branches[0].columns.length} × ${b.columns.length}).`);
      });
    } else processSelect(ast, env2, node);
  }

  const baseEnv = { ctes: new Map(), scope: null };
  let resultNo = 0;
  for (const st of stmts) {
    if (st.type === 'select') {
      const into = st.into && st.into.expr ? String(st.into.expr.value || st.into.expr) : '';
      const n = into ? mk(/^#/.test(into) ? 'temp' : 'target', into) : mk('result', stmts.filter((s) => s.type === 'select').length > 1 ? `Resultado ${++resultNo}` : 'Resultado');
      processQuery(st, baseEnv, n);
      if (into && /^#/.test(into)) { n.closed = true; defined.set(lower(into), n); }
    } else if (st.type === 'insert') {
      const tgt = Array.isArray(st.table) ? st.table[0] : st.table;
      if (st.values && st.values.type === 'select') {
        const name = tableName(tgt || {}) || 'destino';
        const n = mk(/^#/.test(name) ? 'temp' : 'target', name);
        processQuery(st.values, baseEnv, n);
        if (Array.isArray(st.columns)) st.columns.forEach((c, i) => { if (n.columns[i]) n.columns[i].name = typeof c === 'string' ? c : c.column || n.columns[i].name; });
        if (/^#/.test(name)) { n.closed = true; defined.set(lower(name), n); }
      } else notes.push('INSERT … VALUES ignorado (sem origem em tabelas).');
    } else if (st.type === 'update' || st.type === 'delete' || st.type === 'merge') {
      notes.push(`${st.type.toUpperCase()} ignorado: ainda não é analisado.`);
    } else if (['declare', 'exec', 'set', 'use', 'transaction', 'if', 'while', 'print', 'return'].includes(st.type) || !st.type) {
      notes.push(`${String(st.type || 'comando').toUpperCase()} ignorado.`);
    } else notes.push(`Instrução “${st.type}” ignorada.`);
  }
  if (!nodes.some((n) => n.kind === 'result' || n.kind === 'target' || n.kind === 'temp')) {
    throw new Error('Nada para mostrar: só há instruções que ainda não são analisadas (SELECT, CTE, UNION e INSERT … SELECT são).');
  }
  if (nodes.length === 0) throw new Error('Nada para mostrar.');
  return { nodes, edges, colEdges, warnings: [...warnings], notes: [...new Set(notes)] };
}

/* ─────────────── Para o desenho ─────────────── */

const L = { w: 270, head: 30, row: 20, pad: 6, infoLine: 16, gapX: 110, gapY: 30, maxRows: 40 };

/** Colunas desenhadas: fontes de tabela mostram só as usadas; os demais blocos, todas (até um teto). */
function visibleColumns(node) {
  const all = node.columns.map((col, idx) => ({ col, idx }));
  if (OPEN_KINDS.has(node.kind)) {
    return all.filter((x) => x.col.flags.length);
  }
  return all;
}

/** Linhas do bloco de detalhes (JOIN, WHERE, HAVING, GROUP BY, agregações…), com marca para destacar filtros e agregações. */
function infoLines(node) {
  const out = [];
  const i = node.info;
  for (const j of i.joins) if (j.type !== 'FROM' || j.cond) out.push({ tag: 'JOIN', kind: 'join', text: `${j.type} ${j.table}${j.cond ? ' ON ' + j.cond : ''}` });
  for (const w of i.where) out.push({ tag: 'WHERE', kind: 'filter', text: w });
  for (const h of i.having) out.push({ tag: 'HAVING', kind: 'filter', text: h });
  if (i.groupBy.length) out.push({ tag: 'GROUP BY', kind: 'group', text: i.groupBy.join(', ') });
  if (i.aggs.length) out.push({ tag: 'Σ', kind: 'agg', text: [...new Set(i.aggs)].join(', ') });
  if (i.distinct) out.push({ tag: 'DISTINCT', kind: 'misc', text: 'linhas distintas' });
  if (i.top) out.push({ tag: 'TOP', kind: 'misc', text: i.top.replace(/^TOP /, '') });
  if (i.orderBy.length) out.push({ tag: 'ORDER BY', kind: 'misc', text: i.orderBy.join(', ') });
  return out;
}

const rowsOf = (node) => Math.min(L.maxRows, Math.max(1, visibleColumns(node).length)) + (visibleColumns(node).length > L.maxRows ? 1 : 0);
const heightOfNode = (node) => L.head + L.pad + rowsOf(node) * L.row + (OPEN_KINDS.has(node.kind) ? 0 : (infoLines(node).length ? 8 + infoLines(node).length * L.infoLine : 0)) + 4;

/** Camadas da esquerda (tabelas) para a direita (resultado), ordem por baricentro. → { pos: { id: {x,y,w,h} }, width, height } */
function layoutLineage(graph) {
  const ids = graph.nodes.map((n) => n.id);
  const ins = new Map(ids.map((id) => [id, new Set()]));
  const outs = new Map(ids.map((id) => [id, new Set()]));
  for (const e of graph.edges) if (e.from !== e.to) { ins.get(e.to).add(e.from); outs.get(e.from).add(e.to); }
  const layer = new Map(), state = new Map();
  const depth = (id) => {
    if (state.get(id) === 2) return layer.get(id);
    state.set(id, 1);
    let d = 0;
    for (const p of ins.get(id)) { if (state.get(p) === 1) continue; d = Math.max(d, depth(p) + 1); }
    state.set(id, 2); layer.set(id, d);
    return d;
  };
  ids.forEach(depth);
  const cols = [];
  for (const id of ids) (cols[layer.get(id)] = cols[layer.get(id)] || []).push(id);
  for (let i = 0; i < cols.length; i++) if (!cols[i]) cols[i] = [];
  const order = new Map();
  cols.forEach((c) => c.forEach((id, i) => order.set(id, i)));
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < cols.length; l++) {
      const bary = new Map(cols[l].map((id) => { const ps = [...ins.get(id)].filter((p) => layer.get(p) < l); return [id, ps.length ? ps.reduce((s, p) => s + order.get(p), 0) / ps.length : order.get(id)]; }));
      cols[l].sort((a, b) => bary.get(a) - bary.get(b));
      cols[l].forEach((id, i) => order.set(id, i));
    }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const heights = cols.map((c) => c.reduce((s, id) => s + heightOfNode(byId.get(id)) + L.gapY, -L.gapY));
  const maxH = Math.max(0, ...heights);
  const pos = {};
  cols.forEach((c, l) => {
    let y = (maxH - heights[l]) / 2;
    for (const id of c) { const h = heightOfNode(byId.get(id)); pos[id] = { x: l * (L.w + L.gapX), y, w: L.w, h }; y += h + L.gapY; }
  });
  return { pos, width: Math.max(0, cols.length * (L.w + L.gapX) - L.gapX), height: maxH };
}

/** Linha (índice na lista desenhada) de uma coluna dentro do nó, e a altura do seu centro. */
function colCenterY(graph, pos, nodeId, colIdx) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const vis = visibleColumns(node);
  let r = vis.findIndex((x) => x.idx === colIdx);
  if (r < 0) r = 0;
  r = Math.min(r, L.maxRows);
  return pos[nodeId].y + L.head + L.pad + r * L.row + L.row / 2;
}

/** De onde vem a coluna: percorre as arestas de coluna para trás. → { cols: Set('nó:idx'), edges: Set(índice), nodes: Set(id) } */
function upstream(graph, nodeId, colIdx) {
  const cols = new Set([`${nodeId}:${colIdx}`]), edges = new Set(), nodes = new Set([nodeId]);
  const into = new Map();
  graph.colEdges.forEach((e, i) => { const k = `${e.to.node}:${e.to.col}`; (into.get(k) || into.set(k, []).get(k)).push([e, i]); });
  const queue = [`${nodeId}:${colIdx}`];
  while (queue.length) {
    const k = queue.shift();
    for (const [e, i] of into.get(k) || []) {
      edges.add(i);
      const f = `${e.from.node}:${e.from.col}`;
      nodes.add(e.from.node);
      if (!cols.has(f)) { cols.add(f); queue.push(f); }
    }
  }
  return { cols, edges, nodes };
}

module.exports = { analyze, preprocess, layoutLineage, visibleColumns, infoLines, upstream, colCenterY, exprText, LIMITATIONS, LAYOUT: L };
