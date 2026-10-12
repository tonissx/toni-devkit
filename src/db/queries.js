'use strict';
/**
 * Banco — consultas T-SQL do monitor (SQL Server 2016+). Puro: só monta texto; quem executa é electron/db/service.js.
 *
 * Regras para não pesar num servidor de produção:
 * - Toda consulta vai com PREAMBLE: leitura suja (não espera nem segura lock), LOCK_TIMEOUT de 1 s, prioridade baixa
 *   em deadlock (se algo der errado, o monitor é a vítima) e sem contagem de linhas.
 * - Só views de sistema (DMVs). Plano de execução nunca no ciclo — só sob demanda (planFor).
 * - Textos de query cortados (4 mil caracteres o trecho, 8 mil o lote).
 * - Nada de texto do usuário concatenado: métricas e bancos vêm de listas fechadas; números são validados.
 */

const PREAMBLE = 'SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 1000; SET DEADLOCK_PRIORITY LOW;\n';

// Trecho do comando que está rodando (offsets em bytes de nvarchar → /2).
const stmt = (alias, textAlias) => `LEFT(SUBSTRING(${textAlias}.text, ${alias}.statement_start_offset / 2 + 1,
    (CASE ${alias}.statement_end_offset WHEN -1 THEN DATALENGTH(${textAlias}.text) ELSE ${alias}.statement_end_offset END - ${alias}.statement_start_offset) / 2 + 1), 4000)`;

/** Servidor e permissões (Testar conexão e cabeçalho). Funciona sem VIEW SERVER STATE. */
const SERVER_INFO = `${PREAMBLE}
SELECT
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64))   AS product_version,
    CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(64))     AS product_level,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(128))         AS edition,
    CAST(SERVERPROPERTY('MachineName') AS nvarchar(128))     AS machine_name,
    CAST(SERVERPROPERTY('ServerName') AS nvarchar(256))      AS server_name,
    CAST(SERVERPROPERTY('InstanceName') AS nvarchar(128))    AS instance_name,
    HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE')       AS has_view_server_state,
    IS_SRVROLEMEMBER('sysadmin')                             AS is_sysadmin,
    HAS_PERMS_BY_NAME(NULL, NULL, 'ALTER ANY CONNECTION')    AS can_kill,
    @@SPID                                                   AS own_spid,
    SUSER_SNAME()                                            AS login_name;`;

/** Início do SQL Server e CPUs (precisa de VIEW SERVER STATE). */
const SYS_INFO = `${PREAMBLE}
SELECT sqlserver_start_time, cpu_count, hyperthread_ratio, physical_memory_kb / 1024 AS physical_memory_mb FROM sys.dm_os_sys_info;`;

/**
 * Agora: 1º conjunto = requests ativos; 2º = sessões ociosas que bloqueiam (transação aberta sem comando rodando —
 * a cabeça "sleeping" clássica: alguém fez BEGIN TRAN e esqueceu).
 */
const NOW = `${PREAMBLE}
SELECT
    r.session_id, r.blocking_session_id, r.status, r.command,
    r.wait_type, r.wait_time, r.wait_resource, r.last_wait_type,
    r.cpu_time, r.logical_reads, r.reads, r.writes, r.total_elapsed_time, r.start_time,
    r.open_transaction_count, r.percent_complete, r.granted_query_memory, r.dop,
    DB_NAME(r.database_id) AS database_name,
    s.login_name, s.host_name, s.program_name, s.transaction_isolation_level,
    c.client_net_address,
    CONVERT(varchar(18), r.query_hash, 1) AS query_hash,
    CONVERT(varchar(130), r.plan_handle, 1) AS plan_handle,
    ${stmt('r', 't')} AS statement_text,
    LEFT(t.text, 8000) AS batch_text,
    OBJECT_NAME(t.objectid, t.dbid) AS object_name
FROM sys.dm_exec_requests AS r
JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_connections AS c ON c.session_id = r.session_id AND c.parent_connection_id IS NULL
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE r.session_id <> @@SPID
  AND (s.is_user_process = 1 OR r.blocking_session_id > 0 OR r.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests));

SELECT
    s.session_id, s.status, s.login_name, s.host_name, s.program_name,
    s.last_request_start_time, s.last_request_end_time, s.open_transaction_count,
    DB_NAME(s.database_id) AS database_name,
    c.client_net_address,
    LEFT(t.text, 8000) AS batch_text,
    tr.transaction_begin_time
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_connections AS c ON c.session_id = s.session_id AND c.parent_connection_id IS NULL
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) AS t
OUTER APPLY (
    SELECT MIN(at.transaction_begin_time) AS transaction_begin_time
    FROM sys.dm_tran_session_transactions AS st
    JOIN sys.dm_tran_active_transactions AS at ON at.transaction_id = st.transaction_id
    WHERE st.session_id = s.session_id
) AS tr
WHERE s.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0)
  AND NOT EXISTS (SELECT 1 FROM sys.dm_exec_requests AS r2 WHERE r2.session_id = s.session_id);`;

