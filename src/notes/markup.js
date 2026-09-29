'use strict';
/**
 * Formatação inteligente no editor de Notes — funções puras: (texto, seleção) → { value, start, end } | null.
 * - Colar tabela (texto separado por tab: Excel, SSMS, Google Sheets, tabelas do navegador) → tabela Markdown.
 * - Colar uma URL com texto selecionado → [texto](url).
 * - Ctrl+B / Ctrl+I → negrito / itálico (alterna) · Ctrl+K com seleção → link ·
 *   Ctrl+Shift+K → `código` (trecho de uma linha) ou bloco ``` (sem seleção / várias linhas).
 * Nada disso age dentro de bloco de código cercado (lá o texto colado fica como veio).
 */
const { insertBlock, inFence } = require('./edit.js');

const URL_RE = /^(?:https?:\/\/|mailto:)\S+$/i;
const NUM_RE = /^[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?%?$/;
const LINE_PREFIX_RE = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s*)?/;
const PAD_MAX = 40; // colunas mais largas que isso não são alinhadas com espaços no .md

/** TSV com as aspas do Excel (célula "a""b" ou com quebra de linha dentro). */
function parseTsv(text) {
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const cellText = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|');

/**
 * Texto colado → tabela Markdown, ou null se não parece tabela.
 * Exige ≥ 2 linhas, ≥ 2 colunas e o mesmo número de colunas em todas (evita pegar código indentado com tab).
 * A 1ª linha vira cabeçalho; colunas só com números ficam alinhadas à direita.
 */
function tableFromText(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.includes('\t') || !src.includes('\n')) return null;
  const rows = parseTsv(src).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return null;
  const cols = rows[0].length;
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
  // Código indentado com tab: a 1ª coluna sai sempre vazia.
  if (rows.every((r) => !r[0].trim())) return null;
  const cells = rows.map((r) => r.map(cellText));
  const body = cells.slice(1);
  const right = cells[0].map((_, c) => {
    const vals = body.map((r) => r[c]).filter((v) => v && !/^null$/i.test(v));
    return vals.length > 0 && vals.every((v) => NUM_RE.test(v));
  });
  const width = cells[0].map((_, c) => Math.min(PAD_MAX, Math.max(3, ...cells.map((r) => r[c].length))));
  const fmt = (r) => '| ' + r.map((v, c) => (right[c] ? v.padStart(width[c]) : v.padEnd(width[c]))).join(' | ') + ' |';
  const sep = '| ' + width.map((w, c) => (right[c] ? '-'.repeat(w - 1) + ':' : '-'.repeat(w))).join(' | ') + ' |';
  return [fmt(cells[0]), sep, ...body.map(fmt)].join('\n');
}

/** Colar texto: tabela → bloco de tabela; URL sobre seleção de uma linha → [seleção](url). Senão null. */
function smartPaste(value, start, end, text) {
  if (inFence(value, start)) return null;
  const table = tableFromText(text);
  if (table) return insertBlock(value, start, end, table, { blankLines: true });
  const sel = value.slice(start, end);
  const url = String(text || '').trim();
  if (sel && !sel.includes('\n') && sel.trim() && URL_RE.test(url) && !URL_RE.test(sel.trim())) {
    const ins = `[${sel}](${url})`;
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
  }
  return null;
}

/** Seleção sem os espaços das pontas (duplo clique no Windows pega o espaço depois da palavra). */
function trimSel(value, start, end) {
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  return [start, end];
}

/**
 * Alterna um marcador em volta da seleção (** negrito, * itálico, ` código).
 * Sem seleção: insere o par e deixa o cursor no meio. Já marcado (dentro ou logo fora da seleção): desmarca.
 * Seleção com várias linhas: marca cada linha não vazia.
 */
function toggleWrap(value, start, end, mark) {
  const m = mark.length;
  if (start === end) {
    // Cursor entre um par vazio ("**|**"): desfaz.
    if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark) {
      return { value: value.slice(0, start - m) + value.slice(end + m), start: start - m, end: start - m };
    }
    return { value: value.slice(0, start) + mark + mark + value.slice(end), start: start + m, end: start + m };
  }
  [start, end] = trimSel(value, start, end);
  if (start === end) return null;
  const sel = value.slice(start, end);
  // "*" não pode confundir com "**": o marcador tem que estar isolado.
  const isolated = (s, e) => mark !== '*' || (value[s - 1] !== '*' && value[e] !== '*');
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark) && (mark !== '*' || !sel.startsWith('**') || sel.startsWith('***'))) {
    const inner = sel.slice(m, -m);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark && isolated(start - m, end + m)) {
    return { value: value.slice(0, start - m) + sel + value.slice(end + m), start: start - m, end: end - m };
  }
  const multi = sel.includes('\n');
  const out = sel.split('\n').map((l) => {
    // Em várias linhas, marca só o conteúdo: "- [ ] ", "1. ", "# ", "> " ficam de fora.
    const a = multi ? LINE_PREFIX_RE.exec(l)[0].length : 0;
    const b = l.trimEnd().length;
    return l.slice(a, b).trim() ? l.slice(0, a) + mark + l.slice(a, b) + mark + l.slice(b) : l;
  }).join('\n');
  return { value: value.slice(0, start) + out + value.slice(end), start, end: start + out.length };
}

/**
 * Ctrl+K com seleção → [seleção](url) com "url" selecionado para digitar por cima.
 * Se a seleção já é uma URL → [](url) com o cursor no texto. Sem seleção → null (Ctrl+K segue para a palette).
 */
function makeLink(value, start, end) {
  [start, end] = trimSel(value, start, end);
  if (start === end) return null;
  const sel = value.slice(start, end);
  if (sel.includes('\n')) return null;
  if (URL_RE.test(sel)) {
    const ins = `[](${sel})`;
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + 1, end: start + 1 };
  }
  const ins = `[${sel}](url)`;
  const u = start + sel.length + 3;
  return { value: value.slice(0, start) + ins + value.slice(end), start: u, end: u + 3 };
}

/**
 * Ctrl+Shift+K: cerca as linhas da seleção com ``` (ou abre um bloco vazio). O cursor vai para logo
 * depois do ``` de abertura — é só digitar a linguagem (sql, js…).
 */
function codeBlock(value, start, end) {
  const ls = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  const le = nl === -1 ? value.length : nl;
  const body = value.slice(ls, le);
  // Linha vazia: bloco novo com o cursor na linha do meio.
  if (!body.trim()) return { value: value.slice(0, ls) + '```\n\n```' + value.slice(le), start: ls + 4, end: ls + 4 };
  return { value: value.slice(0, ls) + '```\n' + body + '\n```' + value.slice(le), start: ls + 3, end: ls + 3 };
}

/** Ctrl+Shift+K: trecho selecionado dentro de uma linha → `código` (alterna); senão → bloco ```. */
function codeToggle(value, start, end) {
  const sel = value.slice(start, end);
  return sel.trim() && !sel.includes('\n') ? toggleWrap(value, start, end, '`') : codeBlock(value, start, end);
}

module.exports = { tableFromText, smartPaste, toggleWrap, makeLink, codeBlock, codeToggle, parseTsv };
