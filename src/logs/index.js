'use strict';
/**
 * Logs — índice de um log (ou de vários arquivos rotacionados, um atrás do outro). Puro: recebe texto, não lê disco.
 *
 * Desempenho é o ponto: milhões de linhas.
 * - O texto fica em blocos (strings de alguns MB, sempre terminando em fim de linha). Strings ASCII ocupam 1 byte
 *   por caractere no V8, então a memória fica perto do tamanho do arquivo.
 * - Cada entrada (linha principal + continuações: stack trace, mensagem em várias linhas) é uma posição nos
 *   typed arrays: start (offset global no texto), lines, level, ts, group, e status/ms nos logs de acesso.
 * - Busca de texto roda a regex sobre o bloco inteiro e, a cada acerto, pula para o fim da entrada — não monta
 *   uma string por entrada. Nível, tempo, status e duração usam só os arrays.
 * - Filtros por campo (logger:, user.id:) leem a entrada, mas só das que já passaram nos outros filtros.
 */
const { FORMATS, LV } = require('./parse.js');
const { fingerprint } = require('./fingerprint.js');
const { matchFields } = require('./query.js');

const MAX_CONT = 5000; // continuações por entrada: um bloco gigante sem data não vira uma linha só
const FP_LINES = 80;   // linhas lidas para agrupar um erro (exceção, causa e primeiros frames)

function grow(arr, need) {
  if (need <= arr.length) return arr;
  let len = Math.max(1024, arr.length);
  while (len < need) len *= 2;
  const next = new arr.constructor(len);
  next.set(arr);
  return next;
}

class LogIndex {
  /** format: id de parse.js FORMATS. */
  constructor({ format = 'plain' } = {}) {
    this.format = format;
    this.fmt = FORMATS[format] || FORMATS.plain;
    this.http = !!this.fmt.http;
    this.chunks = [];
    this.chunkStart = [];
    this.total = 0;       // caracteres indexados (sem o pedaço de linha pendente)
    this.pending = '';    // linha ainda sem \n (arquivo crescendo)
    this.n = 0;
    this.start = new Float64Array(4096);
    this.lines = new Uint32Array(4096);
    this.level = new Uint8Array(4096);
    this.ts = new Float64Array(4096);
    this.group = new Int32Array(4096);
    if (this.http) { this.status = new Uint16Array(4096); this.ms = new Float32Array(4096); }
    this.open = -1;       // entrada que ainda pode ganhar continuações
    this.lastTs = NaN;
    this.tsMin = Infinity;
    this.tsMax = -Infinity;
    this.levelTotals = new Array(7).fill(0);
    this.segments = [];
    this.ctx = { baseDay: null };
    this.groups = [];     // { id, key, title, exception, rootCause, frame, level, count, first, last, sample }
    this.groupByKey = new Map();
    this.fieldNames = new Set();
    this.version = 0;
    this._cache = null;   // última máscara de consulta: { query, n, M }
  }

  /** Começa um arquivo novo (rotação): fecha a linha pendente e a entrada aberta. ctx: { baseDay, ... } */
  beginSegment(name, ctx = {}) {
    this.end();
    this.ctx = { baseDay: null, ...ctx };
    this.segments.push({ name, ctx: this.ctx, firstEntry: this.n, firstChar: this.total });
  }

  /** Fim do arquivo (sem tail): a última linha sem \n também conta. */
  end() {
    if (this.pending) { const p = this.pending; this.pending = ''; this._addChunk(p + '\n'); }
    this._close(this.open);
    this.open = -1;
  }

  /** Acrescenta texto (pode cortar uma linha no meio: o resto espera o próximo pedaço). → entradas novas. */
  add(text) {
    if (!text) return 0;
    if (!this.segments.length) this.beginSegment('', {});
    let s = this.pending + text;
    const cut = s.lastIndexOf('\n');
    if (cut < 0) { this.pending = s; return 0; }
    this.pending = s.slice(cut + 1);
    s = s.slice(0, cut + 1);
    const before = this.n;
    this._addChunk(s);
    return this.n - before;
  }

  _addChunk(s) {
    const base = this.total;
    this.chunks.push(s);
    this.chunkStart.push(base);
    this.total += s.length;
    const fmt = this.fmt;
    const ctx = this.ctx;
    let pos = 0;
    const L = s.length;
    while (pos < L) {
      let nl = s.indexOf('\n', pos);
      if (nl < 0) nl = L;
      let end = nl;
      if (end > pos && s.charCodeAt(end - 1) === 13) end--;
      const line = s.slice(pos, end);
      const isStart = this.open < 0 || (this.lines[this.open] >= MAX_CONT) || (line.length > 0 && fmt.isStart(line, ctx));
      if (isStart) this._begin(base + pos, line, ctx);
      else this.lines[this.open]++;
      pos = nl + 1;
    }
    this.version++;
  }

