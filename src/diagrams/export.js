// Exportar o diagrama: SVG autônomo, PNG (2x) ou o texto Mermaid (.mmd). Só roda no renderer.
import { readColors, svgToPng } from '../tools/json-visualizer/exportImage.js';
import { standaloneSvg, safeFileName, viewBoxOf } from './svg.js';

/** kind: 'svg' | 'png' | 'mmd'. Devolve { path, name } ou null se o usuário cancelou o diálogo. */
export async function exportDiagram(kind, { svg, title, code }) {
  const save = window.devkit.files.saveExport;
  const name = safeFileName(title);
  if (kind === 'mmd') return save(String(code || ''), name + '.mmd');
  if (!svg) throw new Error('Não há diagrama renderizado para exportar');
  const out = standaloneSvg(svg, readColors().bg);
  if (kind === 'svg') return save(out, name + '.svg');
  const vb = viewBoxOf(out);
  return save(await svgToPng(out, vb ? vb.w : 800, vb ? vb.h : 600), name + '.png');
}
