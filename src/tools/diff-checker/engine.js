'use strict';
/**
 * Motor do Diff Checker — sem dependências.
 * Diff de linhas com Myers O(ND) em espaço linear (divide-and-conquer pela "middle snake"),
 * depois diff por caractere/palavra dentro de cada par de linhas alteradas.
 */

/* ─────────────── Myers ─────────────── */

/** Pares [i, j] (em ordem) de elementos iguais de A e B (arrays de inteiros). */
function lcsPairs(A, B) {
  const N = A.length, M = B.length;
  const off = N + M + 1;
  const vf = new Int32Array(2 * off + 1);
  const vb = new Int32Array(2 * off + 1);
  const pairs = [];

  // Encontra a "middle snake" do subproblema A[a0..a1) × B[b0..b1) (ambos não vazios).
  function middle(a0, a1, b0, b1) {
    const n = a1 - a0, m = b1 - b0, delta = n - m, odd = (delta & 1) !== 0;
    const dmax = (n + m + 1) >> 1;
    vf[off + 1] = 0;
    vb[off + 1] = 0;
    for (let d = 0; d <= dmax; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vf[off + k - 1] < vf[off + k + 1]) ? vf[off + k + 1] : vf[off + k - 1] + 1;
        let y = x - k;
        const sx = x, sy = y;
        while (x < n && y < m && A[a0 + x] === B[b0 + y]) { x++; y++; }
        vf[off + k] = x;
        const kb = delta - k;
        if (odd && kb >= -(d - 1) && kb <= d - 1 && x + vb[off + kb] >= n) {
          return [a0 + sx, b0 + sy, a0 + x, b0 + y];
        }
      }
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vb[off + k - 1] < vb[off + k + 1]) ? vb[off + k + 1] : vb[off + k - 1] + 1;
        let y = x - k;
        const sx = x, sy = y;
        while (x < n && y < m && A[a1 - 1 - x] === B[b1 - 1 - y]) { x++; y++; }
        vb[off + k] = x;
        const kf = delta - k;
        if (!odd && kf >= -d && kf <= d && x + vf[off + kf] >= n) {
          return [a0 + n - x, b0 + m - y, a0 + n - sx, b0 + m - sy];
        }
      }
    }
    throw new Error('diff: middle snake não encontrada');
  }

  function rec(a0, a1, b0, b1) {
    while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { pairs.push([a0, b0]); a0++; b0++; }
    let ea = a1, eb = b1;
    while (ea > a0 && eb > b0 && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    if (a0 < ea && b0 < eb) {
      // Sem prefixo/sufixo comum e ambos não vazios ⇒ D ≥ 2: as duas metades são estritamente menores.
      const [x, y, u, v] = middle(a0, ea, b0, eb);
      rec(a0, x, b0, y);
      for (let i = 0; i < u - x; i++) pairs.push([x + i, y + i]);
      rec(u, ea, v, eb);
    }
    for (let i = 0; i < a1 - ea; i++) pairs.push([ea + i, eb + i]);
  }

  rec(0, N, 0, M);
  return pairs;
}

/** Converte duas listas de chaves (strings) em arrays de inteiros comparáveis. */
function intern(ka, kb) {
  const ids = new Map();
  const id = (s) => { let v = ids.get(s); if (v === undefined) { v = ids.size; ids.set(s, v); } return v; };
  return [Int32Array.from(ka, id), Int32Array.from(kb, id)];
}

/** Sequência de operações { t: 'eq'|'del'|'add', a, b } (índices; -1 quando não se aplica). */
function diffSeq(ka, kb) {
  const [A, B] = intern(ka, kb);
  const pairs = lcsPairs(A, B);
  const ops = [];
  let i = 0, j = 0;
  const flush = (ti, tj) => {
    while (i < ti) ops.push({ t: 'del', a: i++, b: -1 });
    while (j < tj) ops.push({ t: 'add', a: -1, b: j++ });
  };
  for (const [pi, pj] of pairs) {
    flush(pi, pj);
    ops.push({ t: 'eq', a: i++, b: j++ });
  }
  flush(A.length, B.length);
  return ops;
}

/* ─────────────── Linhas ─────────────── */

// Texto vazio = uma linha vazia: assim split/join é sempre reversível (importante no merge).
const splitLines = (text) => text.split(/\r\n|\r|\n/);

