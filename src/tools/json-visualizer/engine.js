'use strict';
// Engine do JSON Visualizer: parse com posição de erro, formatação, modelo de grafo,
// layout em árvore (esquerda → direita), JSONPath e conversões. Puro: sem DOM nem Electron.

// ── Parse ────────────────────────────────────────────────────────────────────

/** Validador estrito que devolve a posição do primeiro erro (as mensagens do JSON.parse variam por versão). */
function findError(text) {
  let i = 0;
  const n = text.length;
  const fail = (pos, msg) => { const e = new Error(msg); e.pos = pos; throw e; };
  const unexpected = () => (i >= n ? fail(n, 'Fim inesperado do JSON') : fail(i, "Token inesperado '" + text[i] + "'"));
  const ws = () => { while (i < n && ' \t\n\r'.includes(text[i])) i++; };
  const lit = (word) => {
    if (text.startsWith(word, i)) i += word.length; else unexpected();
  };
  const str = () => {
    i++; // "
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail(i, 'Escape \\u inválido');
          i += 6;
        } else if (e && '"\\/bfnrt'.includes(e)) i += 2;
        else fail(i, 'Escape inválido na string');
      } else if (c < ' ') fail(i, 'Caractere de controle na string');
      else i++;
    }
    fail(n, 'String não terminada');
  };
  const num = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) unexpected();
    i += m[0].length;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') unexpected();
        str(); ws();
        if (text[i] !== ':') unexpected();
        i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        unexpected();
      }
    } else if (c === '[') {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        unexpected();
      }
    } else if (c === '"') str();
    else if (c === 't') lit('true');
    else if (c === 'f') lit('false');
    else if (c === 'n') lit('null');
    else if (c === '-' || (c >= '0' && c <= '9')) num();
    else unexpected();
  };
  try {
    value(); ws();
    if (i < n) unexpected();
  } catch (e) {
    if (e.pos === undefined) throw e;
    return { pos: e.pos, msg: e.message };
  }
  return null;
}

function parseJson(text) {
  if (!text || !text.trim()) return { ok: false, error: 'Entrada vazia', line: 1, col: 1 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const f = findError(text);
    const pos = f ? f.pos : 0;
    const before = text.slice(0, pos).split('\n');
    return { ok: false, error: f ? f.msg : String(e.message || e), line: before.length, col: before[before.length - 1].length + 1 };
  }
}

// ── Formatação ───────────────────────────────────────────────────────────────

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeysDeep(v[k]);
    return o;
  }
  return v;
}

function formatJson(value, indent = 2, sortKeys = false) {
  const v = sortKeys ? sortKeysDeep(value) : value;
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : indent);
}

const minifyJson = (value) => JSON.stringify(value);

// ── JSONPath ─────────────────────────────────────────────────────────────────

const IDENT = /^[A-Za-z_$][\w$]*$/;

function toJsonPath(segs) {
  let p = '$';
  for (const s of segs) {
    if (typeof s === 'number') p += '[' + s + ']';
    else if (IDENT.test(s)) p += '.' + s;
    else p += "['" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']";
  }
  return p;
}

const isContainer = (v) => v !== null && typeof v === 'object';
const childrenOf = (v) => (Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v));

function tokenizePath(expr) {
  const s = expr.trim();
  if (s[0] !== '$') throw new Error("A expressão JSONPath deve começar com '$'");
  const toks = [];
  let i = 1;
  while (i < s.length) {
    if (s.startsWith('..', i)) {
      i += 2;
      if (s[i] === '*') { toks.push({ t: 'deep', k: '*' }); i++; continue; }
      const m = /^[\w$]+/.exec(s.slice(i));
      if (!m) throw new Error("Esperado nome após '..'");
      toks.push({ t: 'deep', k: m[0] }); i += m[0].length;
    } else if (s[i] === '.') {
      i++;
      if (s[i] === '*') { toks.push({ t: 'all' }); i++; continue; }
      const m = /^[\w$]+/.exec(s.slice(i));
      if (!m) throw new Error("Esperado nome após '.'");
      toks.push({ t: 'key', k: m[0] }); i += m[0].length;
    } else if (s[i] === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new Error("Falta ']'");
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === '*') toks.push({ t: 'all' });
      else if (/^\d+$/.test(inner)) toks.push({ t: 'idx', k: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) toks.push({ t: 'key', k: inner.slice(1, -1) });
      else throw new Error('Índice não suportado: [' + inner + ']');
    } else throw new Error("Caractere inesperado '" + s[i] + "' na expressão");
  }
  return toks;
}

