'use strict';
/**
 * Banco — histórico em disco e regras de incidente. Puro (a gravação fica em electron/db/service.js).
 *
 * Arquivo por servidor e por dia: <userData>/db-monitor/<serverId>/AAAA-MM-DD.ndjson, uma linha JSON por registro:
 *   { k: 's', t, ... }  amostra compacta (a cada ciclo do ao vivo)
 *   { k: 'i', t, id, kind, title, data }  incidente aberto (retrato completo do momento)
 *   { k: 'e', t, id, durMs, peak... }      incidente terminou
 *   kind: 'blocking' | 'long' | 'deadlock' | 'kill' | 'error' | 'offline'
 */
const { flatten, headSummary } = require('./blocking.js');

const p2 = (n) => String(n).padStart(2, '0');
/** Dia local de um instante: '2026-10-12'. */
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

const cut = (s, n) => (s == null ? s : String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

/** Linha de request/sessão enxuta para o retrato (sem os campos que não ajudam a investigar). */
function slimRow(r) {
  if (!r) return null;
  return {
    session_id: r.session_id, blocking_session_id: r.blocking_session_id || 0, status: r.status, command: r.command,
    wait_type: r.wait_type, wait_time: r.wait_time, wait_resource: r.wait_resource, cpu_time: r.cpu_time,
    logical_reads: r.logical_reads, writes: r.writes, total_elapsed_time: r.total_elapsed_time, start_time: r.start_time,
    open_transaction_count: r.open_transaction_count, database_name: r.database_name, login_name: r.login_name,
    host_name: r.host_name, program_name: r.program_name, client_net_address: r.client_net_address,
    query_hash: r.query_hash, object_name: r.object_name,
    statement_text: cut(r.statement_text, 2000), batch_text: cut(r.batch_text || '', 4000),
    transaction_begin_time: r.transaction_begin_time, last_request_end_time: r.last_request_end_time,
  };
}

/** Árvore de bloqueio serializável (até 200 nós). */
function treeSnapshot(head) {
  const nodes = flatten([head]).slice(0, 200);
  return nodes.map((n) => ({ id: n.id, depth: n.depth, idle: !!n.idle, cycle: !!n.cycle, blockedCount: n.blockedCount, waitMs: n.waitMs, row: slimRow(n.row) }));
}

/**
 * Amostra compacta para a linha do tempo. snap: { t, requests, tree, rates, waits, cpu }.
 */
function sampleRecord(snap) {
  const reqs = snap.requests || [];
  const longest = reqs.reduce((m, r) => Math.max(m, Number(r.total_elapsed_time) || 0), 0);
  const w = snap.waits ? snap.waits.rows.slice(0, 6).map((x) => [x.wait_type, Math.round(x.waitMs)]) : null;
  const rates = snap.rates || {};
  const rnd = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  return {
    k: 's', t: snap.t,
    a: reqs.length,
    b: snap.tree ? snap.tree.blocked.size : 0,
    h: snap.tree ? snap.tree.heads.length : 0,
    lx: longest,
    cpu: snap.cpu ? snap.cpu.sql_cpu : null,
    oc: snap.cpu ? Math.max(0, 100 - snap.cpu.system_idle - snap.cpu.sql_cpu) : null,
    bps: rnd(rates.batchPerSec), tps: rnd(rates.transactionsPerSec), conn: rates.userConnections == null ? null : rates.userConnections,
    ple: rates.ple == null ? null : rates.ple, lw: rnd(rates.lockWaitsPerSec), mg: rates.memoryGrantsPending == null ? null : rates.memoryGrantsPending,
    w,
    wc: snap.waits ? Object.fromEntries(Object.entries(snap.waits.byCategory).map(([k, v]) => [k, Math.round(v)])) : null,
  };
}

const DEFAULTS = { blockMs: 10000, longMs: 30000 };

/**
 * Incidentes que abriram/fecharam nesta amostra. state: { open: { key: { id, t, kind, peak } } } (mutável, guardado
 * pelo collector). → [registros 'i' | 'e'].
 */
function detectIncidents(state, snap, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const t = snap.t;
  const out = [];
  const seen = new Set();
  state.open = state.open || {};
  state.seq = state.seq || 0;
  const newId = () => `${t.toString(36)}-${(++state.seq).toString(36)}`;

  // Bloqueio: por cabeça (sessão + quando começou o que ela está fazendo / a transação).
  for (const h of (snap.tree ? snap.tree.heads : [])) {
    if (h.maxWaitMs < o.blockMs) continue;
    const r = h.row || {};
    const key = `b:${h.id}:${r.start_time || r.transaction_begin_time || r.last_request_start_time || ''}`;
    seen.add(key);
    const cur = state.open[key];
    if (!cur) {
      const id = newId();
      // since: quando o bloqueio começou de fato (a espera mais longa já vinha correndo antes de passar do limite).
      state.open[key] = { id, t, since: t - h.maxWaitMs, kind: 'blocking', peakBlocked: h.blockedCount, peakWaitMs: h.maxWaitMs };
      out.push({ k: 'i', t, id, kind: 'blocking', title: headSummary(h), data: { head: h.id, tree: treeSnapshot(h) } });
    } else {
      cur.peakBlocked = Math.max(cur.peakBlocked, h.blockedCount);
      cur.peakWaitMs = Math.max(cur.peakWaitMs, h.maxWaitMs);
    }
  }
  // Query longa (que não está só esperando bloqueio — essa já conta no incidente de bloqueio).
  for (const r of snap.requests || []) {
    if (Number(r.total_elapsed_time) < o.longMs || Number(r.blocking_session_id) > 0) continue;
    if (/^(BACKUP|RESTORE|DBCC|WAITFOR)/i.test(r.command || '') && !opts.includeMaintenance) continue;
    const key = `q:${r.session_id}:${r.start_time || ''}`;
    seen.add(key);
    const cur = state.open[key];
    if (!cur) {
      const id = newId();
      state.open[key] = { id, t, since: t - Number(r.total_elapsed_time), kind: 'long', peakMs: Number(r.total_elapsed_time) };
      const who = [r.program_name, r.login_name].filter(Boolean).join(' · ');
      out.push({ k: 'i', t, id, kind: 'long', title: `Query rodando há ${Math.round(r.total_elapsed_time / 1000)} s na sessão ${r.session_id}${who ? ` (${who})` : ''}`, data: { row: slimRow(r) } });
    } else cur.peakMs = Math.max(cur.peakMs, Number(r.total_elapsed_time));
  }
  // Fecha o que sumiu.
  for (const [key, cur] of Object.entries(state.open)) {
    if (seen.has(key)) continue;
    delete state.open[key];
    out.push({ k: 'e', t, id: cur.id, kind: cur.kind, durMs: t - (cur.since != null ? cur.since : cur.t), peakBlocked: cur.peakBlocked, peakWaitMs: cur.peakWaitMs, peakMs: cur.peakMs });
  }
  return out;
}

/** Linhas NDJSON → registros (ignora linhas quebradas — gravação interrompida). */
function parseLines(text, from = -Infinity, to = Infinity) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && typeof r.t === 'number' && r.t >= from && r.t <= to) out.push(r);
  }
  return out;
}

