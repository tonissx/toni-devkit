'use strict';
/**
 * Logs — formatos e leitura de uma linha/entrada. Puro (sem fs): usado pelo worker do processo principal
 * (electron/logs/engine.js) e pela tela.
 *
 * Formatos:
 * - jboss:   Fluig/WildFly/JBoss server.log — `2026-10-11 10:22:33,123 ERROR [com.x.Y] (default task-1) msg`
 *            (a data é opcional: o console do JBoss grava só a hora).
 * - ndjson:  um JSON por linha (pino, winston, serilog, bunyan, logstash…).
 * - iis:     W3C do IIS, com o cabeçalho `#Fields:` dizendo a ordem das colunas.
 * - access:  Nginx/Apache "combined" (com `$request_time` no fim, se houver).
 * - generic: começa com data/hora e tem um nível em algum lugar (log4j, logback, Spring, syslog, Python…).
 * - plain:   sem data no começo das linhas: cada linha é uma entrada, exceto as continuações de stack trace.
 *
 * Cada formato diz se uma linha começa uma entrada nova (isStart) e lê, rápido, o que o índice guarda
 * (scan → ts, level, status, ms). parse() lê tudo de uma entrada para o detalhe e os filtros por campo.
 */

const LEVELS = ['unknown', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LV = { unknown: 0, trace: 1, debug: 2, info: 3, warn: 4, error: 5, fatal: 6 };
const LEVEL_LABEL = ['—', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

const WORD_LEVEL = {
  trace: 1, finest: 1, finer: 1, verbose: 1, vrb: 1, trc: 1,
  debug: 2, dbg: 2, fine: 2, config: 2,
  info: 3, information: 3, informational: 3, notice: 3, inf: 3,
  warn: 4, warning: 4, wrn: 4,
  error: 5, err: 5, severe: 5, eror: 5,
  fatal: 6, critical: 6, crit: 6, emerg: 6, emergency: 6, alert: 6, panic: 6, ftl: 6,
};

/** 'WARNING' | 'warn' | 40 (pino) → 4. Desconhecido → 0. */
function levelFrom(v) {
  if (v == null) return 0;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    if (n >= 60) return 6; if (n >= 50) return 5; if (n >= 40) return 4; if (n >= 30) return 3; if (n >= 20) return 2; if (n >= 10) return 1;
    return 0;
  }
  return WORD_LEVEL[String(v).toLowerCase()] || 0;
}

/* ─────────────── Data e hora ─────────────── */

const MONTHS = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 };

// Cache da hora local: só cria um Date quando muda a hora — o resto é soma (milhões de linhas por arquivo).
let hourKey = -1;
let hourBase = 0;
function localMs(y, mo, d, h, mi, s, ms) {
  const k = ((y * 12 + mo) * 31 + d) * 24 + h;
  if (k !== hourKey) { hourKey = k; hourBase = new Date(y, mo, d, h).getTime(); }
  return hourBase + mi * 60000 + s * 1000 + ms;
}

const dig = (c) => c >= 48 && c <= 57;
function num(s, i, n) {
  let v = 0;
  for (let k = 0; k < n; k++) { const c = s.charCodeAt(i + k); if (c < 48 || c > 57) return -1; v = v * 10 + (c - 48); }
  return v;
}

/**
 * Data e hora no começo de s (a partir de i). Aceita:
 *   2026-10-11 10:22:33,123 · 2026-10-11T10:22:33.123456Z · 2026/10/11 10:22:33 · 11/10/2026 10:22:33 (dia primeiro)
 *   10:22:33,123 (só hora: usa baseDay) · [2026-10-11 10:22:33] · Oct 11 10:22:33 (syslog: ano de baseDay)
 * → { ms, end } ou null. baseDay: Date (meia-noite local) para logs sem data.
 */
