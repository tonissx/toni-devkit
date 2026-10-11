// Testes da ferramenta Logs (regras puras): node --test scripts/test-logs.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../src/logs/parse.js');
const F = require('../src/logs/fingerprint.js');
const Q = require('../src/logs/query.js');
const A = require('../src/logs/aggregate.js');
const R = require('../src/logs/rotate.js');
const { redact } = require('../src/logs/redact.js');
const { LogIndex, histogramSpec } = require('../src/logs/index.js');

const JBOSS = `2026-10-11 10:22:33,123 INFO  [org.jboss.as] (Controller Boot Thread) WFLYSRV0025: Fluig iniciado em 45123ms
2026-10-11 10:22:34,001 WARN  [com.fluig.wcm] (default task-3) Widget sem permissão: 42
2026-10-11 10:22:35,500 ERROR [com.fluig.workflow.WorkflowService] (default task-12) Falha ao iniciar processo 1234
java.lang.NullPointerException: Cannot invoke "String.length()" because "nome" is null
\tat com.fluig.workflow.WorkflowService.start(WorkflowService.java:88)
\tat org.jboss.invocation.InterceptorContext.proceed(InterceptorContext.java:422)
\tat java.base/java.lang.Thread.run(Thread.java:829)
Caused by: java.sql.SQLException: Timeout de conexão
\t... 12 more
2026-10-11 10:22:36,000 ERROR [com.fluig.workflow.WorkflowService] (default task-7) Falha ao iniciar processo 5678
java.lang.NullPointerException: Cannot invoke "String.length()" because "nome" is null
\tat com.fluig.workflow.WorkflowService.start(WorkflowService.java:88)
Caused by: java.sql.SQLException: Timeout de conexão
2026-10-11 10:23:00,000 INFO  [stdout] (default task-1) heartbeat ok
`;

const NDJSON = `{"level":30,"time":1791800000000,"msg":"servidor no ar","name":"api"}
{"level":50,"time":1791800001000,"msg":"falha no pagamento","name":"api","err":{"type":"Error","message":"timeout","stack":"Error: timeout\\n    at pay (/app/pay.js:10:5)"},"user":{"id":42}}
{"level":"warn","timestamp":"2026-10-11T13:00:02.000Z","message":"lento","durationMs":1200}
`;

const IIS = `#Software: Microsoft Internet Information Services 10.0
#Version: 1.0
#Date: 2026-10-11 13:00:00
#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus sc-win32-status time-taken
2026-10-11 13:00:01 10.0.0.5 GET /portal/api/users/123 - 443 - 10.0.0.9 Mozilla/5.0+(Windows) - 200 0 0 15
2026-10-11 13:00:02 10.0.0.5 POST /portal/api/process - 443 - 10.0.0.9 Mozilla/5.0+(Windows) - 500 0 0 2300
2026-10-11 13:00:03 10.0.0.5 GET /portal/api/users/456 x=1 443 - 10.0.0.8 curl/8 - 404 0 2 4
`;

const ACCESS = `10.0.0.1 - - [11/Oct/2026:10:00:00 -0300] "GET /api/users/7 HTTP/1.1" 200 512 "-" "curl/8.0" 0.012
10.0.0.2 - joao [11/Oct/2026:10:00:01 -0300] "POST /api/orders HTTP/1.1" 502 0 "https://x/" "Mozilla/5.0" 1.500
`;

const GENERIC = `2026-10-11 10:00:00.123 [main] INFO  com.acme.App - Iniciando
2026-10-11 10:00:01.456 [http-1] ERROR com.acme.Repo - Falha ao gravar id=9
org.postgresql.util.PSQLException: ERROR: duplicate key value
\tat com.acme.Repo.save(Repo.java:31)
2026-10-11T10:00:02.000-03:00  WARN 1234 --- [main] c.a.Config : propriedade antiga
`;

function indexOf(text, format, opts = {}) {
  const ix = new LogIndex({ format });
  ix.beginSegment('teste', opts);
  // Em dois pedaços cortando uma linha no meio, como no tail.
  const cut = Math.floor(text.length / 2);
  ix.add(text.slice(0, cut));
  ix.add(text.slice(cut));
  ix.end();
  return ix;
}

