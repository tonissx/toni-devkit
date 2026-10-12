'use strict';
/**
 * Banco — esperas e contadores entre duas amostras. Puro.
 *
 * As DMVs são cumulativas desde o início do serviço: o que interessa é o delta. Se o valor diminuiu, o serviço
 * reiniciou (ou alguém limpou com DBCC SQLPERF) — aquele intervalo é descartado em vez de mostrar número negativo.
 */

// Esperas que não indicam problema (o SQL Server esperando trabalho) — lista consagrada, resumida.
const BENIGN = new Set([
  'BROKER_EVENTHANDLER', 'BROKER_RECEIVE_WAITFOR', 'BROKER_TASK_STOP', 'BROKER_TO_FLUSH', 'BROKER_TRANSMITTER',
  'CHECKPOINT_QUEUE', 'CHKPT', 'CLR_AUTO_EVENT', 'CLR_MANUAL_EVENT', 'CLR_SEMAPHORE', 'DBMIRROR_DBM_EVENT',
  'DBMIRROR_EVENTS_QUEUE', 'DBMIRROR_WORKER_QUEUE', 'DBMIRRORING_CMD', 'DIRTY_PAGE_POLL', 'DISPATCHER_QUEUE_SEMAPHORE',
  'EXECSYNC', 'FSAGENT', 'FT_IFTS_SCHEDULER_IDLE_WAIT', 'FT_IFTSHC_MUTEX', 'HADR_CLUSAPI_CALL', 'HADR_FILESTREAM_IOMGR_IOCOMPLETION',
  'HADR_LOGCAPTURE_WAIT', 'HADR_NOTIFICATION_DEQUEUE', 'HADR_TIMER_TASK', 'HADR_WORK_QUEUE', 'KSOURCE_WAKEUP',
  'LAZYWRITER_SLEEP', 'LOGMGR_QUEUE', 'MEMORY_ALLOCATION_EXT', 'ONDEMAND_TASK_QUEUE', 'PARALLEL_REDO_DRAIN_WORKER',
  'PARALLEL_REDO_LOG_CACHE', 'PARALLEL_REDO_TRAN_LIST', 'PARALLEL_REDO_WORKER_SYNC', 'PARALLEL_REDO_WORKER_WAIT_WORK',
  'PREEMPTIVE_OS_FLUSHFILEBUFFERS', 'PREEMPTIVE_XE_GETTARGETSTATE', 'PVS_PREALLOCATE', 'PWAIT_ALL_COMPONENTS_INITIALIZED',
  'PWAIT_DIRECTLOGCONSUMER_GETNEXT', 'PWAIT_EXTENSIBILITY_CLEANUP_TASK', 'QDS_PERSIST_TASK_MAIN_LOOP_SLEEP', 'QDS_ASYNC_QUEUE',
  'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP', 'QDS_SHUTDOWN_QUEUE', 'REDO_THREAD_PENDING_WORK', 'REQUEST_FOR_DEADLOCK_SEARCH',
  'RESOURCE_QUEUE', 'SERVER_IDLE_CHECK', 'SLEEP_BPOOL_FLUSH', 'SLEEP_DBSTARTUP', 'SLEEP_DCOMSTARTUP', 'SLEEP_MASTERDBREADY',
  'SLEEP_MASTERMDREADY', 'SLEEP_MASTERUPGRADED', 'SLEEP_MSDBSTARTUP', 'SLEEP_SYSTEMTASK', 'SLEEP_TASK', 'SLEEP_TEMPDBSTARTUP',
  'SNI_HTTP_ACCEPT', 'SOS_WORK_DISPATCHER', 'SP_SERVER_DIAGNOSTICS_SLEEP', 'SQLTRACE_BUFFER_FLUSH', 'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
  'SQLTRACE_WAIT_ENTRIES', 'UCS_SESSION_REGISTRATION', 'VDI_CLIENT_OTHER', 'WAIT_FOR_RESULTS', 'WAITFOR', 'WAITFOR_TASKSHUTDOWN',
  'WAIT_XTP_RECOVERY', 'WAIT_XTP_HOST_WAIT', 'WAIT_XTP_OFFLINE_CKPT_NEW_LOG', 'WAIT_XTP_CKPT_CLOSE', 'XE_DISPATCHER_JOIN',
  'XE_DISPATCHER_WAIT', 'XE_LIVE_TARGET_TVF', 'XE_TIMER_EVENT', 'SOS_SCHEDULER_YIELD_IDLE', 'CXCONSUMER',
]);

