'use strict';
/**
 * Busca da command palette — JS puro, sem dependências.
 * Pesquisa em nome, keywords/aliases, descrição e categoria, ignorando acentos e maiúsculas.
 * Prefixo > início de palavra > trecho contido > fuzzy (subsequência); o nome pesa mais que o resto.
 */

/** Minúsculas e sem acentos. Mantém o comprimento de textos NFC (índices continuam válidos p/ destaque). */
const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const range = (from, len) => Array.from({ length: len }, (_, i) => from + i);
const isWordStart = (t, i) => i === 0 || /[\s\-_./:()·]/.test(t[i - 1]);

/** Pontua um texto contra a consulta já normalizada. Retorna { score, idx } ou null. */
function matchText(text, q, fuzzy) {
  const t = normalize(text);
  if (!q || !t) return null;
  if (t.startsWith(q)) return { score: 100 + (10 * q.length) / t.length, idx: range(0, q.length) };
  let at = -1;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) { if (isWordStart(t, i)) { at = i; break; } }
  if (at !== -1) return { score: 80, idx: range(at, q.length) };
  at = t.indexOf(q);
  if (at !== -1) return { score: 60, idx: range(at, q.length) };
  if (!fuzzy) return null;
  // Subsequência gulosa: bônus para caracteres seguidos e para início de palavra.
  const idx = [];
  let sc = 0, last = -2;
  for (let i = 0, j = 0; i < t.length && j < q.length; i++) {
    if (t[i] !== q[j]) continue;
    sc += last === i - 1 ? 3 : 1;
    if (isWordStart(t, i)) sc += 2;
    idx.push(i); last = i; j++;
  }
  if (idx.length < q.length) return null;
  // Fuzzy muito espalhado (ex.: 3 letras em 40 caracteres) é ruído.
  if (idx[idx.length - 1] - idx[0] + 1 > q.length * 4) return null;
  return { score: Math.min(45, 10 + sc), idx };
}

const WEIGHTS = { name: 1, keywords: 0.8, description: 0.5, category: 0.4 };

/** Melhor pontuação de um termo entre os campos do comando. */
function scoreTerm(cmd, q, categoryName) {
  let best = null;
  const consider = (field, text, fuzzy) => {
    const m = matchText(text, q, fuzzy);
    if (!m) return;
    const score = m.score * WEIGHTS[field];
    if (!best || score > best.score) best = { score, idx: field === 'name' ? m.idx : [] };
  };
  consider('name', cmd.name, true);
  for (const k of cmd.keywords || []) consider('keywords', k, true);
  consider('description', cmd.description, false);
  consider('category', categoryName, false);
  return best;
}

/**
 * Pontua um comando. Consulta com espaços: primeiro tenta a frase inteira;
 * senão, todos os termos precisam casar (em qualquer campo).
 */
function scoreCommand(cmd, query, categoryName = '') {
  const q = normalize(query).trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const whole = scoreTerm(cmd, q, categoryName);
  if (whole || !q.includes(' ')) return whole;
  const parts = q.split(' ').map((t) => scoreTerm(cmd, t, categoryName));
  if (parts.some((p) => !p)) return null;
  return {
    score: (0.9 * parts.reduce((n, p) => n + p.score, 0)) / parts.length,
    idx: [...new Set(parts.flatMap((p) => p.idx))].sort((a, b) => a - b),
  };
}

/**
 * Ordena comandos pela consulta. recent = ids usados recentemente (mais recente primeiro),
 * que ganham um pequeno bônus. Empates mantêm a ordem original.
 */
function rank(cmds, query, { recent = [], categoryName = () => '' } = {}) {
  const out = [];
  cmds.forEach((cmd, order) => {
    const m = scoreCommand(cmd, query, categoryName(cmd.category));
    if (!m) return;
    const r = recent.indexOf(cmd.id);
    out.push({ cmd, score: m.score + (r === -1 ? 0 : 8 - Math.min(r, 7)), idx: m.idx, order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

/* ─────────────── Recentes ─────────────── */
const RECENT_KEY = 'tk.palette.recent';
const RECENT_MAX = 8;

function loadRecent(storage) {
  try { const v = JSON.parse(storage.getItem(RECENT_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function pushRecent(storage, id) {
  const next = [id, ...loadRecent(storage).filter((x) => x !== id)].slice(0, RECENT_MAX);
  try { storage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

module.exports = { normalize, matchText, scoreCommand, rank, loadRecent, pushRecent };
