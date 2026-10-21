'use strict';
/** Preparação do SVG do Mermaid para exportar e nomes de arquivo. JS puro. */

const VIEWBOX_RE = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/;

/** { x, y, w, h } do viewBox do SVG, ou null. */
function viewBoxOf(svg) {
  const m = VIEWBOX_RE.exec(String(svg || ''));
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), w: parseFloat(m[3]), h: parseFloat(m[4]) } : null;
}

/**
 * SVG autônomo: tamanho explícito em px (o do Mermaid é width="100%" + max-width), xmlns garantido e um
 * retângulo de fundo com a cor do tema (senão o PNG sai transparente e o texto claro some no branco).
 */
function standaloneSvg(svg, bg) {
  const src = String(svg || '');
  const vb = viewBoxOf(src);
  const open = /<svg\b[^>]*>/.exec(src);
  if (!vb || !open) return src;
  let tag = open[0]
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/\sstyle="[^"]*"/, '');
  if (!/\sxmlns=/.test(tag)) tag = tag.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  tag = tag.replace('<svg', `<svg width="${Math.ceil(vb.w)}" height="${Math.ceil(vb.h)}"`);
  const rect = bg ? `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${bg}"/>` : '';
  return src.slice(0, open.index) + tag + rect + src.slice(open.index + open[0].length);
}

/** Nome de arquivo seguro a partir do título ("Pedidos: v2?" → "Pedidos v2"); 'diagrama' se sobrar nada. */
function safeFileName(title) {
  const s = String(title || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s.slice(0, 80) || 'diagrama';
}

module.exports = { viewBoxOf, standaloneSvg, safeFileName };
