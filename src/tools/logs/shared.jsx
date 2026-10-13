// Logs — peças compartilhadas: API, níveis (cor + ícone + rótulo: a cor nunca sozinha), formatação de hora e
// números, realce dos termos buscados e sparkline.
import { DS } from '../../lib/ds.js';

// Formatadores e peças genéricas moram em src/lib/fmt.jsx (compartilhados com o Banco).
export { fmtTime, fmtDateTime, sameDay, fmtTick, fmtStep, ago, fmtNum, fmtCompact, fmtBytes, fmtMs, Sparkline, useDelayed, copyText, errText } from '../../lib/fmt.jsx';

const { Icon } = DS;

export const logsApi = () => window.devkit.logs;

/** Níveis do mais grave ao mais leve (ordem dos chips). id = índice de src/logs/parse.js LEVELS. */
export const LEVEL_META = [
  { id: 6, key: 'fatal', label: 'FATAL', name: 'Fatal', icon: 'skull' },
  { id: 5, key: 'error', label: 'ERROR', name: 'Erro', icon: 'circle-x' },
  { id: 4, key: 'warn', label: 'WARN', name: 'Aviso', icon: 'triangle-alert' },
  { id: 3, key: 'info', label: 'INFO', name: 'Info', icon: 'info' },
  { id: 2, key: 'debug', label: 'DEBUG', name: 'Debug', icon: 'bug' },
  { id: 1, key: 'trace', label: 'TRACE', name: 'Trace', icon: 'footprints' },
  { id: 0, key: 'unknown', label: '—', name: 'Sem nível', icon: 'circle-dashed' },
];
export const LEVEL_BY_ID = LEVEL_META.reduce((m, l) => { m[l.id] = l; return m; }, {});
/** Cor de um nível (variável CSS definida em logs.css para cada tema). */
export const levelColor = (id) => `var(--lg-${LEVEL_BY_ID[id] ? LEVEL_BY_ID[id].key : 'unknown'})`;

export function LevelBadge({ level, compact }) {
  const l = LEVEL_BY_ID[level] || LEVEL_BY_ID[0];
  return (
    <span className={'lg-lv is-' + l.key} title={l.name}>
      <Icon name={l.icon} size={11} />{!compact && <span>{l.label}</span>}
    </span>
  );
}

/* ─────────────── Realce ─────────────── */

/** Regexes do realce (vêm do worker como { source, flags }). */
export function toRegexes(list) {
  const out = [];
  for (const h of list || []) {
    try { out.push(new RegExp(h.source, h.flags.includes('g') ? h.flags : h.flags + 'g')); } catch { /* ignora */ }
  }
  return out;
}

/** Texto com os trechos que casam em <mark>. */
export function Highlight({ text, res }) {
  const s = String(text || '');
  if (!res || !res.length || !s) return s;
  const ranges = [];
  for (const re of res) {
    re.lastIndex = 0;
    let m; let guard = 0;
    while ((m = re.exec(s)) && guard++ < 200) {
      if (!m[0].length) { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  if (!ranges.length) return s;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  const out = [];
  let p = 0;
  merged.forEach(([a, b], k) => { if (a > p) out.push(s.slice(p, a)); out.push(<mark key={k}>{s.slice(a, b)}</mark>); p = b; });
  if (p < s.length) out.push(s.slice(p));
  return out;
}

