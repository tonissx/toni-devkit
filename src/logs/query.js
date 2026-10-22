'use strict';
/**
 * Logs — mini-linguagem de filtro. Puro. Termos separados por espaço, todos precisam casar (E):
 *
 *   timeout                   texto em qualquer lugar da entrada (sem diferenciar maiúsculas), stack incluído
 *   "conexão recusada"        frase exata
 *   /time(d)?out \d+/i        regex (flags: i, s, u)
 *   -heartbeat  -"GET /ping"  exclui
 *   level:error+  level:warn,error  level:>=warn
 *   logger:com.fluig  thread:"task-12"  msg:falha  path:/api/*  method:POST  ip:10.0.
 *   status:5xx  status:404  status:>=400  ms:>500  lines:>10
 *   has:stack  has:json       user.id:42  (qualquer campo do JSON/logfmt)  campo:*  (o campo existe)
 *   group:abc123ef            (um grupo de erro da aba Problemas)
 *
 * compile(q) → { terms, text, levels, idx, fields, highlight, error }. A execução fica em index.js:
 * texto/regex rodam direto sobre os blocos de texto; idx usa só os arrays do índice; fields precisam ler a entrada.
 */
const { levelFrom, LEVELS } = require('./parse.js');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Quebra a consulta em termos, respeitando "aspas" e /regex/. */
function tokenize(q) {
  const out = [];
  const s = String(q || '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let neg = false;
    if (s[i] === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) { neg = true; i++; }
    // /regex/flags
    if (s[i] === '/') {
      let j = i + 1; let esc = false; let cls = false;
      while (j < s.length) {
        const c = s[j];
        if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break;
        j++;
      }
      if (j < s.length) {
        let k = j + 1;
        while (k < s.length && /[a-z]/i.test(s[k])) k++;
        out.push({ kind: 'regex', neg, source: s.slice(i + 1, j), flags: s.slice(j + 1, k) });
        i = k;
        continue;
      }
    }
    if (s[i] === '"') {
      const j = s.indexOf('"', i + 1);
      const end = j < 0 ? s.length : j;
      out.push({ kind: 'phrase', neg, value: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // palavra ou chave:valor (valor pode vir entre aspas)
    let j = i;
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== ':' && s[j] !== '"') j++;
    if (s[j] === ':' && j > i && /^[\w.@()-]+$/.test(s.slice(i, j))) {
      const key = s.slice(i, j);
      let k = j + 1; let value;
      if (s[k] === '"') { const e = s.indexOf('"', k + 1); const end = e < 0 ? s.length : e; value = s.slice(k + 1, end); k = end + 1; } else {
        const st = k; while (k < s.length && !/\s/.test(s[k])) k++; value = s.slice(st, k);
      }
      out.push({ kind: 'field', neg, key, value });
      i = k;
      continue;
    }
    while (j < s.length && !/\s/.test(s[j])) j++;
    out.push({ kind: 'text', neg, value: s.slice(i, j) });
    i = j;
  }
  return out.filter((t) => t.kind === 'regex' || t.kind === 'field' || t.value !== '');
}

const NUM_OP_RE = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)\s*(ms|s|m)?$/i;
function numTest(v) {
  const m = NUM_OP_RE.exec(String(v).trim());
  if (!m) return null;
  const mult = !m[3] ? 1 : m[3].toLowerCase() === 's' ? 1000 : m[3].toLowerCase() === 'm' ? 60000 : 1;
  const n = Number(m[2]) * mult;
  switch (m[1]) {
    case '>': return (x) => x > n;
    case '>=': return (x) => x >= n;
    case '<': return (x) => x < n;
    case '<=': return (x) => x <= n;
    default: return (x) => x === n;
  }
}

/** status:5xx · status:404 · status:4xx,5xx · status:>=400 */
function statusTest(v) {
  const parts = String(v).split(',').map((p) => p.trim()).filter(Boolean);
  const tests = parts.map((p) => {
    if (/^[1-5]xx$/i.test(p)) { const c = Number(p[0]); return (x) => Math.floor(x / 100) === c; }
    return numTest(p);
  });
  if (!tests.length || tests.some((t) => !t)) return null;
  return (x) => tests.some((t) => t(x));
}

/** level:error+ · level:>=warn · level:warn,error · level:error → Set de níveis (0..6). */
function levelSet(v) {
  const s = String(v).toLowerCase().trim();
  let m = /^(>=|>|<=|<)?\s*([a-z]+|\d+)(\+)?$/.exec(s);
  if (m && (m[1] || m[3])) {
    const lv = levelFrom(m[2]);
    if (!lv) return null;
    const set = new Set();
    for (let i = 1; i < LEVELS.length; i++) {
      const ok = m[3] || m[1] === '>=' ? i >= lv : m[1] === '>' ? i > lv : m[1] === '<=' ? i <= lv : i < lv;
      if (ok) set.add(i);
    }
    return set;
  }
  const set = new Set();
  for (const p of s.split(',')) {
    if (!p) continue;
    if (p === 'unknown' || p === 'none' || p === '-') { set.add(0); continue; }
    m = /^([a-z]+|\d+)$/.exec(p);
    const lv = m ? levelFrom(m[1]) : 0;
    if (!lv) return null;
    set.add(lv);
  }
  return set.size ? set : null;
}

/** Teste de valor de campo: contém (sem diferenciar maiúsculas), * no fim = prefixo, =exato, números, * = existe. */
function valueTest(v) {
  const s = String(v);
  if (s === '*') return (x) => x != null && x !== '';
  const n = /^(>=|<=|>|<)/.test(s) ? numTest(s) : null;
  if (n) return (x) => x != null && x !== '' && n(Number(x));
  if (s.startsWith('=')) { const want = s.slice(1).toLowerCase(); return (x) => x != null && String(x).toLowerCase() === want; }
  if (s.includes('*')) {
    const re = new RegExp('^' + s.split('*').map(escapeRe).join('.*') + '$', 'i');
    return (x) => x != null && re.test(String(x));
  }
  const want = s.toLowerCase();
  return (x) => x != null && String(x).toLowerCase().includes(want);
}

const MS_KEYS = new Set(['ms', 'duration', 'latency', 'time-taken', 'tempo']);
const KNOWN = { logger: 'logger', thread: 'thread', msg: 'msg', message: 'msg', path: 'path', url: 'path', method: 'method', ip: 'ip', ua: 'ua', exception: 'exception' };

/**
 * Compila a consulta. Termos inválidos (regex quebrada, status:abc) viram { error } — o resto continua valendo.
 */
function compile(q) {
  const terms = tokenize(q);
  const text = [];      // { re (global), neg }   — rodam sobre o texto da entrada inteira
  const idx = [];       // { kind: 'status'|'ms'|'lines'|'stack'|'json'|'group', test, neg }
  const fields = [];    // { key, test, neg }     — precisam ler a entrada
  const highlight = []; // regexes para realçar na lista
  let levels = null;
  const errors = [];

  for (const t of terms) {
    if (t.kind === 'text' || t.kind === 'phrase') {
      const re = new RegExp(escapeRe(t.value), 'gi');
      text.push({ re, neg: t.neg, label: t.value });
      if (!t.neg) highlight.push(new RegExp(escapeRe(t.value), 'gi'));
      continue;
    }
    if (t.kind === 'regex') {
      try {
        const flags = [...new Set((t.flags || '').replace(/[^isu]/g, '') + 'g')].join('');
        const re = new RegExp(t.source, flags);
        text.push({ re, neg: t.neg, label: '/' + t.source + '/' });
        if (!t.neg) highlight.push(new RegExp(t.source, flags));
      } catch (e) { errors.push(`Regex inválida /${t.source}/: ${e.message.replace(/^Invalid regular expression: /, '')}`); }
      continue;
    }
    // campo
    const key = t.key.toLowerCase();
    if (key === 'level' || key === 'lvl' || key === 'nivel' || key === 'nível') {
      const set = levelSet(t.value);
      if (!set) { errors.push(`Nível desconhecido: ${t.value}`); continue; }
      const eff = t.neg ? new Set([0, 1, 2, 3, 4, 5, 6].filter((l) => !set.has(l))) : set;
      levels = levels ? new Set([...levels].filter((l) => eff.has(l))) : eff;
      continue;
    }
    if (key === 'status' || key === 'sc-status') {
      const test = statusTest(t.value);
      if (!test) { errors.push(`Status inválido: ${t.value}`); continue; }
      idx.push({ kind: 'status', test, neg: t.neg });
      continue;
    }
    if (MS_KEYS.has(key)) {
      const test = numTest(t.value);
      if (!test) { errors.push(`Tempo inválido: ${t.value} (use ms:>500, ms:<1s)`); continue; }
      idx.push({ kind: 'ms', test, neg: t.neg });
      continue;
    }
    if (key === 'lines' || key === 'linhas') {
      const test = numTest(t.value);
      if (!test) { errors.push(`Número de linhas inválido: ${t.value}`); continue; }
      idx.push({ kind: 'lines', test, neg: t.neg });
      continue;
    }
    if (key === 'has' || key === 'tem') {
      const v = t.value.toLowerCase();
      if (v === 'stack' || v === 'stacktrace' || v === 'trace') idx.push({ kind: 'stack', test: (x) => x, neg: t.neg });
      else fields.push({ key: v, test: (x) => x != null && x !== '', neg: t.neg });
      continue;
    }
    if (key === 'group' || key === 'grupo') {
      const want = t.value.toLowerCase();
      idx.push({ kind: 'group', test: (x) => x === want, neg: t.neg });
      continue;
    }
    fields.push({ key: KNOWN[key] || t.key, test: valueTest(t.value), neg: t.neg, known: !!KNOWN[key] });
  }

  return {
    query: String(q || ''), terms, text, idx, fields, levels, highlight,
    error: errors.length ? errors.join(' · ') : null,
    empty: !text.length && !idx.length && !fields.length && !levels,
  };
}

/** Valor de um campo numa entrada lida (parse.js), para os filtros por campo. */
function fieldValue(p, key, extra) {
  if (!p) return undefined;
  switch (key) {
    case 'logger': return p.logger != null ? p.logger : p.fields && p.fields.logger;
    case 'thread': return p.thread != null ? p.thread : p.fields && p.fields.thread;
    case 'msg': return p.msg;
    case 'path': return p.http ? p.http.path : p.fields && (p.fields.path || p.fields.url);
    case 'method': return p.http ? p.http.method : p.fields && p.fields.method;
    case 'ip': return p.http ? p.http.ip : p.fields && (p.fields.ip || p.fields.client_ip || p.fields.remote_addr);
    case 'ua': return p.http ? p.http.ua : p.fields && (p.fields.ua || p.fields.userAgent || p.fields.user_agent);
    case 'exception': return extra && extra.exception;
    default: {
      const f = p.fields || {};
      if (key in f) return f[key];
      const lk = key.toLowerCase();
      for (const k of Object.keys(f)) if (k.toLowerCase() === lk) return f[k];
      return undefined;
    }
  }
}

/** A entrada (já lida) passa nos filtros por campo? */
function matchFields(compiled, p, extra) {
  for (const f of compiled.fields) {
    const ok = f.test(fieldValue(p, f.key, extra));
    if (ok === f.neg) return false;
  }
  return true;
}

/** Completar a consulta: chaves conhecidas + campos vistos no arquivo. */
function suggestions(prefix, knownFields = []) {
  const base = ['level:error+', 'level:warn+', 'logger:', 'thread:', 'msg:', 'has:stack', 'status:5xx', 'status:4xx', 'ms:>500', 'path:', 'method:', 'ip:', 'lines:>10', 'exception:'];
  const all = [...base, ...knownFields.map((k) => k + ':')];
  const p = String(prefix || '').toLowerCase();
  return [...new Set(all)].filter((s) => s.toLowerCase().startsWith(p) && s.toLowerCase() !== p).slice(0, 12);
}

const EXACT_KEYS = new Set(['thread', 'logger', 'ip', 'method']);

/**
 * Termo de filtro para "seguir" um valor visto no detalhe (thread, ip, id de correlação…). Valor exato, entre aspas.
 * '' quando não dá para montar (vazio, enorme ou com aspas, que a mini-linguagem não escapa).
 */
function termFor(key, value) {
  const k = String(key || '').trim();
  const v = String(value == null ? '' : value).trim();
  if (!k || !v || v.length > 200 || v.includes('"')) return '';
  if (k === 'status') return /^\d{3}$/.test(v) ? 'status:' + v : '';
  const name = k === 'requisição' || k === 'path' ? 'path' : k === 'usuário' ? 'user' : k === 'user agent' ? 'ua' : k;
  if (/\s/.test(name) || name.includes(':')) return '';
  return `${name}:"=${v}"`;
}

module.exports = { tokenize, compile, matchFields, fieldValue, levelSet, statusTest, numTest, suggestions, escapeRe, termFor, EXACT_KEYS };
