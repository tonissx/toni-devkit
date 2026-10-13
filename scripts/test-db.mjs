// Testes da ferramenta Banco (regras puras): node --test scripts/test-db.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Q = require('../src/db/queries.js');
const { blockingTree, flatten, headSummary } = require('../src/db/blocking.js');
const W = require('../src/db/waits.js');
const { parseDeadlock, deadlockSummary } = require('../src/db/deadlock.js');
const H = require('../src/db/history.js');
const C = require('../src/db/connstr.js');
const { evaluate, missingIndexSql } = require('../src/db/health.js');

const req = (id, blocker = 0, extra = {}) => ({ session_id: id, blocking_session_id: blocker, wait_time: blocker ? 1000 * id : 0, status: blocker ? 'suspended' : 'running', start_time: '2026-10-12T10:00:00', program_name: 'App', login_name: 'u' + id, ...extra });

/* ─────────────── Bloqueio ─────────────── */

test('árvore: cadeia com cabeça ociosa (transação esquecida)', () => {
  const r = blockingTree(
    [req(60, 55), req(61, 60), req(62, 55), req(70)],
    [{ session_id: 55, status: 'sleeping', open_transaction_count: 1, program_name: 'SSMS', login_name: 'dba', transaction_begin_time: '2026-10-12T09:58:00' }],
  );
  assert.equal(r.heads.length, 1);
  const h = r.heads[0];
  assert.equal(h.id, 55);
  assert.equal(h.idle, true);
  assert.equal(h.blockedCount, 3);
  assert.equal(h.maxWaitMs, 62000);
  assert.deepEqual(flatten(r.trees).map((n) => [n.id, n.depth]), [[55, 0], [60, 1], [61, 2], [62, 1]]);
  assert.deepEqual([...r.blocked].sort(), [60, 61, 62]);
  assert.match(headSummary(h), /^Sessão 55 \(SSMS · dba\) ociosa com transação aberta segura 3 sessões — maior espera 62 s$/);
});

test('árvore: paralelismo (bloqueia a si mesmo) não é bloqueio; cabeça sumida vira desconhecida', () => {
  const r = blockingTree([req(80, 80), req(81, 99)], []);
  assert.equal(r.blocked.has(80), false);
  assert.equal(r.heads.length, 1);
  assert.equal(r.heads[0].id, 99);
  assert.equal(r.heads[0].unknown, true);
});

test('árvore: ciclo (deadlock ainda não resolvido) vira árvore com a menor sessão na cabeça', () => {
  const r = blockingTree([req(90, 91), req(91, 92), req(92, 90), req(93, 92)], []);
  assert.equal(r.heads.length, 1);
  assert.equal(r.heads[0].id, 90);
  assert.equal(r.heads[0].cycle, true);
  assert.deepEqual(flatten(r.trees).map((n) => n.id).sort(), [90, 91, 92, 93]);
  assert.equal(r.heads[0].blockedCount, 3);
});

test('árvore: várias cabeças, a que segura mais primeiro', () => {
  const r = blockingTree([req(10, 5), req(11, 7), req(12, 7), req(13, 12)], [{ session_id: 5 }, { session_id: 7 }]);
  assert.deepEqual(r.heads.map((h) => [h.id, h.blockedCount]), [[7, 3], [5, 1]]);
});

/* ─────────────── Esperas e contadores ─────────────── */

const w = (type, ms, tasks = 1, sig = 0) => ({ wait_type: type, wait_time_ms: ms, waiting_tasks_count: tasks, signal_wait_time_ms: sig });

test('esperas: delta, sem as benignas, por categoria', () => {
  const d = W.waitDelta([w('LCK_M_X', 1000), w('PAGEIOLATCH_SH', 500), w('SLEEP_TASK', 99999)], [w('LCK_M_X', 6000, 4), w('PAGEIOLATCH_SH', 700, 3), w('SLEEP_TASK', 199999), w('ASYNC_NETWORK_IO', 300)], 10);
  assert.deepEqual(d.rows.map((r) => [r.wait_type, r.waitMs, r.category]), [['LCK_M_X', 5000, 'lock'], ['ASYNC_NETWORK_IO', 300, 'network'], ['PAGEIOLATCH_SH', 200, 'io']]);
  assert.equal(d.total, 5500);
  assert.equal(d.rows[0].msPerSec, 500);
  assert.deepEqual(d.byCategory, { lock: 5000, network: 300, io: 200 });
});