/** Contadores de desempenho que o monitor usa (o nome do objeto muda por instância: casamos pelo contador). */
const COUNTER_NAMES = [
  'Batch Requests/sec', 'SQL Compilations/sec', 'SQL Re-Compilations/sec', 'User Connections', 'Page life expectancy',
  'Lock Waits/sec', 'Number of Deadlocks/sec', 'Processes blocked', 'Transactions/sec', 'Memory Grants Pending',
  'Target Server Memory (KB)', 'Total Server Memory (KB)', 'Log File(s) Size (KB)', 'Log File(s) Used Size (KB)',
];
const COUNTERS = `${PREAMBLE}
SELECT RTRIM(object_name) AS object_name, RTRIM(counter_name) AS counter_name, RTRIM(instance_name) AS instance_name, cntr_value, cntr_type
FROM sys.dm_os_performance_counters
WHERE counter_name IN (${COUNTER_NAMES.map((n) => `N'${n.replace(/'/g, "''")}'`).join(', ')});`;

/** CPU: o SQL Server grava no ring buffer a cada minuto (uso do processo do SQL e ocioso do sistema). */
const CPU = `${PREAMBLE}
SELECT TOP (1)
    x.record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu,
    x.record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS system_idle
FROM (
    SELECT CONVERT(xml, record) AS record, [timestamp]
    FROM sys.dm_os_ring_buffers
    WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR' AND record LIKE N'%<SystemHealth>%'
) AS x
ORDER BY x.[timestamp] DESC;`;

/** Esperas acumuladas desde o início do serviço (o monitor calcula o delta entre amostras — src/db/waits.js). */
const WAITS = `${PREAMBLE}
SELECT wait_type, waiting_tasks_count, wait_time_ms, signal_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0;`;

/** Ordem das consultas mais caras — só destas colunas (nunca texto vindo da tela). */
const TOP_METRICS = {
  cpu: 'total_cpu_us', reads: 'total_reads', duration: 'total_duration_us', executions: 'executions',
  avg_cpu: 'avg_cpu_us', avg_duration: 'avg_duration_us', avg_reads: 'avg_reads', writes: 'total_writes',
};

const int = (v, min, max, def) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

/** Consultas mais caras do cache de planos, agrupadas por query_hash (a mesma query com parâmetros diferentes). */
function topQueries({ metric = 'cpu', top = 50 } = {}) {
  const col = TOP_METRICS[metric] || TOP_METRICS.cpu;
  const n = int(top, 1, 200, 50);
  return `${PREAMBLE}
WITH agg AS (
    SELECT
        qs.query_hash,
        SUM(qs.execution_count)        AS executions,
        SUM(qs.total_worker_time)      AS total_cpu_us,
        SUM(qs.total_logical_reads)    AS total_reads,
        SUM(qs.total_logical_writes)   AS total_writes,
        SUM(qs.total_elapsed_time)     AS total_duration_us,
        MAX(qs.max_elapsed_time)       AS max_duration_us,
        MIN(qs.creation_time)          AS first_seen,
        MAX(qs.last_execution_time)    AS last_execution,
        COUNT(DISTINCT qs.plan_handle) AS plans
    FROM sys.dm_exec_query_stats AS qs
    GROUP BY qs.query_hash
),
ranked AS (
    SELECT TOP (${n}) agg.*,
        total_cpu_us / NULLIF(executions, 0)      AS avg_cpu_us,
        total_duration_us / NULLIF(executions, 0) AS avg_duration_us,
        total_reads / NULLIF(executions, 0)       AS avg_reads
    FROM agg
    ORDER BY ${col} DESC
)
SELECT
    CONVERT(varchar(18), ranked.query_hash, 1) AS query_hash,
    ranked.executions, ranked.total_cpu_us, ranked.total_reads, ranked.total_writes, ranked.total_duration_us,
    ranked.max_duration_us, ranked.avg_cpu_us, ranked.avg_duration_us, ranked.avg_reads, ranked.first_seen,
    ranked.last_execution, ranked.plans,
    sample.statement_text, sample.database_name, sample.object_name, sample.plan_handle
FROM ranked
OUTER APPLY (
    SELECT TOP (1)
        ${stmt('qs', 'st')} AS statement_text,
        DB_NAME(st.dbid) AS database_name,
        OBJECT_NAME(st.objectid, st.dbid) AS object_name,
        CONVERT(varchar(130), qs.plan_handle, 1) AS plan_handle
    FROM sys.dm_exec_query_stats AS qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
    WHERE qs.query_hash = ranked.query_hash
    ORDER BY qs.last_execution_time DESC
) AS sample
ORDER BY ranked.${col} DESC;`;
}