function tsAt(s, i = 0, baseDay = null) {
  let p = i;
  if (s.charCodeAt(p) === 91) p++; // [
  let y, mo, d;
  const c0 = s.charCodeAt(p);
  if (!dig(c0)) {
    // syslog: "Oct 11 10:22:33"
    const m = MONTHS[s.substr(p, 3).toLowerCase()];
    if (m === undefined || s.charCodeAt(p + 3) !== 32) return null;
    let q = p + 4;
    if (s.charCodeAt(q) === 32) q++;
    const dd = dig(s.charCodeAt(q + 1)) ? num(s, q, 2) : num(s, q, 1);
    if (dd < 1) return null;
    q += dd >= 10 || s.charCodeAt(q) === 48 ? 2 : 1;
    if (s.charCodeAt(q) !== 32) return null;
    y = (baseDay || new Date()).getFullYear(); mo = m; d = dd; p = q + 1;
    return timePart(s, p, y, mo, d);
  }
  const a = num(s, p, 4);
  if (a >= 1970 && (s[p + 4] === '-' || s[p + 4] === '/') && s[p + 7] === s[p + 4]) {
    y = a; mo = num(s, p + 5, 2) - 1; d = num(s, p + 8, 2);
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const sep = s[p + 10];
    if (sep !== ' ' && sep !== 'T' && sep !== '_') return null;
    return timePart(s, p + 11, y, mo, d);
  }
  // 11/10/2026 10:22:33 — dia primeiro (pt-BR)
  if (dig(s.charCodeAt(p + 1)) && s[p + 2] === '/' && s[p + 5] === '/') {
    d = num(s, p, 2); mo = num(s, p + 3, 2) - 1; y = num(s, p + 6, 4);
    if (y < 1970 || mo < 0 || mo > 11 || d < 1 || d > 31 || s[p + 10] !== ' ') return null;
    return timePart(s, p + 11, y, mo, d);
  }
  // Só a hora (console do JBoss): HH:MM:SS
  if (s[p + 2] === ':' && s[p + 5] === ':') {
    const b = baseDay || new Date(new Date().setHours(0, 0, 0, 0));
    return timePart(s, p, b.getFullYear(), b.getMonth(), b.getDate());
  }
  return null;
}

function timePart(s, p, y, mo, d) {
  const h = num(s, p, 2);
  const mi = num(s, p + 3, 2);
  const sec = num(s, p + 6, 2);
  if (h < 0 || h > 23 || mi < 0 || mi > 59 || sec < 0 || sec > 60 || s[p + 2] !== ':' || s[p + 5] !== ':') return null;
  let q = p + 8;
  let ms = 0;
  const c = s[q];
  if (c === ',' || c === '.') {
    let k = q + 1; let frac = 0; let digits = 0;
    while (dig(s.charCodeAt(k))) { if (digits < 3) { frac = frac * 10 + (s.charCodeAt(k) - 48); digits++; } k++; }
    while (digits > 0 && digits < 3) { frac *= 10; digits++; }
    ms = frac; q = k;
  }
  // Fuso: Z, +03:00, -0300 (depois de espaço opcional só para "+hhmm" dos logs de acesso).
  let zone = null;
  const z = s[q];
  if (z === 'Z') { zone = 0; q++; } else if ((z === '+' || z === '-') && dig(s.charCodeAt(q + 1)) && dig(s.charCodeAt(q + 2))) {
    const hh = num(s, q + 1, 2);
    const mm = s[q + 3] === ':' ? num(s, q + 4, 2) : num(s, q + 3, 2);
    if (mm >= 0) { zone = (z === '-' ? -1 : 1) * (hh * 60 + mm); q += s[q + 3] === ':' ? 6 : 5; }
  }
  if (s.charCodeAt(q) === 93) q++; // ]
  const msv = zone == null ? localMs(y, mo, d, h, mi, sec, ms) : Date.UTC(y, mo, d, h, mi, sec, ms) - zone * 60000;
  return { ms: msv, end: q };
}

/** Data/hora dos logs de acesso: 11/Oct/2026:10:22:33 -0300 */
function accessTs(t) {
  const d = num(t, 0, 2);
  const mo = MONTHS[t.substr(3, 3).toLowerCase()];
  const y = num(t, 7, 4);
  const h = num(t, 12, 2); const mi = num(t, 15, 2); const s = num(t, 18, 2);
  if (d < 1 || mo === undefined || y < 1970 || h < 0) return NaN;
  const z = t.slice(21).trim();
  if (/^[+-]\d{4}$/.test(z)) {
    const off = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
    return Date.UTC(y, mo, d, h, mi, s) - off * 60000;
  }
  return localMs(y, mo, d, h, mi, s, 0);
}