test('esperas: serviço reiniciado (contador menor) descarta o intervalo', () => {
  assert.equal(W.waitDelta([w('LCK_M_X', 5000)], [w('LCK_M_X', 10)], 5), null);
  assert.equal(W.waitDelta(null, [w('LCK_M_X', 10)], 5), null);
});

test('categorias de espera', () => {
  assert.equal(W.waitCategory('WRITELOG'), 'log');
  assert.equal(W.waitCategory('CXPACKET'), 'parallel');
  assert.equal(W.waitCategory('RESOURCE_SEMAPHORE'), 'memory');
  assert.equal(W.waitCategory('SOS_SCHEDULER_YIELD'), 'cpu');
  assert.equal(W.waitCategory('PAGELATCH_EX'), 'latch');
});

const ctr = (obj, name, inst, value, perSec) => ({ object_name: obj, counter_name: name, instance_name: inst, cntr_value: value, cntr_type: perSec ? 272696576 : 65792 });

test('contadores: por segundo entre amostras, instantâneos como estão, PLE do Buffer Manager', () => {
  const a = [ctr('SQLServer:SQL Statistics', 'Batch Requests/sec', '', 1000, true), ctr('SQLServer:General Statistics', 'User Connections', '', 40), ctr('SQLServer:Buffer Manager', 'Page life expectancy', '', 900), ctr('SQLServer:Buffer Node', 'Page life expectancy', '000', 5), ctr('SQLServer:Locks', 'Lock Waits/sec', '_Total', 10, true), ctr('SQLServer:Locks', 'Lock Waits/sec', 'Key', 9, true)];
  const b = [ctr('SQLServer:SQL Statistics', 'Batch Requests/sec', '', 1500, true), ctr('SQLServer:General Statistics', 'User Connections', '', 42), ctr('SQLServer:Buffer Manager', 'Page life expectancy', '', 950), ctr('SQLServer:Buffer Node', 'Page life expectancy', '000', 6), ctr('SQLServer:Locks', 'Lock Waits/sec', '_Total', 30, true), ctr('SQLServer:Locks', 'Lock Waits/sec', 'Key', 25, true)];
  assert.deepEqual(W.counterRates(a, b, 5), { batchPerSec: 100, userConnections: 42, ple: 950, lockWaitsPerSec: 4 });
  assert.equal(W.counterRates(b, a, 5), null); // reiniciou
  assert.equal(W.counterRates(null, b, 5).batchPerSec, null); // primeira amostra: sem taxa ainda
});

/* ─────────────── Deadlock ─────────────── */

