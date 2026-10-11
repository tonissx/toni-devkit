// Logs — peças compartilhadas: API, níveis (cor + ícone + rótulo: a cor nunca sozinha), formatação de hora e
// números, realce dos termos buscados e sparkline.
import { DS } from '../../lib/ds.js';

const { Icon } = DS;

export const logsApi = () => window.devkit.logs;

/** Mensagem limpa de um erro de IPC. */
export const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

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

/* ─────────────── Formatação ─────────────── */

const p2 = (n) => String(n).padStart(2, '0');
/** 10:22:33.123 (com a data se não for hoje, quando pedido). */
export function fmtTime(ms, { date = false, millis = true } = {}) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const t = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${millis ? '.' + String(d.getMilliseconds()).padStart(3, '0') : ''}`;
  if (!date) return t;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${t}`;
}
export const fmtDateTime = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : new Date(ms).toLocaleString('pt-BR'));
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** Rótulo de eixo conforme o passo: 10:22 · 10:22:30 · 11/10 · 11/10 14h */
export function fmtTick(ms, step) {
  const d = new Date(ms);
  if (step >= 86400e3) return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  if (step >= 3600e3) return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}h`;
  if (step >= 60e3) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 1 s · 30 s · 5 min · 3 h · 1 dia */
export function fmtStep(step) {
  if (step < 60e3) return `${step / 1000} s`;
  if (step < 3600e3) return `${step / 60e3} min`;
  if (step < 86400e3) return `${step / 3600e3} h`;
  const d = step / 86400e3;
  return d === 1 ? '1 dia' : `${d} dias`;
}

/** "há 5 min" a partir de agora (ms). */
export function ago(ms, now = Date.now()) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = (now - ms) / 1000;
  if (d < 0) return fmtTime(ms, { date: true, millis: false });
  if (d < 60) return 'agora';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  if (d < 172800) return 'ontem';
  if (d < 30 * 86400) return `há ${Math.floor(d / 86400)} dias`;
  return new Date(ms).toLocaleDateString('pt-BR');
}

const NF = new Intl.NumberFormat('pt-BR');
const CF = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : NF.format(n));
export const fmtCompact = (n) => (n == null || !Number.isFinite(n) ? '—' : n < 10000 ? NF.format(n) : CF.format(n));
export function fmtBytes(b) {
  if (!Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1).replace('.', ',')} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
  return `${(b / 1073741824).toFixed(2).replace('.', ',')} GB`;
}
export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms === 0) return '0';
  if (ms < 1) return `${ms.toFixed(2).replace('.', ',')} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace('.', ',')} s`;
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

/* ─────────────── Sparkline ─────────────── */

/** Linha fina de contagens; a cor vem de quem usa (currentColor). */
export function Sparkline({ data, width = 96, height = 22, title }) {
  if (!data || !data.length) return <svg className="lg-spark" width={width} height={height} aria-hidden="true" />;
  const max = Math.max(1, ...data);
  const n = data.length;
  const x = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1);
  const y = (v) => height - 2 - (v / max) * (height - 4);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastI = data.length - 1;
  return (
    <svg className="lg-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || 'Ocorrências no tempo'}>
      <polyline points={`1,${height - 1} ${pts} ${width - 1},${height - 1}`} className="lg-spark__area" />
      <polyline points={pts} className="lg-spark__line" />
      {data[lastI] > 0 && <circle cx={x(lastI)} cy={y(data[lastI])} r="2.5" className="lg-spark__dot" />}
    </svg>
  );
}

/**
 * true só depois de `flag` ficar ligado por `ms` — para indicar "carregando" sem piscar quando a resposta é rápida
 * (a maioria das consultas volta em dezenas de ms).
 */
export function useDelayed(flag, ms = 300) {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (!flag) { setOn(false); return undefined; }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return on;
}

/** Copia texto (com toast). */
export async function copyText(text, toast, what = 'Copiado') {
  try { await window.devkit.clipboard.write(String(text)); toast && toast(what, '', 'ok'); } catch (e) { toast && toast('Não foi possível copiar', errText(e), 'error'); }
}