function lineKey(line, o) {
  let k = line;
  if (o.ignoreWhitespace) k = k.trim().replace(/\s+/g, ' ');
  if (o.ignoreCase) k = k.toLowerCase();
  return k;
}

/**
 * Diff de linhas. Compara por chave normalizada (ignorar espaços/maiúsculas),
 * mas devolve o texto original de cada lado.
 */
function diffLines(left, right, o = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const a = splitLines(left), b = splitLines(right);
  const ops = diffSeq(a.map((l) => lineKey(l, o)), b.map((l) => lineKey(l, o)));
  const hunks = buildHunks(ops);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { a, b, ops, hunks, stats: stats(ops, a.length, b.length), ms };
}

/** Blocos contíguos de mudança. Em cada bloco as remoções vêm antes das adições. */
function buildHunks(ops) {
  const hunks = [];
  let ai = 0, bi = 0, cur = null;
  ops.forEach((op, idx) => {
    if (op.t === 'eq') {
      if (cur) { cur.aEnd = ai; cur.bEnd = bi; cur.opEnd = idx; hunks.push(cur); cur = null; }
      ai++; bi++;
      return;
    }
    if (!cur) cur = { aStart: ai, bStart: bi, opStart: idx };
    if (op.t === 'del') ai++; else bi++;
  });
  if (cur) { cur.aEnd = ai; cur.bEnd = bi; cur.opEnd = ops.length; hunks.push(cur); }
  return hunks;
}

function stats(ops, na, nb) {
  let added = 0, removed = 0, unchanged = 0;
  for (const op of ops) { if (op.t === 'add') added++; else if (op.t === 'del') removed++; else unchanged++; }
  const similarity = na + nb === 0 ? 100 : (unchanged * 2 * 100) / (na + nb);
  return { added, removed, unchanged, similarity };
}

/**
 * Linhas de exibição lado a lado: { t, a, b, hunk } — em blocos de mudança, as linhas
 * removidas e adicionadas são pareadas na ordem ('mod' quando há par, senão 'del'/'add').
 */
function pairRows(result) {
  const { ops, hunks } = result;
  const rows = [];
  let h = 0, idx = 0;
  while (idx < ops.length) {
    const hk = hunks[h];
    if (hk && idx === hk.opStart) {
      const dels = [], adds = [];
      for (let i = hk.opStart; i < hk.opEnd; i++) (ops[i].t === 'del' ? dels : adds).push(ops[i]);
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        const d = dels[i], ad = adds[i];
        rows.push({ t: d && ad ? 'mod' : d ? 'del' : 'add', a: d ? d.a : -1, b: ad ? ad.b : -1, hunk: h });
      }
      idx = hk.opEnd;
      h++;
    } else {
      rows.push({ t: 'eq', a: ops[idx].a, b: ops[idx].b, hunk: -1 });
      idx++;
    }
  }
  return rows;
}

/* ─────────────── Dentro da linha ─────────────── */

const WORD_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const tokens = (s, word) => (word ? s.match(WORD_RE) || [] : Array.from(s));

/** Segmentos [início, fim, alterado] (em code units) dos dois lados. */
function inlineSegments(oldLine, newLine, word, o) {
  const ta = tokens(oldLine, word), tb = tokens(newLine, word);
  const key = (t) => {
    if (o.ignoreWhitespace && /^\s+$/.test(t)) return ' ';
    return o.ignoreCase ? t.toLowerCase() : t;
  };
  const ops = diffSeq(ta.map(key), tb.map(key));
  const sa = [], sb = [];
  let pa = 0, pb = 0;
  const push = (segs, start, len, changed) => {
    if (!len) return;
    const last = segs[segs.length - 1];
    if (last && last[2] === changed && last[1] === start) last[1] = start + len;
    else segs.push([start, start + len, changed]);
  };
  for (const op of ops) {
    if (op.t === 'eq') {
      push(sa, pa, ta[op.a].length, false); pa += ta[op.a].length;
      push(sb, pb, tb[op.b].length, false); pb += tb[op.b].length;
    } else if (op.t === 'del') {
      push(sa, pa, ta[op.a].length, true); pa += ta[op.a].length;
    } else {
      push(sb, pb, tb[op.b].length, true); pb += tb[op.b].length;
    }
  }
  if (word) { absorbGaps(sa, oldLine); absorbGaps(sb, newLine); }
  return [sa, sb];
}