/** Subconjunto de JSONPath: $, .k, ['k'], [n], [*], .*, ..k. → [{ path, value }] */
function query(root, expr) {
  let cur = [{ segs: [], value: root }];
  for (const tok of tokenizePath(expr)) {
    const next = [];
    for (const { segs, value } of cur) {
      if (tok.t === 'key') {
        if (isContainer(value) && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, tok.k)) next.push({ segs: [...segs, tok.k], value: value[tok.k] });
      } else if (tok.t === 'idx') {
        if (Array.isArray(value) && tok.k < value.length) next.push({ segs: [...segs, tok.k], value: value[tok.k] });
      } else if (tok.t === 'all') {
        if (isContainer(value)) for (const [k, v] of childrenOf(value)) next.push({ segs: [...segs, k], value: v });
      } else if (tok.t === 'deep') {
        const walk = (v, sg) => {
          if (!isContainer(v)) return;
          if (tok.k === '*') { for (const [k, c] of childrenOf(v)) next.push({ segs: [...sg, k], value: c }); }
          else if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, tok.k)) next.push({ segs: [...sg, tok.k], value: v[tok.k] });
          for (const [k, c] of childrenOf(v)) walk(c, [...sg, k]);
        };
        walk(value, segs);
      }
    }
    cur = next;
  }
  return cur.map((r) => ({ path: toJsonPath(r.segs), value: r.value }));
}

// ── Grafo ────────────────────────────────────────────────────────────────────

const typeOf = (v) => (v === null ? 'null' : typeof v);
const MAX_VALUE_CHARS = 48;

function display(v) {
  let s = typeof v === 'string' ? JSON.stringify(v) : String(v);
  if (s.length > MAX_VALUE_CHARS) s = s.slice(0, MAX_VALUE_CHARS - 1) + '…';
  return s;
}

/**
 * Um nó por objeto/array. Linhas do nó = chaves com valor primitivo; filhos objeto/array viram arestas.
 * opts.collapsed: Set de paths cujos descendentes ficam ocultos.
 */
function buildGraph(root, opts = {}) {
  const collapsed = opts.collapsed || new Set();
  const nodes = [];
  const edges = [];

  const visit = (value, segs, depth, parentId, label) => {
    const path = toJsonPath(segs);
    const id = nodes.length;
    const node = { id, path, segs, depth, kind: 'primitive', rows: [], childCount: 0, collapsed: false, hiddenChildren: 0 };
    nodes.push(node);
    if (parentId !== null) edges.push({ from: parentId, to: id, label });

    if (!isContainer(value)) {
      node.rows.push({ key: '', value: display(value), type: typeOf(value) });
      return;
    }
    node.kind = Array.isArray(value) ? 'array' : 'object';
    const kids = [];
    for (const [k, v] of childrenOf(value)) {
      if (isContainer(v)) kids.push([k, v]);
      else node.rows.push({ key: typeof k === 'number' ? '[' + k + ']' : k, value: display(v), type: typeOf(v) });
    }
    node.childCount = kids.length;
    if (collapsed.has(path) && kids.length) {
      node.collapsed = true;
      node.hiddenChildren = kids.length;
      return;
    }
    for (const [k, v] of kids) visit(v, [...segs, k], depth + 1, id, typeof k === 'number' ? '[' + k + ']' : k);
  };

  visit(root, [], 0, null, '');
  return { nodes, edges };
}

// ── Layout ───────────────────────────────────────────────────────────────────

const L = { charW: 7.4, rowH: 22, padX: 12, padY: 8, minW: 64, gapX: 80, gapY: 18 };

