'use strict';
/**
 * Banco (processo principal): servidores SQL Server cadastrados, um coletor por servidor monitorado e o histórico.
 *
 * - Credencial: vem do Vault (getCredential(entryId) → { user, password }), lida na hora de conectar. Fica só na
 *   memória do coletor enquanto ele roda (para o monitor em segundo plano sobreviver ao auto-lock do cofre); nunca em disco.
 * - Coletor: 1 conexão; reconecta sozinho (5 s → 60 s). A cada ciclo (intervalSec, padrão 5 s com a tela aberta,
 *   15 s em segundo plano) roda NOW + contadores; esperas a cada 15 s; CPU e deadlocks a cada 60 s.
 * - Histórico: <dir>/<serverId>/AAAA-MM-DD.ndjson (src/db/history.js), retenção de keepDays (padrão 7).
 * - KILL: confere que a sessão ainda é a mesma (login, programa, início) antes de encerrar — o número da sessão é
 *   reaproveitado pelo SQL Server — e registra no histórico.
 * - servidores em <file> (db-servers.json): sem senha (só o id da entrada do Vault).
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { openConnection, friendlyError } = require('./driver');
const Q = require('../../src/db/queries.js');
const { tediousConfig, serverLabel } = require('../../src/db/connstr.js');
const { blockingTree, flatten } = require('../../src/db/blocking.js');
const { waitDelta, counterRates } = require('../../src/db/waits.js');
const H = require('../../src/db/history.js');
const { parseDeadlock, deadlockSummary } = require('../../src/db/deadlock.js');
const { evaluate } = require('../../src/db/health.js');
const { sqlRisks } = require('../../src/sql/risks.js');

const DEFAULT_SETTINGS = { keepDays: 7, blockMs: 10000, longMs: 30000 };
const SERVER_FIELDS = ['name', 'host', 'port', 'instance', 'database', 'vaultEntryId', 'encrypt', 'trustCert', 'intervalSec', 'background'];

function cleanServer(s, prev = {}) {
  const o = { ...prev };
  for (const k of SERVER_FIELDS) if (s[k] !== undefined) o[k] = s[k];
  o.name = String(o.name || o.host || '').trim().slice(0, 80);
  o.host = String(o.host || '').trim();
  o.instance = String(o.instance || '').trim();
  o.port = o.port ? Number(o.port) : null;
  if (o.port && !(o.port > 0 && o.port < 65536)) throw new Error('Porta inválida');
  o.database = String(o.database || '').trim();
  o.encrypt = o.encrypt !== false;
  o.trustCert = !!o.trustCert;
  o.intervalSec = Math.min(30, Math.max(2, Number(o.intervalSec) || 5));
  o.background = !!o.background;
  if (!o.host) throw new Error('Informe o servidor');
  if (!o.vaultEntryId) throw new Error('Escolha a credencial no Vault');
  return o;
}

const rowsOf = (sets, i = 0) => (sets[i] ? sets[i].rows : []);

function createDbService({ file, dir, getCredential, broadcast = () => {}, connect = openConnection, now = () => Date.now(), timers = { setTimeout, clearTimeout } }) {
  let state = { servers: [], settings: { ...DEFAULT_SETTINGS } };
  const queue = createQueue();
  const collectors = new Map(); // id → Collector
  const viewers = new Map();    // id → quantas telas estão olhando (ao vivo mais rápido)
  let seq = 0;

  async function init() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      state = { servers: Array.isArray(raw.servers) ? raw.servers : [], settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
    } catch { /* primeira vez */ }
    // Em segundo plano: começa um pouco depois de o app abrir (não disputa a inicialização).
    timers.setTimeout(() => { for (const s of state.servers) if (s.background) ensure(s.id); }, 8000);
    // Limpeza do histórico uma vez por dia.
    const sweep = () => { cleanup().catch(() => {}); const t = timers.setTimeout(sweep, 6 * 3600e3); if (t && t.unref) t.unref(); };
    const t0 = timers.setTimeout(sweep, 60e3); if (t0 && t0.unref) t0.unref();
  }
  const persist = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));
  const serverOf = (id) => { const s = state.servers.find((x) => x.id === id); if (!s) throw new Error('Servidor não encontrado'); return s; };
  const dirOf = (id) => path.join(dir, String(id).replace(/[^\w-]/g, '_'));

  /* ─────────────── Histórico em disco ─────────────── */

  async function append(id, records) {
    if (!records.length) return;
    const byDay = new Map();
    for (const r of records) { const k = H.dayKey(r.t); byDay.set(k, (byDay.get(k) || '') + JSON.stringify(r) + '\n'); }
    await queue.run('h:' + id, async () => {
      await fs.mkdir(dirOf(id), { recursive: true });
      for (const [day, text] of byDay) await fs.appendFile(path.join(dirOf(id), day + '.ndjson'), text, 'utf8');
    });
  }
  async function readRange(id, from, to) {
    let names = [];
    try { names = await fs.readdir(dirOf(id)); } catch { return []; }
    const out = [];
    for (const n of H.filesForRange(names, from, to)) {
      const text = await fs.readFile(path.join(dirOf(id), n), 'utf8').catch(() => '');
      for (const r of H.parseLines(text, from, to)) out.push(r);
    }
    return out;
  }
  async function cleanup() {
    for (const s of state.servers) {
      let names = [];
      try { names = await fs.readdir(dirOf(s.id)); } catch { continue; }
      for (const n of H.expiredFiles(names, now(), state.settings.keepDays)) await fs.unlink(path.join(dirOf(s.id), n)).catch(() => {});
    }
  }

  /* ─────────────── Coletor ─────────────── */

  function createCollector(server) {
    const c = {
      id: server.id, status: 'idle', error: null, info: null, conn: null, cred: null, timer: null, backoff: 5000, stopped: false,
      prevWaits: null, prevWaitsAt: 0, prevCounters: null, prevCountersAt: 0, rates: null, waits: null, cpu: null, cpuAt: 0,
      deadlockPos: null, deadlockAt: 0, lastDeadlockUtc: 0, incidents: {}, snap: null, ticks: 0, lastTickMs: 0, offlineSince: null,
    };
    const emit = (extra = {}) => broadcast({ type: 'status', id: c.id, status: c.status, error: c.error, ...extra });

    async function connectNow() {
      const s = serverOf(c.id);
      if (!c.cred) {
        try { c.cred = await getCredential(s.vaultEntryId); } catch (e) {
          c.status = /tranc|lock|bloque/i.test(e.message) ? 'locked' : 'error';
          c.error = c.status === 'locked' ? 'O Vault está trancado — desbloqueie para o monitor entrar no servidor.' : e.message;
          emit();
          throw Object.assign(new Error(c.error), { locked: c.status === 'locked' });
        }
      }
      c.status = 'connecting'; emit();
      const conn = await connect(tediousConfig(s, c.cred));
      conn.onDead((e) => {
        if (c.conn !== conn) return;
        c.conn = null;
        if (c.stopped) return;
        c.status = 'offline'; c.error = friendlyError(e); c.offlineSince = c.offlineSince || now();
        emit();
        append(c.id, [{ k: 'i', t: now(), id: 'off-' + now().toString(36), kind: 'offline', title: 'Conexão com o servidor caiu: ' + c.error }]).catch(() => {});
      });
      c.conn = conn;
      const info = rowsOf(await conn.query(Q.SERVER_INFO))[0] || {};
      if (info.has_view_server_state) {
        try { Object.assign(info, rowsOf(await conn.query(Q.SYS_INFO))[0] || {}); } catch { /* sem permissão mesmo */ }
      }
      c.info = info;
      c.status = 'ok'; c.error = info.has_view_server_state ? null : 'Sem VIEW SERVER STATE: só as sessões deste login aparecem.';
      c.backoff = 5000;
      if (c.offlineSince) { c.offlineSince = null; }
      emit({ info });
    }

    async function tick() {
      c.timer = null;
      if (c.stopped) return;
      const started = now();
      try {
        if (!c.conn || !c.conn.alive) await connectNow();
        await collect();
      } catch (e) {
        if (!e.locked) {
          c.status = c.conn && c.conn.alive ? 'error' : 'offline';
          c.error = e.message;
          emit();
        }
        c.backoff = Math.min(60000, c.backoff * 2);
        return schedule(e.locked ? 30000 : c.backoff);
      }
      c.lastTickMs = now() - started;
      schedule(intervalMs());
    }
    const intervalMs = () => {
      const s = state.servers.find((x) => x.id === c.id);
      const base = (s ? s.intervalSec : 5) * 1000;
      return viewers.get(c.id) ? base : Math.max(15000, base); // sem ninguém olhando: no máximo a cada 15 s
    };
    function schedule(ms) { if (c.stopped) return; timers.clearTimeout(c.timer); c.timer = timers.setTimeout(tick, ms); }

    async function collect() {
      const conn = c.conn;
      const t = now();
      const sets = await conn.query(Q.NOW);
      const requests = rowsOf(sets, 0);
      const idle = rowsOf(sets, 1);
      // Contadores (todo ciclo) e esperas (a cada 15 s): deltas por segundo.
      const counters = rowsOf(await conn.query(Q.COUNTERS));
      if (c.prevCounters) {
        const r = counterRates(c.prevCounters, counters, (t - c.prevCountersAt) / 1000);
        if (r) c.rates = r;
      } else c.rates = counterRates(null, counters, 0);
      c.prevCounters = counters; c.prevCountersAt = t;
      if (t - c.prevWaitsAt >= 14000) {
        const waits = rowsOf(await conn.query(Q.WAITS));
        if (c.prevWaits) c.waits = waitDelta(c.prevWaits, waits, (t - c.prevWaitsAt) / 1000) || c.waits;
        c.prevWaits = waits; c.prevWaitsAt = t;
      }
      if (t - c.cpuAt >= 59000 && c.info && c.info.has_view_server_state) {
        c.cpu = rowsOf(await conn.query(Q.CPU))[0] || c.cpu; c.cpuAt = t;
      }
      const tree = blockingTree(requests, idle);
      const snap = { t, requests, idle, tree, rates: c.rates, waits: c.waits, cpu: c.cpu };
      c.snap = snap;
      c.ticks++;
      const records = [H.sampleRecord(snap), ...H.detectIncidents(c, snap, state.settings)];
      // Deadlocks (a cada 60 s, só o que é novo).
      if (t - c.deadlockAt >= 59000 && c.info && c.info.has_view_server_state) {
        c.deadlockAt = t;
        try { records.push(...(await readDeadlocks(conn, t))); } catch { /* system_health desligado/sem permissão */ }
      }
      await append(c.id, records);
      const newIncidents = records.filter((r) => r.k === 'i');
      broadcast({ type: 'sample', id: c.id, t, summary: summaryOf(c), incidents: newIncidents.map((r) => ({ id: r.id, kind: r.kind, title: r.title, t: r.t })) });
    }

    async function readDeadlocks(conn, t) {
      const pos = c.deadlockPos;
      const sets = await conn.query(Q.deadlocksSince(pos && pos.file_name, pos && pos.file_offset));
      const last = rowsOf(sets, 0)[0];
      const first = !pos;
      if (last) c.deadlockPos = { file_name: last.file_name, file_offset: Number(last.file_offset) };
      const out = [];
      for (const d of rowsOf(sets, 1)) {
        const utc = Number(d.event_utc) || 0;
        if (utc <= c.lastDeadlockUtc) continue; // retomar do offset repete o bloco
        c.lastDeadlockUtc = utc;
        // Na primeira leitura não traz o passado inteiro para o histórico de hoje — só as últimas 24 h.
        if (first && utc < t - 86400e3) continue;
        let summary = 'Deadlock';
        try { summary = deadlockSummary(parseDeadlock(d.deadlock_xml)); } catch { /* XML estranho: guarda cru */ }
        out.push({ k: 'i', t: utc || t, id: 'dl-' + (utc || t).toString(36) + '-' + (++seq), kind: 'deadlock', title: 'Deadlock: ' + summary, data: { xml: String(d.deadlock_xml || '').slice(0, 200000) } });
      }
      return out;
    }

    return {
      c,
      start() { c.stopped = false; if (!c.timer) schedule(0); },
      stop() { c.stopped = true; timers.clearTimeout(c.timer); c.timer = null; if (c.conn) c.conn.close(); c.conn = null; c.cred = null; c.status = 'idle'; emit(); },
      kick() { if (!c.stopped) schedule(0); },
      forgetCredential() { c.cred = null; },
    };
  }

  function summaryOf(c) {
    const s = c.snap;
    if (!s) return { status: c.status, error: c.error };
    const heads = s.tree.heads.slice(0, 3).map((h) => ({ id: h.id, blockedCount: h.blockedCount, maxWaitMs: h.maxWaitMs, idle: !!h.idle, program: h.row && h.row.program_name, login: h.row && h.row.login_name }));
    return {
      status: c.status, error: c.error, t: s.t, active: s.requests.length, blocked: s.tree.blocked.size, heads,
      longestMs: s.requests.reduce((m, r) => Math.max(m, Number(r.total_elapsed_time) || 0), 0),
      cpu: s.cpu ? s.cpu.sql_cpu : null, batchPerSec: s.rates ? s.rates.batchPerSec : null, connections: s.rates ? s.rates.userConnections : null,
      ple: s.rates ? s.rates.ple : null, tickMs: c.lastTickMs,
    };
  }

  function ensure(id) {
    let col = collectors.get(id);
    if (!col) { col = createCollector(serverOf(id)); collectors.set(id, col); }
    col.start();
    return col;
  }
  function release(id) {
    const s = state.servers.find((x) => x.id === id);
    if (s && s.background) return; // continua em segundo plano
    if (viewers.get(id)) return;
    const col = collectors.get(id);
    if (col) { col.stop(); collectors.delete(id); }
  }

  /** Conexão avulsa (testar, saúde, queries, plano, KILL): usa o coletor se estiver conectado. */
  async function withConn(id, fn) {
    const col = collectors.get(id);
    if (col && col.c.conn && col.c.conn.alive) return fn(col.c.conn, col.c);
    const s = serverOf(id);
    const cred = col && col.c.cred ? col.c.cred : await getCredential(s.vaultEntryId);
    const conn = await connect(tediousConfig(s, cred, { requestTimeout: 30000 }));
    try { return await fn(conn, col ? col.c : null); } finally { conn.close(); }
  }

  /* ─────────────── API ─────────────── */

  const listOut = () => state.servers.map((s) => {
    const col = collectors.get(s.id);
    return { ...s, label: serverLabel(s), running: !!col, ...(col ? summaryOf(col.c) : { status: 'idle' }), info: col && col.c.info ? col.c.info : null };
  });

  return {
    init,
    list: () => listOut(),
    settings: () => state.settings,
    async setSettings(patch) {
      const p = patch || {};
      const s = state.settings;
      if (p.keepDays != null) s.keepDays = Math.min(90, Math.max(1, Number(p.keepDays) || 7));
      if (p.blockMs != null) s.blockMs = Math.min(600e3, Math.max(1000, Number(p.blockMs) || 10000));
      if (p.longMs != null) s.longMs = Math.min(3600e3, Math.max(1000, Number(p.longMs) || 30000));
      await persist();
      return s;
    },
    async add(server) {
      const s = cleanServer(server);
      s.id = 's' + now().toString(36) + Math.random().toString(36).slice(2, 6);
      state.servers.push(s);
      await persist();
      if (s.background) ensure(s.id);
      return s;
    },
    async update(id, patch) {
      const i = state.servers.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('Servidor não encontrado');
      const prev = state.servers[i];
      state.servers[i] = { ...cleanServer(patch, prev), id };
      await persist();
      const col = collectors.get(id);
      if (col) { col.stop(); collectors.delete(id); }
      if (state.servers[i].background || viewers.get(id)) ensure(id);
      return state.servers[i];
    },
    async remove(id) {
      const col = collectors.get(id);
      if (col) { col.stop(); collectors.delete(id); }
      state.servers = state.servers.filter((x) => x.id !== id);
      viewers.delete(id);
      await persist();
      return true;
    },
    /** Testa um rascunho de servidor (antes de salvar): versão, edição e permissões. */
    async test(draft) {
      const s = { ...draft, host: String(draft.host || '').trim() };
      if (!s.host) throw new Error('Informe o servidor');
      if (!s.vaultEntryId) throw new Error('Escolha a credencial no Vault');
      const cred = await getCredential(s.vaultEntryId);
      const t0 = now();
      const conn = await connect(tediousConfig(s, cred));
      try {
        const info = rowsOf(await conn.query(Q.SERVER_INFO))[0] || {};
        if (info.has_view_server_state) Object.assign(info, rowsOf(await conn.query(Q.SYS_INFO))[0] || {});
        return { ok: true, ms: now() - t0, info };
      } finally { conn.close(); }
    },
    /** A tela abriu/fechou este servidor: com alguém olhando, o ciclo fica no intervalo cheio (5 s). */
    watch(id, on) {
      const n = Math.max(0, (viewers.get(id) || 0) + (on ? 1 : -1));
      if (n) viewers.set(id, n); else viewers.delete(id);
      if (on) { const col = ensure(id); col.kick(); } else release(id);
      return true;
    },
    /** Agora: o último retrato (requests, cabeças/árvore, esperas, contadores). */
    now(id) {
      const col = collectors.get(id);
      if (!col) return { status: 'idle' };
      const c = col.c;
      const s = c.snap;
      return {
        status: c.status, error: c.error, info: c.info, summary: summaryOf(c),
        t: s ? s.t : null,
        requests: s ? s.requests : [],
        tree: s ? flatten(s.tree.trees).map((n) => ({ id: n.id, depth: n.depth, idle: !!n.idle, unknown: !!n.unknown, cycle: !!n.cycle, blockedCount: n.blockedCount, maxWaitMs: n.maxWaitMs, waitMs: n.waitMs, row: n.row })) : [],
        blocked: s ? [...s.tree.blocked] : [],
        waits: s && s.waits ? { total: s.waits.total, rows: s.waits.rows.slice(0, 15), byCategory: s.waits.byCategory } : null,
        rates: s ? s.rates : null, cpu: s ? s.cpu : null,
      };
    },
    /** Histórico de um intervalo: séries para o gráfico e incidentes. */
    async history(id, { from, to, buckets = 240 } = {}) {
      const end = Number(to) || now();
      const start = Number(from) || end - 3 * 3600e3;
      const recs = await readRange(id, start, end);
      const samples = recs.filter((r) => r.k === 's');
      return { from: start, to: end, ...H.seriesOf(samples, start, end, buckets), incidents: H.incidentsOf(recs).map((i) => ({ ...i, data: undefined, hasData: !!i.data })), samples: samples.length };
    },
    /** O que estava acontecendo em t: amostra mais próxima e incidentes abertos naquele momento (com o retrato). */
    async at(id, t) {
      const recs = await readRange(id, t - 15 * 60e3, t + 60e3);
      const inc = H.incidentsOf(await readRange(id, t - 6 * 3600e3, t + 60e3)).filter((i) => i.t <= t + 30e3 && (i.open || (i.endT || i.t) >= t - 30e3));
      return { sample: H.nearestSample(recs, t), incidents: inc };
    },
    async incident(id, incidentId, t) {
      const recs = await readRange(id, Number(t) - 60e3, Number(t) + 60e3);
      const all = H.incidentsOf(await readRange(id, Number(t) - 60e3, now()));
      const i = all.find((x) => x.id === incidentId) || H.incidentsOf(recs).find((x) => x.id === incidentId);
      if (!i) throw new Error('Incidente não encontrado no histórico');
      if (i.kind === 'deadlock' && i.data && i.data.xml) { try { i.graph = parseDeadlock(i.data.xml); } catch (e) { i.graphError = e.message; } }
      return i;
    },
    async deadlocks(id, { from, to } = {}) {
      const end = Number(to) || now();
      const start = Number(from) || end - 7 * 86400e3;
      return H.incidentsOf(await readRange(id, start, end)).filter((i) => i.kind === 'deadlock').map((i) => ({ id: i.id, t: i.t, title: i.title }));
    },
    async topQueries(id, opts = {}) {
      return withConn(id, async (conn) => {
        const rows = rowsOf(await conn.query(Q.topQueries(opts)));
        return rows.map((r) => ({ ...r, risks: r.statement_text ? sqlRisks(r.statement_text).map((x) => x.text).slice(0, 3) : [] }));
      });
    },
    async queryStoreDbs(id) { return withConn(id, async (conn) => rowsOf(await conn.query(Q.QUERY_STORE_DBS))); },
    async queryStoreTop(id, database, opts = {}) {
      return withConn(id, async (conn) => {
        const dbs = rowsOf(await conn.query(Q.QUERY_STORE_DBS)).map((r) => r.database_name);
        if (!dbs.includes(database)) throw new Error('Query Store não está ligado nesse banco');
        return rowsOf(await conn.query(Q.queryStoreTop(database, opts)));
      });
    },
    async health(id) {
      return withConn(id, async (conn, c) => {
        const run = async (sql) => { try { return rowsOf(await conn.query(sql)); } catch (e) { return { error: e.message }; } };
        const [files, logUsage, backups, jobs, connections, missing] = [await run(Q.FILES), await run(Q.LOG_USAGE), await run(Q.BACKUPS), await run(Q.FAILED_JOBS), await run(Q.CONNECTIONS), await run(Q.MISSING_INDEXES)];
        const ok = (x) => (Array.isArray(x) ? x : []);
        const ev = evaluate({ files: ok(files), logUsage: ok(logUsage), backups: ok(backups), jobs: ok(jobs), rates: c && c.rates, now: now() });
        const errors = Object.entries({ files, logUsage, backups, jobs, connections, missing }).filter(([, v]) => v && v.error).map(([k, v]) => `${k}: ${v.error}`);
        return { ...ev, files: ok(files), backups: ok(backups), jobs: ok(jobs), connections: ok(connections), missing: ok(missing), errors };
      });
    },
    async plan(id, { planHandle, sessionId } = {}) {
      return withConn(id, async (conn) => {
        let xml = null;
        if (sessionId) { try { xml = (rowsOf(await conn.query(Q.livePlanFor(sessionId)))[0] || {}).query_plan; } catch { /* sem plano ao vivo */ } }
        if (!xml && planHandle) xml = (rowsOf(await conn.query(Q.planFor(planHandle)))[0] || {}).query_plan;
        if (!xml) throw new Error('Plano não disponível (a query já terminou ou saiu do cache)');
        return { xml: String(xml) };
      });
    },
    /**
     * Encerra uma sessão. expect: { login_name, program_name, start } do que a pessoa viu — se a sessão mudou (outro
     * login/programa: número reaproveitado), recusa.
     */
    async kill(id, sessionId, expect = {}) {
      return withConn(id, async (conn, c) => {
        const own = (c && c.info && c.info.own_spid) || null;
        const sql = Q.killSql(sessionId, own);
        const cur = rowsOf(await conn.query(`${Q.PREAMBLE}SELECT login_name, program_name, host_name, login_time FROM sys.dm_exec_sessions WHERE session_id = ${Number(sessionId)};`))[0];
        if (!cur) throw new Error('A sessão já terminou');
        if ((expect.login_name && cur.login_name !== expect.login_name) || (expect.program_name != null && (cur.program_name || '') !== (expect.program_name || ''))) {
          throw new Error(`A sessão ${sessionId} agora é de outro login/programa (${cur.login_name} · ${cur.program_name || '—'}) — nada foi encerrado`);
        }
        await conn.query(sql);
        const t = now();
        await append(id, [{ k: 'i', t, id: 'kill-' + t.toString(36), kind: 'kill', title: `Sessão ${sessionId} encerrada (${cur.login_name}${cur.program_name ? ' · ' + cur.program_name : ''})`, data: { session: Number(sessionId), login: cur.login_name, program: cur.program_name, host: cur.host_name, expect } }]);
        const col = collectors.get(id);
        if (col) col.kick();
        return { ok: true };
      });
    },
    /** O Vault foi desbloqueado: os coletores esperando a credencial tentam de novo. */
    vaultUnlocked() { for (const col of collectors.values()) if (col.c.status === 'locked') col.kick(); },
    /** Resumo para o Início/palette. */
    summaries: () => listOut().map((s) => ({ id: s.id, name: s.name, label: s.label, status: s.status, error: s.error, running: s.running, active: s.active, blocked: s.blocked, heads: s.heads, background: s.background })),
    stopAll() { for (const col of collectors.values()) col.stop(); collectors.clear(); },
    flush: () => queue.flush(),
    _collectors: collectors,
  };
}

module.exports = { createDbService, cleanServer, DEFAULT_SETTINGS };