/* ─────────────── Continuação (stack trace, mensagem em várias linhas) ─────────────── */

const STACK_RE = /^(?:\s+\S|\s*at [\w$.<>]+\(|Caused by:|Suppressed:|\.\.\. \d+ (?:more|common frames omitted)|Traceback \(most recent|\s*File ")/;
/** Linha que continua a entrada anterior mesmo em formatos sem marca de começo. */
const isContinuation = (line) => line.length === 0 || STACK_RE.test(line);

/* ─────────────── Nível em texto livre ─────────────── */

// Maiúsculas isoladas ("ERROR", "[WARN]", "level=warn") — "error" no meio da frase não conta.
const TOKEN_RE = /(?:^|[\s[|(<:=])(TRACE|DEBUG|INFO|INFORMATION|NOTICE|WARN|WARNING|ERROR|ERR|SEVERE|FATAL|CRITICAL|CRIT|VERBOSE|DBG|INF|WRN|ERR|FTL|VRB)(?=$|[\s\]|)>:,.-])/;
const BRACKET_RE = /\[(trace|debug|info|notice|warn|warning|error|err|fatal|critical|severe)\]/i;
const KV_RE = /\b(?:level|lvl|severity|loglevel)\s*[=:]\s*"?([A-Za-z]+|\d+)/i;
// Python: "2026-10-11 10:22:33,123 - app.mod - ERROR - msg" ou "ERROR:root:msg"
const PY_RE = /^(TRACE|DEBUG|INFO|WARNING|ERROR|CRITICAL):[\w.]*:/;

function levelIn(s, from = 0) {
  const head = from ? s.slice(from, from + 200) : s.slice(0, 200);
  let m = TOKEN_RE.exec(head);
  if (m) return levelFrom(m[1]);
  m = BRACKET_RE.exec(head);
  if (m) return levelFrom(m[1]);
  m = KV_RE.exec(head);
  if (m) return levelFrom(m[1]);
  m = PY_RE.exec(head);
  if (m) return levelFrom(m[1]);
  return 0;
}

/* ─────────────── Formatos ─────────────── */

const JBOSS_RE = /^(?:\d{4}-\d{2}-\d{2}[ T])?\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\s+\[([^\]]*)\]\s+\(([^)]*)\)\s?([\s\S]*)$/;
const JBOSS_HEAD = /^(?:\d{4}-\d{2}-\d{2}[ T])?\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\s/;
const ACCESS_RE = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\S+)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?(.*)$/;

// Chaves comuns de JSON por linha.
const J_TIME = ['@timestamp', 'timestamp', 'time', 'ts', '@t', 't', 'date', 'datetime', 'eventTime'];
const J_LEVEL = ['level', 'lvl', 'severity', '@l', 'levelname', 'log.level', 'loglevel', 'Level', 'LogLevel', 'severityText'];
const J_MSG = ['msg', 'message', '@m', '@mt', 'Message', 'MessageTemplate', 'text', 'log'];
const J_LOGGER = ['logger', 'name', 'logger_name', 'loggerName', 'SourceContext', 'category', 'module', 'component', 'log.logger'];
const J_THREAD = ['thread', 'thread_name', 'threadName', 'ThreadId'];
const J_ERROR = ['err', 'error', 'exception', 'Exception', 'stack', 'stack_trace', 'stacktrace', 'error.stack_trace'];

// Extração rápida (sem JSON.parse) para o índice.
const J_LEVEL_RE = /"(?:level|lvl|severity|@l|levelname|log\.level|loglevel|Level|LogLevel|severityText)"\s*:\s*(?:"([^"]*)"|(\d+))/;
const J_TIME_RE = /"(?:@timestamp|timestamp|time|ts|@t|t|date|datetime|eventTime)"\s*:\s*(?:"([^"]*)"|(\d{10,13}(?:\.\d+)?))/;

function jsonTs(v) {
  if (v == null) return NaN;
  if (typeof v === 'number' || /^\d{10,13}(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n; // segundos (unix) ou ms
  }
  const t = tsAt(String(v), 0);
  if (t) return t.ms;
  const d = Date.parse(String(v));
  return Number.isNaN(d) ? NaN : d;
}

const pick = (o, keys) => {
  for (const k of keys) {
    if (k.includes('.') && !(k in o)) {
      const v = k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o);
      if (v !== undefined) return v;
    } else if (o[k] !== undefined) return o[k];
  }
  return undefined;
};

