'use strict';
/**
 * Converte comentários de linha JavaScript (`// texto`) em comentários SQL (`-- texto`).
 *
 * Percorre o texto respeitando o que não pode ser tocado: literais com aspas
 * simples/duplas (ex.: `'http://x'`), identificadores `[entre colchetes]`, comentários
 * de bloco e comentários SQL `--` que já existem (um `//` dentro deles é só texto). Só o marcador `//` é trocado; o texto do comentário fica como está.
 */
function convertLineComments(input) {
  const s = String(input ?? '');
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== c) j++;
      out += s.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (c === '[') {
      const j = s.indexOf(']', i + 1);
      const end = j === -1 ? n : j + 1;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = s.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '-' && d === '-') {
      const j = s.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '/') {
      out += '--';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

module.exports = { convertLineComments };
