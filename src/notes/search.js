'use strict';
/**
 * Busca de Notes — em memória, sem dependências.
 * Cada termo da consulta precisa casar em algum campo; pesos: título ≫ aliases/tags ≫ tipo ≫ conteúdo.
 * Ignora acentos/maiúsculas e aceita 1 erro de digitação em palavras de título/tags/aliases (≥ 5 letras).
 */
const { normalize } = require('../commands/search.js');
const { displayTitle, allTags, excerpt } = require('./note.js');
const { folderOf } = require('./folders.js');

// Campos normalizados por nota. As notas são imutáveis no serviço (salvar cria outro objeto),
// então o cache por objeto nunca fica velho.
const cache = new WeakMap();
function fieldsOf(note) {
  let f = cache.get(note);
  if (!f) {
    const title = displayTitle(note);
    const nt = normalize(title);
    const tags = allTags(note);
    const aliases = (note.aliases || []).map(normalize);
    f = {
      title,
      nt,
      titleWords: nt.split(/[^\p{L}\p{N}_]+/u).filter(Boolean),
      tags,
      keyWords: [...tags, ...aliases.flatMap((a) => a.split(/\s+/))].filter(Boolean),
      aliases: aliases.join(' '),
      type: note.type,
      content: normalize(note.content),
    };
    cache.set(note, f);
  }
  return f;
}

/** Distância de edição ≤ 1 (troca, inserção ou remoção de um caractere). */
function withinOne(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

/** Termo com ≥ 5 letras a 1 erro de alguma palavra (inteira ou do mesmo tamanho do começo dela). */
const typo = (term, words) => term.length >= 5 && words.some((w) => withinOne(term, w) || (w.length > term.length && withinOne(term, w.slice(0, term.length))));

/** Palavras do conteúdo (≥ 5 letras), calculadas só quando a busca exata falhar. */
function contentWords(f) {
  if (!f.cw) f.cw = [...new Set(f.content.split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 5))];
  return f.cw;
}

function scoreTerm(f, t) {
  let s = 0;
  if (f.titleWords.some((w) => w.startsWith(t))) s = 30;
  else if (f.nt.includes(t)) s = 20;
  else if (typo(t, f.titleWords)) s = 14;
  let k = 0;
  if (f.keyWords.includes(t)) k = 18;
  else if (f.keyWords.some((w) => w.startsWith(t))) k = 14;
  else if (f.aliases.includes(t)) k = 10;
  else if (typo(t, f.keyWords)) k = 8;
  const ty = f.type === t ? 6 : 0;
  let c = 0;
  const at = f.content.indexOf(t);
  if (at !== -1) {
    c = 5;
    let n = 0;
    for (let i = f.content.indexOf(t, at + t.length); i !== -1 && n < 4; i = f.content.indexOf(t, i + t.length)) n++;
    c += n * 0.5;
  } else if (!s && !k && typo(t, contentWords(f))) c = 3;
  return Math.max(s, k, ty, c) + (s && c ? 1 : 0);
}

/** Filtros: { quick, pinned, favorite, type, tag, folder } — folder: '' = raiz, 'a/b' = notas diretas dessa pasta. */
function matchesFilter(note, flt) {
  if (!flt) return true;
  if (flt.folder != null && folderOf(note.file) !== flt.folder) return false;
  if (flt.quick && !note.quick) return false;
  if (flt.pinned && !note.pinned) return false;
  if (flt.favorite && !note.favorite) return false;
  if (flt.type && note.type !== flt.type) return false;
  if (flt.tag && !fieldsOf(note).tags.includes(flt.tag)) return false;
  return true;
}

const byUpdated = (a, b) => String(b.updated).localeCompare(String(a.updated));

/**
 * Busca. Retorna [{ note, title, score, titleIdx, excerpt }] (melhores primeiro).
 * Consulta vazia → notas filtradas, mais recentes primeiro.
 */
function searchNotes(notes, query, { limit = 50, filter } = {}) {
  const q = normalize(query).trim().replace(/\s+/g, ' ');
  const pool = notes.filter((n) => matchesFilter(n, filter));
  if (!q) {
    return pool.sort(byUpdated).slice(0, limit).map((note) => ({ note, title: fieldsOf(note).title, score: 0, titleIdx: [], excerpt: null }));
  }
  const terms = [...new Set(q.replace(/^#/, '').split(' ').map((t) => t.replace(/^#/, '')).filter(Boolean))];
  const out = [];
  for (const note of pool) {
    const f = fieldsOf(note);
    let score = 0, ok = true;
    for (const t of terms) {
      const s = scoreTerm(f, t);
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    if (terms.length > 1) {
      if (f.nt.includes(q)) score += 15;
      else if (f.content.includes(q)) score += 5;
    }
    if (note.pinned) score += 2;
    if (note.favorite) score += 1;
    out.push({ note, f, score });
  }
  out.sort((a, b) => b.score - a.score || byUpdated(a.note, b.note));
  return out.slice(0, limit).map(({ note, f, score }) => {
    const titleIdx = [];
    for (const t of terms) {
      const i = f.nt.indexOf(t);
      if (i !== -1) for (let k = 0; k < t.length; k++) titleIdx.push(i + k);
    }
    return {
      note,
      title: f.title,
      score,
      titleIdx: [...new Set(titleIdx)].sort((a, b) => a - b),
      excerpt: excerpt(note.content, terms), // sem termo no conteúdo → começo do texto
    };
  });
}

module.exports = { searchNotes, matchesFilter, withinOne };