/** Achata objetos aninhados em chaves com ponto (para filtrar por user.id:42 e mostrar no detalhe). */
function flatten(o, prefix = '', out = {}, depth = 0) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

const IIS_DEFAULT = ['date', 'time', 's-ip', 'cs-method', 'cs-uri-stem', 'cs-uri-query', 's-port', 'cs-username', 'c-ip', 'cs(User-Agent)', 'cs(Referer)', 'sc-status', 'sc-substatus', 'sc-win32-status', 'time-taken'];

const statusLevel = (st) => (st >= 500 ? LV.error : st >= 400 ? LV.warn : LV.info);

/**
 * ctx (por arquivo): { baseDay: Date|null, fields: [...] (IIS) }. scan devolve { ts, level, status, ms } e
 * pode atualizar ctx (IIS: #Fields).
 */
const FORMATS = {
  jboss: {
    label: 'Fluig / JBoss / WildFly',
    http: false,
    isStart: (line) => JBOSS_HEAD.test(line),
    scan(line, ctx) {
      const t = tsAt(line, 0, ctx.baseDay);
      const m = JBOSS_HEAD.exec(line);
      return { ts: t ? t.ms : NaN, level: m ? levelFrom(m[1]) : 0 };
    },
    parse(text, ctx) {
      const nl = text.indexOf('\n');
      const first = nl < 0 ? text : text.slice(0, nl);
      const rest = nl < 0 ? '' : text.slice(nl + 1);
      const t = tsAt(first, 0, ctx.baseDay);
      const m = JBOSS_RE.exec(first);
      if (!m) return { ts: t ? t.ms : NaN, level: levelIn(first), msg: first, stack: rest, fields: {} };
      return { ts: t ? t.ms : NaN, level: levelFrom(m[1]), logger: m[2], thread: m[3], msg: m[4], stack: rest, fields: {} };
    },
  },

  ndjson: {
    label: 'JSON por linha',
    http: false,
    isStart: (line) => !isContinuation(line),
    scan(line) {
      if (line.charCodeAt(0) !== 123) return { ts: NaN, level: levelIn(line) };
      const lm = J_LEVEL_RE.exec(line);
      const tm = J_TIME_RE.exec(line);
      return { ts: tm ? jsonTs(tm[1] != null ? tm[1] : tm[2]) : NaN, level: lm ? levelFrom(lm[1] != null ? lm[1] : lm[2]) : 0 };
    },
    parse(text) {
      const nl = text.indexOf('\n');
      const first = nl < 0 ? text : text.slice(0, nl);
      const rest = nl < 0 ? '' : text.slice(nl + 1);
      let o = null;
      try { o = JSON.parse(first); } catch { /* não é JSON */ }
      if (!o || typeof o !== 'object') return { ts: NaN, level: levelIn(first), msg: first, stack: rest, fields: {} };
      const err = pick(o, J_ERROR);
      const errStack = err && typeof err === 'object' ? (err.stack || err.message || '') : typeof err === 'string' && err.includes('\n') ? err : '';
      let msg = pick(o, J_MSG);
      if (msg != null && typeof msg !== 'string') msg = JSON.stringify(msg);
      if (msg == null) msg = err && typeof err === 'object' ? String(err.message || '') : '';
      const logger = pick(o, J_LOGGER);
      const thread = pick(o, J_THREAD);
      return {
        ts: jsonTs(pick(o, J_TIME)),
        level: levelFrom(pick(o, J_LEVEL)),
        logger: logger != null ? String(logger) : undefined,
        thread: thread != null ? String(thread) : undefined,
        msg: String(msg),
        stack: [errStack, rest].filter(Boolean).join('\n'),
        fields: flatten(o),
        json: true,
      };
    },
  },

  iis: {
    label: 'IIS (W3C)',
    http: true,
    isStart: (line) => line.length > 0,
    scan(line, ctx) {
      if (line.charCodeAt(0) === 35) { // #
        if (line.startsWith('#Fields:')) ctx.fields = line.slice(8).trim().split(/\s+/);
        return { ts: NaN, level: 0, meta: true };
      }
      const f = ctx.fields || IIS_DEFAULT;
      const parts = line.split(' ');
      const di = f.indexOf('date'); const ti = f.indexOf('time');
      const si = f.indexOf('sc-status'); const mi = f.indexOf('time-taken');
      const t = di >= 0 && ti >= 0 ? tsAt(parts[di] + ' ' + parts[ti] + 'Z', 0) : null; // IIS grava em UTC
      const status = si >= 0 ? Number(parts[si]) || 0 : 0;
      return { ts: t ? t.ms : NaN, level: status ? statusLevel(status) : 0, status, ms: mi >= 0 ? Number(parts[mi]) : NaN };
    },
    parse(text, ctx) {
      const line = text.split('\n')[0];
      if (line.charCodeAt(0) === 35) return { ts: NaN, level: 0, msg: line, stack: '', fields: {}, meta: true };
      const f = ctx.fields || IIS_DEFAULT;
      const parts = line.split(' ');
      const fields = {};
      f.forEach((k, i) => { if (parts[i] !== undefined) fields[k] = parts[i] === '-' ? '' : parts[i]; });
      const status = Number(fields['sc-status']) || 0;
      const t = fields.date && fields.time ? tsAt(fields.date + ' ' + fields.time + 'Z', 0) : null;
      const path = fields['cs-uri-stem'] || '';
      const query = fields['cs-uri-query'] || '';
      const http = {
        method: fields['cs-method'] || '', path, query, status,
        ms: Number(fields['time-taken']), ip: fields['c-ip'] || '', ua: (fields['cs(User-Agent)'] || '').replace(/\+/g, ' '),
        sub: fields['sc-substatus'], win32: fields['sc-win32-status'],
      };
      return { ts: t ? t.ms : NaN, level: status ? statusLevel(status) : 0, msg: `${http.method} ${path}${query ? '?' + query : ''} → ${status}`, stack: '', fields, http };
    },
  },

  access: {
    label: 'Nginx / Apache (acesso)',
    http: true,
    isStart: (line) => line.length > 0,
    scan(line) {
      const m = ACCESS_RE.exec(line);
      if (!m) return { ts: NaN, level: levelIn(line) };
      const status = Number(m[6]);
      return { ts: accessTs(m[4]), level: statusLevel(status), status, ms: accessMs(m[10]) };
    },
    parse(text) {
      const line = text.split('\n')[0];
      const m = ACCESS_RE.exec(line);
      if (!m) return { ts: NaN, level: levelIn(line), msg: line, stack: '', fields: {} };
      const req = m[5].split(' ');
      const [path, query = ''] = (req[1] || '').split('?');
      const status = Number(m[6]);
      const http = { method: req[0] || '', path: path || '', query, status, ms: accessMs(m[10]), ip: m[1], ua: m[9] || '', bytes: m[7] === '-' ? 0 : Number(m[7]), referer: m[8] && m[8] !== '-' ? m[8] : '', user: m[3] !== '-' ? m[3] : '' };
      return { ts: accessTs(m[4]), level: statusLevel(status), msg: `${http.method} ${http.path}${query ? '?' + query : ''} → ${status}`, stack: '', fields: { ip: http.ip, method: http.method, path: http.path, query, status, bytes: http.bytes, referer: http.referer, ua: http.ua }, http };
    },
  },

  generic: {
    label: 'Texto com data',
    http: false,
    isStart: (line, ctx) => !!tsAt(line, 0, ctx.baseDay),
    scan(line, ctx) {
      const t = tsAt(line, 0, ctx.baseDay);
      return { ts: t ? t.ms : NaN, level: levelIn(line, t ? t.end : 0) };
    },
    parse(text, ctx) {
      const nl = text.indexOf('\n');
      const first = nl < 0 ? text : text.slice(0, nl);
      const rest = nl < 0 ? '' : text.slice(nl + 1);
      const t = tsAt(first, 0, ctx.baseDay);
      const body = t ? first.slice(t.end).trim() : first;
      return { ts: t ? t.ms : NaN, level: levelIn(first, t ? t.end : 0), ...genericParts(body), stack: rest, fields: kvFields(body) };
    },
  },

  plain: {
    label: 'Texto simples',
    http: false,
    isStart: (line) => !isContinuation(line),
    scan(line) { return { ts: NaN, level: levelIn(line) }; },
    parse(text) {
      const nl = text.indexOf('\n');
      return { ts: NaN, level: levelIn(text), msg: nl < 0 ? text : text.slice(0, nl), stack: nl < 0 ? '' : text.slice(nl + 1), fields: kvFields(text.slice(0, 400)) };
    },
  },
};

