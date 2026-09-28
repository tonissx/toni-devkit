'use strict';
// Números e durações legíveis (pt-BR): 12.482 · 1,25 M · 3,40 B · 3h 42m.

const SUFFIXES = [[1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']];

function formatNum(n, { rate = false } = {}) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  for (const [v, s] of SUFFIXES) if (a >= v) return (n / v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + s;
  const digits = rate ? (a < 10 ? 2 : a < 100 ? 1 : 0) : 0;
  return (rate ? n : Math.floor(n)).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

module.exports = { formatNum, formatDuration };
