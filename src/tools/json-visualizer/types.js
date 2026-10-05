'use strict';
/**
 * JSON → tipos (TypeScript, C# e JSON Schema). JS puro e determinístico: infere a forma de todos os exemplos (objetos de
 * um array viram um tipo só; campo que falta em algum vira opcional; tipos diferentes viram união) e escreve o código.
 * Testado em scripts/test-json-types.mjs.
 */

/* ───────── Inferência ───────── */

// Formas: { k: 'string'|'integer'|'number'|'boolean'|'null'|'unknown' } | { k: 'array', items } |
//         { k: 'object', fields: Map<nome, { t, optional }>, name } | { k: 'union', types: [...] }

function infer(v) {
  if (v === null) return { k: 'null' };
  if (Array.isArray(v)) return { k: 'array', items: v.length ? v.map(infer).reduce(merge) : { k: 'unknown' } };
  switch (typeof v) {
    case 'string': return { k: 'string' };
    case 'number': return { k: Number.isInteger(v) ? 'integer' : 'number' };
    case 'boolean': return { k: 'boolean' };
    case 'object': {
      const fields = new Map();
      for (const [key, val] of Object.entries(v)) fields.set(key, { t: infer(val), optional: false });
      return { k: 'object', fields };
    }
    default: return { k: 'unknown' };
  }
}

const members = (t) => (t.k === 'union' ? t.types : [t]);

/** Junta duas formas (dois exemplos do mesmo lugar). */
function merge(a, b) {
  if (a.k === 'unknown') return b;
  if (b.k === 'unknown') return a;
  const out = [];
  for (const t of [...members(a), ...members(b)]) {
    const i = out.findIndex((x) => x.k === t.k || (isNum(x) && isNum(t)));
    if (i < 0) { out.push(t); continue; }
    const x = out[i];
    if (isNum(x) && isNum(t)) out[i] = { k: x.k === 'number' || t.k === 'number' ? 'number' : 'integer' };
    else if (x.k === 'array') out[i] = { k: 'array', items: merge(x.items, t.items) };
    else if (x.k === 'object') out[i] = mergeObjects(x, t);
  }
  return out.length === 1 ? out[0] : { k: 'union', types: out };
}
const isNum = (t) => t.k === 'integer' || t.k === 'number';

function mergeObjects(a, b) {
  const fields = new Map();
  for (const [key, f] of a.fields) {
    const g = b.fields.get(key);
    fields.set(key, g ? { t: merge(f.t, g.t), optional: f.optional || g.optional } : { t: f.t, optional: true });
  }
  for (const [key, g] of b.fields) if (!a.fields.has(key)) fields.set(key, { t: g.t, optional: true });
  return { k: 'object', fields };
}

/* ───────── Nomes ───────── */

const pascal = (s) => {
  const p = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(p) ? 'T' + p : p || 'Item';
};

/** Plural → singular, o bastante para nomes de tipo (pt e en). */
function singular(s) {
  if (/ões$/i.test(s)) return s.replace(/ões$/i, 'ão');
  if (/ães$/i.test(s)) return s.replace(/ães$/i, 'ão');
  if (/ens$/i.test(s)) return s.replace(/ens$/i, 'em');
  if (/ies$/i.test(s) && s.length > 4) return s.replace(/ies$/i, 'y');
  if (/(ss|us|is)$/i.test(s)) return s;
  if (/s$/i.test(s) && s.length > 3) return s.slice(0, -1);
  return s + 'Item';
}

/** Dá nome a cada objeto (pelo caminho), sem repetir. */
function nameObjects(root, rootName) {
  const used = new Set();
  const list = [];
  const unique = (n) => { let x = n; let i = 2; while (used.has(x)) x = n + i++; used.add(x); return x; };
  // hint é o nome cru da chave (com acentos): o singular vem antes de virar PascalCase ("opções" → "opção" → Opcao).
  const walk = (t, hint) => {
    if (t.k === 'object') {
      if (!t.name) { t.name = unique(pascal(hint)); list.push(t); }
      for (const [key, f] of t.fields) walk(f.t, key);
    } else if (t.k === 'array') walk(t.items, singular(hint));
    else if (t.k === 'union') t.types.forEach((x) => walk(x, hint));
  };
  walk(root, rootName);
  return list;
}