/** Categoria de uma espera (cor e texto no gráfico). */
function waitCategory(t) {
  const w = String(t || '');
  if (/^LCK_M_/.test(w)) return 'lock';
  if (/^PAGEIOLATCH_|^IO_COMPLETION$|^ASYNC_IO_COMPLETION$|^BACKUPIO$/.test(w)) return 'io';
  if (/^WRITELOG$|^LOGBUFFER$|^LOG_RATE_GOVERNOR$/.test(w)) return 'log';
  if (/^PAGELATCH_|^LATCH_/.test(w)) return 'latch';
  if (/^CX|^EXCHANGE$/.test(w)) return 'parallel';
  if (/^RESOURCE_SEMAPHORE|^CMEMTHREAD$|^MEMORY_/.test(w)) return 'memory';
  if (/^ASYNC_NETWORK_IO$/.test(w)) return 'network';
  if (/^SOS_SCHEDULER_YIELD$|^THREADPOOL$/.test(w)) return 'cpu';
  if (/^PREEMPTIVE_/.test(w)) return 'external';
  return 'other';
}

const CATEGORY_LABEL = {
  lock: 'Bloqueio (lock)', io: 'Disco (leitura)', log: 'Log de transações', latch: 'Latch', parallel: 'Paralelismo',
  memory: 'Memória', network: 'Rede / cliente lento', cpu: 'CPU', external: 'Chamadas externas', other: 'Outras',
};

/** O que cada espera comum costuma significar — para o tooltip/detalhe. */
const WAIT_HINT = {
  ASYNC_NETWORK_IO: 'O SQL Server terminou, mas o cliente demora a ler o resultado (app processando linha a linha, rede lenta ou resultado grande demais).',
  WRITELOG: 'Esperando o log de transações ir para o disco: disco do log lento ou muitos commits pequenos.',
  PAGEIOLATCH_SH: 'Lendo páginas do disco para a memória: falta de memória, falta de índice (varredura) ou disco lento.',
  PAGEIOLATCH_EX: 'Lendo páginas do disco para alterar: disco lento ou pouca memória.',
  CXPACKET: 'Paralelismo: threads de uma mesma query esperando umas às outras (veja MAXDOP e o custo para paralelismo).',
  SOS_SCHEDULER_YIELD: 'Pressão de CPU: queries pesadas disputando os processadores.',
  THREADPOOL: 'Faltam threads de trabalho: muitas conexões simultâneas ou bloqueio em cascata.',
  RESOURCE_SEMAPHORE: 'Queries esperando memória para executar (ordenações e hashes grandes).',
  LCK_M_X: 'Esperando um lock exclusivo — alguém está com a linha/página/tabela presa.',
  LCK_M_S: 'Leitura esperando um lock — alguém está alterando os dados (transação aberta?).',
  LCK_M_U: 'Esperando um lock de atualização — UPDATE disputando a mesma linha.',
  LCK_M_IX: 'Esperando lock de intenção exclusiva — normalmente atrás de uma varredura ou escalonamento de lock.',
  PAGELATCH_EX: 'Disputa de página em memória (tempdb ou inserções no fim do índice).',
};

