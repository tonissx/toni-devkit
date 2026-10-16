// Testes do serviço do Banco com um SQL Server falso e relógio controlado: node --test scripts/test-db-service.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDbService } = require('../electron/db/service.js');

const DEADLOCK = '<deadlock><victim-list><victimProcess id="p1"/></victim-list><process-list><process id="p1" spid="63" clientapp="RM"><inputbuf>UPDATE a</inputbuf></process><process id="p2" spid="58"><inputbuf>UPDATE b</inputbuf></process></process-list><resource-list><keylock objectname="db.dbo.Pedido" indexname="PK"><owner-list><owner id="p2" mode="X"/></owner-list><waiter-list><waiter id="p1" mode="U"/></waiter-list></keylock></resource-list></deadlock>';

/** SQL Server de mentira: responde pelo que a consulta pede; `world` muda entre os ciclos. */
function fakeServer(world) {
  const log = [];
  const conns = [];
  const connect = async (cfg) => {
    log.push({ connect: cfg });
    if (world.refuse) throw new Error(world.refuse);
    let dead = null; const deadCbs = [];
    const conn = {
      alive: true,
      async query(sql) {
        log.push(sql);
        if (!conn.alive) throw new Error('Sem conexão com o servidor');
        if (/SELECT name FROM sys\.databases WHERE .* ORDER BY name/.test(sql)) return [{ rows: (world.dbs || ['Vendas', 'RM']).map((name) => ({ name })) }];
        if (/sp_executesql/.test(sql)) { world.schemaSql = sql; const j = world.schemaJson || ''; const parts = j.match(/[\s\S]{1,40}/g) || []; return [{ rows: parts.map((p) => ({ 'JSON_F52E2B61': p })) }]; }
        if (/KILL \d+/.test(sql)) { world.killed = Number(/KILL (\d+)/.exec(sql)[1]); return []; }
        if (/SERVERPROPERTY/.test(sql)) return [{ rows: [{ product_version: '16.0.1000', edition: 'Express', has_view_server_state: 1, own_spid: 51, login_name: 'mon' }] }];
        if (/dm_os_sys_info/.test(sql)) return [{ rows: [{ sqlserver_start_time: 0, cpu_count: 4 }] }];
        if (/FROM sys\.dm_exec_sessions WHERE session_id = /.test(sql)) return [{ rows: world.session ? [world.session] : [] }];
        if (/FROM sys\.dm_exec_requests AS r/.test(sql)) return [{ rows: world.requests || [] }, { rows: world.idle || [] }];
        if (/dm_os_performance_counters/.test(sql)) return [{ rows: [{ object_name: 'SQLServer:SQL Statistics', counter_name: 'Batch Requests/sec', instance_name: '', cntr_value: (world.batches = (world.batches || 0) + 50), cntr_type: 272696576 }, { object_name: 'SQLServer:General Statistics', counter_name: 'User Connections', instance_name: '', cntr_value: 12, cntr_type: 65792 }] }];
        if (/dm_os_wait_stats/.test(sql)) return [{ rows: [{ wait_type: 'LCK_M_X', wait_time_ms: (world.lockMs = (world.lockMs || 0) + 3000), waiting_tasks_count: 1, signal_wait_time_ms: 0 }] }];
        if (/RING_BUFFER_SCHEDULER_MONITOR/.test(sql)) return [{ rows: [{ sql_cpu: 30, system_idle: 60 }] }];
        if (/fn_xe_file_target_read_file/.test(sql)) return [{ rows: [{ file_name: 'C:\\x\\system_health_0_1.xel', file_offset: 100 }] }, { rows: world.deadlocks || [] }];
        return [{ rows: [] }];
      },
      close() { conn.alive = false; },
      onDead(cb) { deadCbs.push(cb); },
      drop(e) { conn.alive = false; dead = e; for (const cb of deadCbs) cb(e); },
    };
    void dead;
    conns.push(conn);
    return conn;
  };
  return { connect, log, conns };
}

function fakeClock(start = new Date(2026, 9, 12, 10, 0, 0).getTime()) {
  let t = start;
  let pending = [];
  let id = 0;
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) { const h = { id: ++id, fn, at: t + ms }; pending.push(h); return h; },
      clearTimeout(h) { pending = pending.filter((x) => x !== h); },
    },
    /** Avança o relógio rodando os timers que vencerem (um de cada vez, esperando cada um terminar). */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > end) break;
        pending.shift();
        t = Math.max(t, next.at);
        await next.fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
  };
}

