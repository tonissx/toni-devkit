'use strict';
/**
 * SQL Visualizer — modelo de schema comum ao diagrama ER e ao explorador. Puro.
 *   { tables: [{ id:'dbo.Pedido', schema, name, columns:[{ name, type, nullable, pk, fk, unique, identity }], pk:[] }],
 *     fks:    [{ name, from:'dbo.Pedido', fromCols:[], to:'dbo.Cliente', toCols:[], oneToOne }], warnings:[] }
 * Entradas: DDL colado (ddl.js) ou o JSON gerado por SCHEMA_QUERY (queries.js), colado ou lido do servidor.
 */
const { parseDdl, finalize } = require('./ddl.js');

const str = (v) => (v == null ? '' : String(v));

/** Aceita o JSON da SCHEMA_QUERY como texto, objeto, ou as linhas devolvidas pela ferramenta (JSON partido em pedaços). */
function fromMetadata(input) {
  let data = input;
  if (typeof data === 'string') {
    const s = data.trim();
    if (!s) throw new Error('Cole o JSON do resultado da query de metadados.');
    try { data = JSON.parse(s); } catch (e) { throw new Error('JSON inválido: ' + e.message + '. Cole o resultado inteiro da query, sem cortar.'); }
  }
  // Linhas no formato [{ "col": "<json em pedaços>" }, …]: junta os pedaços e lê de novo.
  if (Array.isArray(data) && data.length && data.every((r) => r && typeof r === 'object' && !('tables' in r) && Object.keys(r).length === 1 && typeof Object.values(r)[0] === 'string')) {
    return fromMetadata(data.map((r) => Object.values(r)[0]).join(''));
  }
  if (Array.isArray(data) && data.length === 1 && data[0] && data[0].tables) data = data[0];
  if (!data || !Array.isArray(data.tables)) throw new Error('JSON sem a lista "tables". Use o resultado da query de metadados do Toni Devkit.');

  const warnings = [];
  const model = { tables: [], fks: [] };
  for (const t of data.tables) {
    const schema = str(t.schema) || 'dbo', name = str(t.name);
    if (!name) { warnings.push('Tabela sem nome ignorada.'); continue; }
    const pkCols = [];
    const columns = (t.columns || []).map((c) => {
      const pk = !!(c.pk || c.isPk);
      if (pk) pkCols.push(str(c.name));
      return { name: str(c.name), type: str(c.type), nullable: c.nullable !== false && c.nullable !== 0 && !pk, pk, fk: false, unique: !!c.unique, identity: !!c.identity };
    });
    model.tables.push({ id: `${schema}.${name}`, schema, name, columns, pk: pkCols });
  }
  for (const f of data.fks || []) {
    model.fks.push({
      name: f.name || null,
      from: { schema: str(f.fromSchema) || 'dbo', name: str(f.fromTable), cols: [].concat(f.fromCols || []).map(str) },
      to: { schema: str(f.toSchema) || 'dbo', name: str(f.toTable), cols: [].concat(f.toCols || []).map(str) },
    });
  }
  if (!model.tables.length) throw new Error('O JSON não tem nenhuma tabela.');
  return finalize(model, warnings);
}

/** Detecta se o texto é JSON (metadados) ou DDL e converte. */
function parseSchemaInput(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) throw new Error('Cole o DDL ou o JSON de metadados para gerar o diagrama.');
  return s[0] === '{' || s[0] === '[' ? fromMetadata(s) : parseDdl(s);
}

/** Tabelas ligadas por FK à tabela `id` (nos dois sentidos). */
function neighbors(schema, id) {
  const out = new Set();
  for (const f of schema.fks) {
    if (f.from === id) out.add(f.to);
    if (f.to === id) out.add(f.from);
  }
  out.delete(id);
  return out;
}

/** Vizinhas até `depth` níveis (BFS). Inclui os próprios `ids` no resultado. */
function expand(schema, ids, depth = 1) {
  const seen = new Set([].concat(ids));
  let frontier = [...seen];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const id of frontier) for (const n of neighbors(schema, id)) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}

/** Subconjunto do schema só com as tabelas de `ids` e as FKs entre elas. */
function subset(schema, ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  return { ...schema, tables: schema.tables.filter((t) => set.has(t.id)), fks: schema.fks.filter((f) => set.has(f.from) && set.has(f.to)) };
}

module.exports = { fromMetadata, parseSchemaInput, neighbors, expand, subset };