// Incidentes que têm começo e fim (os outros — deadlock, KILL, queda — são um instante).
const SPAN_KINDS = new Set(['blocking', 'long']);

/** Junta incidentes 'i' com seus 'e' (duração, pico); os de duração ainda abertos ficam com `open: true`. */
function incidentsOf(records) {
  const map = new Map();
  for (const r of records) {
    if (r.k === 'i') map.set(r.id, { ...r, open: SPAN_KINDS.has(r.kind) });
    else if (r.k === 'e' && map.has(r.id)) Object.assign(map.get(r.id), { open: false, endT: r.t, durMs: r.durMs, peakBlocked: r.peakBlocked, peakWaitMs: r.peakWaitMs, peakMs: r.peakMs });
  }
  return [...map.values()].sort((a, b) => b.t - a.t);
}

/** Arquivos (AAAA-MM-DD.ndjson) que cobrem [from, to]. */
function filesForRange(names, from, to) {
  const a = dayKey(from); const b = dayKey(to);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n)).filter((n) => { const d = n.slice(0, 10); return d >= a && d <= b; }).sort();
}

/** Arquivos mais velhos que keepDays (a contar do dia de hoje). */
function expiredFiles(names, now, keepDays = 7) {
  const limit = dayKey(now - keepDays * 86400e3);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n) && n.slice(0, 10) < limit);
}

/**
 * Amostras → séries para o gráfico, em buckets de `step` ms (máximo de cada bucket — pico é o que interessa).
 * → { start, step, buckets, series: { a, b, cpu, bps, … } }
 */
function seriesOf(samples, from, to, buckets = 240) {
  const span = Math.max(60e3, to - from);
  const step = Math.max(5000, Math.ceil(span / buckets / 5000) * 5000);
  const n = Math.max(1, Math.ceil(span / step));
  const keys = ['a', 'b', 'h', 'lx', 'cpu', 'oc', 'bps', 'tps', 'conn', 'ple', 'lw', 'mg'];
  const series = Object.fromEntries(keys.map((k) => [k, new Array(n).fill(null)]));
  for (const s of samples) {
    if (s.k !== 's' || s.t < from || s.t > to) continue;
    const i = Math.min(n - 1, Math.floor((s.t - from) / step));
    for (const k of keys) {
      const v = s[k];
      if (v == null) continue;
      const cur = series[k][i];
      // PLE: o menor do bucket (queda é o problema); o resto: o maior.
      series[k][i] = cur == null ? v : k === 'ple' ? Math.min(cur, v) : Math.max(cur, v);
    }
  }
  return { start: from, step, buckets: n, series };
}

/** A amostra mais próxima de t (para "o que estava acontecendo neste momento"). */
function nearestSample(samples, t) {
  let best = null; let bd = Infinity;
  for (const s of samples) { if (s.k !== 's') continue; const d = Math.abs(s.t - t); if (d < bd) { bd = d; best = s; } }
  return best;
}

module.exports = { dayKey, slimRow, treeSnapshot, sampleRecord, detectIncidents, parseLines, incidentsOf, filesForRange, expiredFiles, seriesOf, nearestSample, DEFAULTS };