function setup(world = {}, { locked = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-db-'));
  const clock = fakeClock();
  const srv = fakeServer(world);
  const events = [];
  const vault = { locked };
  const svc = createDbService({
    file: path.join(dir, 'db-servers.json'), dir: path.join(dir, 'db-monitor'),
    getCredential: async (id) => { if (vault.locked) throw new Error('O Vault está trancado'); if (id !== 'v1') throw new Error('não existe'); return { user: 'mon', password: 'x' }; },
    broadcast: (e) => events.push(e), connect: srv.connect, now: clock.now, timers: clock.timers,
  });
  return { dir, clock, srv, events, svc, world, vault };
}

const req = (id, blocker, extra = {}) => ({ session_id: id, blocking_session_id: blocker, wait_time: 15000, total_elapsed_time: 15000, start_time: 1, program_name: 'App', login_name: 'u', ...extra });

test('datas: hora de parede do servidor → instante certo, com servidor e PC em fusos diferentes', async () => {
  const { toMs } = require('../electron/db/driver.js');
  // O tedious monta "10:00" como hora local deste PC; o servidor está em UTC+0 → o instante é 10:00Z.
  const wall = new Date(2026, 9, 12, 10, 0, 0);
  assert.equal(toMs(wall, 0), Date.UTC(2026, 9, 12, 10, 0, 0));
  // Servidor no mesmo fuso do PC: nada muda.
  assert.equal(toMs(wall, -wall.getTimezoneOffset()), wall.getTime());
  // Sem fuso conhecido (conexão antiga): como veio.
  assert.equal(toMs(wall, null), wall.getTime());
});

test('cadastro valida e não guarda senha', async () => {
  const { svc, dir } = setup();
  await svc.init();
  await assert.rejects(svc.add({ host: '' , vaultEntryId: 'v1' }), /Informe o servidor/);
  await assert.rejects(svc.add({ host: 'srv' }), /credencial no Vault/);
  await assert.rejects(svc.add({ host: 'srv', vaultEntryId: 'v1', port: 99999 }), /Porta inválida/);
  const s = await svc.add({ name: 'Produção', host: 'srv01', instance: 'RM', vaultEntryId: 'v1', password: 'segredo', intervalSec: 1 });
  assert.equal(s.intervalSec, 2); // mínimo
  await svc.flush();
  const saved = fs.readFileSync(path.join(dir, 'db-servers.json'), 'utf8');
  assert.doesNotMatch(saved, /segredo/);
  assert.equal(svc.list()[0].label, 'srv01\\RM');
});

test('testar conexão: versão e permissões; servidor fora do ar dá erro', async () => {
  const { svc, world } = setup();
  const r = await svc.test({ host: 'srv01', vaultEntryId: 'v1' });
  assert.equal(r.ok, true);
  assert.equal(r.info.edition, 'Express');
  assert.equal(r.info.cpu_count, 4);
  world.refuse = 'Não deu para falar com o servidor';
  await assert.rejects(svc.test({ host: 'srv01', vaultEntryId: 'v1' }), /Não deu para falar/);
});

test('ao vivo: amostras no disco, incidente de bloqueio abre e fecha, aviso para a tela', async () => {
  const w = { requests: [], idle: [] };
  const { svc, clock, events, dir } = setup(w);
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1', intervalSec: 5 });
  svc.watch(s.id, true);
  await clock.advance(1);
  assert.equal(svc.now(s.id).status, 'ok');
  // Bloqueio: 55 (ociosa) segura 60 há 15 s.
  w.requests = [req(60, 55)];
  w.idle = [{ session_id: 55, program_name: 'SSMS', login_name: 'dba', transaction_begin_time: 5 }];
  await clock.advance(5000);
  const now1 = svc.now(s.id);
  assert.deepEqual(now1.tree.map((n) => [n.id, n.depth, n.idle]), [[55, 0, true], [60, 1, false]]);
  assert.equal(now1.summary.blocked, 1);
  assert.equal(now1.rates.batchPerSec, 10); // 50 lotes em 5 s
  const sample = events.filter((e) => e.type === 'sample').at(-1);
  assert.equal(sample.incidents[0].kind, 'blocking');
  // Resolveu: o incidente fecha.
  w.requests = []; w.idle = [];
  await clock.advance(5000);
  await svc.flush();
  const h = await svc.history(s.id, { from: clock.now() - 3600e3, to: clock.now() });
  assert.equal(h.incidents.length, 1);
  assert.equal(h.incidents[0].open, false);
  assert.equal(h.incidents[0].durMs, 20000); // 15 s de espera já corridos + 5 s até resolver
  assert.ok(h.samples >= 3);
  assert.ok(h.series.b.some((v) => v === 1));
  const files = fs.readdirSync(path.join(dir, 'db-monitor', s.id));
  assert.deepEqual(files, ['2026-10-12.ndjson']);
  const inc = await svc.incident(s.id, h.incidents[0].id, h.incidents[0].t);
  assert.equal(inc.data.head, 55);
  // Retrato do momento: amostra mais próxima e o incidente que estava aberto.
  const at = await svc.at(s.id, h.incidents[0].t);
  assert.equal(at.sample.b, 1);
  assert.equal(at.incidents[0].id, h.incidents[0].id);
  svc.watch(s.id, false);
  assert.equal(svc.now(s.id).status, 'idle'); // sem segundo plano: parou
});

test('sem ninguém olhando, em segundo plano o ciclo fica em 15 s', async () => {
  const { svc, clock, srv } = setup({});
  await svc.init();
  await svc.add({ host: 'srv', vaultEntryId: 'v1', intervalSec: 5, background: true });
  await clock.advance(8000); // começa depois de 8 s
  const nowQueries = () => srv.log.filter((x) => typeof x === 'string' && /dm_exec_requests AS r/.test(x)).length;
  const n0 = nowQueries();
  await clock.advance(30000);
  assert.equal(nowQueries() - n0, 2);
});

test('deadlock: registrado uma vez (retomar do offset repete o bloco)', async () => {
  const utc = new Date(2026, 9, 12, 9, 59, 0).getTime();
  const w = { deadlocks: [{ file_name: 'x', file_offset: 100, deadlock_xml: DEADLOCK, event_time: utc }] };
  const { svc, clock } = setup(w);
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1' });
  svc.watch(s.id, true);
  await clock.advance(1);
  await clock.advance(61000); // 2ª leitura de deadlocks devolve o mesmo evento
  await clock.advance(61000);
  await svc.flush();
  const list = await svc.deadlocks(s.id, { from: clock.now() - 86400e3, to: clock.now() });
  assert.equal(list.length, 1);
  assert.match(list[0].title, /^Deadlock: 2 processos · Pedido\/PK · vítima: sessão 63 \(RM\)$/);
  const inc = await svc.incident(s.id, list[0].id, list[0].t);
  assert.equal(inc.graph.edges.length, 1);
});

test('Vault trancado: espera e tenta de novo quando abre', async () => {
  const { svc, clock, vault } = setup({}, { locked: true });
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1' });
  svc.watch(s.id, true);
  await clock.advance(1);
  assert.equal(svc.now(s.id).status, 'locked');
  assert.match(svc.now(s.id).error, /Vault está trancado/);
  vault.locked = false;
  svc.vaultUnlocked();
  await clock.advance(1);
  assert.equal(svc.now(s.id).status, 'ok');
});

test('conexão cai: fica offline, registra e volta sozinha', async () => {
  const { svc, clock, srv } = setup({});
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1' });
  svc.watch(s.id, true);
  await clock.advance(1);
  srv.conns.at(-1).drop(new Error('read ECONNRESET'));
  assert.equal(svc.now(s.id).status, 'offline');
  await clock.advance(5000);
  assert.equal(svc.now(s.id).status, 'ok');
  assert.equal(srv.conns.length, 2);
  await svc.flush();
  const h = await svc.history(s.id, { from: clock.now() - 3600e3, to: clock.now() });
  assert.ok(h.incidents.some((i) => i.kind === 'offline'));
});

test('KILL confere a sessão: recusa se mudou de dono, encerra e registra se é a mesma', async () => {
  const w = { session: { login_name: 'outro', program_name: 'X' } };
  const { svc, clock } = setup(w);
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1' });
  svc.watch(s.id, true);
  await clock.advance(1);
  await assert.rejects(svc.kill(s.id, 77, { login_name: 'dba', program_name: 'SSMS' }), /agora é de outro login/);
  assert.equal(w.killed, undefined);
  w.session = { login_name: 'dba', program_name: 'SSMS', host_name: 'PC1' };
  await svc.kill(s.id, 77, { login_name: 'dba', program_name: 'SSMS' });
  assert.equal(w.killed, 77);
  await assert.rejects(svc.kill(s.id, 51, {}), /próprio monitor/);
  await assert.rejects(svc.kill(s.id, 10, {}), /acima de 50/);
  await svc.flush();
  const h = await svc.history(s.id, { from: clock.now() - 3600e3, to: clock.now() + 1 });
  assert.match(h.incidents.find((i) => i.kind === 'kill').title, /^Sessão 77 encerrada \(dba · SSMS\)$/);
});

test('schema do servidor: lista bancos, roda a query dentro do banco escolhido e junta o JSON em pedaços', async () => {
  const world = { dbs: ['Vendas', 'RM'], schemaJson: JSON.stringify({ tables: [{ schema: 'dbo', name: 'A', columns: [{ name: 'Id', type: 'int', pk: 1 }] }], fks: [] }) };
  const { svc, srv } = setup(world);
  await svc.init();
  const s = await svc.add({ host: 'srv', vaultEntryId: 'v1', intervalSec: 60 });
  assert.deepEqual(await svc.schemaDbs(s.id), ['Vendas', 'RM']);
  const r = await svc.schema(s.id, 'Vendas');
  assert.equal(r.database, 'Vendas');
  assert.equal(r.json, world.schemaJson); // pedaços de 40 caracteres reunidos
  assert.match(world.schemaSql, /EXEC \[Vendas\]\.sys\.sp_executesql/);
  assert.doesNotMatch(world.schemaSql, /\bUSE\b/); // não troca o banco da conexão do monitor
  // banco fora da lista (ou nome malicioso) é recusado antes de qualquer EXEC
  const count = () => srv.log.filter((x) => typeof x === 'string' && /sp_executesql/.test(x)).length;
  const before = count();
  await assert.rejects(svc.schema(s.id, 'x]; DROP DATABASE RM;--'), /não encontrado/);
  assert.equal(count(), before);
  world.schemaJson = '';
  await assert.rejects(svc.schema(s.id, 'RM'), /VIEW DEFINITION/);
});
