'use strict';
/**
 * Calendário das Notes — dias no fuso local ('YYYY-MM-DD'), contagem de notas por dia e seleção de intervalo.
 * As datas das notas são ISO em UTC; cortar o texto (slice(0, 10)) jogaria uma nota criada à noite no dia seguinte.
 */
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** ISO (ou qualquer data que o Date entenda) → 'YYYY-MM-DD' local; null se não for uma data válida. */
function localDay(iso) {
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return key(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Notas criadas por dia: { 'YYYY-MM-DD': n }. Datas ilegíveis ficam de fora. */
function countByDay(notes) {
  const out = {};
  for (const n of notes || []) {
    const k = localDay(n.created);
    if (k) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Ordena as pontas (clicar do dia 21 ao 19 dá 19–21). */
function normalizeRange(a, b) {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** O dia cai no intervalo (as duas pontas incluídas)? */
const inRange = (day, range) => !!day && !!range && day >= range.from && day <= range.to;

/**
 * Clique num dia: sem seleção → o dia; um dia só → o mesmo dia limpa, outro fecha o intervalo;
 * intervalo pronto → recomeça no dia clicado. Retorna { from, to } ou null (sem filtro).
 */
function pickDay(range, day) {
  if (!range) return { from: day, to: day };
  if (range.from === range.to) return range.from === day ? null : normalizeRange(range.from, day);
  return { from: day, to: day };
}

/** Células do mês (semana começando no domingo): 'YYYY-MM-DD' ou null nos vazios; múltiplo de 7. */
function monthGrid(year, month) {
  const lead = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => key(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  return cells;
}

const parts = (day) => { const [y, m, d] = day.split('-').map(Number); return { y, m: m - 1, d }; };

/** '2026-10-19', '2026-10-21' → '19–21 out'; mês ou ano diferente repete o que muda. */
function rangeLabel(range) {
  if (!range) return '';
  const a = parts(range.from), b = parts(range.to);
  const one = (p) => `${p.d} ${MONTHS_SHORT[p.m]}`;
  if (range.from === range.to) return one(a);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m]}`;
  return `${one(a)} – ${one(b)}`;
}

module.exports = { MONTHS, MONTHS_SHORT, localDay, countByDay, normalizeRange, inRange, pickDay, monthGrid, rangeLabel };