const DEADLOCK = `<deadlock>
 <victim-list><victimProcess id="process1f2a8c4e8c8" /></victim-list>
 <process-list>
  <process id="process1f2a8c4e8c8" taskpriority="0" logused="232" waitresource="KEY: 7:72057594043760640 (8194443284a0)" waittime="2341" ownerId="5051" transactionname="user_transaction" lasttranstarted="2026-10-12T10:00:01.123" XDES="0x1" lockMode="U" schedulerid="1" kpid="1" status="suspended" spid="63" sbid="0" ecid="0" priority="0" trancount="2" lastbatchstarted="2026-10-12T10:00:03.140" clientapp="RM.exe" hostname="APP01" hostpid="1" loginname="rm" isolationlevel="read committed (2)" xactid="5051" currentdb="7" currentdbname="CorporeRM" lockTimeout="4294967295" clientoption1="1" clientoption2="1">
   <executionStack>
    <frame procname="adhoc" line="1" stmtstart="38" sqlhandle="0x02"> UPDATE dbo.Pedido SET Status = @1 WHERE Id = @2 </frame>
   </executionStack>
   <inputbuf>UPDATE dbo.Pedido SET Status = 'F' WHERE Id = 10</inputbuf>
  </process>
  <process id="process1f2a8c45468" waitresource="KEY: 7:72057594043826176 (a0c936a3c965)" waittime="2350" transactionname="user_transaction" lockMode="U" spid="58" trancount="2" clientapp="Fluig" hostname="FLUIG01" loginname="fluig" isolationlevel="read committed (2)" currentdbname="CorporeRM">
   <executionStack>
    <frame procname="CorporeRM.dbo.sp_AtualizaEstoque" line="12" stmtstart="200" sqlhandle="0x03"> UPDATE dbo.Estoque SET Qtd = Qtd - @q WHERE ProdutoId = @p </frame>
   </executionStack>
   <inputbuf>Proc [Database Id = 7 Object Id = 1234567]</inputbuf>
  </process>
 </process-list>
 <resource-list>
  <keylock hobtid="72057594043760640" dbid="7" objectname="CorporeRM.dbo.Pedido" indexname="PK_Pedido" id="lock1" mode="X" associatedObjectId="72057594043760640">
   <owner-list><owner id="process1f2a8c45468" mode="X" /></owner-list>
   <waiter-list><waiter id="process1f2a8c4e8c8" mode="U" requestType="wait" /></waiter-list>
  </keylock>
  <keylock hobtid="72057594043826176" dbid="7" objectname="CorporeRM.dbo.Estoque" indexname="PK_Estoque" id="lock2" mode="X" associatedObjectId="72057594043826176">
   <owner-list><owner id="process1f2a8c4e8c8" mode="X" /></owner-list>
   <waiter-list><waiter id="process1f2a8c45468" mode="U" requestType="wait" /></waiter-list>
  </keylock>
 </resource-list>
</deadlock>`;

test('deadlock: processos, recursos, vítima e arestas (quem espera → quem segura)', () => {
  const g = parseDeadlock(DEADLOCK);
  assert.deepEqual(g.victims, ['process1f2a8c4e8c8']);
  assert.equal(g.processes.length, 2);
  const v = g.processes.find((p) => p.victim);
  assert.equal(v.spid, 63);
  assert.equal(v.app, 'RM.exe');
  assert.equal(v.db, 'CorporeRM');
  assert.equal(v.inputBuffer, "UPDATE dbo.Pedido SET Status = 'F' WHERE Id = 10");
  assert.equal(v.frames[0].proc, ''); // adhoc
  assert.equal(g.processes[1].frames[0].proc, 'CorporeRM.dbo.sp_AtualizaEstoque');
  const V = 'process1f2a8c4e8c8'; const O = 'process1f2a8c45468';
  assert.deepEqual(g.resources.map((r) => [r.type, r.object, r.index, r.holders[0].process, r.waiters[0].process]),
    [['keylock', 'CorporeRM.dbo.Pedido', 'PK_Pedido', O, V], ['keylock', 'CorporeRM.dbo.Estoque', 'PK_Estoque', V, O]]);
  assert.deepEqual(g.edges.map((e) => [e.from, e.to, e.resource]), [[V, O, 'lock1'], [O, V, 'lock2']]);
  assert.equal(deadlockSummary(g), '2 processos · Pedido/PK_Pedido, Estoque/PK_Estoque · vítima: sessão 63 (RM.exe)');
});

test('deadlock: entidades e texto vazio; XML sem deadlock dá erro claro', () => {
  const g = parseDeadlock('<deadlock><victim-list/><process-list><process id="p1" spid="5"><inputbuf>SELECT 1 WHERE a &lt; b &amp;&amp; c</inputbuf></process></process-list><resource-list/></deadlock>');
  assert.equal(g.processes[0].inputBuffer, 'SELECT 1 WHERE a < b && c');
  // 2019+: frame ad hoc com texto "unknown" não vale como SQL.
  assert.equal(parseDeadlock('<deadlock><process-list><process id="p"><executionStack><frame procname="unknown" line="1">unknown</frame></executionStack><inputbuf>UPDATE x</inputbuf></process></process-list></deadlock>').processes[0].frames[0].text, '');
  assert.throws(() => parseDeadlock('<x/>'), /sem <deadlock>/);
});