/** $request_time (segundos, com ponto) ou %D (microssegundos, inteiro grande) no fim da linha de acesso → ms. */
function accessMs(tail) {
  if (!tail) return NaN;
  const m = /(?:^|\s)(\d+\.\d+|\d+)\s*$/.exec(tail.trim());
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[1].includes('.') ? v * 1000 : v > 100000 ? v / 1000 : v;
}

// Logger/thread em linhas log4j/logback/Spring depois da data.
const SPRING_RE = /^(?:\[[^\]]*\]\s*)?(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)?\s*\d*\s*---\s*\[([^\]]*)\]\s*(\S+)\s*:\s?([\s\S]*)$/;
const LOG4J_RE = /^\[([^\]]+)\]\s+(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+(\S+)\s+-\s?([\s\S]*)$/;
const LEVEL_FIRST_RE = /^\[?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|CRITICAL)\]?\s+(?:\[([^\]]+)\]\s+)?([\w$.]+(?:\.[\w$]+)+)\s*[-:]\s?([\s\S]*)$/;
function genericParts(body) {
  let m = SPRING_RE.exec(body);
  if (m) return { thread: m[1].trim(), logger: m[2], msg: m[3] };
  m = LOG4J_RE.exec(body);
  if (m) return { thread: m[1], logger: m[2], msg: m[3] };
  m = LEVEL_FIRST_RE.exec(body);
  if (m) return { thread: m[1], logger: m[2], msg: m[3] };
  return { msg: body };
}

