'use strict';
/**
 * SQL Visualizer — parser de DDL (T-SQL) para o diagrama ER. Puro; nunca executa nada, só lê o texto.
 * Entende CREATE TABLE (colunas, PK/FK/UNIQUE inline ou nomeadas, chave composta) e ALTER TABLE ... ADD
 * [CONSTRAINT x] PRIMARY KEY / FOREIGN KEY. Identificadores com [colchetes], "aspas" ou crus; schema opcional (dbo).
 * O que não é reconhecido (índices, procedures, defaults complexos) é ignorado; avisos vão em `warnings`.
 */

/** Tira comentários (-- e / * * /) preservando strings e identificadores entre colchetes ou aspas. */
function stripComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) { if (sql[j + 1] === close) { j += 2; continue; } break; }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Tokens: identificador (já sem colchetes), número/string, ou pontuação de 1 caractere. */
function tokenize(sql) {
  const toks = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[' || c === '"') {
      const close = c === '[' ? ']' : '"';
      let j = i + 1, s = '';
      while (j < sql.length) {
        if (sql[j] === close) { if (sql[j + 1] === close) { s += close; j += 2; continue; } break; }
        s += sql[j++];
      }
      toks.push({ t: 'id', v: s, quoted: true });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      toks.push({ t: 'str', v: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_@#À-￿]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\w@#$À-￿]/.test(sql[j])) j++;
      toks.push({ t: 'id', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      toks.push({ t: 'num', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ t: 'p', v: c });
    i++;
  }
  return toks;
}

const up = (tok) => (tok && tok.t === 'id' && !tok.quoted ? tok.v.toUpperCase() : '');
const isP = (tok, v) => !!tok && tok.t === 'p' && tok.v === v;

/** Divide uma lista de tokens em grupos separados por vírgula de nível 0. */
function splitTop(toks) {
  const parts = [];
  let cur = [], depth = 0;
  for (const t of toks) {
    if (isP(t, '(')) depth++;
    if (isP(t, ')')) depth--;
    if (depth === 0 && isP(t, ',')) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** Nome possivelmente qualificado a partir de `pos`: [a].[b] → { schema, name, next }. Banco.schema.tabela fica com os 2 últimos. */
function readName(toks, pos) {
  const parts = [];
  let i = pos;
  while (toks[i] && toks[i].t === 'id') {
    parts.push(toks[i].v);
    if (isP(toks[i + 1], '.')) i += 2; else { i++; break; }
  }
  if (!parts.length) return null;
  const name = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : 'dbo';
  return { schema, name, next: i };
}

/** Lista de colunas entre parênteses: (a, b DESC) → ['a','b']. Retorna { cols, next }. */
function readCols(toks, pos) {
  if (!isP(toks[pos], '(')) return null;
  const cols = [];
  let i = pos + 1, depth = 1, expectName = true;
  while (i < toks.length && depth > 0) {
    const t = toks[i];
    if (isP(t, '(')) depth++;
    else if (isP(t, ')')) depth--;
    else if (depth === 1 && isP(t, ',')) expectName = true;
    else if (depth === 1 && expectName && t.t === 'id') { cols.push(t.v); expectName = false; }
    i++;
  }
  return { cols, next: i };
}

const key = (schema, name) => `${schema}.${name}`;

/** Tipo da coluna a partir dos tokens após o nome: varchar(50), decimal(10,2), nvarchar(max). */
function readType(toks, pos) {
  const base = toks[pos];
  if (!base || base.t !== 'id') return { type: '', next: pos };
  let type = base.v;
  let i = pos + 1;
  if (isP(toks[i], '.')) { type += '.' + (toks[i + 1] ? toks[i + 1].v : ''); i += 2; } // tipo de usuário com schema
  if (isP(toks[i], '(')) {
    let depth = 0, args = [];
    for (; i < toks.length; i++) {
      if (isP(toks[i], '(')) { depth++; continue; }
      if (isP(toks[i], ')')) { depth--; if (!depth) { i++; break; } continue; }
      if (!isP(toks[i], ',')) args.push(toks[i].v);
    }
    type += `(${args.join(',')})`;
  }
  return { type: type.toLowerCase(), next: i };
}

/** Lê um bloco `REFERENCES t (c)` a partir de `pos` (apontando para REFERENCES). */
function readRef(toks, pos) {
  const ref = readName(toks, pos + 1);
  if (!ref) return null;
  const rc = readCols(toks, ref.next);
  return { schema: ref.schema, name: ref.name, cols: rc ? rc.cols : [] };
}

function parseCreateTable(toks, start, model, warnings) {
  // start aponta para o token depois de CREATE TABLE
  let i = start;
  if (up(toks[i]) === 'IF' && up(toks[i + 1]) === 'NOT' && up(toks[i + 2]) === 'EXISTS') i += 3;
  const nm = readName(toks, i);
  if (!nm || !isP(toks[nm.next], '(')) { warnings.push('CREATE TABLE sem corpo ignorado.'); return nm ? nm.next : i + 1; }
  // acha o ")" que fecha o corpo
  let depth = 0, end = nm.next;
  for (; end < toks.length; end++) {
    if (isP(toks[end], '(')) depth++;
    if (isP(toks[end], ')')) { depth--; if (!depth) break; }
  }
  const body = toks.slice(nm.next + 1, end);
  const table = { id: key(nm.schema, nm.name), schema: nm.schema, name: nm.name, columns: [], pk: [] };
  const fks = [];
  const uniques = [];

  for (const part of splitTop(body)) {
    if (!part.length) continue;
    const first = up(part[0]);
    if (first === 'CONSTRAINT' || first === 'PRIMARY' || first === 'FOREIGN' || first === 'UNIQUE' || first === 'CHECK' || first === 'INDEX') {
      parseTableConstraint(part, table, fks, uniques);
      continue;
    }
    // coluna
    const col = { name: part[0].v, type: '', nullable: true, pk: false, fk: false, unique: false, identity: false };
    const ty = readType(part, 1);
    col.type = ty.type;
    for (let j = ty.next; j < part.length; j++) {
      const w = up(part[j]);
      if (w === 'NOT' && up(part[j + 1]) === 'NULL') { col.nullable = false; j++; }
      else if (w === 'NULL') col.nullable = true;
      else if (w === 'IDENTITY') col.identity = true;
      else if (w === 'PRIMARY' && up(part[j + 1]) === 'KEY') { table.pk.push(col.name); j++; }
      else if (w === 'UNIQUE') col.unique = true;
      else if (w === 'REFERENCES') {
        const r = readRef(part, j);
        if (r) fks.push({ name: null, from: { schema: table.schema, name: table.name, cols: [col.name] }, to: { schema: r.schema, name: r.name, cols: r.cols } });
      }
    }
    table.columns.push(col);
  }

  for (const c of table.columns) {
    c.pk = table.pk.includes(c.name);
    if (c.pk) c.nullable = false;
  }
  model.tables.push(table);
  model.fks.push(...fks);
  return end + 1;
}

function parseTableConstraint(part, table, fks) {
  let i = 0, cname = null;
  if (up(part[0]) === 'CONSTRAINT') { cname = part[1] ? part[1].v : null; i = 2; }
  const w = up(part[i]);
  if (w === 'PRIMARY') {
    const rc = readCols(part, i + 2 + (up(part[i + 2]) === 'CLUSTERED' || up(part[i + 2]) === 'NONCLUSTERED' ? 1 : 0));
    if (rc) table.pk.push(...rc.cols);
  } else if (w === 'FOREIGN') {
    const rc = readCols(part, i + 2);
    if (!rc) return;
    let j = rc.next;
    while (j < part.length && up(part[j]) !== 'REFERENCES') j++;
    const r = readRef(part, j);
    if (r) fks.push({ name: cname, from: { schema: table.schema, name: table.name, cols: rc.cols }, to: { schema: r.schema, name: r.name, cols: r.cols } });
  }
}

function parseAlterTable(toks, start, model, warnings) {
  const nm = readName(toks, start);
  if (!nm) return start + 1;
  let i = nm.next;
  // WITH [NO]CHECK / WITH NOCHECK
  if (up(toks[i]) === 'WITH') i += 2;
  if (up(toks[i]) !== 'ADD') return i; // outras alterações (ADD COLUMN sem constraint também cai aqui)
  i++;
  let cname = null;
  if (up(toks[i]) === 'CONSTRAINT') { cname = toks[i + 1] ? toks[i + 1].v : null; i += 2; }
  const w = up(toks[i]);
  if (w === 'FOREIGN' && up(toks[i + 1]) === 'KEY') {
    const rc = readCols(toks, i + 2);
    if (!rc) return i;
    let j = rc.next;
    if (up(toks[j]) !== 'REFERENCES') return j;
    const r = readRef(toks, j);
    if (r) model.fks.push({ name: cname, from: { schema: nm.schema, name: nm.name, cols: rc.cols }, to: { schema: r.schema, name: r.name, cols: r.cols } });
    return j + 1;
  }
  if (w === 'PRIMARY' && up(toks[i + 1]) === 'KEY') {
    let j = i + 2;
    if (up(toks[j]) === 'CLUSTERED' || up(toks[j]) === 'NONCLUSTERED') j++;
    const rc = readCols(toks, j);
    const t = model.tables.find((x) => x.id === key(nm.schema, nm.name));
    if (rc && t) {
      t.pk.push(...rc.cols);
      for (const c of t.columns) if (rc.cols.includes(c.name)) { c.pk = true; c.nullable = false; }
    } else if (rc) warnings.push(`PRIMARY KEY em ${nm.schema}.${nm.name} antes do CREATE TABLE foi ignorada.`);
    return rc ? rc.next : j;
  }
  return i;
}

/**
 * parseDdl(texto) → { tables, fks, warnings }. Lança Error (pt-BR) se o texto estiver vazio ou nada for reconhecido.
 * Sem efeitos colaterais: é só leitura de texto.
 */
function parseDdl(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) throw new Error('Cole o DDL (CREATE TABLE / ALTER TABLE) para gerar o diagrama.');
  const toks = tokenize(stripComments(src));
  const model = { tables: [], fks: [] };
  const warnings = [];
  for (let i = 0; i < toks.length;) {
    if (up(toks[i]) === 'CREATE' && up(toks[i + 1]) === 'TABLE') { i = parseCreateTable(toks, i + 2, model, warnings); continue; }
    if (up(toks[i]) === 'ALTER' && up(toks[i + 1]) === 'TABLE') { i = parseAlterTable(toks, i + 2, model, warnings); continue; }
    i++;
  }
  if (!model.tables.length) throw new Error('Nenhum CREATE TABLE reconhecido. Confira se o texto é DDL do SQL Server.');
  return finalize(model, warnings);
}

/** Resolve FKs contra as tabelas (marca colunas FK, descarta as que apontam para tabela ausente com aviso). */
function finalize(model, warnings = []) {
  const byId = new Map(model.tables.map((t) => [t.id, t]));
  const fks = [];
  for (const fk of model.fks) {
    const from = byId.get(key(fk.from.schema, fk.from.name));
    const to = byId.get(key(fk.to.schema, fk.to.name));
    if (!from || !to) {
      warnings.push(`FK ${fk.name || ''} (${fk.from.schema}.${fk.from.name} → ${fk.to.schema}.${fk.to.name}) ignorada: tabela fora do DDL colado.`.replace('  ', ' '));
      continue;
    }
    const toCols = fk.to.cols.length ? fk.to.cols : to.pk;
    for (const c of from.columns) if (fk.from.cols.includes(c.name)) c.fk = true;
    fks.push({
      name: fk.name || `FK_${from.name}_${to.name}`,
      from: from.id, fromCols: fk.from.cols,
      to: to.id, toCols,
      // Cardinalidade: FK única na origem (coluna UNIQUE ou PK inteira) vira 1:1; o padrão é 1:N (pai → filho).
      oneToOne: fk.from.cols.length > 0 && (sameSet(fk.from.cols, from.pk) || (fk.from.cols.length === 1 && !!from.columns.find((c) => c.name === fk.from.cols[0] && c.unique))),
    });
  }
  return { tables: model.tables, fks, warnings };
}

const sameSet = (a, b) => a.length === b.length && a.length > 0 && a.every((x) => b.includes(x));

module.exports = { parseDdl, finalize, stripComments, tokenize };
