'use strict';
/**
 * DDL (ou o JSON de metadados do SQL Visualizer) → `erDiagram` do Mermaid. Puro; nunca executa nada.
 * Reaproveita o parser do SQL Visualizer (src/db/schema.js), então entende o mesmo T-SQL.
 *
 * Cardinalidade: o lado do pai é "exatamente um" (||) se todas as colunas da FK são NOT NULL, senão "zero ou um" (|o);
 * o lado do filho é "zero ou mais" (o{), ou "zero ou um" (o|) quando a FK é 1:1. A linha é cheia (identificadora)
 * quando a FK faz parte da chave primária do filho, pontilhada nos demais casos.
 */
const { parseSchemaInput } = require('../db/schema.js');

const ident = (s) => String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || '_';
const quote = (s) => `"${String(s).replace(/"/g, "'")}"`;

/** Tipo aceito pelo Mermaid: começa com letra; só letras, dígitos, _ - ( ) [ ]. "decimal(10,2)" → "decimal(10_2)". */
function typeOf(t) {
  const s = String(t || '').trim().replace(/\s+/g, '_').replace(/,/g, '_').replace(/[^A-Za-z0-9_\-()[\]]/g, '');
  return /^[A-Za-z]/.test(s) ? s : 'unknown';
}

/** Nome de cada entidade: o da tabela; com o schema na frente se não for dbo ou se o nome se repete em outro schema. */
function entityNames(tables) {
  const count = new Map();
  for (const t of tables) count.set(t.name, (count.get(t.name) || 0) + 1);
  const names = new Map();
  const used = new Set();
  for (const t of tables) {
    const full = t.schema && (t.schema !== 'dbo' || count.get(t.name) > 1) ? `${t.schema}_${t.name}` : t.name;
    let id = ident(full), n = 2;
    while (used.has(id)) id = ident(full) + '_' + n++;
    used.add(id);
    names.set(t.id, { id, label: t.schema && t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name });
  }
  return names;
}

/** Schema (formato de src/db/schema.js) → texto Mermaid. */
function schemaToMermaid(schema) {
  const names = entityNames(schema.tables);
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const fkCols = new Map(schema.tables.map((t) => [t.id, new Set()]));
  for (const f of schema.fks) if (fkCols.has(f.from)) f.fromCols.forEach((c) => fkCols.get(f.from).add(c));

  const out = ['erDiagram'];
  for (const f of schema.fks) {
    const child = byId.get(f.from), parent = byId.get(f.to);
    if (!child || !parent) continue; // FK para tabela que não está no texto colado
    const nullable = f.fromCols.some((c) => { const col = child.columns.find((x) => x.name === c); return !col || col.nullable; });
    const identifying = f.fromCols.length > 0 && f.fromCols.every((c) => child.pk.includes(c));
    const label = f.name || f.fromCols.join(', ') || 'fk';
    out.push(`  ${names.get(f.to).id} ${nullable ? '|o' : '||'}${identifying ? '--' : '..'}${f.oneToOne ? 'o|' : 'o{'} ${names.get(f.from).id} : ${quote(label)}`);
  }
  if (schema.fks.length) out.push('');

  for (const t of schema.tables) {
    const { id, label } = names.get(t.id);
    const head = label === id ? id : `${id}[${quote(label)}]`;
    if (!t.columns.length) { out.push(`  ${head}`); continue; }
    out.push(`  ${head} {`);
    for (const c of t.columns) {
      const keys = [];
      if (c.pk) keys.push('PK');
      if (fkCols.get(t.id).has(c.name)) keys.push('FK');
      if (c.unique && !c.pk) keys.push('UK');
      out.push(`    ${typeOf(c.type)} ${ident(c.name)}${keys.length ? ' ' + keys.join(', ') : ''}${c.identity ? ' ' + quote('identity') : ''}`);
    }
    out.push('  }');
  }
  return out.join('\n') + '\n';
}

/** Texto colado (DDL T-SQL ou JSON de metadados) → { code, warnings, tables }. Lança Error com mensagem para a tela. */
function ddlToMermaid(text) {
  const schema = parseSchemaInput(text);
  if (!schema.tables.length) throw new Error('Nenhuma tabela encontrada no texto colado.');
  return { code: schemaToMermaid(schema), warnings: schema.warnings || [], tables: schema.tables.length };
}

module.exports = { ddlToMermaid, schemaToMermaid, typeOf };