/** Bancos com Query Store ligado (para oferecer na aba Queries). */
const QUERY_STORE_DBS = `${PREAMBLE}
CREATE TABLE #qs (database_name sysname, actual_state_desc nvarchar(60));
DECLARE @db sysname, @sql nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases WHERE state = 0 AND database_id > 4 AND HAS_DBACCESS(name) = 1;
OPEN dbs; FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT ' + QUOTENAME(@db, '''') + N', actual_state_desc FROM ' + QUOTENAME(@db) + N'.sys.database_query_store_options WHERE actual_state <> 0';
    BEGIN TRY INSERT INTO #qs EXEC (@sql); END TRY BEGIN CATCH END CATCH;
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;
SELECT database_name, actual_state_desc FROM #qs ORDER BY database_name;`;

/** Bracketed name seguro para o T-SQL (o nome precisa ter vindo de QUERY_STORE_DBS / sys.databases). */
const quoteName = (s) => '[' + String(s).replace(/]/g, ']]') + ']';

/** Query Store de um banco: as mais caras num intervalo (fromUtc/toUtc em ISO). */
function queryStoreTop(database, { metric = 'cpu', top = 50, fromIso, toIso } = {}) {
  const db = quoteName(database);
  const n = int(top, 1, 200, 50);
  const col = { cpu: 'total_cpu_us', reads: 'total_reads', duration: 'total_duration_us', executions: 'executions' }[metric] || 'total_cpu_us';
  const iso = (s) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(String(s || '')) ? String(s).replace('Z', '') : null);
  const from = iso(fromIso) || '1900-01-01T00:00:00';
  const to = iso(toIso) || '9999-12-31T00:00:00';
  return `${PREAMBLE}
SELECT TOP (${n})
    q.query_id,
    CONVERT(varchar(18), q.query_hash, 1)                      AS query_hash,
    OBJECT_NAME(q.object_id, DB_ID(N'${String(database).replace(/'/g, "''")}')) AS object_name,
    SUM(rs.count_executions)                                   AS executions,
    SUM(rs.avg_cpu_time * rs.count_executions)                 AS total_cpu_us,
    SUM(rs.avg_duration * rs.count_executions)                 AS total_duration_us,
    SUM(rs.avg_logical_io_reads * rs.count_executions)         AS total_reads,
    MAX(rs.max_duration)                                       AS max_duration_us,
    COUNT(DISTINCT p.plan_id)                                  AS plans,
    MAX(rs.last_execution_time)                                AS last_execution,
    LEFT(MAX(qt.query_sql_text), 4000)                         AS statement_text
FROM ${db}.sys.query_store_runtime_stats AS rs
JOIN ${db}.sys.query_store_runtime_stats_interval AS i ON i.runtime_stats_interval_id = rs.runtime_stats_interval_id
JOIN ${db}.sys.query_store_plan AS p ON p.plan_id = rs.plan_id
JOIN ${db}.sys.query_store_query AS q ON q.query_id = p.query_id
JOIN ${db}.sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE i.end_time >= '${from}' AND i.start_time < '${to}'
GROUP BY q.query_id, q.query_hash, q.object_id
ORDER BY ${col} DESC;`;
}