/* ───────── TypeScript ───────── */

const tsKey = (k) => (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(k) ? k : JSON.stringify(k));
function tsType(t) {
  switch (t.k) {
    case 'string': case 'boolean': case 'null': return t.k;
    case 'integer': case 'number': return 'number';
    case 'object': return t.name;
    case 'array': { const i = tsType(t.items); return t.items.k === 'union' ? `(${i})[]` : `${i}[]`; }
    case 'union': return [...new Set(t.types.map(tsType))].join(' | ');
    default: return 'unknown';
  }
}
function toTypeScript(t, list) {
  const out = list.map((o) => `export interface ${o.name} {\n${[...o.fields].map(([k, f]) => `  ${tsKey(k)}${f.optional ? '?' : ''}: ${tsType(f.t)};`).join('\n')}\n}`);
  if (t.k !== 'object') out.unshift(`export type Root = ${tsType(t)};`);
  return out.join('\n\n') + '\n';
}

/* ───────── C# ───────── */

const CS_RESERVED = new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(' '));
function csType(t) {
  const nonNull = members(t).filter((x) => x.k !== 'null');
  const nullable = nonNull.length < members(t).length;
  if (nonNull.length !== 1) return nonNull.length === 0 ? 'object?' : 'object';
  const x = nonNull[0];
  const base = { string: 'string', integer: 'long', number: 'double', boolean: 'bool', object: x.name, array: x.k === 'array' ? `List<${csType(x.items)}>` : '', unknown: 'object' }[x.k] || 'object';
  return nullable || x.k === 'unknown' ? base + '?' : base;
}
function toCSharp(t, list) {
  const cls = list.map((o) => {
    const props = [...o.fields].map(([k, f]) => {
      let prop = pascal(k);
      if (prop === o.name) prop += 'Value';
      if (CS_RESERVED.has(prop.toLowerCase()) && prop === prop.toLowerCase()) prop = '@' + prop;
      let type = csType(f.t);
      if (f.optional && !type.endsWith('?')) type += '?';
      return `    [JsonPropertyName(${JSON.stringify(k)})]\n    public ${type} ${prop} { get; set; }`;
    });
    return `public class ${o.name}\n{\n${props.join('\n\n')}\n}`;
  });
  const head = 'using System.Collections.Generic;\nusing System.Text.Json.Serialization;\n\n';
  const root = t.k === 'object' ? '' : `// O JSON é ${t.k === 'array' ? 'uma lista' : 'um valor'}: desserialize como ${csType(t)}\n\n`;
  return head + root + cls.join('\n\n') + '\n';
}

/* ───────── JSON Schema ───────── */

function schemaOf(t) {
  switch (t.k) {
    case 'string': case 'integer': case 'number': case 'boolean': case 'null': return { type: t.k };
    case 'array': return { type: 'array', items: schemaOf(t.items) };
    case 'object': {
      const properties = {};
      const required = [];
      for (const [k, f] of t.fields) { properties[k] = schemaOf(f.t); if (!f.optional) required.push(k); }
      return { type: 'object', properties, ...(required.length ? { required } : {}) };
    }
    case 'union': {
      const all = t.types.map(schemaOf);
      if (all.every((s) => Object.keys(s).length === 1 && s.type)) return { type: all.map((s) => s.type) };
      return { anyOf: all };
    }
    default: return {};
  }
}
const toSchema = (t) => JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...schemaOf(t) }, null, 2) + '\n';

/* ───────── Entrada ───────── */

const LANGS = [
  { value: 'ts', label: 'TypeScript' },
  { value: 'cs', label: 'C#' },
  { value: 'schema', label: 'JSON Schema' },
];

/** valor JSON já interpretado → código. lang: 'ts' | 'cs' | 'schema'. */
function generateTypes(value, lang = 'ts', rootName = 'Root') {
  const t = infer(value);
  const list = nameObjects(t, rootName);
  if (lang === 'cs') return toCSharp(t, list);
  if (lang === 'schema') return toSchema(t);
  return toTypeScript(t, list);
}

module.exports = { generateTypes, infer, merge, singular, pascal, LANGS };
