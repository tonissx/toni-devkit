'use strict';
/**
 * Providers: resultados dinâmicos da palette, gerados a partir da consulta.
 * Cada provider é (query, storage) → comandos no mesmo formato do registry.
 */
const { normalize } = require('./search.js');
const { TOOL_META } = require('../tools/meta.js');

const MAX_RESULTS = 5;
const PER_SOURCE = 2;

// Rascunhos persistidos pelas ferramentas (usePersisted → localStorage 'tk.<chave>').
const DRAFT_SOURCES = [
  { tool: 'sql', key: 'tk.sql.draft', fields: [['text', 'rascunho']] },
  { tool: 'xml', key: 'tk.xml.draft', fields: [['text', 'rascunho']] },
  { tool: 'diff', key: 'tk.diff.draft', fields: [['left', 'Original'], ['right', 'Alterado']] },
];

/** Trecho da linha em volta do casamento, com no máximo ~max caracteres. */
function snippet(line, at, len, max = 72) {
  const s = line.trim();
  const shift = line.length - line.trimStart().length;
  const pos = Math.max(0, at - shift);
  if (s.length <= max) return s;
  const start = Math.max(0, Math.min(pos - Math.floor((max - len) / 2), s.length - max));
  return (start > 0 ? '…' : '') + s.slice(start, start + max) + (start + max < s.length ? '…' : '');
}

/** Linhas dos rascunhos das ferramentas que contêm a consulta (a partir de 2 caracteres). */
function draftMatches(query, storage) {
  const q = normalize(query).trim();
  if (q.length < 2 || !storage) return [];
  const out = [];
  for (const src of DRAFT_SOURCES) {
    let draft;
    try { draft = JSON.parse(storage.getItem(src.key)); } catch { continue; }
    if (!draft) continue;
    const meta = TOOL_META.find((t) => t.id === src.tool);
    let found = 0;
    for (const [field, label] of src.fields) {
      const lines = String(draft[field] || '').split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length && found < PER_SOURCE && out.length < MAX_RESULTS; i++) {
        const at = normalize(lines[i]).indexOf(q);
        if (at === -1) continue;
        found++;
        out.push({
          id: `draft:${src.tool}:${field}:${i}`,
          name: snippet(lines[i], at, q.length),
          description: `${meta.name} · ${label}${draft.file ? ' (' + draft.file + ')' : ''}, linha ${i + 1}`,
          category: 'search',
          icon: meta.icon,
          keywords: [],
          dynamic: true,
          run: (ctx) => ctx.openApp(src.tool),
        });
      }
    }
  }
  return out;
}

module.exports = { draftMatches };