/** Plano de execução (sob demanda) de um plan_handle '0x…'. */
function planFor(planHandle) {
  if (!/^0x[0-9A-Fa-f]{2,128}$/.test(String(planHandle || ''))) throw new Error('plan_handle inválido');
  return `${PREAMBLE}SELECT query_plan FROM sys.dm_exec_query_plan(CONVERT(varbinary(64), '${planHandle}', 1));`;
}

/** Plano ao vivo de uma sessão rodando (2016 SP1+), com as contagens reais até agora. */
function livePlanFor(sessionId) {
  const sid = int(sessionId, 1, 32767, null);
  if (!sid) throw new Error('Sessão inválida');
  return `${PREAMBLE}SELECT query_plan FROM sys.dm_exec_query_statistics_xml(${sid});`;
}

/**
 * Deadlocks do system_health a partir de um ponto (arquivo + offset da última leitura), para não reler os arquivos
 * inteiros a cada minuto. Primeira vez: sem ponto, lê tudo o que houver (só converte para XML os deadlocks).
 * → 1º conjunto: a posição mais nova lida ({ file_name, file_offset }, para a próxima chamada);
 *   2º: os deadlocks ({ file_name, file_offset, deadlock_xml, event_utc }).
 * Retomar de um offset devolve de novo os eventos daquele bloco: quem chama descarta os já vistos (event_utc).
 */
