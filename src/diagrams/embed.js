'use strict';
/** Referência para embutir um diagrama no texto de uma nota: ![[Título]]. JS puro. */

/**
 * Título → { text } com a referência pronta para colar, ou { error } quando o título não cabe na sintaxe
 * ([ ] e | delimitam o ![[…]], então não podem fazer parte do nome).
 */
function embedRef(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return { error: 'Dê um título ao diagrama: a referência usa o título.' };
  if (/[[\]|\r\n]/.test(t)) return { error: 'O título tem [ ], | ou quebra de linha, que não funcionam dentro de ![[…]]. Renomeie o diagrama.' };
  return { text: `![[${t}]]` };
}

module.exports = { embedRef };
