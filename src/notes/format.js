'use strict';
/**
 * Formato de arquivo das Notes: markdown com front matter simples no topo.
 *
 *   ---
 *   id: 20260926-142100-x7k2
 *   title: "SQL — NULL handling"
 *   type: snippet
 *   tags: ["sql", "rm"]
 *   ...
 *   ---
 *   conteúdo em markdown
 *
 * Strings e listas são gravadas como JSON (que também é YAML válido), então o arquivo abre em
 * qualquer editor/Obsidian. Na leitura aceitamos também valores simples sem aspas e listas [a, b].
 * Campos desconhecidos são preservados (extra) para não perder nada de arquivos editados fora do app.
 */
const { createNote } = require('./note.js');

const ORDER = ['id', 'title', 'type', 'tags', 'aliases', 'pinned', 'favorite', 'quick', 'source', 'created', 'updated'];
const OPTIONAL = new Set(['quick', 'source']); // só gravados quando têm valor

function formatValue(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  return JSON.stringify(String(v ?? ''));
}

function serialize(note) {
  const lines = ['---'];
  for (const k of ORDER) {
    const v = note[k];
    if (OPTIONAL.has(k) && (v === undefined || v === false || v === '' || v === null)) continue;
    // Datas e id sem aspas ficam mais legíveis e continuam YAML válido.
    lines.push(`${k}: ${k === 'id' || k === 'created' || k === 'updated' ? String(v ?? '') : formatValue(v ?? (k === 'tags' || k === 'aliases' ? [] : ''))}`);
  }
  for (const [k, raw] of Object.entries(note.extra || {})) lines.push(`${k}: ${raw}`);
  lines.push('---');
  return lines.join('\n') + '\n' + String(note.content || '');
}

function parseValue(raw) {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { /* lista YAML simples */ }
    return s.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return s;
}

const KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s(.*))?$/;

/**
 * Lê um arquivo de nota. fileName dá o id quando o front matter não tem; fallbackDate
 * (ex.: mtime do arquivo) é usado para created/updated ausentes.
 */
function parse(text, fileName = '', fallbackDate = new Date()) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const fields = {};
  const extra = {};
  let content = src;
  if (src.startsWith('---\n')) {
    const end = src.indexOf('\n---', 3);
    const closeOk = end !== -1 && (src[end + 4] === '\n' || end + 4 === src.length);
    const header = closeOk ? src.slice(4, end).split('\n') : null;
    // Só é front matter se todas as linhas forem "chave: valor" (senão é um <hr> do markdown).
    if (header && header.every((l) => !l.trim() || KEY_LINE.test(l))) {
      for (const l of header) {
        const m = KEY_LINE.exec(l);
        if (!m) continue;
        if (ORDER.includes(m[1])) fields[m[1]] = parseValue(m[2] || '');
        else extra[m[1]] = (m[2] || '').trim();
      }
      content = src.slice(end + 5);
    }
  }
  const iso = (fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate)).toISOString();
  const id = fields.id ? String(fields.id) : String(fileName).replace(/\.md$/i, '');
  const note = createNote({
    ...fields,
    id,
    title: fields.title != null ? String(fields.title) : '',
    tags: Array.isArray(fields.tags) ? fields.tags : fields.tags ? [fields.tags] : [],
    aliases: Array.isArray(fields.aliases) ? fields.aliases : fields.aliases ? [fields.aliases] : [],
    pinned: fields.pinned === true,
    favorite: fields.favorite === true,
    quick: fields.quick === true,
    created: fields.created ? String(fields.created) : iso,
    updated: fields.updated ? String(fields.updated) : iso,
    content,
  });
  if (Object.keys(extra).length) note.extra = extra;
  return note;
}

module.exports = { serialize, parse };