/** Calcula x/y/w/h de cada nó (colunas por profundidade, pai centralizado nos filhos). */
function layoutTree(graph) {
  const { nodes, edges } = graph;
  const kids = nodes.map(() => []);
  for (const e of edges) kids[e.from].push(e.to);

  for (const n of nodes) {
    let chars = 2;
    for (const r of n.rows) chars = Math.max(chars, r.key.length + (r.key ? 2 : 0) + r.value.length);
    if (!n.rows.length) chars = 2;
    if (n.collapsed) chars = Math.max(chars, String(n.hiddenChildren).length + 12);
    n.w = Math.max(L.minW, Math.ceil(chars * L.charW) + L.padX * 2);
    n.h = Math.max(1, n.rows.length + (n.collapsed ? 1 : 0)) * L.rowH + L.padY * 2;
  }

  const colW = [];
  for (const n of nodes) colW[n.depth] = Math.max(colW[n.depth] || 0, n.w);
  const colX = [];
  let x = 0;
  for (let d = 0; d < colW.length; d++) { colX[d] = x; x += colW[d] + L.gapX; }

  const nextFree = [];
  let cursor = 0;
  const place = (id) => {
    const n = nodes[id];
    n.x = colX[n.depth];
    for (const c of kids[id]) place(c);
    let y;
    if (kids[id].length) {
      const first = nodes[kids[id][0]], last = nodes[kids[id][kids[id].length - 1]];
      y = (first.y + (last.y + last.h)) / 2 - n.h / 2;
    } else y = cursor;
    y = Math.max(y, nextFree[n.depth] || 0);
    if (!kids[id].length) cursor = y + n.h + L.gapY;
    n.y = y;
    nextFree[n.depth] = y + n.h + L.gapY;
  };
  if (nodes.length) place(0);

  let width = 0, height = 0;
  for (const n of nodes) { width = Math.max(width, n.x + n.w); height = Math.max(height, n.y + n.h); }
  return { width, height };
}

// ── Conversões ───────────────────────────────────────────────────────────────

const YAML_PLAIN = /^[A-Za-z_][\w \-./]*$/;
const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function yamlScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') {
    if (v && YAML_PLAIN.test(v) && !YAML_RESERVED.test(v) && v === v.trim()) return v;
    return JSON.stringify(v);
  }
  return String(v);
}
const yamlKey = (k) => (/^[A-Za-z_][\w.\-]*$/.test(k) && !YAML_RESERVED.test(k) ? k : JSON.stringify(k));
const emptyContainer = (v) => isContainer(v) && childrenOf(v).length === 0;
const inlineYaml = (v) => (!isContainer(v) ? yamlScalar(v) : Array.isArray(v) ? '[]' : '{}');

function yamlBlock(v, ind) {
  const pad = ' '.repeat(ind);
  const out = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!isContainer(item) || emptyContainer(item)) out.push(pad + '- ' + inlineYaml(item));
      else {
        const lines = yamlBlock(item, ind + 2);
        lines[0] = pad + '- ' + lines[0].slice(ind + 2);
        out.push(...lines);
      }
    }
  } else {
    for (const [k, item] of Object.entries(v)) {
      if (!isContainer(item) || emptyContainer(item)) out.push(pad + yamlKey(k) + ': ' + inlineYaml(item));
      else out.push(pad + yamlKey(k) + ':', ...yamlBlock(item, ind + 2));
    }
  }
  return out;
}

function toYaml(value) {
  if (!isContainer(value) || emptyContainer(value)) return inlineYaml(value);
  return yamlBlock(value, 0).join('\n');
}

/** Achata objetos (a.b) e arrays ([i]) em colunas; container vazio vira "{}" / "[]". */
function flatten(v, prefix, out) {
  if (isContainer(v) && childrenOf(v).length) {
    const arr = Array.isArray(v);
    for (const [k, c] of childrenOf(v)) flatten(c, arr ? prefix + '[' + k + ']' : prefix ? prefix + '.' + k : k, out);
  } else out[prefix || 'value'] = isContainer(v) ? (Array.isArray(v) ? '[]' : '{}') : v;
  return out;
}

const csvCell = (v) => {
  if (v === undefined || v === null) return '';
  const s = isContainer(v) ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Array na raiz → uma linha por item; qualquer outro valor → uma única linha. */
function toCsv(value) {
  const rows = (Array.isArray(value) ? value : [value]).map((item) => flatten(item, '', {}));
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

module.exports = {
  parseJson, formatJson, minifyJson, buildGraph, layoutTree, toJsonPath, query, toYaml, toCsv, LAYOUT: L,
};