/* ─────────────── Histórico e incidentes ─────────────── */

test('incidente de bloqueio: abre acima do limite, guarda o pico, fecha quando some', () => {
  const state = {};
  const snap = (t, waitMs, n) => {
    const reqs = Array.from({ length: n }, (_, k) => req(60 + k, 55, { wait_time: waitMs }));
    return { t, requests: reqs, tree: blockingTree(reqs, [{ session_id: 55, transaction_begin_time: '2026-10-12T09:00:00' }]) };
  };
  assert.deepEqual(H.detectIncidents(state, snap(1000, 3000, 2), { blockMs: 10000 }), []);
  const opened = H.detectIncidents(state, snap(6000, 12000, 2), { blockMs: 10000 });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].k, 'i');
  assert.equal(opened[0].kind, 'blocking');
  assert.equal(opened[0].data.head, 55);
  assert.equal(opened[0].data.tree.length, 3);
  assert.deepEqual(H.detectIncidents(state, snap(11000, 20000, 5), { blockMs: 10000 }), []); // mesmo incidente
  const closed = H.detectIncidents(state, { t: 16000, requests: [], tree: blockingTree([], []) }, { blockMs: 10000 });
  // Duração desde o começo real (a espera de 12 s já corria quando passou do limite, em t=6 s): 16 − (6 − 12) = 22 s.
  assert.deepEqual(closed.map((r) => [r.k, r.id === opened[0].id, r.durMs, r.peakBlocked, r.peakWaitMs]), [['e', true, 22000, 5, 20000]]);
});

test('incidente de query longa: ignora quem só está bloqueado e manutenção', () => {
  const state = {};
  const reqs = [req(70, 0, { total_elapsed_time: 45000 }), req(71, 70, { total_elapsed_time: 90000 }), req(72, 0, { total_elapsed_time: 60000, command: 'BACKUP DATABASE' })];
  const r = H.detectIncidents(state, { t: 1, requests: reqs, tree: blockingTree(reqs, []) }, { longMs: 30000, blockMs: 1e9 });
  assert.deepEqual(r.map((x) => [x.kind, x.data.row.session_id]), [['long', 70]]);
  assert.match(r[0].title, /^Query rodando há 45 s na sessão 70 \(App · u70\)$/);
});

test('amostra compacta, NDJSON, incidentes juntados, séries e retenção', () => {
  const reqs = [req(60, 55, { total_elapsed_time: 5000 }), req(70, 0, { total_elapsed_time: 900 })];
  const s = H.sampleRecord({ t: 1000, requests: reqs, tree: blockingTree(reqs, [{ session_id: 55 }]), rates: { batchPerSec: 12.34, ple: 800, userConnections: 30 }, cpu: { sql_cpu: 35, system_idle: 50 }, waits: { rows: [{ wait_type: 'LCK_M_X', waitMs: 5000 }], byCategory: { lock: 5000 } } });
  assert.deepEqual(s, { k: 's', t: 1000, a: 2, b: 1, h: 1, lx: 5000, cpu: 35, oc: 15, bps: 12.3, tps: null, conn: 30, ple: 800, lw: null, mg: null, w: [['LCK_M_X', 5000]], wc: { lock: 5000 } });
  const lines = [JSON.stringify(s), '{quebrado', JSON.stringify({ k: 'i', t: 2000, id: 'x', kind: 'blocking', title: 'T' }), JSON.stringify({ k: 'e', t: 9000, id: 'x', durMs: 7000, peakBlocked: 3 }), JSON.stringify({ ...s, t: 5000, b: 4, ple: 300 })].join('\n');
  const recs = H.parseLines(lines);
  assert.equal(recs.length, 4);
  assert.equal(H.parseLines(lines, 1500, 4000).length, 1);
  assert.deepEqual(H.incidentsOf(recs).map((i) => [i.id, i.open, i.durMs, i.peakBlocked]), [['x', false, 7000, 3]]);
  const ser = H.seriesOf(recs, 0, 60000, 12);
  assert.equal(ser.step, 5000);
  assert.equal(ser.series.b[0], 1);
  assert.equal(ser.series.b[1], 4);
  assert.equal(ser.series.ple[1], 300);
  assert.equal(H.nearestSample(recs, 4200).t, 5000);
  const now = new Date(2026, 9, 12, 12).getTime();
  assert.deepEqual(H.expiredFiles(['2026-10-01.ndjson', '2026-10-05.ndjson', '2026-10-06.ndjson', '2026-10-12.ndjson', 'x.txt'], now, 7), ['2026-10-01.ndjson']);
  assert.deepEqual(H.filesForRange(['2026-10-10.ndjson', '2026-10-11.ndjson', '2026-10-12.ndjson'], new Date(2026, 9, 11, 23).getTime(), new Date(2026, 9, 12, 1).getTime()), ['2026-10-11.ndjson', '2026-10-12.ndjson']);
});