/**
 * Delta de esperas. prev/cur: linhas de WAITS. secs: intervalo. → { total, rows: [{ wait_type, waitMs, tasks, signalMs,
 * msPerSec, category }] (sem as benignas, maior primeiro), byCategory: { cat: waitMs } } ou null (reinício: descarta).
 */
function waitDelta(prev, cur, secs) {
  if (!prev || !cur) return null;
  const p = new Map(prev.map((r) => [r.wait_type, r]));
  const rows = [];
  let total = 0;
  const byCategory = {};
  for (const r of cur) {
    if (BENIGN.has(r.wait_type)) continue;
    const a = p.get(r.wait_type);
    const waitMs = Number(r.wait_time_ms) - (a ? Number(a.wait_time_ms) : 0);
    if (waitMs < 0) return null; // reiniciou ou alguém zerou: não dá para comparar
    if (!waitMs) continue;
    const tasks = Number(r.waiting_tasks_count) - (a ? Number(a.waiting_tasks_count) : 0);
    const signalMs = Number(r.signal_wait_time_ms) - (a ? Number(a.signal_wait_time_ms) : 0);
    const category = waitCategory(r.wait_type);
    rows.push({ wait_type: r.wait_type, waitMs, tasks, signalMs, msPerSec: secs > 0 ? waitMs / secs : 0, category });
    total += waitMs;
    byCategory[category] = (byCategory[category] || 0) + waitMs;
  }
  rows.sort((x, y) => y.waitMs - x.waitMs);
  return { total, rows, byCategory };
}

// cntr_type: 272696576 = acumulado (por segundo = delta / s); 65792 = valor instantâneo.
const PER_SEC = 272696576;
const COUNTER_KEYS = {
  'Batch Requests/sec': 'batchPerSec', 'SQL Compilations/sec': 'compilationsPerSec', 'SQL Re-Compilations/sec': 'recompilationsPerSec',
  'User Connections': 'userConnections', 'Page life expectancy': 'ple', 'Lock Waits/sec': 'lockWaitsPerSec',
  'Number of Deadlocks/sec': 'deadlocksPerSec', 'Processes blocked': 'processesBlocked', 'Transactions/sec': 'transactionsPerSec',
  'Memory Grants Pending': 'memoryGrantsPending', 'Target Server Memory (KB)': 'targetMemoryKb', 'Total Server Memory (KB)': 'totalMemoryKb',
};

/** Escolhe a linha certa de cada contador (instância _Total, Buffer Manager para o PLE…). */
function pickCounters(rows) {
  const out = {};
  for (const r of rows || []) {
    const key = COUNTER_KEYS[r.counter_name];
    if (!key) continue;
    const inst = r.instance_name || '';
    if (key === 'ple') { if (!/Buffer Manager/i.test(r.object_name)) continue; } // não o "Buffer Node" por NUMA
    else if (key === 'lockWaitsPerSec' || key === 'deadlocksPerSec' || key === 'transactionsPerSec') { if (inst !== '_Total') continue; } else if (inst && inst !== '_Total') continue;
    out[key] = { value: Number(r.cntr_value), perSec: Number(r.cntr_type) === PER_SEC };
  }
  return out;
}

/** Contadores por segundo entre duas amostras + os instantâneos. → { batchPerSec, ple, ... } ou null se reiniciou. */
function counterRates(prevRows, curRows, secs) {
  const cur = pickCounters(curRows);
  const prev = prevRows ? pickCounters(prevRows) : null;
  const out = {};
  for (const [k, c] of Object.entries(cur)) {
    if (!c.perSec) { out[k] = c.value; continue; }
    if (!prev || !prev[k] || !(secs > 0)) { out[k] = null; continue; }
    const d = c.value - prev[k].value;
    if (d < 0) return null;
    out[k] = d / secs;
  }
  return out;
}

module.exports = { BENIGN, waitCategory, CATEGORY_LABEL, WAIT_HINT, waitDelta, pickCounters, counterRates };
