'use strict';
/**
 * SQL Visualizer — busca no diagrama ER. Puro (só lê o schema).
 *
 * searchSchema(schema, query) → null (consulta vazia) ou
 *   { tables: [id…]  — tabelas que casam (pelo nome ou por alguma coluna), na ordem do schema,
 *     columns: Set<colKey(id, nome)> — só as colunas cujo nome casa (para destacar no desenho) }
 */
const colKey = (tableId, name) => tableId + '\u0000' + name;

function searchSchema(schema, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !schema) return null;
  const tables = [];
  const columns = new Set();
  for (const t of schema.tables) {
    let hit = t.id.toLowerCase().includes(q);
    for (const c of t.columns) {
      if (c.name.toLowerCase().includes(q)) { columns.add(colKey(t.id, c.name)); hit = true; }
    }
    if (hit) tables.push(t.id);
  }
  return { tables, columns };
}

/** Próximo/anterior índice em círculo (dir = 1 ou -1). */
function stepIndex(cur, len, dir) {
  if (!len) return 0;
  return ((cur + dir) % len + len) % len;
}

module.exports = { searchSchema, colKey, stepIndex };
