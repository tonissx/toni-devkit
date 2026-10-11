'use strict';
/**
 * Logs — motor que roda no worker thread (electron/logs/worker.js): lê os arquivos em blocos, decodifica, indexa
 * (src/logs/index.js) e responde às consultas da tela. Sem Electron: os testes usam direto, sem worker.
 *
 * - Encoding: BOM (UTF-8/UTF-16), senão UTF-8 se a amostra for válida, senão windows-1252 (Fluig/JBoss no Windows).
 * - Arquivos rotacionados entram um atrás do outro (mais antigo primeiro); .gz é descompactado em stream.
 * - Teto de memória: acima de maxBytes, lê só o final (os arquivos mais antigos ficam de fora, e o mais antigo
 *   que entra começa no meio, na próxima quebra de linha). A tela avisa (truncated).
 * - A tela nunca recebe o arquivo: pede as linhas visíveis (rows), o detalhe de uma entrada (entry) e resumos.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');
const { LogIndex } = require('../../src/logs/index.js');
const { detect, FORMATS, LEVEL_LABEL } = require('../../src/logs/parse.js');
const { compile } = require('../../src/logs/query.js');
const A = require('../../src/logs/aggregate.js');
const { baseDayOf } = require('../../src/logs/rotate.js');

const BLOCK = 4 * 1024 * 1024;
const SAMPLE = 256 * 1024;
const MAX_BYTES = 1536 * 1024 * 1024;
const MAX_ENTRY_TEXT = 2 * 1024 * 1024;

/** Encoding pela amostra (Buffer). → { encoding, bom } */
function sniffEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  // UTF-16LE sem BOM: muitos zeros nas posições ímpares.
  let zeros = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++;
  if (n > 16 && zeros > n / 4) return { encoding: 'utf-16le', bom: 0 };
  try {
    // Corta o fim: um caractere de vários bytes pode ter sido cortado na amostra.
    let end = buf.length;
    while (end > 0 && end > buf.length - 4 && (buf[end - 1] & 0xc0) === 0x80) end--;
    if (end > 0 && buf[end - 1] >= 0xc0) end--;
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, end));
    return { encoding: 'utf-8', bom: 0 };
  } catch { return { encoding: 'windows-1252', bom: 0 }; }
}

