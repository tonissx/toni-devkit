'use strict';
/**
 * Logs — modo Investigação. Puro (sem DOM, sem fs): modelo dos casos, limites, ordem, intervalos entre passos,
 * relatório em Markdown e o corte do que vai para a IA.
 *
 * Um caso guarda COPIAS das entradas (texto, hora, nível, de que log vieram): o log pode rotacionar ou sumir, o caso fica.
 *   Investigation { id, title, createdAt, updatedAt, hypothesis, conclusion, items[] }
 *   Item { id, i, ts, level, text, log, path, group, tag, note, addedAt }
 * `i` (índice da entrada no log) só serve para "ir ao log" quando o log aberto é o mesmo `path`.
 */

const TAGS = ['suspeita', 'causa', 'efeito', 'ruido'];
const TAG_LABEL = { suspeita: 'Suspeita', causa: 'Causa', efeito: 'Efeito', ruido: 'Ruído' };
const MAX_CASES = 40;
const MAX_ITEMS = 200;
const MAX_TEXT = 4000;
const MAX_NOTE = 1000;
const MAX_FIELD = 4000;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/** Item válido ou null (sem texto não há o que guardar). */
function normalizeItem(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null;
  const text = str(x.text, MAX_TEXT);
  if (!text.trim()) return null;
  const lv = Math.round(Number(x.level));
  const i = num(x.i);
  return {
    id: str(x.id, 40) || uid(),
    i: i != null && Number.isInteger(i) && i >= 0 ? i : null,
    ts: num(x.ts),
    level: Number.isFinite(lv) && lv >= 0 && lv <= 6 ? lv : 0,
    text,
    log: str(x.log, 200),
    path: str(x.path, 500),
    group: x.group ? str(x.group, 100) : null,
    tag: TAGS.includes(x.tag) ? x.tag : '',
    note: str(x.note, MAX_NOTE),
    addedAt: num(x.addedAt) ?? now,
  };
}

/** Caso válido ou null. */
function normalizeCase(c, now = Date.now()) {
  if (!c || typeof c !== 'object') return null;
  return {
    id: str(c.id, 40) || uid(),
    title: str(c.title, 120).trim() || 'Investigação',
    createdAt: num(c.createdAt) ?? now,
    updatedAt: num(c.updatedAt) ?? now,
    hypothesis: str(c.hypothesis, MAX_FIELD),
    conclusion: str(c.conclusion, MAX_FIELD),
    items: (Array.isArray(c.items) ? c.items : []).map((x) => normalizeItem(x, now)).filter(Boolean).slice(0, MAX_ITEMS),
  };
}

function normalizeCases(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).map((c) => normalizeCase(c, now)).filter(Boolean).slice(0, MAX_CASES);
}

/** Mesma entrada do mesmo log (ou, sem índice, mesma hora e mesmo texto). */
function sameItem(a, b) {
  if (a.path !== b.path) return false;
  if (a.i != null && b.i != null) return a.i === b.i;
  return a.ts === b.ts && a.text === b.text;
}

/** Acrescenta ao caso sem repetir. → { items, added, item, full } */
function addItem(items, raw, now = Date.now()) {
  const item = normalizeItem(raw, now);
  if (!item) return { items, added: false, item: null, full: false };
  const dup = items.find((x) => sameItem(x, item));
  if (dup) return { items, added: false, item: dup, full: false };
  if (items.length >= MAX_ITEMS) return { items, added: false, item: null, full: true };
  return { items: [...items, item], added: true, item, full: false };
}

const removeItem = (items, id) => items.filter((x) => x.id !== id);
const patchItem = (items, id, patch) => items.map((x) => (x.id === id ? normalizeItem({ ...x, ...patch }) || x : x));

/** Sobe (-1) ou desce (+1) um passo na ordem de coleta. */
function moveItem(items, id, dir) {
  const k = items.findIndex((x) => x.id === id);
  const j = k + (dir < 0 ? -1 : 1);
  if (k < 0 || j < 0 || j >= items.length) return items;
  const out = items.slice();
  [out[k], out[j]] = [out[j], out[k]];
  return out;
}

/** Ordem de exibição: 'time' (por hora; sem hora vai para o fim) ou 'added' (a ordem em que foram guardados). */
function ordered(items, mode = 'time') {
  if (mode !== 'time') return items.slice();
  return items.map((x, k) => ({ x, k })).sort((a, b) => {
    const ta = a.x.ts == null ? Infinity : a.x.ts;
    const tb = b.x.ts == null ? Infinity : b.x.ts;
    return ta === tb ? a.k - b.k : ta < tb ? -1 : 1;
  }).map((o) => o.x);
}

/** "+3,2 s", "+2 min 5 s", "−450 ms" … ('' sem valor). */
function fmtDelta(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms);
  if (a < 1000) return `${sign}${Math.round(a)} ms`;
  if (a < 59950) return `${sign}${(a / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} s`;
  if (a < 3600000) { const m = Math.floor(a / 60000); const s = Math.round((a % 60000) / 1000); return s === 60 ? `${sign}${m + 1} min` : `${sign}${m} min${s ? ` ${s} s` : ''}`; }
  const h = Math.floor(a / 3600000); const m = Math.round((a % 3600000) / 60000);
  return m === 60 ? `${sign}${h + 1} h` : `${sign}${h} h${m ? ` ${m} min` : ''}`;
}

/** Duração sem sinal ("4 min 12 s"). */
const fmtSpan = (ms) => fmtDelta(Math.abs(ms)).replace(/^\+/, '');