/** Modo palavra: espaço inalterado entre dois trechos alterados vira parte da mudança. */
function absorbGaps(segs, line) {
  for (let i = 1; i < segs.length - 1; i++) {
    const s = segs[i];
    if (!s[2] && segs[i - 1][2] && segs[i + 1][2] && /^\s+$/.test(line.slice(s[0], s[1]))) {
      segs[i - 1][1] = segs[i + 1][1];
      segs.splice(i, 2);
      i--;
    }
  }
}

const changedLen = (segs) => segs.reduce((n, s) => n + (s[2] ? s[1] - s[0] : 0), 0);
const changedRuns = (segs) => segs.filter((s) => s[2]).length;

/**
 * Destaque dentro da linha. granularity: 'char' | 'word' | 'smart'.
 * Retorna [segsAntigo, segsNovo] ou null quando as linhas são diferentes demais
 * (nesse caso a linha inteira fica destacada, sem marcação interna).
 */
function diffInline(oldLine, newLine, granularity = 'smart', o = {}) {
  if (granularity === 'char' || granularity === 'word') {
    return inlineSegments(oldLine, newLine, granularity === 'word', o);
  }
  const total = Math.max(oldLine.length, newLine.length) || 1;
  const ch = inlineSegments(oldLine, newLine, false, o);
  const chChanged = Math.max(changedLen(ch[0]), changedLen(ch[1]));
  if (chChanged / total <= 0.3 && changedRuns(ch[0]) <= 2 && changedRuns(ch[1]) <= 2) return ch;
  const wd = inlineSegments(oldLine, newLine, true, o);
  const wdChanged = Math.max(changedLen(wd[0]), changedLen(wd[1]));
  if (1 - wdChanged / total < 0.3) return null;
  return wd;
}

/* ─────────────── Merge ─────────────── */

/**
 * Aplica um bloco de mudança: 'toRight' copia as linhas do Original para o Alterado,
 * 'toLeft' faz o contrário. Retorna { left, right } com o texto atualizado.
 */
function applyHunk(left, right, hunk, direction) {
  const eolOf = (t) => (/\r\n/.test(t) ? '\r\n' : '\n');
  const a = splitLines(left), b = splitLines(right);
  if (direction === 'toRight') {
    b.splice(hunk.bStart, hunk.bEnd - hunk.bStart, ...a.slice(hunk.aStart, hunk.aEnd));
    return { left, right: b.join(eolOf(right || left)) };
  }
  a.splice(hunk.aStart, hunk.aEnd - hunk.aStart, ...b.slice(hunk.bStart, hunk.bEnd));
  return { left: a.join(eolOf(left || right)), right };
}

/**
 * Resultado de diffLines → texto no formato diff unificado (com `context` linhas iguais em volta de cada bloco).
 * Usado para mandar as diferenças à IA ("Resumir diferenças").
 */
function unifiedDiff(result, { context = 3, leftName = 'Original', rightName = 'Alterado' } = {}) {
  const { a, b, ops, hunks } = result;
  if (!hunks.length) return '';
  const out = [`--- ${leftName}`, `+++ ${rightName}`];
  // Junta blocos próximos (o contexto de um encosta no do outro).
  const groups = [];
  for (const h of hunks) {
    const from = Math.max(0, h.opStart - context), to = Math.min(ops.length, h.opEnd + context);
    const last = groups[groups.length - 1];
    if (last && from <= last.to) last.to = to; else groups.push({ from, to });
  }
  for (const g of groups) {
    const slice = ops.slice(g.from, g.to);
    const firstA = slice.find((o) => o.a >= 0), firstB = slice.find((o) => o.b >= 0);
    const na = slice.filter((o) => o.t !== 'add').length, nb = slice.filter((o) => o.t !== 'del').length;
    out.push(`@@ -${firstA ? firstA.a + 1 : 0},${na} +${firstB ? firstB.b + 1 : 0},${nb} @@`);
    for (const o of slice) out.push(o.t === 'eq' ? ' ' + a[o.a] : o.t === 'del' ? '-' + a[o.a] : '+' + b[o.b]);
  }
  return out.join('\n') + '\n';
}

module.exports = { diffLines, diffSeq, buildHunks, pairRows, diffInline, applyHunk, splitLines, stats, unifiedDiff };
