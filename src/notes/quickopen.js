'use strict';
/**
 * Ctrl+P do Notes — ordena as notas para o seletor "abrir nota": só funções puras.
 * Consulta vazia → recentes primeiro (ordem de `recentIds`), depois as mais recém-editadas.
 * Com consulta → casa título (com destaque), pasta e tags; várias palavras = todas precisam casar.
 */
const { normalize, matchText } = require('../commands/search.js');

const WEIGHTS = { title: 1, folder: 0.5, tag: 0.6 };

/** Melhor pontuação de uma palavra (já normalizada) contra a nota: { score, idx } | null. idx só vale para o título. */
function scoreWord(n, q) {
  let best = null;
  const consider = (field, text, fuzzy) => {
    const m = matchText(text, q, fuzzy);
    if (!m) return;
    const score = m.score * WEIGHTS[field];
    if (!best || score > best.score) best = { score, idx: field === 'title' ? m.idx : [] };
  };
  consider('title', n.title, true);
  consider('folder', n.folder, false);
  for (const t of n.tags || []) consider('tag', t, false);
  return best;
}

function scoreNote(n, query) {
  const q = normalize(query).trim().replace(/\s+/g, ' ');
  const whole = scoreWord(n, q);
  if (whole || !q.includes(' ')) return whole;
  const parts = q.split(' ').map((w) => scoreWord(n, w));
  if (parts.some((p) => !p)) return null;
  return {
    score: (0.9 * parts.reduce((s, p) => s + p.score, 0)) / parts.length,
    idx: [...new Set(parts.flatMap((p) => p.idx))].sort((a, b) => a - b),
  };
}

/** → [{ note, idx }] */
function rankNotes(rows, query, { recentIds = [], limit = 50 } = {}) {
  const list = (rows || []).filter(Boolean);
  if (!normalize(query).trim()) {
    const pos = new Map(recentIds.map((id, i) => [id, i]));
    return [...list]
      .sort((a, b) => {
        const ra = pos.has(a.id) ? pos.get(a.id) : Infinity, rb = pos.has(b.id) ? pos.get(b.id) : Infinity;
        return ra !== rb ? ra - rb : (b.updated || 0) - (a.updated || 0);
      })
      .slice(0, limit)
      .map((note) => ({ note, idx: [] }));
  }
  const out = [];
  for (const note of list) {
    const m = scoreNote(note, query);
    if (m) out.push({ note, idx: m.idx, score: m.score });
  }
  out.sort((a, b) => b.score - a.score || (b.note.updated || 0) - (a.note.updated || 0));
  return out.slice(0, limit).map(({ note, idx }) => ({ note, idx }));
}

module.exports = { rankNotes };