async function readHead(file, bytes = SAMPLE) {
  if (file.gz) {
    // Descompacta só o começo.
    return new Promise((resolve) => {
      const parts = []; let got = 0;
      const s = fs.createReadStream(file.path).pipe(zlib.createGunzip());
      s.on('data', (c) => { parts.push(c); got += c.length; if (got >= bytes) s.destroy(); });
      s.on('close', () => resolve(Buffer.concat(parts).subarray(0, bytes)));
      s.on('error', () => resolve(Buffer.concat(parts)));
    });
  }
  const fh = await fsp.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

const toArr = (ta) => Array.from(ta);
const finite = (x) => (Number.isFinite(x) ? x : null);

function createEngine({ emit = () => {}, maxBytes = MAX_BYTES } = {}) {
  const sources = new Map(); // id → { id, index, files, format, encoding, last, chain, truncated, bytes }

  const get = (id) => {
    const s = sources.get(id);
    if (!s) throw new Error('Log não está aberto (feche e abra de novo)');
    return s;
  };
  // Operações de leitura de um mesmo log em fila (abrir e crescer nunca ao mesmo tempo).
  const serial = (s, job) => { const next = s.chain.then(job, job); s.chain = next.catch(() => {}); return next; };

  async function readInto(s, f, start, end, onBytes) {
    const index = s.index;
    if (f.gz) {
      const dec = new TextDecoder(s.encoding);
      const stream = fs.createReadStream(f.path).pipe(zlib.createGunzip({ chunkSize: 1024 * 1024 }));
      let skip = f.bom || 0;
      for await (const chunk of stream) {
        let c = chunk;
        if (skip) { const k = Math.min(skip, c.length); c = c.subarray(k); skip -= k; }
        index.add(dec.decode(c, { stream: true }));
        onBytes(chunk.length);
      }
      index.add(dec.decode());
      return;
    }
    if (end <= start) return;
    const stream = fs.createReadStream(f.path, { start, end: end - 1, highWaterMark: BLOCK });
    let first = true;
    for await (const chunk of stream) {
      let c = chunk;
      if (first && f.skipToLine) {
        // Começou no meio do arquivo (teto de memória): descarta até a próxima quebra de linha.
        const nl = c.indexOf(10);
        c = nl < 0 ? c.subarray(c.length) : c.subarray(nl + 1);
      }
      first = false;
      index.add(f.decoder.decode(c, { stream: true }));
      onBytes(chunk.length);
    }
  }

  /** files: [{ path, name, date, mtime, size, gz }] do mais antigo ao atual. */
  async function open({ id, files, format = 'auto', encoding = 'auto', tail = true }) {
    if (!files || !files.length) throw new Error('Nenhum arquivo para abrir');
    // Tamanhos atuais (o arquivo ativo pode ter crescido desde a listagem).
    const list = [];
    for (const f of files) {
      const st = await fsp.stat(f.path);
      list.push({ ...f, size: st.size, mtime: st.mtimeMs });
    }
    // Teto: do mais novo para o mais antigo até caber.
    let budget = maxBytes;
    let truncated = false;
    const use = [];
    for (let k = list.length - 1; k >= 0; k--) {
      const f = list[k];
      const cost = f.gz ? f.size * 8 : f.size; // texto descompactado ~8× o .gz
      if (budget <= 0) { truncated = true; break; }
      if (cost > budget) {
        truncated = true;
        if (f.gz) break; // .gz não dá para começar no meio
        use.unshift({ ...f, start: f.size - budget, skipToLine: true });
        budget = 0;
        break;
      }
      use.unshift({ ...f, start: 0 });
      budget -= cost;
    }
    // Amostra para detectar encoding/formato: o arquivo atual (ou o anterior, se acabou de rotacionar e está vazio).
    const probe = [...use].reverse().find((f) => f.size > 0) || use[use.length - 1];
    const head = await readHead(probe);
    const sniff = sniffEncoding(head);
    const enc = encoding && encoding !== 'auto' ? encoding : sniff.encoding;
    const sample = new TextDecoder(enc).decode(head.subarray(sniff.bom));
    const det = detect(sample);
    const fmt = format && format !== 'auto' && FORMATS[format] ? format : det.format;

    const s = {
      id, files: use, format: fmt, detected: det, encoding: enc, truncated, chain: Promise.resolve(), last: null,
      index: new LogIndex({ format: fmt }), bytes: 0, total: use.reduce((t, f) => t + (f.size - (f.start || 0)), 0), loading: true,
    };
    sources.set(id, s);
    await serial(s, async () => {
      let done = 0; let lastEmit = 0;
      const onBytes = (b) => {
        done += b;
        const now = Date.now();
        if (now - lastEmit > 250) { lastEmit = now; emit({ type: 'progress', id, done, total: s.total, n: s.index.n }); }
      };
      for (const f of use) {
        const bom = f.start ? 0 : (f.gz ? sniff.bom : (await readHead(f, 4).then(sniffEncoding)).bom);
        f.bom = bom;
        f.decoder = new TextDecoder(enc);
        s.index.beginSegment(f.name, { baseDay: baseDayOf(f) });
        await readInto(s, f, (f.start || 0) + (f.start ? 0 : bom), f.size, onBytes);
        f.offset = f.size;
      }
      // Sem acompanhar (ou o último é .gz): a última linha, mesmo sem \n, já conta e a última entrada fecha.
      const lastFile = use[use.length - 1];
      if (!tail || lastFile.gz) s.index.end();
      s.grownAt = Date.now();
      s.bytes = done;
      s.loading = false;
    });
    return info(id);
  }

  /** O arquivo atual cresceu: lê só o que chegou. → { added, n } ou { reset: true } se encolheu (truncado). */
  function grow({ id }) {
    const s = get(id);
    return serial(s, async () => {
      const f = s.files[s.files.length - 1];
      if (!f || f.gz) return { added: 0, n: s.index.n };
      let st;
      try { st = await fsp.stat(f.path); } catch { return { missing: true, n: s.index.n }; }
      if (st.size < f.offset) return { reset: true, n: s.index.n };
      const ix = s.index;
      if (st.size === f.offset) {
        // Parado há 2 s: a linha sem \n e a última entrada (com o stack que já veio) fecham — entram no grupo
        // de erro. Uma continuação que chegue depois disso vira entrada própria.
        if (Date.now() - (s.grownAt || 0) >= 2000 && (ix.pending || (ix.open >= 0 && ix.group[ix.open] === -1))) {
          const before = ix.n;
          ix.end();
          return { added: ix.n - before, settled: true, n: ix.n };
        }
        return { added: 0, n: ix.n };
      }
      const before = ix.n;
      await readInto(s, { ...f, skipToLine: false }, f.offset, st.size, () => {});
      s.bytes += st.size - f.offset;
      f.offset = st.size;
      s.grownAt = Date.now();
      return { added: ix.n - before, n: ix.n };
    });
  }

  function info(id) {
    const s = get(id);
    const ix = s.index;
    return {
      id, format: s.format, formatLabel: (FORMATS[s.format] || {}).label, detected: s.detected, encoding: s.encoding,
      http: ix.http, n: ix.n, bytes: s.bytes, truncated: s.truncated, loading: s.loading,
      files: s.files.map((f) => ({ path: f.path, name: f.name, size: f.size, gz: !!f.gz, partial: !!f.start })),
      tsMin: finite(ix.tsMin), tsMax: finite(ix.tsMax), levelTotals: ix.levelTotalsNow(), groups: ix.groups.length,
      fields: [...ix.fieldNames].slice(0, 100),
    };
  }

  /**
   * Roda a consulta. opts: { q, levels: [n] | null, from, to, buckets }. Guarda o resultado para rows/next/charts.
   * → { qid, total, counts, hist, groups (do resultado, top 300), error, highlight, n, levelTotals }
   */
  function query({ id, qid, q = '', levels = null, from = null, to = null, buckets = 120 }) {
    const s = get(id);
    const ix = s.index;
    const c = compile(q);
    const lv = levels && levels.length < 7 ? new Set(levels.filter((l) => !c.levels || c.levels.has(l))) : c.levels;
    const M = ix.mask(c);
    const sum = ix.summarize(M, { levels: lv, from, to, buckets });
    s.last = { qid, c, sum, opts: { q, levels, from, to, buckets } };
    const groups = [...sum.gcount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 300)
      .map(([g, count]) => groupOut(ix, ix.groups[g], count));
    return {
      qid, total: sum.total, counts: sum.counts, n: ix.n, levelTotals: ix.levelTotalsNow(),
      hist: sum.hist ? { start: sum.hist.start, step: sum.hist.step, buckets: sum.hist.buckets, data: toArr(sum.hist.data) } : null,
      spikes: A.spikes(sum.hist),
      groups, groupsTotal: sum.gcount.size,
      error: c.error, highlight: c.highlight.map((r) => ({ source: r.source, flags: r.flags })),
      tsMin: finite(ix.tsMin), tsMax: finite(ix.tsMax), loading: s.loading,
    };
  }

  function groupOut(ix, G, count) {
    return {
      id: G.id, key: G.key, title: G.title, exception: G.exception, rootCause: G.rootCause, frame: G.frame, logger: G.logger,
      level: G.level, count, total: G.count, first: finite(G.first), last: finite(G.last), sample: G.sample, lastIdx: G.lastIdx,
    };
  }

  const lastOf = (s, qid) => {
    if (!s.last) throw new Error('Consulta ainda não rodou');
    if (qid != null && s.last.qid !== qid) return null; // a tela está mostrando uma consulta mais nova
    return s.last;
  };

  /** Linhas para a lista: posições [from, from+count) do resultado. */
  function rows({ id, qid, from = 0, count = 100 }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const r = L.sum.result;
    const out = [];
    const end = Math.min(r.length, from + count);
    const ix = s.index;
    for (let k = Math.max(0, from); k < end; k++) {
      const row = ix.row(r[k]);
      // JSON por linha: a lista mostra "logger: mensagem" em vez do JSON cru (o detalhe mostra tudo).
      if (s.format === 'ndjson' && row.text.charCodeAt(0) === 123) {
        const p = ix.parse(r[k], 1);
        if (p.json) row.display = (p.logger ? p.logger + ': ' : '') + (p.msg || '') + (p.stack ? '  ⏎ ' + p.stack.split('\n')[0] : '');
      } else if (ix.http) {
        // Acesso: data, status e tempo já estão nas colunas — fica a requisição e quem pediu.
        const p = ix.parse(r[k], 1);
        if (p.http) row.display = `${p.http.method} ${p.http.path}${p.http.query ? '?' + p.http.query : ''}  · ${p.http.ip}${p.http.user ? ' (' + p.http.user + ')' : ''}`;
      }
      out.push(row);
    }
    return { from, rows: out, total: r.length };
  }

  /** Tudo de uma entrada: texto (cortado em 2 MB), campos lidos e o grupo. */
  function entry({ id, i }) {
    const s = get(id);
    const ix = s.index;
    if (i < 0 || i >= ix.n) throw new Error('Entrada fora do log');
    let text = ix.text(i);
    const cut = text.length > MAX_ENTRY_TEXT;
    if (cut) text = text.slice(0, MAX_ENTRY_TEXT);
    const p = ix.fmt.parse(text, ix.ctxOf(i));
    const g = ix.group[i];
    return {
      ...ix.row(i), text, cut, segment: ix.segOf(i).name,
      parsed: { ts: finite(p.ts), level: p.level, logger: p.logger, thread: p.thread, msg: p.msg, stack: p.stack, fields: p.fields, http: p.http, json: !!p.json },
      group: g >= 0 ? groupOut(ix, ix.groups[g], ix.groups[g].count) : null,
      levelLabel: LEVEL_LABEL[ix.level[i]],
    };
  }

  /** Vizinhas sem filtro (contexto). */
  function context({ id, i, before = 50, after = 50 }) {
    const s = get(id);
    const ix = s.index;
    const a = Math.max(0, i - before);
    const b = Math.min(ix.n, i + after + 1);
    const out = [];
    for (let k = a; k < b; k++) out.push(ix.row(k));
    return { rows: out, at: i };
  }

  /** Posição de uma entrada no resultado (ou a mais próxima depois dela). */
  function locate({ id, qid, i }) {
    const L = lastOf(get(id), qid);
    if (!L) return { stale: true };
    const r = L.sum.result;
    let lo = 0; let hi = r.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r[mid] < i) lo = mid + 1; else hi = mid; }
    return { pos: Math.min(lo, Math.max(0, r.length - 1)), exact: r[lo] === i };
  }

  /** Primeira posição do resultado com hora ≥ t. */
  function seekTime({ id, qid, t }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const r = L.sum.result;
    for (let k = 0; k < r.length; k++) if (s.index.ts[r[k]] >= t) return { pos: k };
    return { pos: Math.max(0, r.length - 1) };
  }

  /** Próxima (dir 1) / anterior (-1) posição do resultado com nível ≥ minLevel. */
  function next({ id, qid, pos, dir = 1, minLevel = 5 }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const r = L.sum.result;
    for (let k = pos + dir; k >= 0 && k < r.length; k += dir) if (s.index.level[r[k]] >= minLevel) return { pos: k };
    return { pos: -1 };
  }

  /** Sparklines dos grupos no resultado atual. */
  function sparks({ id, qid, groups }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const out = {};
    for (const g of (groups || []).slice(0, 60)) out[g] = s.index.groupSpark(L.sum.result, g, L.sum.hist);
    return { sparks: out };
  }

  /** Números da aba Gráficos para o resultado atual. */
  function charts({ id, qid }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const ix = s.index;
    const hist = L.sum.hist;
    const out = { http: ix.http, errorRate: A.errorRate(hist), total: L.sum.total };
    if (ix.http) out.httpStats = A.httpStats(ix, L.sum.result, hist);
    else out.loggers = A.topLoggers(ix, L.sum.result);
    out.levels = L.sum.counts;
    return out;
  }

  /** Grava o resultado atual num arquivo. kind: 'log' (texto como está) | 'md' (bloco de código com cabeçalho). */
  async function exportTo({ id, qid, file, kind = 'log', limit = 0 }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) throw new Error('A consulta mudou — exporte de novo');
    const r = L.sum.result;
    const n = limit ? Math.min(limit, r.length) : r.length;
    const ws = fs.createWriteStream(file, { encoding: 'utf8' });
    const write = (str) => new Promise((res) => { if (!ws.write(str)) ws.once('drain', res); else res(); });
    if (kind === 'md') await write(`# Logs — ${s.files.map((f) => f.name).join(', ')}\n\nFiltro: \`${L.opts.q || '(nenhum)'}\` · ${n} entradas\n\n\`\`\`\n`);
    for (let k = 0; k < n; k++) await write(s.index.text(r[k]) + '\n');
    if (kind === 'md') await write('```\n');
    await new Promise((res, rej) => { ws.end(res); ws.on('error', rej); });
    return { count: n };
  }

  /** Texto do resultado (para copiar/levar para Notes), até maxChars. */
  function textOf({ id, qid, from = 0, count = 200, maxChars = 200000 }) {
    const s = get(id);
    const L = lastOf(s, qid);
    if (!L) return { stale: true };
    const r = L.sum.result;
    let out = ''; let k = from;
    for (; k < Math.min(r.length, from + count); k++) {
      const t = s.index.text(r[k]);
      if (out.length + t.length > maxChars) break;
      out += t + '\n';
    }
    return { text: out, count: k - from, more: k < r.length };
  }

  function close({ id }) { sources.delete(id); return true; }

  const OPS = { open, grow, info: ({ id }) => info(id), query, rows, entry, context, locate, seekTime, next, sparks, charts, exportTo, textOf, close };
  return {
    call(op, args) {
      const fn = OPS[op];
      if (!fn) throw new Error('Operação desconhecida: ' + op);
      return fn(args || {});
    },
    _sources: sources,
  };
}

module.exports = { createEngine, sniffEncoding, MAX_BYTES };