function deadlocksSince(fileName, fileOffset) {
  const ok = fileName && /^[^'\r\n]{1,400}\.xel$/i.test(fileName) && Number.isSafeInteger(Number(fileOffset));
  const start = ok ? `N'${String(fileName).replace(/'/g, "''")}', ${Number(fileOffset)}` : 'NULL, NULL';
  return `${PREAMBLE}
DECLARE @target nvarchar(400) = (
    SELECT TOP (1) CAST(t.target_data AS xml).value('(EventFileTarget/File/@name)[1]', 'nvarchar(400)')
    FROM sys.dm_xe_session_targets AS t
    JOIN sys.dm_xe_sessions AS s ON s.address = t.event_session_address
    WHERE s.name = N'system_health' AND t.target_name = N'event_file');
DECLARE @pattern nvarchar(400) = LEFT(@target, LEN(@target) - CHARINDEX(N'\\', REVERSE(@target)) + 1) + N'system_health*.xel';
SELECT f.file_name, f.file_offset, f.object_name,
       CASE WHEN f.object_name = N'xml_deadlock_report' THEN f.event_data END AS event_data
INTO #xe
FROM sys.fn_xe_file_target_read_file(@pattern, NULL, ${start}) AS f
WHERE @target IS NOT NULL;
SELECT TOP (1) file_name, file_offset FROM #xe ORDER BY file_name DESC, file_offset DESC;
SELECT
    file_name, file_offset,
    CAST(CONVERT(xml, event_data).query('(event/data/value/deadlock)[1]') AS nvarchar(max)) AS deadlock_xml,
    CONVERT(xml, event_data).value('(event/@timestamp)[1]', 'datetime2') AS event_utc
FROM #xe
WHERE object_name = N'xml_deadlock_report'
ORDER BY file_name, file_offset;`;
}

/** Saúde: arquivos (tamanho, crescimento, espaço livre do disco). */
const FILES = `${PREAMBLE}
SELECT
    DB_NAME(mf.database_id) AS database_name, mf.file_id, mf.name AS logical_name, mf.type_desc, mf.physical_name,
    CAST(mf.size AS bigint) * 8 AS size_kb, mf.max_size, mf.growth, mf.is_percent_growth,
    d.recovery_model_desc, d.state_desc, d.log_reuse_wait_desc,
    vs.volume_mount_point, vs.total_bytes AS volume_total_bytes, vs.available_bytes AS volume_available_bytes
FROM sys.master_files AS mf
JOIN sys.databases AS d ON d.database_id = mf.database_id
OUTER APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) AS vs;`;

/** Saúde: uso do log por banco (contador — barato e sem trocar de banco). */
const LOG_USAGE = `${PREAMBLE}
SELECT RTRIM(instance_name) AS database_name, RTRIM(counter_name) AS counter_name, cntr_value
FROM sys.dm_os_performance_counters
WHERE counter_name IN (N'Log File(s) Size (KB)', N'Log File(s) Used Size (KB)', N'Percent Log Used')
  AND instance_name NOT IN (N'_Total', N'mssqlsystemresource');`;

/** Saúde: último backup de cada tipo por banco. */
const BACKUPS = `${PREAMBLE}
SELECT
    d.name AS database_name, d.recovery_model_desc, d.state_desc, d.create_date,
    MAX(CASE WHEN b.type = 'D' THEN b.backup_finish_date END) AS last_full,
    MAX(CASE WHEN b.type = 'I' THEN b.backup_finish_date END) AS last_diff,
    MAX(CASE WHEN b.type = 'L' THEN b.backup_finish_date END) AS last_log
FROM sys.databases AS d
LEFT JOIN msdb.dbo.backupset AS b ON b.database_name = d.name AND b.is_copy_only = 0
WHERE d.database_id <> 2
GROUP BY d.name, d.recovery_model_desc, d.state_desc, d.create_date;`;

/** Saúde: jobs do SQL Agent que falharam nas últimas 24 h (Express não tem Agent: volta vazio). */
const FAILED_JOBS = `${PREAMBLE}
SELECT TOP (50)
    j.name AS job_name, h.step_id, h.step_name, h.run_status, LEFT(h.message, 2000) AS message,
    msdb.dbo.agent_datetime(h.run_date, h.run_time) AS run_at,
    h.run_duration
FROM msdb.dbo.sysjobhistory AS h
JOIN msdb.dbo.sysjobs AS j ON j.job_id = h.job_id
WHERE h.run_status = 0 AND h.step_id = 0
  AND msdb.dbo.agent_datetime(h.run_date, h.run_time) >= DATEADD(HOUR, -24, GETDATE())
ORDER BY run_at DESC;`;

/** Saúde: conexões por programa/login/host (pool esgotando, app esquecendo transação aberta). */
const CONNECTIONS = `${PREAMBLE}
SELECT
    ISNULL(s.program_name, N'') AS program_name, s.login_name, ISNULL(s.host_name, N'') AS host_name,
    COUNT(*) AS sessions,
    SUM(CASE WHEN r.session_id IS NOT NULL THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN s.open_transaction_count > 0 THEN 1 ELSE 0 END) AS open_transactions,
    MIN(s.login_time) AS oldest_login
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_requests AS r ON r.session_id = s.session_id
WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
GROUP BY s.program_name, s.login_name, s.host_name
ORDER BY sessions DESC;`;

/** Saúde: índices que o otimizador sentiu falta (desde o último restart) — só sugestão, nunca aplicada. */
const MISSING_INDEXES = `${PREAMBLE}
SELECT TOP (30)
    DB_NAME(mid.database_id) AS database_name, mid.statement AS table_name,
    mid.equality_columns, mid.inequality_columns, mid.included_columns,
    migs.user_seeks, migs.user_scans, migs.avg_total_user_cost, migs.avg_user_impact, migs.last_user_seek,
    migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS score
FROM sys.dm_db_missing_index_group_stats AS migs
JOIN sys.dm_db_missing_index_groups AS mig ON mig.index_group_handle = migs.group_handle
JOIN sys.dm_db_missing_index_details AS mid ON mid.index_handle = mig.index_handle
ORDER BY score DESC;`;

/** KILL não aceita parâmetro: o número é validado aqui (sessões de sistema e a do próprio monitor ficam de fora). */
function killSql(sessionId, ownSpid) {
  const sid = int(sessionId, 51, 32767, null);
  if (!sid) throw new Error('Só dá para encerrar sessões de usuário (número acima de 50)');
  if (ownSpid && sid === Number(ownSpid)) throw new Error('Esta é a sessão do próprio monitor');
  return `KILL ${sid};`;
}

module.exports = {
  PREAMBLE, SERVER_INFO, SYS_INFO, NOW, COUNTERS, COUNTER_NAMES, CPU, WAITS, TOP_METRICS, topQueries, QUERY_STORE_DBS,
  queryStoreTop, planFor, livePlanFor, deadlocksSince, FILES, LOG_USAGE, BACKUPS, FAILED_JOBS, CONNECTIONS, MISSING_INDEXES,
  killSql, quoteName,
};
