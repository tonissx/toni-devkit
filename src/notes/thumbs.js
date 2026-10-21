// Miniaturas dos anexos das Notes (renderer). Duas fontes, nesta ordem:
//   1. o Windows (provedor de miniaturas do Explorer, via processo principal): vídeo, Word/Excel/PowerPoint e, se houver
//      um instalado, PDF;
//   2. pdf.js (bundle sob demanda dist/pdfthumb.js) para PDF, que não depende de nada instalado no PC.
// Sem miniatura ('' no cache), o cartão fica com o selo colorido do tipo. Os anexos são imutáveis (nome único), então
// o cache vale a sessão toda e as buscas em andamento são compartilhadas.
import { notesApi } from './client.js';
import { visualKind } from './attachments.js';

const cache = new Map();    // anexo → data URL ('' = sem miniatura)
const inflight = new Map(); // anexo → Promise
let pdfLoading = null;

/** Miniatura já conhecida (síncrono): data URL, '' (não há) ou undefined (ainda não buscada). */
export const peekAssetThumb = (asset) => cache.get(asset);

function loadPdfThumb() {
  if (window.DevkitPdfThumb) return Promise.resolve(window.DevkitPdfThumb);
  if (!pdfLoading) {
    pdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'dist/pdfthumb.js';
      s.onload = () => (window.DevkitPdfThumb ? resolve(window.DevkitPdfThumb) : reject(new Error('pdf.js não inicializou')));
      s.onerror = () => reject(new Error('Não foi possível carregar o pdf.js'));
      document.head.appendChild(s);
    }).catch((e) => { pdfLoading = null; throw e; });
  }
  return pdfLoading;
}

async function build(asset) {
  try {
    const win = await notesApi().assetThumb(asset);
    if (win) return win;
  } catch { /* cai para o pdf.js / placeholder */ }
  if (visualKind(asset) !== 'pdf') return '';
  try {
    const bytes = await notesApi().assetBytes(asset);
    if (!bytes) return '';
    return await (await loadPdfThumb()).render(bytes);
  } catch { return ''; } // PDF com senha, corrompido ou bundle indisponível
}

/** Busca (uma vez) a miniatura de um anexo. Nunca rejeita: '' quando não há. */
export function loadAssetThumb(asset) {
  if (cache.has(asset)) return Promise.resolve(cache.get(asset));
  if (!inflight.has(asset)) {
    inflight.set(asset, build(asset).then((url) => { cache.set(asset, url); inflight.delete(asset); return url; }));
  }
  return inflight.get(asset);
}
