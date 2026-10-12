'use strict';
/**
 * Banco — achados de saúde a partir das consultas da aba Saúde. Puro. Cada achado: { level: 'crit'|'warn'|'info',
 * area, db?, text, hint? }. Os limites são os de bom senso de DBA; a tela mostra o motivo de cada um.
 */

const DAY = 86400e3;
const SYSTEM_DBS = new Set(['master', 'model', 'msdb', 'tempdb']);

const toMs = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Number.isFinite(Number(v)) ? Number(v) : Date.parse(v));
const ago = (ms, now) => {
  const d = (now - ms) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min`;
  if (d < 2 * 86400) return `${Math.round(d / 3600)} h`;
  return `${Math.round(d / 86400)} dias`;
};

/**
 * h: { files, logUsage, backups, jobs, rates, now }
 * → { findings: [...], logs: [{ db, sizeKb, usedKb, pct, reuseWait }], disks: [{ mount, totalBytes, freeBytes, pct }] }
 */
function evaluate(h) {
  const now = h.now || Date.now();
  const findings = [];

  // Log por banco (contador "Percent Log Used" + tamanho), com o motivo de não reaproveitar (sys.databases).
  const byDb = {};
  for (const r of h.logUsage || []) {
    const d = byDb[r.database_name] || (byDb[r.database_name] = { db: r.database_name });
    if (r.counter_name === 'Log File(s) Size (KB)') d.sizeKb = Number(r.cntr_value);
    else if (r.counter_name === 'Log File(s) Used Size (KB)') d.usedKb = Number(r.cntr_value);
    else if (r.counter_name === 'Percent Log Used') d.pct = Number(r.cntr_value);
  }
  const reuse = {};
  const recovery = {};
  for (const f of h.files || []) { reuse[f.database_name] = f.log_reuse_wait_desc; recovery[f.database_name] = f.recovery_model_desc; }
  const logs = Object.values(byDb).map((d) => ({ ...d, pct: d.pct != null ? d.pct : d.sizeKb ? Math.round((d.usedKb / d.sizeKb) * 100) : null, reuseWait: reuse[d.db] || '' }))
    .sort((a, b) => (b.pct || 0) - (a.pct || 0));
  for (const l of logs) {
    if (l.pct == null || l.db === 'tempdb' && l.pct < 90) continue;
    const why = l.reuseWait && l.reuseWait !== 'NOTHING' ? ` — esperando ${l.reuseWait}` : '';
    if (l.pct >= 90) findings.push({ level: 'crit', area: 'log', db: l.db, text: `Log de ${l.db} ${l.pct}% cheio${why}`, hint: hintReuse(l.reuseWait) });
    else if (l.pct >= 80) findings.push({ level: 'warn', area: 'log', db: l.db, text: `Log de ${l.db} ${l.pct}% cheio${why}`, hint: hintReuse(l.reuseWait) });
  }

  // Discos (um por ponto de montagem).
  const disks = new Map();
  for (const f of h.files || []) {
    if (!f.volume_mount_point || disks.has(f.volume_mount_point)) continue;
    const total = Number(f.volume_total_bytes); const free = Number(f.volume_available_bytes);
    if (total > 0) disks.set(f.volume_mount_point, { mount: f.volume_mount_point, totalBytes: total, freeBytes: free, pct: Math.round((1 - free / total) * 100) });
  }
  for (const d of disks.values()) {
    const freePct = 100 - d.pct;
    if (freePct < 10) findings.push({ level: 'crit', area: 'disk', text: `Disco ${d.mount} com só ${freePct}% livre`, hint: 'Arquivos de dados/log crescem ali — sem espaço, o banco para de gravar.' });
    else if (freePct < 20) findings.push({ level: 'warn', area: 'disk', text: `Disco ${d.mount} com ${freePct}% livre` });
  }

  // Crescimento em porcentagem (cresce cada vez mais) e arquivos sem limite em disco quase cheio.
  for (const f of h.files || []) {
    if (f.is_percent_growth && Number(f.size_kb) > 10 * 1024 * 1024) findings.push({ level: 'info', area: 'files', db: f.database_name, text: `${f.database_name}/${f.logical_name} cresce em ${f.growth}% (arquivo de ${Math.round(f.size_kb / 1048576)} GB)`, hint: 'Crescimento em % fica cada vez maior; prefira um valor fixo em MB.' });
  }

  // Backups.
  for (const b of h.backups || []) {
    if (b.database_name === 'tempdb' || b.state_desc && b.state_desc !== 'ONLINE') continue;
    const full = toMs(b.last_full); const diff = toMs(b.last_diff); const log = toMs(b.last_log);
    const lastData = Math.max(full || 0, diff || 0);
    const sys = SYSTEM_DBS.has(b.database_name);
    if (!full) {
      const created = toMs(b.create_date);
      if (!created || now - created > DAY) findings.push({ level: sys ? 'warn' : 'crit', area: 'backup', db: b.database_name, text: `${b.database_name} nunca teve backup completo` });
    } else if (now - lastData > 7 * DAY) findings.push({ level: sys ? 'info' : 'warn', area: 'backup', db: b.database_name, text: `Último backup de dados de ${b.database_name} há ${ago(lastData, now)}` });
    if (b.recovery_model_desc === 'FULL' && b.database_name !== 'model') {
      if (!log) findings.push({ level: 'warn', area: 'backup', db: b.database_name, text: `${b.database_name} está em FULL sem backup de log`, hint: 'Em FULL o log só é liberado por backup de log — ele vai crescer até encher o disco.' });
      else if (now - log > DAY) findings.push({ level: 'warn', area: 'backup', db: b.database_name, text: `Último backup de log de ${b.database_name} há ${ago(log, now)}` });
    }
  }

  // Jobs do Agent.
  for (const j of h.jobs || []) findings.push({ level: 'warn', area: 'jobs', text: `Job "${j.job_name}" falhou ${ago(toMs(j.run_at), now)} atrás`, hint: String(j.message || '').slice(0, 300) });

  // Contadores.
  const r = h.rates || {};
  if (r.ple != null && r.ple < 300) findings.push({ level: 'warn', area: 'memory', text: `Page life expectancy em ${Math.round(r.ple)} s`, hint: 'As páginas ficam pouco tempo em memória: falta memória ou varreduras grandes estão expulsando o cache.' });
  if (r.memoryGrantsPending > 0) findings.push({ level: 'warn', area: 'memory', text: `${r.memoryGrantsPending} queries esperando memória para executar` });

  const order = { crit: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { findings, logs, disks: [...disks.values()] };
}

function hintReuse(w) {
  switch (w) {
    case 'LOG_BACKUP': return 'Precisa de backup de log para liberar espaço (banco em FULL/BULK_LOGGED).';
    case 'ACTIVE_TRANSACTION': return 'Uma transação aberta segura o log — veja a aba Agora (transações antigas/ociosas).';
    case 'REPLICATION': return 'A replicação ainda não leu o log.';
    case 'AVAILABILITY_REPLICA': return 'Uma réplica do Always On está atrasada.';
    case 'CHECKPOINT': return 'Esperando checkpoint — costuma se resolver sozinho.';
    default: return '';
  }
}

/** CREATE INDEX sugerido para um índice faltante (só texto para copiar — nunca executado pelo Devkit). */
function missingIndexSql(m) {
  const cols = [m.equality_columns, m.inequality_columns].filter(Boolean).join(', ');
  const table = String(m.table_name || '');
  const short = table.split('.').pop().replace(/[[\]]/g, '');
  const name = `IX_${short}_${cols.replace(/[[\]\s]/g, '').split(',').slice(0, 3).join('_')}`.slice(0, 120);
  return `CREATE NONCLUSTERED INDEX [${name}]\nON ${table} (${cols})${m.included_columns ? `\nINCLUDE (${m.included_columns})` : ''};`;
}

module.exports = { evaluate, missingIndexSql, hintReuse };
