// Miniatura de um diagrama (SVG como data URL, para um <img>). Usada pelo cartão em Notes (DiagramCard) e pelo
// ![[Diagrama]] dentro do texto das notas (NotePreview). O Excalidraw só é carregado quando há algo para desenhar.
import { loadExcalidraw } from './excalidraw.js';
import { parseScene, sceneIsEmpty } from './scene.js';

/**
 * Conteúdo da nota → { url } | { empty: true } | { error }. Sem cache.
 * <img> com data: URL: o SVG roda isolado (sem scripts nem carregamentos externos).
 */
export async function sceneThumb(content, { dark = true } = {}) {
  const parsed = parseScene(content);
  if (parsed.error) return { error: parsed.error };
  if (sceneIsEmpty(parsed.scene)) return { empty: true };
  try {
    const X = await loadExcalidraw();
    const svg = await X.exportSvg(parsed.scene, { dark });
    return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/*
 * Cache por nota para o embed. O preview das Notas regrava o HTML a cada tecla (o modo "Lado a lado"), e gerar o SVG
 * toda vez seria caro e faria a imagem piscar. Cada entrada guarda o `updated` da nota de onde saiu: se o diagrama
 * mudou (mesmo com o preview desmontado, quando nenhum evento chegaria), `embedThumb` vê a diferença e gera de novo.
 */
const MAX = 32;
const cache = new Map(); // id → { updated, result } — a ordem de inserção serve de LRU

/** Última miniatura gerada para a nota, ou undefined. Síncrono: serve para pintar antes de checar se mudou. */
export const peekThumb = (id) => { const e = cache.get(id); return e && e.result; };

/** Esquece uma nota (ou tudo, sem argumento). */
export const forgetThumb = (id) => { if (id === undefined) cache.clear(); else cache.delete(id); };

/** Miniatura da nota (`{ id, content, updated }`), do cache se `updated` não mudou. */
export async function embedThumb(note, opts) {
  const hit = cache.get(note.id);
  if (hit && hit.updated === note.updated) return hit.result;
  const result = await sceneThumb(note.content, opts);
  cache.delete(note.id);
  cache.set(note.id, { updated: note.updated, result });
  while (cache.size > MAX) cache.delete(cache.keys().next().value);
  return result;
}