/**
 * Passo a passo na ordem pedida. → { list: [{ item, n, delta, repeat }], span, errors, repeated }
 * delta = tempo desde o passo anterior da lista; repeat = quantos passos do caso têm o mesmo grupo de falha (0 se único).
 */
function steps(items, mode = 'time') {
  const list = ordered(items, mode);
  const perGroup = new Map();
  for (const x of items) if (x.group) perGroup.set(x.group, (perGroup.get(x.group) || 0) + 1);
  const out = list.map((item, k) => {
    const prev = k ? list[k - 1] : null;
    const n = item.group ? perGroup.get(item.group) : 0;
    return { item, n: k + 1, delta: prev && prev.ts != null && item.ts != null ? item.ts - prev.ts : null, repeat: n > 1 ? n : 0 };
  });
  const ts = items.map((x) => x.ts).filter((t) => t != null);
  return {
    list: out,
    span: ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : null,
    errors: items.filter((x) => x.level >= 5).length,
    repeated: out.filter((s) => s.repeat).length,
  };
}

const p2 = (n) => String(n).padStart(2, '0');
/** 2026-10-22 08:00:03,638 (hora local). */
function fmtStamp(ts) {
  if (ts == null || !Number.isFinite(ts)) return '(sem hora)';
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())},${String(d.getMilliseconds()).padStart(3, '0')}`;
}

const LEVEL_NAME = ['—', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const headline = (item, max = 160) => str(item.text.split('\n')[0].trim(), max);

/** Resumo de uma linha: "7 passos · 4 min 12 s · 3 erros · 2 repetidos". */
function summary(items, mode = 'time') {
  const s = steps(items, mode);
  const parts = [`${items.length} passo${items.length === 1 ? '' : 's'}`];
  if (s.span != null) parts.push(fmtSpan(s.span));
  if (s.errors) parts.push(`${s.errors} erro${s.errors === 1 ? '' : 's'}`);
  if (s.repeated) parts.push(`${s.repeated} repetido${s.repeated === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Relatório do caso. opts: { mode: 'time' | 'added', redact: (texto) => texto } */
function toMarkdown(c, { mode = 'time', redact = (t) => t } = {}) {
  const r = (t) => redact(String(t == null ? '' : t));
  const out = [`# ${r(c.title)}`, '', `> ${summary(c.items, mode)}`];
  if (c.hypothesis.trim()) out.push('', '## Hipótese', '', r(c.hypothesis.trim()));
  out.push('', '## Passo a passo');
  for (const s of steps(c.items, mode).list) {
    const it = s.item;
    const tag = it.tag ? ` · **${TAG_LABEL[it.tag]}**` : '';
    const delta = s.delta != null ? ` · ${fmtDelta(s.delta)}` : '';
    const rep = s.repeat ? ` · mesma falha ×${s.repeat}` : '';
    out.push('', `### ${s.n}. ${fmtStamp(it.ts)} · ${LEVEL_NAME[it.level]}${tag}${delta}${rep}`);
    if (it.log) out.push('', `_${r(it.log)}_`);
    out.push('', '```', r(it.text).replace(/```/g, "'''"), '```');
    if (it.note.trim()) out.push('', `> ${r(it.note.trim()).replace(/\n/g, '\n> ')}`);
  }
  if (c.conclusion.trim()) out.push('', '## Conclusão', '', r(c.conclusion.trim()));
  return out.join('\n') + '\n';
}

/** Erros que falam de banco: vale perguntar ao Banco o que estava acontecendo naquela hora. */
const DB_HINT = /\b(sql|jdbc|timeout|deadlock|lock request|database|banco|connection|conex[aã]o|ORA-\d|SQLException|SQLTimeout|tedious|sqlserver|mssql)/i;
const dbHint = (text) => DB_HINT.test(String(text || '').slice(0, 20000));

/**
 * Cabe no orçamento da IA: corta o texto de cada passo (`per`) e, se o total passar de `budget`, mantém primeiro, último e
 * os etiquetados e completa com os demais na ordem. → { kept (na ordem original), omitted }
 */
function fitSteps(list, { budget = 24000, per = 1500 } = {}) {
  const clipped = list.map((s) => ({ ...s, text: s.text.length > per ? s.text.slice(0, per) + '\n… (cortado)' : s.text }));
  const size = (s) => s.text.length + (s.note || '').length + 120;
  let total = clipped.reduce((a, s) => a + size(s), 0);
  if (total <= budget) return { kept: clipped, omitted: 0 };
  const keep = new Set();
  let used = 0;
  const take = (k) => { if (keep.has(k)) return; keep.add(k); used += size(clipped[k]); };
  clipped.forEach((s, k) => { if (s.tag || k === 0 || k === clipped.length - 1) take(k); });
  for (let k = 0; k < clipped.length && used < budget; k++) if (!keep.has(k) && used + size(clipped[k]) <= budget) take(k);
  const kept = clipped.filter((_, k) => keep.has(k));
  return { kept, omitted: clipped.length - kept.length };
}

module.exports = {
  TAGS, TAG_LABEL, MAX_CASES, MAX_ITEMS, MAX_TEXT, MAX_NOTE,
  normalizeItem, normalizeCase, normalizeCases, sameItem, addItem, removeItem, patchItem, moveItem,
  ordered, steps, summary, fmtDelta, fmtSpan, fmtStamp, headline, toMarkdown, dbHint, fitSteps,
};
