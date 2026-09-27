'use strict';
/**
 * Domínio de Notes — o modelo de uma nota e as regras derivadas do conteúdo. JS puro.
 * Usado pelo processo principal (serviço/persistência) e pelos renderers (UI, palette).
 */
const { normalize } = require('../commands/search.js');

const TYPES = ['note', 'snippet'];

/** Id ordenável por data e legível no nome do arquivo: 20260926-142100-x7k2. */
function newId(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${rnd}`;
}

/** Nota completa a partir de campos parciais (padrões para o resto). */
function createNote(partial = {}) {
  const now = new Date().toISOString();
  const n = {
    id: newId(),
    title: '',
    content: '',
    type: 'note',
    tags: [],
    aliases: [],
    pinned: false,
    favorite: false,
    quick: false,
    created: now,
    updated: now,
    ...partial,
  };
  n.type = TYPES.includes(n.type) ? n.type : 'note';
  n.tags = uniq((n.tags || []).map(normTag).filter(Boolean));
  n.aliases = uniq((n.aliases || []).map((a) => String(a).trim()).filter(Boolean));
  return n;
}

const uniq = (arr) => [...new Set(arr)];
const normTag = (t) => String(t || '').trim().replace(/^#+/, '').toLowerCase();

/* ─────────────── Markdown: código ─────────────── */
const FENCE_RE = /^(```|~~~)([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;

/** Remove só os blocos de código cercados (``` / ~~~). */
const removeFences = (md) => String(md || '').replace(FENCE_RE, '');

/** Remove blocos e trechos de código (tags e links dentro de código não contam). */
const stripCode = (md) => String(md || '').replace(FENCE_RE, '').replace(/`[^`\n]*`/g, '');

/** Blocos de código cercados: [{ lang, code }]. */
function codeBlocks(md) {
  const out = [];
  for (const m of String(md || '').matchAll(FENCE_RE)) out.push({ lang: m[2].trim().split(/\s+/)[0] || '', code: m[3].replace(/\n$/, '') });
  return out;
}

/** O que um snippet copia: os blocos de código juntos, ou o conteúdo inteiro se não houver bloco. */
function snippetCode(note) {
  const blocks = codeBlocks(note.content);
  return blocks.length ? blocks.map((b) => b.code).join('\n\n') : String(note.content || '').trim();
}

/* ─────────────── Tags e links ─────────────── */
const TAG_RE = /(^|[\s(,;])#(\p{L}[\p{L}\p{N}_\-./]*)/gu;

/** #tags escritas no texto (fora de código). "# Título" é heading, não tag. */
function inlineTags(content) {
  const out = [];
  for (const m of stripCode(content).matchAll(TAG_RE)) out.push(normTag(m[2].replace(/[.\-/]+$/, '')));
  return uniq(out.filter(Boolean));
}

/** Tags do front matter + #tags do texto. */
const allTags = (note) => uniq([...(note.tags || []).map(normTag), ...inlineTags(note.content)]).filter(Boolean);

const LINK_RE = /\[\[([^[\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

/** Títulos referenciados com [[Título]] ou [[Título|texto]] (fora de código). */
function wikiLinks(content) {
  return uniq([...stripCode(content).matchAll(LINK_RE)].map((m) => m[1].trim()).filter(Boolean));
}

/* ─────────────── Título e trecho ─────────────── */

/** Remove a marcação de markdown de uma linha (para títulos derivados e trechos). */
const plainLine = (line) => String(line)
  .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
  .replace(/!?\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_~`]+/g, '')
  .trim();

/** Título exibido: o título, ou a 1ª linha com texto do conteúdo (Quick Notes não têm título). */
function displayTitle(note) {
  const t = String(note.title || '').trim();
  if (t) return t;
  const body = String(note.content || '').replace(FENCE_RE, '');
  for (const line of body.split('\n')) {
    // #tags não fazem parte do título derivado ("lembrar do COALESCE #sql" → "lembrar do COALESCE").
    const p = plainLine(line).replace(/(^|\s)#\p{L}[\p{L}\p{N}_\-./]*/gu, '').trim();
    if (p) return p.length > 80 ? p.slice(0, 79) + '…' : p;
  }
  return 'Sem título';
}

/**
 * Trecho do conteúdo em volta do primeiro termo encontrado, para mostrar *por que* a nota casou.
 * Retorna { text, ranges: [[início, fim], …] } com os termos destacáveis dentro do trecho.
 */
function excerpt(content, terms = [], max = 120) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  const nflat = normalize(flat); // mesmo comprimento (texto NFC) → índices valem para os dois
  const ts = terms.map((t) => normalize(t)).filter(Boolean);
  let at = -1;
  for (const t of ts) { const i = nflat.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  let start = 0;
  if (at > max / 3) start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max));
  // Começa numa fronteira de palavra para não cortar no meio.
  if (start > 0) { const sp = flat.indexOf(' ', start); if (sp !== -1 && sp < at) start = sp + 1; }
  const end = Math.min(flat.length, start + max);
  const text = (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
  const shift = start > 0 ? 1 - start : -start;
  const ranges = [];
  for (const t of ts) {
    for (let i = nflat.indexOf(t, start); i !== -1 && i + t.length <= end; i = nflat.indexOf(t, i + t.length)) {
      ranges.push([i + shift, i + t.length + shift]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  return { text, ranges };
}

module.exports = {
  TYPES, newId, createNote, normTag, codeBlocks, snippetCode, inlineTags, allTags, wikiLinks,
  plainLine, displayTitle, excerpt, stripCode, removeFences,
};
