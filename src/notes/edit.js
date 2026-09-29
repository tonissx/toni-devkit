'use strict';
/**
 * Edição de tarefas no textarea — funções puras: (texto, seleção) → { value, start, end } | null.
 * `null` = nada a fazer (o editor deixa o navegador tratar a tecla).
 */
const { maskFences } = require('./note.js');

const TASK_PREFIX_RE = /^([ \t]*)((?:[-*+])|(?:\d+)[.)])[ \t]+\[( |x|X)\][ \t]?/;
const LIST_PREFIX_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

const pad = (n) => String(n).padStart(2, '0');
/** Data local em AAAA-MM-DD, com deslocamento em dias. */
function isoDate(now = new Date(), addDays = 0) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Limites [início, fim) da linha que contém `pos`. */
function lineBounds(value, pos) {
  const start = value.lastIndexOf('\n', pos - 1) + 1;
  const nl = value.indexOf('\n', pos);
  return [start, nl === -1 ? value.length : nl];
}

/** A posição está dentro de um bloco de código cercado (``` / ~~~)? */
function inFence(value, pos) {
  const [s, e] = lineBounds(value, pos);
  const line = value.slice(s, e);
  return line.trim() !== '' && maskFences(value).slice(s, e).trim() === '';
}

/** Aplica edições [{from,to,text}] (em ordem, sem sobrepor) e leva as posições junto. */
function applyEdits(value, edits, positions) {
  let out = '', last = 0;
  for (const ed of edits) { out += value.slice(last, ed.from) + ed.text; last = ed.to; }
  out += value.slice(last);
  const map = (p) => {
    let shift = 0;
    for (const ed of edits) {
      if (p >= ed.to) shift += ed.text.length - (ed.to - ed.from);
      else if (p > ed.from) return ed.from + shift + Math.min(p - ed.from, ed.text.length);
    }
    return p + shift;
  };
  return { value: out, ...positions(map) };
}

/**
 * Enter numa linha "- [ ] texto": a próxima linha já nasce "- [ ] " (mesma indentação; listas
 * numeradas incrementam). Enter numa tarefa vazia sai da lista. Só com o cursor sem seleção.
 */
function continueList(value, pos) {
  if (inFence(value, pos)) return null;
  const [ls, le] = lineBounds(value, pos);
  const line = value.slice(ls, le);
  const m = TASK_PREFIX_RE.exec(line);
  if (!m || pos < ls + m[0].length) return null;
  const rest = line.slice(m[0].length);
  if (!rest.trim() && pos === le) {
    // Tarefa vazia: remove a marcação e deixa a linha em branco.
    return { value: value.slice(0, ls) + value.slice(le), start: ls, end: ls };
  }
  const num = /^(\d+)([.)])$/.exec(m[2]);
  const marker = num ? `${Number(num[1]) + 1}${num[2]}` : m[2];
  const ins = `\n${m[1]}${marker} [ ] `;
  return { value: value.slice(0, pos) + ins + value.slice(pos), start: pos + ins.length, end: pos + ins.length };
}

/**
 * Ctrl+L: alterna a(s) linha(s) da seleção entre texto → "- [ ]" → "- [x]" → texto.
 * Com várias linhas, a primeira linha não vazia decide a ação para todas.
 */
function toggleTaskLines(value, start, end) {
  const [firstLs] = lineBounds(value, start);
  const [, lastLe] = lineBounds(value, Math.max(start, end - (end > start && value[end - 1] === '\n' ? 1 : 0)));
  const lines = [];
  for (let ls = firstLs; ls <= lastLe;) {
    const nl = value.indexOf('\n', ls);
    const le = nl === -1 || nl > lastLe ? lastLe : nl;
    lines.push([ls, le]);
    if (le >= lastLe) break;
    ls = le + 1;
  }
  const single = lines.length === 1;
  const eligible = lines.filter(([s, e]) => !inFence(value, s) && (single || value.slice(s, e).trim() !== ''));
  if (!eligible.length) return null;

  const stateOf = (s, e) => {
    const t = TASK_PREFIX_RE.exec(value.slice(s, e));
    return t ? (t[3] === ' ' ? 'open' : 'done') : 'plain';
  };
  const action = { plain: 'make', open: 'check', done: 'clear' }[stateOf(...eligible[0])];

  const edits = [];
  for (const [s, e] of eligible) {
    const line = value.slice(s, e);
    const st = stateOf(s, e);
    if (action === 'make' && st === 'plain') {
      const list = LIST_PREFIX_RE.exec(line);
      if (list) edits.push({ from: s + list[0].length, to: s + list[0].length, text: '[ ] ' });
      else { const ind = /^[ \t]*/.exec(line)[0].length; edits.push({ from: s + ind, to: s + ind, text: '- [ ] ' }); }
    } else if (action === 'check' && st === 'open') {
      const t = TASK_PREFIX_RE.exec(line);
      const at = s + t[0].indexOf('[') + 1;
      edits.push({ from: at, to: at + 1, text: 'x' });
    } else if (action === 'clear' && st !== 'plain') {
      const t = TASK_PREFIX_RE.exec(line);
      edits.push({ from: s + t[1].length, to: s + t[0].length, text: '' });
    }
  }
  if (!edits.length) return null;
  return applyEdits(value, edits, (map) => ({ start: map(start), end: map(end) }));
}

/**
 * Espaço digitado depois de "[]" ou "todo" no começo da linha vira "- [ ] "; depois de
 * "@hoje" / "@amanha" vira a data (@AAAA-MM-DD). O espaço digitado já vem incluído no resultado.
 */
function expandOnSpace(value, pos, now = new Date()) {
  if (inFence(value, pos)) return null;
  const [ls] = lineBounds(value, pos);
  const before = value.slice(ls, pos);
  let m = /^([ \t]*)(\[\]|todo)$/i.exec(before);
  if (m) {
    const text = `${m[1]}- [ ] `;
    return { value: value.slice(0, ls) + text + value.slice(pos), start: ls + text.length, end: ls + text.length };
  }
  m = /(^|\s)@(hoje|amanha|amanhã)$/i.exec(before);
  if (m) {
    const from = pos - m[0].length + m[1].length;
    const text = `@${isoDate(now, /^h/i.test(m[2]) ? 0 : 1)} `;
    return { value: value.slice(0, from) + text + value.slice(pos), start: from + text.length, end: from + text.length };
  }
  return null;
}

module.exports = { continueList, toggleTaskLines, expandOnSpace, isoDate };
