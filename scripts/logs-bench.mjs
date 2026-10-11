// Medição da ferramenta Logs: gera um server.log sintético (estilo Fluig/JBoss, com stack traces) e mede indexar,
// filtrar e resumir. node scripts/logs-bench.mjs [MB=200]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LogIndex } = require('../src/logs/index.js');
const Q = require('../src/logs/query.js');
const A = require('../src/logs/aggregate.js');

const MB = Number(process.argv[2] || 200);
const LEVELS = ['INFO ', 'INFO ', 'INFO ', 'INFO ', 'DEBUG', 'INFO ', 'WARN ', 'INFO ', 'INFO ', 'ERROR'];
const LOGGERS = ['com.fluig.workflow.WorkflowService', 'com.fluig.wcm.PageService', 'org.jboss.as.server', 'com.totvs.technology.ecm.dm', 'stdout', 'com.fluig.dataset.DatasetService'];
const MSGS = [
  (n) => `Processo ${n} movimentado pela atividade ${n % 30} por usuario${n % 97}`,
  (n) => `Dataset ds_cliente_${n % 12} executado em ${n % 900}ms`,
  (n) => `Sessão ${n.toString(16)} expirada`,
  (n) => `Timeout ao chamar ws RM (tentativa ${n % 3}) id=${n}`,
  (n) => `Documento ${n} publicado na pasta ${n % 400}`,
];
const STACK = '\njava.lang.NullPointerException: Cannot invoke "String.length()"\n\tat com.fluig.workflow.WorkflowService.start(WorkflowService.java:88)\n\tat org.jboss.invocation.InterceptorContext.proceed(InterceptorContext.java:422)\n\tat java.base/java.lang.Thread.run(Thread.java:829)';

function chunk(t0, from, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const n = from + k;
    const t = new Date(t0 + n * 37);
    const p = (x, w = 2) => String(x).padStart(w, '0');
    const ts = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())},${p(t.getMilliseconds(), 3)}`;
    const lv = LEVELS[n % 10];
    out.push(`${ts} ${lv} [${LOGGERS[n % 6]}] (default task-${n % 64}) ${MSGS[n % 5](n)}${lv === 'ERROR' && n % 3 === 0 ? STACK : ''}`);
  }
  return out.join('\n') + '\n';
}

const mem = () => Math.round(process.memoryUsage().heapUsed / 1048576) + ' MB heap';
const ix = new LogIndex({ format: 'jboss' });
ix.beginSegment('server.log');
const t0 = Date.now() - 86400e3;
let bytes = 0; let n = 0;
let gen = 0;
const tIndex = performance.now();
while (bytes < MB * 1048576) {
  const g0 = performance.now();
  const s = chunk(t0, n, 20000);
  gen += performance.now() - g0;
  n += 20000;
  bytes += s.length;
  ix.add(s);
}
ix.end();
const indexMs = performance.now() - tIndex - gen;
console.log(`indexar: ${MB} MB, ${ix.n.toLocaleString('pt-BR')} entradas em ${(indexMs / 1000).toFixed(2)} s (${(MB / (indexMs / 1000)).toFixed(0)} MB/s) · ${ix.groups.length} grupos · ${mem()}`);

function time(label, q, opts) {
  const c = Q.compile(q);
  ix._cache = null;
  const a = performance.now();
  const M = ix.mask(c);
  const s = ix.summarize(M, { levels: c.levels, ...opts });
  console.log(`${label.padEnd(36)} ${(performance.now() - a).toFixed(0).padStart(5)} ms → ${s.total.toLocaleString('pt-BR')}`);
  return s;
}
const all = time('tudo', '');
time('level:error+', 'level:error+');
time('level:error+ "timeout"', 'level:error+ "timeout"');
time('timeout (texto em tudo)', 'timeout');
time('/ds_cliente_\\d+ executado/', '/ds_cliente_\\d+ executado/');
time('-heartbeat -stdout NullPointer', '-heartbeat -stdout NullPointer');
time('logger:dataset (lê entradas)', 'logger:dataset');
const a = performance.now();
A.topLoggers(ix, all.result);
console.log(`${'topLoggers (amostra 300k)'.padEnd(36)} ${(performance.now() - a).toFixed(0).padStart(5)} ms`);
const r = performance.now();
for (let k = 0; k < 1000; k++) ix.row(all.result[(k * 7919) % all.total]);
console.log(`${'1000 linhas para a lista'.padEnd(36)} ${(performance.now() - r).toFixed(0).padStart(5)} ms · ${mem()}`);