/* ─────────────── Conexão ─────────────── */

test('connection string ADO.NET', () => {
  const c = C.parseConnectionString('Server=tcp:srv-sql01\\RM,1450;Initial Catalog=CorporeRM;User ID=monitor;Password="a;b""c";Encrypt=False;TrustServerCertificate=True');
  assert.deepEqual(c, { host: 'srv-sql01', instance: 'RM', port: 1450, database: 'CorporeRM', user: 'monitor', password: 'a;b"c', encrypt: false, trustCert: true, integrated: false });
  assert.equal(C.parseConnectionString('Data Source=(local);Integrated Security=SSPI').integrated, true);
  assert.equal(C.parseConnectionString('Data Source=(local);Integrated Security=SSPI').host, 'localhost');
});

test('connection string JDBC', () => {
  const c = C.parseConnectionString('jdbc:sqlserver://10.0.0.5:1433;databaseName=fluig;user=fluig;password={x;y};encrypt=true;trustServerCertificate=true');
  assert.deepEqual(c, { host: '10.0.0.5', instance: '', port: 1433, database: 'fluig', user: 'fluig', password: 'x;y', encrypt: true, trustCert: true, integrated: false });
  assert.equal(C.parseConnectionString('jdbc:sqlserver://srv\\INST;databaseName=a').instance, 'INST');
});

test('Vault → servidor e configuração do tedious', () => {
  const v = C.fromVaultFields([{ name: 'Servidor', value: 'srv01\\SQL2019' }, { name: 'Porta', value: '' }, { name: 'Banco', value: 'fluig' }, { name: 'Usuário', value: 'mon' }, { name: 'Senha', value: 's3' }]);
  assert.deepEqual(v, { host: 'srv01', instance: 'SQL2019', port: null, database: 'fluig', user: 'mon', password: 's3' });
  const cfg = C.tediousConfig({ ...v, trustCert: true }, v);
  assert.equal(cfg.server, 'srv01');
  assert.equal(cfg.options.instanceName, 'SQL2019');
  assert.equal(cfg.options.port, undefined);
  assert.equal(cfg.options.appName, 'Toni Devkit Monitor');
  assert.equal(cfg.options.encrypt, true);
  assert.equal(cfg.options.trustServerCertificate, true);
  assert.deepEqual(cfg.authentication, { type: 'default', options: { userName: 'mon', password: 's3' } });
  assert.equal(C.tediousConfig({ host: 'a', port: 1500 }, { user: 'u' }).options.port, 1500);
  assert.equal(C.tediousConfig({ host: 'a' }, { user: 'u' }).options.port, 1433);
  assert.throws(() => C.tediousConfig({ host: '' }, { user: 'u' }), /sem endereço/);
  assert.equal(C.serverLabel({ host: 'srv', instance: 'I', port: 1500 }), 'srv\\I,1500');
});

/* ─────────────── Saúde ─────────────── */

