'use strict';
/**
 * Importar markdown como nota nova (arrastar um .md / colar). JS puro, sem DOM.
 * Devolve só os campos que o usuário "traz"; id/datas/fixada ficam por conta do create (nota nova).
 */
const { parse } = require('./format.js');

const MD_EXT = /\.(md|markdown|txt)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

/** Arquivo importável como nota: extensão de texto/markdown e até 2 MB. */
const isMarkdownFile = (f) => !!f && MD_EXT.test(f.name || '') && (f.size == null || f.size <= MAX_BYTES);

/** Nome do arquivo sem a extensão ("meu-guia.md" → "meu-guia"). */
const baseTitle = (fileName) => String(fileName || '').replace(/^.*[\\/]/, '').replace(MD_EXT, '').trim();

/** { title, content, tags, aliases, type } a partir do texto de um .md (ou de uma colagem). */
function fromMarkdown(text, fileName = '') {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const p = parse(src, 'import');
  let title = String(p.title || '').trim();
  let content = p.content;
  if (!title) {
    // 1º "# Título" do corpo vira o título (e sai do corpo para não aparecer duas vezes).
    const m = /^(?:[ \t]*\n)*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(content);
    if (m) { title = m[1].trim(); content = content.slice(m[0].length).replace(/^\n+/, ''); }
  }
  if (!title) title = baseTitle(fileName);
  return { title, content, tags: p.tags, aliases: p.aliases, type: p.type };
}

module.exports = { fromMarkdown, isMarkdownFile, baseTitle, MAX_BYTES };