  _begin(at, line, ctx) {
    const prev = this.open;
    const i = this.n;
    const need = i + 1;
    if (need > this.start.length) {
      this.start = grow(this.start, need); this.lines = grow(this.lines, need); this.level = grow(this.level, need);
      this.ts = grow(this.ts, need); this.group = grow(this.group, need);
      if (this.http) { this.status = grow(this.status, need); this.ms = grow(this.ms, need); }
    }
    const sc = this.fmt.scan(line, ctx);
    let t = sc.ts;
    if (Number.isFinite(t)) {
      this.lastTs = t;
      if (t < this.tsMin) this.tsMin = t;
      if (t > this.tsMax) this.tsMax = t;
    } else t = this.lastTs; // sem data: herda a da anterior (o gráfico fica coerente)
    this.start[i] = at;
    this.lines[i] = 1;
    this.level[i] = sc.level || 0;
    this.ts[i] = t;
    this.group[i] = -1;
    if (this.http) { this.status[i] = sc.status || 0; this.ms[i] = Number.isFinite(sc.ms) ? sc.ms : NaN; }
    this.n = need;
    this.open = i;
    this._close(prev); // depois de registrar a nova: o fim da anterior é o começo desta
  }

  /** Fecha a entrada: nível pelo stack (quando o formato não tem nível) e grupo de erro/aviso. */
  _close(i) {
    if (i < 0 || i >= this.n || this.group[i] !== -1) return; // -1 = ainda aberta
    let lv = this.level[i];
    if (lv === 0 && this.lines[i] > 1) {
      const head = this.text(i, FP_LINES);
      if (/^\s+at [\w$.<>]+\(|^Traceback \(most recent|^Caused by:/m.test(head)) { lv = LV.error; this.level[i] = lv; }
    }
    this.levelTotals[lv]++;
    if (lv < LV.warn) { this.group[i] = -2; return; } // -2: fechada, sem grupo
    const ctx = this.ctxOf(i);
    const p = this.fmt.parse(this.text(i, FP_LINES), ctx);
    if (this.http && p.http) { p.msg = `${p.http.method} ${p.http.path} → ${p.http.status}`; }
    const fp = fingerprint(p);
    let g = this.groupByKey.get(fp.key);
    if (g === undefined) {
      g = this.groups.length;
      this.groups.push({ id: g, key: fp.key, title: fp.title, exception: fp.exception, rootCause: fp.rootCause, frame: fp.frame, logger: p.logger || '', level: lv, count: 0, first: this.ts[i], last: this.ts[i], sample: i, firstIdx: i, lastIdx: i });
      this.groupByKey.set(fp.key, g);
    }
    const G = this.groups[g];
    G.count++;
    if (lv > G.level) G.level = lv;
    const t = this.ts[i];
    if (Number.isFinite(t)) {
      if (!Number.isFinite(G.first) || t < G.first) G.first = t;
      if (!Number.isFinite(G.last) || t > G.last) G.last = t;
    }
    G.lastIdx = i;
    this.group[i] = g;
  }

  /** Para mostrar: a entrada aberta conta no total de níveis. */
  levelTotalsNow() {
    const t = this.levelTotals.slice();
    if (this.open >= 0 && this.group[this.open] === -1) t[this.level[this.open]]++;
    return t;
  }

  segOf(i) {
    const S = this.segments;
    let lo = 0; let hi = S.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid].firstEntry <= i) lo = mid; else hi = mid - 1; }
    return S[lo];
  }
  ctxOf(i) { const s = this.segOf(i); return s ? s.ctx : this.ctx; }

  chunkOf(pos) {
    const C = this.chunkStart;
    let lo = 0; let hi = C.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (C[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** Fim (exclusivo) da entrada i no texto global. */
  endOf(i) { return i + 1 < this.n ? this.start[i + 1] : this.total; }

  /** Texto da entrada (sem o \n final). maxLines corta o stack (para agrupar/mostrar rápido). */
  text(i, maxLines = 0) {
    if (i < 0 || i >= this.n) return '';
    const s = this.start[i];
    let e = this.endOf(i);
    let ci = this.chunkOf(s);
    let out = '';
    let p = s;
    while (p < e && ci < this.chunks.length) {
      const cs = this.chunkStart[ci];
      const ch = this.chunks[ci];
      const to = Math.min(e, cs + ch.length);
      if (maxLines) {
        // Corta antes de montar strings enormes.
        let k = p - cs; let lines = (out.match(/\n/g) || []).length;
        while (k < to - cs && lines < maxLines) { const nl = ch.indexOf('\n', k); if (nl < 0 || nl >= to - cs) { k = to - cs; break; } k = nl + 1; lines++; }
        out += ch.slice(p - cs, k);
        if (lines >= maxLines) break;
      } else out += ch.slice(p - cs, to - cs);
      p = to;
      ci++;
    }
    return out.replace(/\r?\n$/, '').replace(/\r\n/g, '\n');
  }

  /** Primeira linha (para a lista), cortada em max caracteres. */
  firstLine(i, max = 1000) {
    if (i < 0 || i >= this.n) return '';
    const s = this.start[i];
    const ci = this.chunkOf(s);
    const ch = this.chunks[ci];
    const off = s - this.chunkStart[ci];
    let nl = ch.indexOf('\n', off);
    if (nl < 0) nl = ch.length;
    let line = ch.slice(off, Math.min(nl, off + max));
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    return line;
  }

  /** Entrada lida por inteiro (detalhe e filtros por campo). */
  parse(i, maxLines = 0) {
    const p = this.fmt.parse(maxLines === 1 ? this.firstLine(i, 1e6) : this.text(i, maxLines), this.ctxOf(i));
    if (p.fields) for (const k of Object.keys(p.fields)) { if (this.fieldNames.size < 300) this.fieldNames.add(k); }
    return p;
  }

  /* ─────────────── Consulta ─────────────── */

  /** Marca em M[i - off] (i de from a to) as entradas que casam a regex (global) em algum ponto do texto. */
  _searchInto(re, M, from, to, val, off = 0) {
    if (from >= to) return;
    const startPos = this.start[from];
    const endPos = this.endOf(to - 1);
    let e = from;
    for (let ci = this.chunkOf(startPos); ci < this.chunks.length; ci++) {
      const base = this.chunkStart[ci];
      if (base >= endPos) break;
      const str = this.chunks[ci];
      re.lastIndex = Math.max(0, startPos - base);
      let m;
      while ((m = re.exec(str))) {
        const pos = base + m.index;
        if (pos >= endPos) break;
        while (e + 1 < to && this.start[e + 1] <= pos) e++;
        M[e - off] = val;
        const next = this.endOf(e) - base;
        if (next >= str.length) break;
        re.lastIndex = Math.max(next, m.index + 1);
      }
    }
  }

  /**
   * Máscara (1 = passa) dos filtros de texto, campos e índice — sem nível nem intervalo de tempo, que entram no
   * resumo. Reaproveita a última máscara da mesma consulta e só calcula as entradas novas (tail).
   */
  mask(compiled) {
    const n = this.n;
    const c = this._cache;
    if (c && c.query === compiled.query && c.n <= n) {
      if (c.M.length < n) c.M = grow(c.M, Math.ceil(n * 1.25));
      // A última entrada pode ter ganho continuações: recalcula a partir dela.
      const from = Math.max(0, c.n - 1);
      if (from < n) this._matchRange(compiled, from, n, c.M);
      c.n = n;
      return c.M;
    }
    const M = new Uint8Array(Math.max(1024, Math.ceil(n * 1.25)));
    this._matchRange(compiled, 0, n, M);
    this._cache = { query: compiled.query, n, M };
    return M;
  }

  _matchRange(compiled, from, to, Mbig) {
    if (compiled.empty) { Mbig.fill(1, from, to); return; }
    Mbig.fill(1, from, to);
    const tmp = compiled.text.length ? new Uint8Array(to - from) : null;
    for (const t of compiled.text) {
      tmp.fill(0);
      this._searchInto(t.re, tmp, from, to, 1, from); // tmp[0] = entrada from
      const drop = t.neg ? 1 : 0;
      for (let k = 0; k < to - from; k++) if (tmp[k] === drop) Mbig[from + k] = 0;
    }
    for (const t of compiled.idx) {
      for (let i = from; i < to; i++) {
        if (!Mbig[i]) continue;
        let v;
        switch (t.kind) {
          case 'status': v = this.http ? this.status[i] : 0; break;
          case 'ms': v = this.http ? this.ms[i] : NaN; break;
          case 'lines': v = this.lines[i]; break;
          case 'stack': v = this.lines[i] > 1; break;
          case 'group': { const g = this.group[i]; v = g >= 0 ? this.groups[g].key : ''; break; }
          default: v = undefined;
        }
        if (t.test(v) === t.neg) Mbig[i] = 0;
      }
    }
    if (compiled.fields.length) {
      // Campos estão na 1ª linha (JSON por linha inclusive); a exceção vem do grupo, já calculado.
      for (let i = from; i < to; i++) {
        if (!Mbig[i]) continue;
        const p = this.parse(i, 1);
        const g = this.group[i];
        if (!matchFields(compiled, p, { exception: g >= 0 ? this.groups[g].exception : '' })) Mbig[i] = 0;
      }
    }
  }

  /**
   * Resumo de uma consulta: contagem por nível (respeitando tempo, não o nível), histograma (respeitando nível, não
   * o tempo — para escolher o intervalo no gráfico), lista de entradas que passam em tudo e contagem por grupo.
   * opts: { levels: Set|null, from, to (ms), buckets }
   */
  summarize(M, { levels = null, from = null, to = null, buckets = 120 } = {}) {
    const n = this.n;
    const counts = new Array(7).fill(0);
    const hist = histogramSpec(this.tsMin, this.tsMax, buckets);
    const H = hist ? new Uint32Array(hist.buckets * 7) : null;
    let result = new Int32Array(Math.min(n, 65536) || 16);
    let len = 0;
    const gcount = new Map();
    const hasT = from != null || to != null;
    const lo = from == null ? -Infinity : from;
    const hi = to == null ? Infinity : to;
    const lvOk = levels ? new Uint8Array(7).map((_, i) => (levels.has(i) ? 1 : 0)) : null;
    for (let i = 0; i < n; i++) {
      if (!M[i]) continue;
      const lv = this.level[i];
      const t = this.ts[i];
      const inT = !hasT || (t >= lo && t <= hi);
      const okL = !lvOk || lvOk[lv];
      if (inT) counts[lv]++;
      if (okL && H && Number.isFinite(t)) {
        let b = Math.floor((t - hist.start) / hist.step);
        if (b >= hist.buckets) b = hist.buckets - 1; else if (b < 0) b = 0;
        H[b * 7 + lv]++;
      }
      if (inT && okL) {
        if (len >= result.length) result = grow(result, len + 1);
        result[len++] = i;
        const g = this.group[i];
        if (g >= 0) gcount.set(g, (gcount.get(g) || 0) + 1);
      }
    }
    return { counts, hist: hist ? { ...hist, data: H } : null, result: result.subarray(0, len), total: len, gcount };
  }

  /** Entrada → linha para a lista. */
  row(i) {
    const g = this.group[i];
    return {
      i, ts: this.ts[i], level: this.level[i], lines: this.lines[i], text: this.firstLine(i),
      group: g >= 0 ? this.groups[g].key : null,
      status: this.http ? this.status[i] : undefined,
      ms: this.http && Number.isFinite(this.ms[i]) ? this.ms[i] : undefined,
    };
  }

  /** Contagem por bucket de um grupo (sparkline), dentro do resultado. */
  groupSpark(result, gid, hist) {
    if (!hist) return [];
    const out = new Array(hist.buckets).fill(0);
    for (let k = 0; k < result.length; k++) {
      const i = result[k];
      if (this.group[i] !== gid) continue;
      const t = this.ts[i];
      if (!Number.isFinite(t)) continue;
      let b = Math.floor((t - hist.start) / hist.step);
      if (b >= hist.buckets) b = hist.buckets - 1; else if (b < 0) b = 0;
      out[b]++;
    }
    return out;
  }
}

const STEPS = [1e3, 5e3, 15e3, 30e3, 60e3, 300e3, 900e3, 1800e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 7 * 86400e3, 30 * 86400e3];

/** Intervalo de cada barra do histograma: um passo "redondo" que dê até `buckets` barras. */
function histogramSpec(min, max, buckets = 120) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = Math.max(1000, max - min);
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) if (span / s <= buckets) { step = s; break; }
  // Alinha no passo (no fuso local para passos de hora/dia), para as barras caírem em horários redondos.
  const tz = new Date(min).getTimezoneOffset() * 60000;
  const start = step >= 3600e3 ? Math.floor((min - tz) / step) * step + tz : Math.floor(min / step) * step;
  const count = Math.max(1, Math.floor((max - start) / step) + 1);
  return { start, step, buckets: count };
}

module.exports = { LogIndex, histogramSpec, STEPS };
