// Banco — peças compartilhadas da tela: API, estado do servidor (cor + ícone + texto), durações e rótulo de sessão.
import { DS } from '../../lib/ds.js';

const { Icon } = DS;

export const dbApi = () => window.devkit.db;
export { errText, fmtNum, fmtCompact, fmtBytes, fmtMs, fmtTime, fmtDateTime, ago, sameDay, Sparkline, useDelayed, copyText } from '../../lib/fmt.jsx';

/** Estado do monitor de um servidor. */
export const STATUS = {
  ok: { label: 'Monitorando', icon: 'activity', tone: 'ok' },
  connecting: { label: 'Conectando…', icon: 'plug-zap', tone: 'muted' },
  offline: { label: 'Sem conexão', icon: 'unplug', tone: 'error' },
  error: { label: 'Erro', icon: 'circle-alert', tone: 'error' },
  locked: { label: 'Vault trancado', icon: 'lock-keyhole', tone: 'warn' },
  idle: { label: 'Parado', icon: 'circle-pause', tone: 'muted' },
};

/** Estado efetivo: bloqueio manda mais que "ok". */
export function serverTone(s) {
  if (!s) return 'muted';
  if (s.status === 'ok' && s.blocked > 0) return 'block';
  return (STATUS[s.status] || STATUS.idle).tone;
}

export function StatusDot({ s, title }) {
  const tone = serverTone(s);
  return <span className={'db-dot is-' + tone} title={title || (s && s.blocked ? `${s.blocked} sessão(ões) bloqueada(s)` : (STATUS[s && s.status] || STATUS.idle).label)} />;
}

/** 1,2 s · 45 s · 3 min 20 s · 2 h 5 min */
export function fmtDur(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const v = Number(ms);
  if (v < 1000) return `${Math.round(v)} ms`;
  const s = v / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 >= 1 ? ` ${Math.round(s % 60)} s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Microssegundos (dm_exec_query_stats) → texto. */
export const fmtUs = (us) => fmtDur(us == null ? null : Number(us) / 1000);

/** "Fluig · fluig_user @ APP01" */
export const whoOf = (r) => (r ? [r.program_name, r.login_name ? r.login_name + (r.host_name ? ' @ ' + r.host_name : '') : r.host_name].filter(Boolean).join(' · ') : '');

/** Texto principal de uma sessão: o comando que está rodando, ou o último lote (ociosa). */
export const sqlOf = (r) => String((r && (r.statement_text || r.batch_text)) || '').trim();
/** Uma linha só, para listas. */
export const oneLine = (s, n = 200) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

export function Tone({ tone, icon, children, title }) {
  return <span className={'db-tone is-' + tone} title={title}>{icon && <Icon name={icon} size={11} />}{children}</span>;
}

/** Categoria de espera → cor (variáveis em db.css) e rótulo curto. */
export const WAIT_CAT = {
  lock: { label: 'Lock', color: 'var(--db-c-lock)' }, io: { label: 'Disco', color: 'var(--db-c-io)' }, log: { label: 'Log', color: 'var(--db-c-log)' },
  latch: { label: 'Latch', color: 'var(--db-c-latch)' }, parallel: { label: 'Paralelismo', color: 'var(--db-c-parallel)' },
  memory: { label: 'Memória', color: 'var(--db-c-memory)' }, network: { label: 'Rede', color: 'var(--db-c-network)' },
  cpu: { label: 'CPU', color: 'var(--db-c-cpu)' }, external: { label: 'Externas', color: 'var(--db-c-other)' }, other: { label: 'Outras', color: 'var(--db-c-other)' },
};
