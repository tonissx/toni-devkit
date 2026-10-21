// Entrada do bundle renderer/dist/pdfthumb.js (pdf.js, carregado sob demanda por pdfthumb.js): desenha a 1ª página de um
// PDF como miniatura. O worker do pdf.js vai dentro do mesmo bundle e roda na própria thread (globalThis.pdfjsWorker),
// então não há Worker nem arquivo extra a liberar na CSP.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

globalThis.pdfjsWorker = { WorkerMessageHandler };

/** bytes (Uint8Array) → data URL (JPEG) da 1ª página, com `width` px de largura. Rejeita se o PDF não abrir (senha, corrompido). */
async function render(bytes, width = 192) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // páginas sem fundo ficam pretas no JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    task.destroy(); // libera o documento e a thread do worker embutido
  }
}

window.DevkitPdfThumb = { render };
