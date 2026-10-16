'use strict';
/**
 * SQL Visualizer — layout hierárquico (em camadas) do diagrama ER e exportação DBML. Puro, sem DOM.
 * Tabelas referenciadas (pai) ficam à esquerda; quem as referencia (filho) à direita. Ciclos de FK são tolerados
 * (a aresta que fecha o ciclo é ignorada na hora de definir as camadas). Dentro de cada camada a ordem
 * é refinada por baricentro (poucas passadas) para reduzir cruzamentos.
 */

const ER = { w: 232, head: 30, row: 20, pad: 6, gapX: 90, gapY: 28 };

const heightOf = (t) => ER.head + ER.pad + Math.max(1, t.columns.length) * ER.row;

/** layoutEr(schema) → { nodes: { [id]: { x, y, w, h, layer } }, width, height } */
function layoutEr(schema, opts = {}) {
  const o = { ...ER, ...opts };
  const ids = schema.tables.map((t) => t.id);
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const parents = new Map(ids.map((id) => [id, new Set()])); // filho → pais (tabelas que ele referencia)
  const children = new Map(ids.map((id) => [id, new Set()]));
  for (const f of schema.fks) {
    if (f.from === f.to || !byId.has(f.from) || !byId.has(f.to)) continue;
    parents.get(f.from).add(f.to);
    children.get(f.to).add(f.from);
  }

  // Camada = maior distância até uma raiz, ignorando arestas de retorno (DFS com pilha de visita).
  const layer = new Map();
  const state = new Map(); // 1 = visitando, 2 = pronto
  const depth = (id) => {
    if (state.get(id) === 2) return layer.get(id);
    state.set(id, 1);
    let d = 0;
    for (const p of parents.get(id)) {
      if (state.get(p) === 1) continue; // ciclo
      d = Math.max(d, depth(p) + 1);
    }
    state.set(id, 2);
    layer.set(id, d);
    return d;
  };
  // Iterativo-seguro para cadeias longas: processa na ordem e confia na memoização (profundidade de pilha ~ camadas).
  for (const id of ids) depth(id);

  const layers = [];
  for (const id of ids) {
    const l = layer.get(id);
    (layers[l] = layers[l] || []).push(id);
  }
  for (let l = 0; l < layers.length; l++) if (!layers[l]) layers[l] = [];

  // Ordem inicial alfabética; depois baricentro em relação à camada vizinha, indo e voltando.
  for (const col of layers) col.sort((a, b) => a.localeCompare(b));
  const pos = new Map();
  const reindex = () => layers.forEach((col) => col.forEach((id, i) => pos.set(id, i)));
  reindex();
  const sweep = (order, neigh) => {
    for (const l of order) {
      const col = layers[l];
      const bary = new Map(col.map((id) => {
        const ns = [...neigh(id)].filter((n) => layer.get(n) !== l);
        return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id)];
      }));
      col.sort((a, b) => bary.get(a) - bary.get(b) || a.localeCompare(b));
      col.forEach((id, i) => pos.set(id, i));
    }
  };
  const idx = (n) => [...Array(n).keys()];
  for (let pass = 0; pass < 4; pass++) {
    sweep(idx(layers.length).slice(1), (id) => parents.get(id));
    sweep(idx(layers.length).slice(0, -1).reverse(), (id) => children.get(id));
  }

  // Coordenadas: colunas lado a lado, cada coluna empilhada, centralizada na altura da maior.
  const colHeight = layers.map((col) => col.reduce((s, id) => s + heightOf(byId.get(id)) + o.gapY, -o.gapY));
  const maxH = Math.max(0, ...colHeight);
  const nodes = {};
  layers.forEach((col, l) => {
    let y = (maxH - colHeight[l]) / 2;
    const x = l * (o.w + o.gapX);
    for (const id of col) {
      const h = heightOf(byId.get(id));
      nodes[id] = { x, y, w: o.w, h, layer: l };
      y += h + o.gapY;
    }
  });
  return { nodes, width: layers.length * (o.w + o.gapX) - o.gapX, height: maxH };
}

/** Ponto de ancoragem da aresta nas laterais dos nós: sai do lado do filho que olha para o pai. */
function edgeAnchors(a, b, ya = a.y + 15, yb = b.y + 15) {
  // a = nó filho (origem da FK), b = nó pai (referenciado); ya/yb = altura da linha da coluna em cada tabela
  if (a.x > b.x + b.w - 1) return { x1: a.x, y1: ya, x2: b.x + b.w, y2: yb };
  if (a.x + a.w < b.x + 1) return { x1: a.x + a.w, y1: ya, x2: b.x, y2: yb };
  // mesma coluna: contorna pela direita
  return { x1: a.x + a.w, y1: ya, x2: b.x + b.w, y2: yb, loop: true };
}

/** Altura (centro) da linha da coluna `col` dentro do nó da tabela `t`; coluna desconhecida cai no cabeçalho. */
function colY(node, t, col) {
  const i = t ? t.columns.findIndex((c) => c.name === col) : -1;
  return i < 0 ? node.y + ER.head / 2 : node.y + ER.head + ER.pad + i * ER.row + ER.row / 2;
}

/** Cor estável de cada FK (HSL): a aresta e as colunas que ela liga usam a mesma cor, para ver qual PK casa com qual FK. */
function fkColor(name) {
  let h = 7;
  for (let i = 0; i < String(name).length; i++) h = (h * 33 + String(name).charCodeAt(i)) >>> 0;
  return `hsl(${(h * 137) % 360} 70% 58%)`;
}

const dbmlName = (s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${String(s).replace(/"/g, '\\"')}"`);
const dbmlType = (t) => (/^[A-Za-z_][A-Za-z0-9_]*(\([^)]*\))?$/.test(t) ? t : `"${String(t).replace(/"/g, '\\"')}"`);

/** Exporta o schema para DBML (dbdiagram.io). Nomes fora do padrão vão entre aspas, aspas internas escapadas. */
function toDbml(schema) {
  const out = [];
  for (const t of schema.tables) {
    const tn = t.schema && t.schema !== 'dbo' ? `${dbmlName(t.schema)}.${dbmlName(t.name)}` : dbmlName(t.name);
    out.push(`Table ${tn} {`);
    const composite = t.pk.length > 1;
    for (const c of t.columns) {
      const attrs = [];
      if (c.pk && !composite) attrs.push('pk');
      if (c.identity) attrs.push('increment');
      if (!c.nullable && !c.pk) attrs.push('not null');
      if (c.unique) attrs.push('unique');
      out.push(`  ${dbmlName(c.name)} ${dbmlType(c.type || 'unknown')}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`);
    }
    if (composite) out.push('', '  indexes {', `    (${t.pk.map(dbmlName).join(', ')}) [pk]`, '  }');
    out.push('}', '');
  }
  const ref = (id, cols) => {
    const t = schema.tables.find((x) => x.id === id);
    const tn = t.schema && t.schema !== 'dbo' ? `${dbmlName(t.schema)}.${dbmlName(t.name)}` : dbmlName(t.name);
    return cols.length > 1 ? `${tn}.(${cols.map(dbmlName).join(', ')})` : `${tn}.${dbmlName(cols[0] || 'id')}`;
  };
  for (const f of schema.fks) out.push(`Ref ${dbmlName(f.name)}: ${ref(f.from, f.fromCols)} ${f.oneToOne ? '-' : '>'} ${ref(f.to, f.toCols)}`);
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

module.exports = { ER, layoutEr, edgeAnchors, colY, fkColor, toDbml, heightOf };
