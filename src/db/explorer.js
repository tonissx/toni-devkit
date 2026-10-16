'use strict';
/**
 * SQL Visualizer — regras puras do explorador de schemas grandes: filtro por busca/schema/prefixo, módulos (grupos),
 * posicionamento de tabelas novas sem sobrepor, layout por grupo e (de)serialização dos "layouts" nomeados.
 * O canvas começa vazio; só as tabelas adicionadas existem na tela (por isso centenas de tabelas não travam).
 */
const { layoutEr, heightOf, ER } = require('./erlayout.js');
const { subset } = require('./schema.js');

const norm = (s) => String(s || '').toLowerCase();

/** Ids das tabelas que passam nos filtros. q: busca em nome/schema/colunas; schemas: Set (vazio/null = todos); prefixes: ['TMOV','F']. */
function filterTables(schema, { q = '', schemas = null, prefixes = [] } = {}) {
  const text = norm(q).trim();
  const pf = prefixes.map(norm).filter(Boolean);
  const out = [];
  for (const t of schema.tables) {
    if (schemas && schemas.size && !schemas.has(t.schema)) continue;
    const name = norm(t.name);
    if (pf.length && !pf.some((p) => name.startsWith(p))) continue;
    if (text) {
      const hit = name.includes(text) || norm(t.id).includes(text) || t.columns.some((c) => norm(c.name).includes(text));
      if (!hit) continue;
    }
    out.push(t);
  }
  // Nome primeiro, depois quem começa pela busca (mais relevante no topo).
  out.sort((a, b) => {
    const sa = text && norm(a.name).startsWith(text) ? 0 : 1, sb = text && norm(b.name).startsWith(text) ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema);
  });
  return out.map((t) => t.id);
}

/** Texto "TMOV, F" → ['TMOV','F']. */
const parsePrefixes = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Módulo da tabela: 'schema' | 'prefix' (antes do 1º "_", senão a 1ª palavra em CamelCase) | 'letters' (n primeiras letras). */
function moduleOf(table, mode, n = 2) {
  if (mode === 'schema') return table.schema || 'dbo';
  if (mode === 'prefix') {
    const m = /^([^_]+)_/.exec(table.name);
    if (m) return m[1];
    const c = /^([A-Z]?[a-z0-9]+|[A-Z]+(?![a-z]))/.exec(table.name);
    return c ? c[1] : table.name;
  }
  if (mode === 'letters') return table.name.slice(0, Math.max(1, n)).toUpperCase();
  return '';
}

/** Cor estável por módulo (HSL), boa nos dois temas por usar pouca opacidade no preenchimento. */
function moduleColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Onde pôr uma tabela nova: à direita da âncora (uma vizinha já no canvas), descendo até achar espaço livre; sem âncora,
 * abaixo de tudo. `boxes`: caixas {x,y,w,h} existentes.
 */
function placeNear(boxes, anchor, size, gap = 40) {
  const w = size.w, h = size.h;
  if (!anchor) {
    if (!boxes.length) return { x: 0, y: 0 };
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const left = Math.min(...boxes.map((b) => b.x));
    return { x: left, y: bottom + gap };
  }
  const cand = { x: anchor.x + anchor.w + gap * 2, y: anchor.y, w, h };
  for (let i = 0; i < 2000; i++) {
    if (!boxes.some((b) => overlaps(cand, b, gap / 2))) return { x: cand.x, y: cand.y };
    cand.y += 28;
    if (i % 40 === 39) { cand.x += w + gap; cand.y = anchor.y; } // coluna cheia: vai para a direita
  }
  return { x: cand.x, y: cand.y };
}

/** Caixa que envolve os nós de cada grupo. groupOf(id) → chave ('' = sem grupo). */
function groupRects(nodes, groupOf, pad = 18) {
  const by = new Map();
  for (const [id, n] of Object.entries(nodes)) {
    const k = groupOf(id);
    if (!k) continue;
    const g = by.get(k) || { key: k, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0 };
    g.x0 = Math.min(g.x0, n.x); g.y0 = Math.min(g.y0, n.y); g.x1 = Math.max(g.x1, n.x + n.w); g.y1 = Math.max(g.y1, n.y + n.h); g.count++;
    by.set(k, g);
  }
  return [...by.values()].map((g) => ({ key: g.key, count: g.count, color: moduleColor(g.key), x: g.x0 - pad, y: g.y0 - pad - 14, w: g.x1 - g.x0 + pad * 2, h: g.y1 - g.y0 + pad * 2 + 14 }));
}