test('saúde: log cheio com motivo, disco, backup e jobs', () => {
  const now = new Date(2026, 9, 12, 12).getTime();
  const r = evaluate({
    now,
    logUsage: [
      { database_name: 'CorporeRM', counter_name: 'Log File(s) Size (KB)', cntr_value: 1000 }, { database_name: 'CorporeRM', counter_name: 'Percent Log Used', cntr_value: 93 },
      { database_name: 'fluig', counter_name: 'Percent Log Used', cntr_value: 40 },
    ],
    files: [
      { database_name: 'CorporeRM', log_reuse_wait_desc: 'LOG_BACKUP', recovery_model_desc: 'FULL', volume_mount_point: 'D:\\', volume_total_bytes: 1000, volume_available_bytes: 50, size_kb: 10 },
      { database_name: 'fluig', log_reuse_wait_desc: 'NOTHING', recovery_model_desc: 'SIMPLE', volume_mount_point: 'D:\\', volume_total_bytes: 1000, volume_available_bytes: 50, size_kb: 10 },
    ],
    backups: [
      { database_name: 'CorporeRM', recovery_model_desc: 'FULL', state_desc: 'ONLINE', last_full: new Date(now - 2 * 86400e3), last_log: null, create_date: new Date(2020, 0, 1) },
      { database_name: 'fluig', recovery_model_desc: 'SIMPLE', state_desc: 'ONLINE', last_full: null, create_date: new Date(2020, 0, 1) },
    ],
    jobs: [{ job_name: 'Backup noturno', run_at: new Date(now - 3 * 3600e3), message: 'falhou' }],
    rates: { ple: 120 },
  });
  const t = r.findings.map((f) => `${f.level} ${f.text}`);
  assert.ok(t.includes('crit Log de CorporeRM 93% cheio — esperando LOG_BACKUP'), t.join('\n'));
  assert.ok(t.includes('crit Disco D:\\ com só 5% livre'));
  assert.ok(t.includes('crit fluig nunca teve backup completo'));
  assert.ok(t.includes('warn CorporeRM está em FULL sem backup de log'));
  assert.ok(t.includes('warn Job "Backup noturno" falhou 3 h atrás'));
  assert.ok(t.includes('warn Page life expectancy em 120 s'));
  assert.equal(r.findings[0].level, 'crit');
  assert.match(r.findings.find((f) => f.area === 'log').hint, /backup de log/);
  assert.deepEqual(r.disks, [{ mount: 'D:\\', totalBytes: 1000, freeBytes: 50, pct: 95 }]);
});

test('CREATE INDEX sugerido', () => {
  assert.equal(missingIndexSql({ table_name: '[CorporeRM].[dbo].[Pedido]', equality_columns: '[Status]', inequality_columns: '[Data]', included_columns: '[Valor]' }),
    'CREATE NONCLUSTERED INDEX [IX_Pedido_Status_Data]\nON [CorporeRM].[dbo].[Pedido] ([Status], [Data])\nINCLUDE ([Valor]);');
});

/* ─────────────── Consultas (segurança) ─────────────── */

