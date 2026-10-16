// SQL Visualizer — SVG estático do diagrama ER (para exportar SVG/PNG). Cores já resolvidas (sem var()), nomes escapados.
import { ER, edgeAnchors, colY, fkColor } from '../../db/erlayout.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = 'Consolas, Menlo, monospace';

/** Caminho curvo da FK: sai do filho (a) e chega ao pai (b). Compartilhado com a tela. */
export function fkPath(a, b, ya, yb) {
  const p = edgeAnchors(a, b, ya, yb);
  if (p.loop) {
    const bx = Math.max(a.x + a.w, b.x + b.w) + 40;
    return { d: `M${p.x1} ${p.y1} C${bx} ${p.y1} ${bx} ${p.y2} ${p.x2} ${p.y2}`, ...p };
  }
  const dx = Math.max(30, Math.abs(p.x2 - p.x1) / 2) * (p.x2 < p.x1 ? -1 : 1);
  return { d: `M${p.x1} ${p.y1} C${p.x1 + dx} ${p.y1} ${p.x2 - dx} ${p.y2} ${p.x2} ${p.y2}`, ...p };
}

/** Geometria completa de uma FK: caminho ligando a linha da coluna FK (filho) à da PK/chave referenciada (pai), cor e rótulos. */
export function fkGeom(f, nodes, tableOf) {
  const a = nodes[f.from], b = nodes[f.to];
  if (!a || !b) return null;
  const ya = colY(a, tableOf(f.from), f.fromCols[0]), yb = colY(b, tableOf(f.to), f.toCols[0]);
  const p = fkPath(a, b, ya, yb);
  return { p, c: cardLabels(f, p), color: fkColor(f.name), ya, yb, mx: (p.x1 + p.x2) / 2, my: (p.y1 + p.y2) / 2 };
}

/** Faixa colorida atrás de cada coluna que participa de uma FK (filho e pai): { tableId: Map(coluna → cor) }. */
export function linkedColumns(schema) {
  const m = new Map();
  const mark = (id, cols, color) => { const r = m.get(id) || m.set(id, new Map()).get(id); for (const c of cols) if (!r.has(c)) r.set(c, color); };
  for (const f of schema.fks) { const color = fkColor(f.name); mark(f.from, f.fromCols, color); mark(f.to, f.toCols, color); }
  return m;
}

/** Rótulos de cardinalidade: lado pai "1", lado filho "N" (ou "1" em 1:1). */
export function cardLabels(fk, p) {
  if (p.loop) return { child: { x: p.x1 + 8, y: p.y1 - 6, text: fk.oneToOne ? '1' : 'N', anchor: 'start' }, parent: { x: p.x2 + 8, y: p.y2 - 6, text: '1', anchor: 'start' } };
  const dir = p.x2 < p.x1 ? -1 : 1; // sentido da linha ao sair do filho
  return {
    child: { x: p.x1 + dir * 8, y: p.y1 - 6, text: fk.oneToOne ? '1' : 'N', anchor: dir > 0 ? 'start' : 'end' },
    parent: { x: p.x2 - dir * 8, y: p.y2 - 6, text: '1', anchor: dir > 0 ? 'end' : 'start' },
  };
}

/** erToSvg(schema, nodes, size, colors) → string SVG. nodes: { id: {x,y,w,h} } (já com as posições arrastadas). */
export function erToSvg(schema, nodes, colors) {
  const ids = Object.keys(nodes);
  const pad = 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) { const n = nodes[id]; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w + 40); y1 = Math.max(y1, n.y + n.h); }
  if (!ids.length) { x0 = y0 = 0; x1 = y1 = 100; }
  const w = Math.ceil(x1 - x0 + pad * 2), h = Math.ceil(y1 - y0 + pad * 2);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0 - pad} ${y0 - pad} ${w} ${h}" font-family="${FONT}" font-size="12">`,
    `<rect x="${x0 - pad}" y="${y0 - pad}" width="${w}" height="${h}" fill="${colors.bg}"/>`,
  ];
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const links = linkedColumns(schema);
  for (const f of schema.fks) {
    const g = fkGeom(f, nodes, (id) => byId.get(id));
    if (!g) continue;
    const { p, c } = g;
    out.push(`<path d="${p.d}" fill="none" stroke="${g.color}" stroke-width="1.8"/>`);
    out.push(`<circle cx="${p.x1}" cy="${p.y1}" r="3.5" fill="${g.color}"/><circle cx="${p.x2}" cy="${p.y2}" r="3.5" fill="${g.color}"/>`);
    out.push(`<text x="${c.child.x}" y="${c.child.y}" text-anchor="${c.child.anchor}" font-size="10" fill="${colors.dim}">${c.child.text}</text>`);
    out.push(`<text x="${c.parent.x}" y="${c.parent.y}" text-anchor="${c.parent.anchor}" font-size="10" fill="${colors.dim}">${c.parent.text}</text>`);
  }
  for (const t of schema.tables) {
    const n = nodes[t.id];
    if (!n) continue;
    const title = t.schema && t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name;
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${colors.box}" stroke="${colors.border}"/>`);
    out.push(`<path d="M${n.x} ${n.y + ER.head} V${n.y + 6} a6 6 0 0 1 6 -6 H${n.x + n.w - 6} a6 6 0 0 1 6 6 V${n.y + ER.head} Z" fill="${colors.head}"/>`);
    out.push(`<text x="${n.x + 10}" y="${n.y + 20}" font-weight="700" fill="${colors.text}">${esc(title)}</text>`);
    t.columns.forEach((c, i) => {
      const y = n.y + ER.head + ER.pad + i * ER.row + 14;
      const lk = links.get(t.id) && links.get(t.id).get(c.name);
      if (lk) out.push(`<rect x="${n.x + 1}" y="${y - 14}" width="${n.w - 2}" height="${ER.row}" fill="${lk}" fill-opacity=".16"/><rect x="${n.x + 1}" y="${y - 14}" width="3" height="${ER.row}" fill="${lk}"/>`);
      const mark = c.pk ? 'PK' : c.fk ? 'FK' : '';
      if (mark) out.push(`<text x="${n.x + 10}" y="${y}" font-size="10" font-weight="700" fill="${c.pk ? colors.pk : colors.fk}">${mark}</text>`);
      out.push(`<text x="${n.x + 34}" y="${y}" fill="${colors.text}">${esc(c.name)}</text>`);
      out.push(`<text x="${n.x + n.w - 10}" y="${y}" text-anchor="end" fill="${colors.dim}">${esc(c.type)}${c.nullable ? '' : ' •'}</text>`);
    });
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width: w, height: h };
}

/** Lê as cores do tema atual (variáveis CSS) para o SVG exportado. */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  return {
    bg: v('--tk-surface-1', '#111'), box: v('--tk-surface-2', '#1a1a1a'), head: v('--tk-surface-3', '#262626'),
    border: v('--tk-border-strong', '#444'), edge: v('--tk-border-strong', '#555'), text: v('--tk-text', '#eee'),
    dim: v('--tk-text-3', '#999'), pk: v('--tk-amber', '#f5c542'), fk: v('--tk-accent', '#1fa35c'),
  };
}