/**
 * Reorganiza o canvas: sem grupos, um layout em camadas; com grupos, cada módulo é organizado por dentro e os módulos
 * são empacotados em linhas (cada um com seu retângulo). Retorna { pos: { id: {x,y} } }.
 */
function layoutAll(schema, groupOf) {
  const sub = schema;
  if (!groupOf) {
    const L = layoutEr(sub);
    return Object.fromEntries(Object.entries(L.nodes).map(([id, n]) => [id, { x: n.x, y: n.y }]));
  }
  const groups = new Map();
  for (const t of sub.tables) {
    const k = groupOf(t.id) || '~sem módulo';
    (groups.get(k) || groups.set(k, []).get(k)).push(t.id);
  }
  const blocks = [...groups.entries()].map(([key, ids]) => {
    const L = layoutEr(subset(sub, ids));
    return { key, nodes: L.nodes, w: L.width + 60, h: L.height + 60 };
  }).sort((a, b) => b.h * b.w - a.h * a.w);
  const total = blocks.reduce((s, b) => s + b.w * b.h, 0);
  const rowW = Math.max(1600, Math.sqrt(total) * 1.6);
  const pos = {};
  let x = 0, y = 0, rowH = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > rowW) { x = 0; y += rowH + 60; rowH = 0; }
    for (const [id, n] of Object.entries(b.nodes)) pos[id] = { x: x + 30 + n.x, y: y + 30 + n.y };
    x += b.w + 40;
    rowH = Math.max(rowH, b.h);
  }
  return pos;
}

/** Caixas {x,y,w,h} dos nós do canvas a partir de posições + alturas. */
function boxesOf(schema, ids, pos) {
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const nodes = {};
  for (const id of ids) {
    const t = byId.get(id), p = pos[id];
    if (t && p) nodes[id] = { x: p.x, y: p.y, w: ER.w, h: heightOf(t) };
  }
  return nodes;
}

/** Layout nomeado → objeto simples (JSON). */
const serializeLayout = ({ ids, pos, group }) => ({ v: 1, ids: [...ids], pos: Object.fromEntries([...ids].map((id) => [id, pos[id]]).filter(([, p]) => p).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }])), group: group || { mode: 'none', n: 2 }, savedAt: Date.now() });

/** Aplica um layout salvo a um schema: ignora tabelas que não existem mais e diz quantas faltaram. */
function restoreLayout(schema, saved) {
  if (!saved || !Array.isArray(saved.ids)) return { ids: [], pos: {}, missing: 0, group: { mode: 'none', n: 2 } };
  const have = new Set(schema.tables.map((t) => t.id));
  const ids = saved.ids.filter((id) => have.has(id));
  const pos = {};
  for (const id of ids) if (saved.pos && saved.pos[id] && Number.isFinite(saved.pos[id].x) && Number.isFinite(saved.pos[id].y)) pos[id] = saved.pos[id];
  return { ids, pos, missing: saved.ids.length - ids.length, group: saved.group && saved.group.mode ? saved.group : { mode: 'none', n: 2 } };
}

/** Chave do conjunto de layouts: servidor·banco quando vem do servidor (estável mesmo se criarem tabelas); texto colado usa um hash dos nomes. */
function schemaKey(label, schema) {
  if (label) return label;
  let h = 5381;
  for (const t of schema.tables) for (let i = 0; i < t.id.length; i++) h = ((h * 33) ^ t.id.charCodeAt(i)) >>> 0;
  return `texto|${schema.tables.length}|${h.toString(36)}`;
}

module.exports = { filterTables, parsePrefixes, moduleOf, moduleColor, placeNear, groupRects, layoutAll, boxesOf, serializeLayout, restoreLayout, schemaKey };