test('tabela temporária: limpa antes e depois (o coletor reaproveita a mesma sessão)', () => {
  for (const sql of [Q.QUERY_STORE_DBS, Q.deadlocksSince(), Q.deadlocksSince('C:\\x\\a.xel', 10)]) {
    const temps = [...new Set(sql.match(/#\w+/g) || [])];
    assert.ok(temps.length > 0);
    for (const t of temps) {
      assert.match(sql, new RegExp(`DROP TABLE IF EXISTS ${t};[\\s\\S]*DROP TABLE ${t};\\s*$`), t);
    }
  }
});

test('consultas: preâmbulo leve, métricas e números só de listas fechadas', () => {
  for (const sql of [Q.NOW, Q.COUNTERS, Q.WAITS, Q.FILES, Q.topQueries()]) assert.ok(sql.startsWith(Q.PREAMBLE));
  assert.ok(Q.PREAMBLE.startsWith(Q.MARK));
  assert.match(Q.topQueries(), new RegExp(`NOT LIKE N'${Q.MARK.replace(/[*/]/g, '\\$&')}%'`)); // o monitor não aparece no próprio top
  assert.match(Q.PREAMBLE, /READ UNCOMMITTED/);
  assert.match(Q.PREAMBLE, /LOCK_TIMEOUT 1000/);
  assert.match(Q.PREAMBLE, /DEADLOCK_PRIORITY LOW/);
  assert.match(Q.topQueries({ metric: 'reads', top: 10 }), /SELECT TOP \(10\)[\s\S]*ORDER BY total_reads DESC/);
  const evil = Q.topQueries({ metric: 'cpu; DROP TABLE x', top: '5; --' });
  assert.doesNotMatch(evil, /DROP|--\s*$/m);
  assert.match(evil, /TOP \(50\)[\s\S]*ORDER BY total_cpu_us DESC/);
  assert.equal(Q.killSql(57, 60), 'KILL 57;');
  assert.throws(() => Q.killSql(12), /acima de 50/);
  assert.throws(() => Q.killSql('57; DROP'), /acima de 50/);
  assert.throws(() => Q.killSql(60, 60), /próprio monitor/);
  assert.throws(() => Q.planFor("0x12'; DROP"), /inválido/);
  assert.match(Q.planFor('0x0600FF'), /CONVERT\(varbinary\(64\), '0x0600FF', 1\)/);
  assert.match(Q.deadlocksSince("C:\\x\\system_health_0_1.xel", 1024), /N'C:\\x\\system_health_0_1\.xel', 1024/);
  assert.match(Q.deadlocksSince("x'; DROP.xel", 5), /NULL, NULL/);
  assert.equal(Q.quoteName('a]b'), '[a]]b]');
  assert.match(Q.queryStoreTop("db'x", { fromIso: "2026-10-12T10:00:00Z' OR 1=1" }), /DB_ID\(N'db''x'\)[\s\S]*FROM \[db'x\]\.sys\.query_store_runtime_stats[\s\S]*i\.end_time >= '1900-01-01T00:00:00'/);
});

/* ─────────────── Plano de execução (Showplan) ─────────────── */

const { parsePlan, analyze, layout } = require('../src/db/showplan.js');
const PLAN = (stmt, ns = true) => `<?xml version="1.0"?><ShowPlanXML ${ns ? 'xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"' : ''} Version="1.6" Build="16.0"><BatchSequence><Batch><Statements>${stmt}</Statements></Batch></BatchSequence></ShowPlanXML>`;
const STMT = `<StmtSimple StatementText="SELECT * FROM T WHERE A = @p &amp; 1" StatementSubTreeCost="10" StatementEstRows="5" StatementType="SELECT" CardinalityEstimationModelVersion="150" StatementOptmEarlyAbortReason="TimeOut" QueryHash="0xAB">
<QueryPlan DegreeOfParallelism="1" NonParallelPlanReason="MaxDOPSetToOne" CachedPlanSize="32">
<MemoryGrantInfo RequestedMemory="102400" GrantedMemory="102400" MaxUsedMemory="1024" GrantWaitTime="3000"/>
<Warnings><PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(nvarchar(20),[T].[EXTERNAL_ID],0)"/></Warnings>
<MissingIndexes><MissingIndexGroup Impact="87.5"><MissingIndex Database="[db]" Schema="[dbo]" Table="[T]"><ColumnGroup Usage="EQUALITY"><Column Name="[A]"/></ColumnGroup><ColumnGroup Usage="INCLUDE"><Column Name="[B]"/></ColumnGroup></MissingIndex></MissingIndexGroup></MissingIndexes>
<ParameterList><ColumnReference Column="@p" ParameterDataType="int" ParameterCompiledValue="(1)" ParameterRuntimeValue="(99)"/></ParameterList>
<RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="5" EstimatedTotalSubtreeCost="10">
 <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="5" ActualExecutions="1"/></RunTimeInformation>
 <NestedLoops>
  <RelOp NodeId="1" PhysicalOp="Index Scan" LogicalOp="Index Scan" EstimateRows="20000" TableCardinality="90000" EstimatedTotalSubtreeCost="6">
   <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="2" ActualRowsRead="90000" ActualExecutions="1"/></RunTimeInformation>
   <IndexScan><Object Database="[db]" Schema="[dbo]" Table="[T]" Index="[IX_T]" IndexKind="NonClustered"/><Predicate><ScalarOperator ScalarString="[T].[A]=[@p]"/></Predicate></IndexScan>
  </RelOp>
  <RelOp NodeId="2" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="3">
   <Warnings><SpillToTempDb SpillLevel="1"/></Warnings>
   <IndexScan Lookup="1"><Object Database="[db]" Schema="[dbo]" Table="[T]" Index="[PK_T]"/></IndexScan>
  </RelOp>
 </NestedLoops>
</RelOp></QueryPlan></StmtSimple>`;

test('plano: parseia statement, nós, custos próprios e plano real', () => {
  const r = parsePlan(PLAN(STMT));
  assert.equal(r.statements.length, 1);
  const s = r.statements[0];
  assert.equal(s.text, 'SELECT * FROM T WHERE A = @p & 1');
  assert.equal(s.cost, 10);
  assert.equal(s.nodes.length, 3);
  assert.equal(s.isActual, true);
  assert.equal(s.grant.grantedKb, 102400);
  assert.deepEqual(s.nodes.map((n) => n.id), [0, 1, 2]);
  const [nl, scan, lk] = s.nodes;
  assert.equal(nl.ownCost, 1);
  assert.equal(scan.object.full, 'db.dbo.T');
  assert.equal(scan.predicate[0], '[T].[A]=[@p]');
  assert.equal(scan.runtime.rowsRead, 90000);
  assert.equal(lk.lookup, true);
  assert.equal(lk.label, 'Key Lookup');
  assert.equal(Math.round(scan.costPct), 60);
  assert.equal(s.tree.id, -1);
  assert.equal(s.tree.children[0].id, 0);
  assert.equal(s.missing[0].impact, 87.5);
});

test('plano: insights — scan, lookup, spill, conversão, missing index, grant, estimativa, sniffing', () => {
  const s = parsePlan(PLAN(STMT, false)).statements[0];
  const { insights, top } = analyze(s);
  const kinds = insights.map((i) => i.kind);
  for (const k of ['scan', 'lookup', 'spill', 'convert', 'missingIndex', 'grantWait', 'grantBig', 'estimate', 'sniffing', 'serial', 'abort']) assert.ok(kinds.includes(k), k);
  assert.equal(insights[0].severity, 'error'); // erros primeiro
  assert.ok(insights.find((i) => i.kind === 'convert').title.includes('Seek'));
  assert.match(insights.find((i) => i.kind === 'missingIndex').sql, /CREATE NONCLUSTERED INDEX .*\n.*\(\[A\]\)\nINCLUDE \(\[B\]\)/);
  assert.equal(top[0].id, 1); // maior custo próprio
});

test('plano: layout põe a raiz à esquerda e centraliza o pai nos filhos', () => {
  const s = parsePlan(PLAN(STMT)).statements[0];
  const { pos, cols, rows } = layout(s.tree);
  assert.equal(cols, 3);
  assert.equal(rows, 2);
  assert.equal(pos.get(0).col, 1);
  assert.equal(pos.get(0).row, 0.5);
  assert.equal(pos.get(-1).col, 0); // a instrução (raiz virtual) fica na coluna 0
});

test('plano: XML inválido ou sem operadores não quebra', () => {
  assert.ok(parsePlan('<<<').error);
  assert.ok(parsePlan('<a/>').error);
  assert.ok(parsePlan(PLAN('<StmtSimple StatementText="DECLARE @x int"/>')).error);
  assert.ok(parsePlan('').error);
});

test('plano: vários statements e IF (StmtCond)', () => {
  const one = '<StmtSimple StatementText="A" StatementSubTreeCost="1"><QueryPlan><RelOp NodeId="0" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="1" EstimatedTotalSubtreeCost="1"><TableScan><Object Table="[X]"/></TableScan></RelOp></QueryPlan></StmtSimple>';
  const r = parsePlan(PLAN(one + `<StmtCond StatementText="IF"><Then><Statements>${one}</Statements></Then></StmtCond>`));
  assert.equal(r.statements.length, 2);
  assert.equal(r.statements[1].index, 1);
});