/** chave=valor soltos na mensagem (logfmt): user=42 duration=12ms. */
function kvFields(s) {
  const out = {};
  const re = /\b([A-Za-z_][\w.-]{0,40})=("([^"]*)"|[^\s,;]+)/g;
  let m; let n = 0;
  while ((m = re.exec(s)) && n < 40) { out[m[1]] = m[3] != null ? m[3] : m[2]; n++; }
  return out;
}

/* ─────────────── Detecção ─────────────── */

/**
 * Formato pela amostra (primeiras linhas). → { format, confidence (0..1) }.
 */
function detect(sample) {
  const lines = String(sample).split(/\r?\n/).slice(0, 400).filter((l) => l.trim());
  if (!lines.length) return { format: 'plain', confidence: 0 };
  if (lines.some((l) => /^#(Software: Microsoft Internet Information Services|Fields: )/.test(l))) return { format: 'iis', confidence: 1 };
  const n = lines.length;
  const ctx = { baseDay: null };
  let json = 0; let jboss = 0; let access = 0; let ts = 0; let cont = 0;
  for (const l of lines) {
    if (l.charCodeAt(0) === 123) { try { if (typeof JSON.parse(l) === 'object') json++; } catch { /* linha quebrada */ } }
    if (JBOSS_HEAD.test(l)) jboss++;
    else if (ACCESS_RE.test(l)) access++;
    if (tsAt(l, 0, ctx.baseDay)) ts++;
    else if (STACK_RE.test(l)) cont++;
  }
  const heads = Math.max(1, n - cont); // linhas que não são continuação de stack
  const scores = [
    ['ndjson', json / heads],
    ['access', access / n],
    ['jboss', jboss / heads],
    ['generic', ts / heads],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [best, conf] = scores[0];
  if (conf >= 0.5) return { format: best === 'generic' && jboss / heads >= 0.4 ? 'jboss' : best, confidence: Math.round(conf * 100) / 100 };
  return { format: 'plain', confidence: Math.round((1 - conf) * 100) / 100 };
}

const FORMAT_IDS = Object.keys(FORMATS);

module.exports = {
  LEVELS, LV, LEVEL_LABEL, FORMATS, FORMAT_IDS,
  levelFrom, levelIn, tsAt, accessTs, isContinuation, detect, kvFields, flatten,
};
