'use strict';
// Histórico de versões de um agente (sem React): linhas do diff entre duas versões do arquivo, no formato que a tela desenha.
const { diffLines } = require('../diff-checker/engine.js');

/**
 * Diff de linhas entre dois textos → { rows, added, removed }. Cada row: { k: 'eq' | 'del' | 'add' | 'gap', text, n? }.
 * Trechos iguais longos viram uma linha `gap` ("n linhas iguais"), mantendo `context` linhas em volta de cada mudança.
 */
function diffRows(oldText, newText, context = 3) {
  const r = diffLines(String(oldText == null ? '' : oldText), String(newText == null ? '' : newText));
  const raw = r.ops.map((o) => (o.t === 'eq' ? { k: 'eq', text: r.a[o.a] } : o.t === 'del' ? { k: 'del', text: r.a[o.a] } : { k: 'add', text: r.b[o.b] }));
  const rows = [];
  for (let i = 0; i < raw.length;) {
    if (raw[i].k !== 'eq') { rows.push(raw[i++]); continue; }
    let j = i;
    while (j < raw.length && raw[j].k === 'eq') j++;
    const head = i === 0 ? 0 : context;           // sem contexto antes do começo do arquivo
    const tail = j === raw.length ? 0 : context;  // nem depois do fim
    if (j - i > head + tail + 1) {
      rows.push(...raw.slice(i, i + head), { k: 'gap', n: j - i - head - tail, text: '' }, ...raw.slice(j - tail, j));
    } else rows.push(...raw.slice(i, j));
    i = j;
  }
  return { rows, added: raw.filter((x) => x.k === 'add').length, removed: raw.filter((x) => x.k === 'del').length };
}

module.exports = { diffRows };
