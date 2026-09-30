// Geometria compartilhada do grafo + exportação (SVG autônomo e PNG). Só roda no renderer.
import { LAYOUT as L } from './engine.js';

export const FONT_FAMILY = "ui-monospace, 'JetBrains Mono', Consolas, monospace";

/** Curva suave da borda direita do pai à borda esquerda do filho. */
export function edgePath(a, b) {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2;
  const x2 = b.x, y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

const MAX_LABEL = 11; // cabe no vão entre colunas (LAYOUT.gapX)
/** Rótulo da aresta (chave/índice que originou o filho), truncado para caber no vão. */
export const edgeLabel = (e) => (e.label.length > MAX_LABEL ? e.label.slice(0, MAX_LABEL - 1) + '…' : e.label);
/** Âncora (fim do texto) do rótulo: logo antes do filho, acima da linha. */
export const edgeLabelPos = (b) => ({ x: b.x - 8, y: b.y + b.h / 2 - 5 });

/** Posição (y do texto) da linha i do nó. */
export const rowY = (n, i) => n.y + L.padY + i * L.rowH + L.rowH / 2 + 4;

/** Lê as cores do tema atual (variáveis --tk-*), para que o arquivo exportado fique igual à tela. */
export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--tk-surface-1', '#0E0E10'),
    node: v('--tk-surface-2', '#141417'),
    border: v('--tk-border-strong', '#2E2E35'),
    text: v('--tk-text', '#F4F4F5'),
    dim: v('--tk-text-3', '#6B6B74'),
    accent: v('--tk-accent', '#3DDC84'),
    key: v('--tk-cyan', '#4FD1E8'),
    string: v('--tk-accent-text', '#3DDC84'),
    number: v('--tk-amber', '#F5C542'),
    boolean: v('--tk-violet', '#9B7BFF'),
    null: v('--tk-text-3', '#6B6B74'),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG autônomo do grafo inteiro (com as posições já calculadas por layoutTree). */
export function graphToSvg(graph, size, colors = readColors()) {
  const pad = 24;
  const w = Math.ceil(size.width + pad * 2), h = Math.ceil(size.height + pad * 2);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}" font-family="${esc(FONT_FAMILY)}" font-size="12">`,
    `<rect x="${-pad}" y="${-pad}" width="${w}" height="${h}" fill="${colors.bg}"/>`,
  ];
  for (const e of graph.edges) {
    const b = graph.nodes[e.to];
    out.push(`<path d="${edgePath(graph.nodes[e.from], b)}" fill="none" stroke="${colors.border}" stroke-width="1.5"/>`);
    const p = edgeLabelPos(b);
    out.push(`<text x="${p.x}" y="${p.y}" text-anchor="end" font-size="10" fill="${colors.dim}">${esc(edgeLabel(e))}</text>`);
  }
  for (const n of graph.nodes) {
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${colors.node}" stroke="${colors.border}"/>`);
    n.rows.forEach((r, i) => {
      const y = rowY(n, i);
      if (r.key) {
        out.push(`<text x="${n.x + L.padX}" y="${y}" fill="${colors.key}">${esc(r.key)}</text>`);
        out.push(`<text x="${n.x + L.padX + (r.key.length + 2) * L.charW}" y="${y}" fill="${colors[r.type] || colors.text}">${esc(r.value)}</text>`);
      } else {
        out.push(`<text x="${n.x + L.padX}" y="${y}" fill="${colors[r.type] || colors.text}">${esc(r.value)}</text>`);
      }
    });
    if (!n.rows.length && !n.collapsed) {
      out.push(`<text x="${n.x + L.padX}" y="${rowY(n, 0)}" fill="${colors.dim}">${n.kind === 'array' ? '[]' : '{}'}</text>`);
    }
    if (n.collapsed) {
      out.push(`<text x="${n.x + L.padX}" y="${rowY(n, n.rows.length)}" fill="${colors.dim}">+ ${n.hiddenChildren} oculto(s)</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Rasteriza um SVG (string) em PNG → Uint8Array. `scale` 2 dá boa nitidez. */
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Limite do canvas do Chromium ≈ 16384 px por lado.
      const k = Math.min(scale, 16000 / Math.max(width, height, 1));
      canvas.width = Math.max(1, Math.floor(width * k));
      canvas.height = Math.max(1, Math.floor(height * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Imagem grande demais para exportar em PNG'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Falha ao gerar a imagem'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