/* ─────────────── Detecção ─────────────── */

test('detecta cada formato pela amostra', () => {
  assert.equal(P.detect(JBOSS).format, 'jboss');
  assert.equal(P.detect(NDJSON).format, 'ndjson');
  assert.equal(P.detect(IIS).format, 'iis');
  assert.equal(P.detect(ACCESS).format, 'access');
  assert.equal(P.detect(GENERIC).format, 'generic');
  assert.equal(P.detect('só texto\noutra linha\n  continuação').format, 'plain');
});

test('tsAt lê vários formatos de data', () => {
  const local = (y, mo, d, h, mi, s, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  assert.equal(P.tsAt('2026-10-11 10:22:33,123 X').ms, local(2026, 10, 11, 10, 22, 33, 123));
  assert.equal(P.tsAt('2026-10-11T10:22:33.123456Z').ms, Date.UTC(2026, 9, 11, 10, 22, 33, 123));
  assert.equal(P.tsAt('2026-10-11T10:22:33-03:00').ms, Date.UTC(2026, 9, 11, 13, 22, 33));
  assert.equal(P.tsAt('11/10/2026 08:00:00 x').ms, local(2026, 10, 11, 8, 0, 0));
  assert.equal(P.tsAt('[2026/10/11 08:00:00] x').ms, local(2026, 10, 11, 8, 0, 0));
  assert.equal(P.tsAt('10:22:33,500 INFO', 0, new Date(2026, 0, 2)).ms, local(2026, 1, 2, 10, 22, 33, 500));
  assert.equal(P.tsAt('Oct 11 10:22:33 host sshd', 0, new Date(2026, 0, 1)).ms, local(2026, 10, 11, 10, 22, 33));
  assert.equal(P.tsAt('não é data'), null);
  assert.equal(P.tsAt('2026-13-11 10:00:00'), null);
});

test('nível em texto livre: tokens em maiúsculas, [colchetes] e level=', () => {
  assert.equal(P.levelIn('2026-10-11 x [main] ERROR com.X - y'), P.LV.error);
  assert.equal(P.levelIn('algo [warn] aconteceu'), P.LV.warn);
  assert.equal(P.levelIn('ts=1 level=debug msg=x'), P.LV.debug);
  assert.equal(P.levelIn('um error qualquer no meio da frase'), 0);
  assert.equal(P.levelFrom(50), P.LV.error);
  assert.equal(P.levelFrom('Warning'), P.LV.warn);
  assert.equal(P.levelFrom('SEVERE'), P.LV.error);
});

/* ─────────────── Índice ─────────────── */

test('JBoss: stack trace multilinha vira uma entrada só, com nível e grupo', () => {
  const ix = indexOf(JBOSS, 'jboss');
  assert.equal(ix.n, 5);
  assert.deepEqual([...ix.level.subarray(0, 5)], [P.LV.info, P.LV.warn, P.LV.error, P.LV.error, P.LV.info]);
  assert.equal(ix.lines[2], 7);
  assert.match(ix.text(2), /^2026-10-11 10:22:35,500 ERROR[\s\S]*\.\.\. 12 more$/);
  assert.equal(ix.firstLine(4), '2026-10-11 10:23:00,000 INFO  [stdout] (default task-1) heartbeat ok');
  // Os dois erros (ids e threads diferentes) caem no mesmo grupo; o aviso tem o seu.
  assert.equal(ix.group[2], ix.group[3]);
  const g = ix.groups[ix.group[2]];
  assert.equal(g.count, 2);
  assert.equal(g.rootCause, 'java.sql.SQLException');
  assert.equal(g.frame, 'com.fluig.workflow.WorkflowService.start');
  assert.match(g.title, /^SQLException em WorkflowService\.start: Falha ao iniciar processo ◇$/);
  // O aviso não herda o stack do erro seguinte.
  assert.equal(ix.groups[ix.group[1]].exception, '');
  assert.equal(ix.groups[ix.group[1]].title, 'Widget sem permissão: ◇');
  assert.deepEqual(ix.levelTotalsNow(), [0, 0, 0, 2, 1, 2, 0]);
  const p = ix.parse(2);
  assert.equal(p.logger, 'com.fluig.workflow.WorkflowService');
  assert.equal(p.thread, 'default task-12');
  assert.equal(p.msg, 'Falha ao iniciar processo 1234');
});

test('JBoss sem data usa o dia do arquivo', () => {
  const ix = indexOf('10:00:00,000 INFO  [a] (t) um\n10:00:01,000 ERROR [a] (t) dois\n', 'jboss', { baseDay: new Date(2026, 4, 3) });
  assert.equal(ix.ts[1], new Date(2026, 4, 3, 10, 0, 1).getTime());
});

test('NDJSON: nível numérico (pino) e por nome, campos achatados, stack do err', () => {
  const ix = indexOf(NDJSON, 'ndjson');
  assert.equal(ix.n, 3);
  assert.deepEqual([...ix.level.subarray(0, 3)], [P.LV.info, P.LV.error, P.LV.warn]);
  assert.equal(ix.ts[0], 1791800000000);
  assert.equal(ix.ts[2], Date.UTC(2026, 9, 11, 13, 0, 2));
  const p = ix.parse(1);
  assert.equal(p.msg, 'falha no pagamento');
  assert.equal(p.logger, 'api');
  assert.equal(p.fields['user.id'], 42);
  assert.match(p.stack, /at pay/);
});

test('IIS: colunas do #Fields, nível pelo status, duração', () => {
  const ix = indexOf(IIS, 'iis');
  assert.equal(ix.n, 7); // 4 de cabeçalho + 3 requisições
  assert.deepEqual([...ix.status.subarray(4, 7)], [200, 500, 404]);
  assert.deepEqual([...ix.level.subarray(4, 7)], [P.LV.info, P.LV.error, P.LV.warn]);
  assert.equal(ix.ms[5], 2300);
  assert.equal(ix.ts[4], Date.UTC(2026, 9, 11, 13, 0, 1));
  const p = ix.parse(6);
  assert.equal(p.http.path, '/portal/api/users/456');
  assert.equal(p.http.query, 'x=1');
  assert.equal(p.http.ua, 'curl/8');
});

test('Nginx/Apache: data com fuso, status e $request_time', () => {
  const ix = indexOf(ACCESS, 'access');
  assert.equal(ix.n, 2);
  assert.equal(ix.ts[0], Date.UTC(2026, 9, 11, 13, 0, 0));
  assert.equal(ix.status[1], 502);
  assert.equal(ix.ms[1], 1500);
  assert.equal(ix.ms[0], 12);
  const p = ix.parse(1);
  assert.equal(p.http.method, 'POST');
  assert.equal(p.http.user, 'joao');
});

test('genérico: log4j, Spring e stack de exceção', () => {
  const ix = indexOf(GENERIC, 'generic');
  assert.equal(ix.n, 3);
  assert.deepEqual([...ix.level.subarray(0, 3)], [P.LV.info, P.LV.error, P.LV.warn]);
  assert.equal(ix.lines[1], 3);
  const a = ix.parse(1);
  assert.equal(a.logger, 'com.acme.Repo');
  assert.equal(a.thread, 'http-1');
  assert.equal(a.fields.id, '9');
  const b = ix.parse(2);
  assert.equal(b.logger, 'c.a.Config');
  assert.equal(b.msg, 'propriedade antiga');
});

test('texto simples: stack sem nível vira erro', () => {
  const ix = indexOf('iniciando\nException in thread "main" java.lang.IllegalStateException: x\n\tat a.B.c(B.java:1)\nfim\n', 'plain');
  assert.equal(ix.n, 3);
  assert.equal(ix.level[1], P.LV.error);
  assert.equal(ix.groups[ix.group[1]].exception, 'java.lang.IllegalStateException');
});

test('tail: linha cortada espera o resto; continuação chega depois', () => {
  const ix = new LogIndex({ format: 'jboss' });
  ix.beginSegment('a.log');
  ix.add('2026-10-11 10:00:00,000 ERROR [x] (t) falhou\n\tat a.B.c(B.ja');
  assert.equal(ix.n, 1);
  assert.equal(ix.lines[0], 1);
  ix.add('va:1)\n2026-10-11 10:00:01,000 INFO [x] (t) ok\n');
  assert.equal(ix.n, 2);
  assert.equal(ix.lines[0], 2);
  assert.equal(ix.text(0), '2026-10-11 10:00:00,000 ERROR [x] (t) falhou\n\tat a.B.c(B.java:1)');
});

test('CRLF não aparece no texto', () => {
  const ix = indexOf('2026-10-11 10:00:00,000 INFO  [x] (t) a\r\n2026-10-11 10:00:01,000 INFO  [x] (t) b\r\n', 'jboss');
  assert.equal(ix.firstLine(0), '2026-10-11 10:00:00,000 INFO  [x] (t) a');
  assert.equal(ix.text(1), '2026-10-11 10:00:01,000 INFO  [x] (t) b');
});

test('rotação: segmentos com contexto próprio, entradas seguidas', () => {
  const ix = new LogIndex({ format: 'jboss' });
  ix.beginSegment('server.log.2026-10-10', { baseDay: new Date(2026, 9, 10) });
  ix.add('23:59:59,000 INFO  [a] (t) ontem');
  ix.beginSegment('server.log', { baseDay: new Date(2026, 9, 11) });
  ix.add('00:00:01,000 ERROR [a] (t) hoje\n');
  ix.end();
  assert.equal(ix.n, 2);
  assert.equal(ix.segOf(1).name, 'server.log');
  assert.equal(ix.ts[0], new Date(2026, 9, 10, 23, 59, 59).getTime());
  assert.equal(ix.ts[1], new Date(2026, 9, 11, 0, 0, 1).getTime());
});

/* ─────────────── Consulta ─────────────── */

test('tokenize: aspas, regex, negação e chave:valor', () => {
  const t = Q.tokenize('timeout "conexão recusada" /ti(me)?out \\d+/i -heartbeat level:error+ logger:"com.x y" -"GET /ping"');
  assert.deepEqual(t.map((x) => [x.kind, x.neg, x.value || x.source, x.key || x.flags || '']), [
    ['text', false, 'timeout', ''],
    ['phrase', false, 'conexão recusada', ''],
    ['regex', false, 'ti(me)?out \\d+', 'i'],
    ['text', true, 'heartbeat', ''],
    ['field', false, 'error+', 'level'],
    ['field', false, 'com.x y', 'logger'],
    ['phrase', true, 'GET /ping', ''],
  ]);
});

test('compile: níveis, status, tempo e erros sem derrubar o resto', () => {
  assert.deepEqual([...Q.compile('level:warn+').levels].sort(), [4, 5, 6]);
  assert.deepEqual([...Q.compile('level:info,error').levels].sort(), [3, 5]);
  assert.deepEqual([...Q.compile('level:<=info').levels].sort(), [1, 2, 3]);
  assert.deepEqual([...Q.compile('-level:info').levels].sort(), [0, 1, 2, 4, 5, 6]);
  const s = Q.statusTest('4xx,500');
  assert.equal(s(404), true); assert.equal(s(500), true); assert.equal(s(502), false);
  assert.equal(Q.numTest('>1s')(1500), true);
  const c = Q.compile('ok /a(/ status:abc level:banana');
  assert.match(c.error, /Regex inválida/);
  assert.match(c.error, /Status inválido/);
  assert.match(c.error, /Nível desconhecido/);
  assert.equal(c.text.length, 1);
  assert.equal(Q.compile('').empty, true);
});

function run(ix, q, opts) { const c = Q.compile(q); return ix.summarize(ix.mask(c), { levels: c.levels, ...opts }); }

test('consulta no índice: texto acha o stack, exclusão, campos, has:stack', () => {
  const ix = indexOf(JBOSS, 'jboss');
  assert.deepEqual([...run(ix, 'SQLException').result], [2, 3]);
  assert.deepEqual([...run(ix, 'sqlexception -task-7').result], [2]);
  assert.deepEqual([...run(ix, '"heartbeat ok"').result], [4]);
  assert.deepEqual([...run(ix, '/processo \\d{4}$/').result], []); // a 1ª linha não termina no número… é o meio
  assert.deepEqual([...run(ix, '/processo 1234/').result], [2]);
  assert.deepEqual([...run(ix, 'logger:workflow').result], [2, 3]);
  assert.deepEqual([...run(ix, 'thread:"task-3"').result], [1]);
  assert.deepEqual([...run(ix, 'has:stack').result], [2, 3]);
  assert.deepEqual([...run(ix, '-has:stack level:info').result], [0, 4]);
  assert.deepEqual([...run(ix, 'exception:NullPointer').result], [2, 3]);
  const key = ix.groups[ix.group[2]].key;
  assert.deepEqual([...run(ix, 'group:' + key).result], [2, 3]);
});

test('resumo: contagem por nível respeita o tempo; histograma respeita o nível', () => {
  const ix = indexOf(JBOSS, 'jboss');
  const all = run(ix, '');
  assert.deepEqual(all.counts, [0, 0, 0, 2, 1, 2, 0]);
  const t = new Date(2026, 9, 11, 10, 22, 35).getTime();
  const r = run(ix, 'level:error', { from: t, to: t + 600 });
  assert.deepEqual([...r.result], [2]);
  assert.equal(r.counts[P.LV.error], 1);
  assert.equal(r.counts[P.LV.info], 0);
  // Histograma: só ERROR, mas os dois (o tempo não corta o gráfico).
  let errs = 0;
  for (let b = 0; b < r.hist.buckets; b++) errs += r.hist.data[b * 7 + P.LV.error];
  assert.equal(errs, 2);
  assert.equal(r.gcount.get(ix.group[2]), 1);
});

test('tail com a mesma consulta reaproveita a máscara e calcula só o que chegou', () => {
  const ix = new LogIndex({ format: 'jboss' });
  ix.beginSegment('a');
  ix.add('2026-10-11 10:00:00,000 INFO  [x] (t) um\n2026-10-11 10:00:01,000 ERROR [x] (t) timeout\n');
  const c = Q.compile('timeout');
  assert.deepEqual([...ix.summarize(ix.mask(c)).result], [1]);
  ix.add('\tat a.B(B.java:1)\n2026-10-11 10:00:02,000 ERROR [x] (t) outro timeout\n');
  assert.deepEqual([...ix.summarize(ix.mask(c)).result], [1, 2]);
  assert.equal(ix.lines[1], 2);
});

test('histogramSpec escolhe passos redondos', () => {
  const t0 = Date.UTC(2026, 9, 11, 10, 0, 0);
  assert.equal(histogramSpec(t0, t0 + 60e3).step, 1e3);
  assert.equal(histogramSpec(t0, t0 + 3600e3).step, 30e3);
  assert.equal(histogramSpec(t0, t0 + 86400e3).step, 900e3);
  assert.equal(histogramSpec(NaN, t0), null);
});

/* ─────────────── Impressão digital ─────────────── */

test('normalize tira o que varia', () => {
  assert.equal(F.normalize('Pedido 123 do usuário joao@x.com falhou em 2026-10-11 10:00:00 (id 9f1c2d3e-0000-4000-8000-123456789abc) ip 10.0.0.1:8080'),
    'Pedido ◇ do usuário ◇ falhou em ◇ (id ◇) ip ◇');
  assert.equal(F.normalize('arquivo C:\\fluig\\volume\\x.pdf não encontrado'), 'arquivo ◇ não encontrado');
  assert.equal(F.normalize('task-12 "nome" null'), 'task-◇ "◇" null');
});

test('fingerprint: mesma falha, mesmo grupo; falhas diferentes, grupos diferentes', () => {
  const a = F.fingerprint({ msg: 'Erro ao salvar pedido 1', stack: '\tat com.acme.Repo.save(Repo.java:31)' });
  const b = F.fingerprint({ msg: 'Erro ao salvar pedido 999', stack: '\tat com.acme.Repo.save(Repo.java:31)' });
  const c = F.fingerprint({ msg: 'Erro ao salvar pedido 1', stack: '\tat com.acme.Other.save(Other.java:1)' });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  const e = F.exceptionOf('java.lang.IllegalStateException: x', '\tat java.util.X.y(X.java:1)\n\tat org.jboss.Z.w(Z.java:2)\n\tat com.fluig.A.b(A.java:3)');
  assert.equal(e.exception, 'java.lang.IllegalStateException');
  assert.equal(e.frame, 'com.fluig.A.b'); // pula frames do Java/JBoss
});

/* ─────────────── Agregados ─────────────── */

test('httpStats: classes de status, percentis e endpoints agrupados por :id', () => {
  const ix = indexOf(IIS, 'iis');
  const s = ix.summarize(ix.mask(Q.compile('')));
  const h = A.httpStats(ix, s.result, s.hist);
  const tot = h.classes.reduce((acc, c) => acc.map((v, k) => v + c[k]), [0, 0, 0, 0]);
  assert.deepEqual(tot, [1, 0, 1, 1]);
  assert.equal(h.overall.p50, 15);
  assert.equal(h.overall.p99, 2300);
  assert.deepEqual(h.endpoints.map((e) => [e.key, e.count]), [['GET /portal/api/users/:id', 2], ['POST /portal/api/process', 1]]);
  assert.deepEqual(h.failing.map((e) => e.key), ['POST /portal/api/process']);
});

test('topLoggers e percentil', () => {
  const ix = indexOf(JBOSS, 'jboss');
  const s = ix.summarize(ix.mask(Q.compile('')));
  const t = A.topLoggers(ix, s.result);
  assert.equal(t.items[0].key, 'c.f.workflow.WorkflowService');
  assert.equal(t.items[0].count, 2);
  assert.equal(t.items[0].errors, 2);
  assert.equal(A.percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(A.normPath('/api/users/123/orders/9f1c2d3e-0000-4000-8000-123456789abc'), '/api/users/:id/orders/:id');
});

/* ─────────────── Rotação ─────────────── */

test('famílias de arquivos rotacionados em ordem, do mais antigo ao atual', () => {
  const fams = R.families([
    { name: 'server.log', mtime: 50 },
    { name: 'server.log.2026-10-09', mtime: 10 },
    { name: 'server.log.2026-10-10', mtime: 20 },
    { name: 'app.log.1', mtime: 30 },
    { name: 'app.log', mtime: 40 },
    { name: 'app.log.2.gz', mtime: 5 },
    { name: 'u_ex261011.log', mtime: 3 },
    { name: 'u_ex261010.log', mtime: 2 },
    { name: 'leia-me.md', mtime: 99 },
  ]);
  assert.deepEqual(fams.map((f) => [f.family, f.files.map((x) => x.name), f.active]), [
    ['server.log', ['server.log.2026-10-09', 'server.log.2026-10-10', 'server.log'], 'server.log'],
    ['app.log', ['app.log.2.gz', 'app.log.1', 'app.log'], 'app.log'],
    ['u_ex.log', ['u_ex261010.log', 'u_ex261011.log'], null],
  ]);
  assert.equal(R.parseName('app.2026-10-10.1.log').family, 'app.log');
  assert.equal(R.parseName('app-20261010.log').date, '2026-10-10');
  assert.equal(R.baseDayOf({ date: '2026-10-10' }).getDate(), 10);
});

/* ─────────────── Redação ─────────────── */

test('redact esconde senhas, tokens, e-mails e CPF', () => {
  const { text, count } = redact('Authorization: Bearer abc.def password=hunter2 {"token":"xyz"} jdbc://sa:segredo@db email ana@x.com cpf 123.456.789-09 ok');
  assert.equal(text, 'Authorization: ‹oculto› password=‹oculto› {"token":"‹oculto›"} jdbc://sa:‹oculto›@db email ‹oculto› cpf ‹oculto› ok');
  assert.equal(count, 6);
});
