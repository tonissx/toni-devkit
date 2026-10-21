// Exportar o diagrama: PNG (2x), SVG ou o arquivo .excalidraw (reabre no excalidraw.com). Só roda no renderer.
// O editor é escuro, mas as cores guardadas são as do modo claro; exportar em claro dá a imagem padrão para
// colar em documentos.
import { loadExcalidraw } from './excalidraw.js';
import { serializeScene, safeFileName } from './scene.js';

/**
 * kind: 'png' | 'svg' | 'excalidraw'. scene: { elements, appState, files } (o estado atual do editor).
 * Devolve { path, name } ou null se o usuário cancelou o diálogo de salvar.
 */
export async function exportDiagram(kind, { scene, title }) {
  const save = window.devkit.files.saveExport;
  const name = safeFileName(title);
  if (kind === 'excalidraw') return save(serializeScene(scene.elements, scene.appState, scene.files), name + '.excalidraw');
  if (!(scene.elements || []).some((e) => !e.isDeleted)) throw new Error('O diagrama está vazio');
  const X = await loadExcalidraw();
  if (kind === 'svg') return save(await X.exportSvg(scene, { dark: false }), name + '.svg');
  return save(await X.exportPng(scene, { dark: false }), name + '.png');
}
