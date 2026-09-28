// Helpers de apresentação do Git Pulse — puros, sem React, fáceis de testar isoladamente.

const KIND_LABEL = {
  modified: { label: 'Modificado', tone: 'warn' },
  added: { label: 'Adicionado', tone: 'ok' },
  deleted: { label: 'Removido', tone: 'error' },
  renamed: { label: 'Renomeado', tone: 'info' },
  copied: { label: 'Copiado', tone: 'info' },
  untracked: { label: 'Novo', tone: 'neutral' },
  conflicted: { label: 'Conflito', tone: 'error' },
};

/** kind ('modified'|'added'|...) → { label, tone } (tone é a variant do Badge do DS). */
export function statusLabel(kind) {
  return KIND_LABEL[kind] || { label: kind, tone: 'neutral' };
}

const UNITS = [
  ['ano', 365 * 24 * 3600],
  ['mês', 30 * 24 * 3600],
  ['dia', 24 * 3600],
  ['h', 3600],
  ['min', 60],
];

/** ISO date → "há 5 min" / "há 2 dias" / "agora". */
export function formatRelativeTime(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 45) return 'agora';
  for (const [label, secs] of UNITS) {
    const n = Math.floor(diffSec / secs);
    if (n >= 1) return `há ${n} ${label}${label.length > 2 && n > 1 && label !== 'h' ? 's' : ''}`;
  }
  return 'agora';
}

/** insertions/deletions (podem ser null p/ untracked) → "+12 -3" | "—". */
export function formatCounts(insertions, deletions) {
  if (insertions == null && deletions == null) return '—';
  return `+${insertions || 0} −${deletions || 0}`;
}
