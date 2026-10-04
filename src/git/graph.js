'use strict';
/**
 * Grafo de commits — raias (colunas) para desenhar o histórico como no `git log --graph`, mas em SVG.
 * Entrada: commits em ordem topológica (filhos antes dos pais), como `git log --topo-order`.
 *
 * Saída, uma linha por commit: { col, color, segments: [{ x1, x2, color, kind }] } — os segmentos ligam a linha i à
 * linha i+1 (x = coluna). kind: 'pass' (raia que só atravessa), 'merge' (do commit para o 2º pai em diante),
 * 'join' (raia que converge num commit). `width` = maior número de colunas usado.
 */

function layoutGraph(commits) {
  const lanes = [];        // coluna → hash esperado (ou null = livre)
  const laneColor = [];    // coluna → índice de cor
  let nextColor = 0;
  let width = 0;
  const rows = [];
  const freeSlot = () => { const i = lanes.indexOf(null); return i === -1 ? lanes.length : i; };

  for (let r = 0; r < commits.length; r++) {
    const c = commits[r];
    let col = lanes.indexOf(c.hash);
    if (col === -1) { // commit sem filho carregado (ponta de branch): ganha uma raia nova
      col = freeSlot();
      lanes[col] = c.hash;
      laneColor[col] = nextColor++;
    }
    const color = laneColor[col];
    // Outras raias que esperavam este commit convergem nele (fim de branch mesclada).
    for (let j = 0; j < lanes.length; j++) if (j !== col && lanes[j] === c.hash) lanes[j] = null;

    // Pais: o 1º continua na raia do commit; os outros (merge) reaproveitam uma raia que já os espera ou abrem uma.
    const from = new Map(); // raia nova → coluna de onde ela sai nesta linha (a do commit)
    const extra = [];       // merge num pai que já tinha raia: linha a mais do commit até essa raia
    const [first, ...others] = c.parents;
    lanes[col] = first || null;
    if (first) from.set(col, col);
    for (const p of others) {
      let j = lanes.indexOf(p);
      if (j === -1) {
        j = freeSlot();
        lanes[j] = p;
        laneColor[j] = nextColor++;
        from.set(j, col);
      } else extra.push(j);
    }
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    // Segmentos até a próxima linha: cada raia ativa vai de x1 (aqui) a x2 (lá).
    const next = commits[r + 1];
    const nextCol = next ? lanes.indexOf(next.hash) : -1;
    const segments = [];
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] == null) continue;
      const x1 = from.has(j) ? from.get(j) : j;
      const x2 = next && lanes[j] === next.hash && nextCol !== -1 ? nextCol : j;
      const kind = from.has(j) && from.get(j) !== j ? 'merge' : x2 !== j ? 'join' : 'pass';
      segments.push({ x1, x2, color: laneColor[j], kind });
      if (extra.includes(j)) segments.push({ x1: col, x2, color: laneColor[j], kind: 'merge' });
    }
    width = Math.max(width, lanes.length, col + 1);
    rows.push({ hash: c.hash, col, color, segments });
  }
  return { rows, width };
}

module.exports = { layoutGraph };
