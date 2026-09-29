// Imagens nas Notes (renderer): colar (Ctrl+V) ou arrastar uma imagem para o textarea grava o
// arquivo em .assets\ (processo principal) e insere "![imagem](.assets/<nome>)" no cursor.
import { notesApi, cleanError } from './client.js';
import { insertBlock } from './edit.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Arquivos de imagem de um DataTransfer (clipboardData do paste ou dataTransfer do drop). */
export function imageFiles(dt) {
  if (!dt) return [];
  const files = [...(dt.files || [])].filter((f) => IMAGE_TYPES.includes(f.type));
  if (files.length) return files;
  // Print da tela (Win+Shift+S) às vezes só aparece em items, não em files.
  return [...(dt.items || [])].filter((i) => i.kind === 'file' && IMAGE_TYPES.includes(i.type)).map((i) => i.getAsFile()).filter(Boolean);
}

/**
 * Handler de onPaste/onDrop do textarea. Sem imagem → não faz nada (o navegador cola o texto normal).
 * insert(r) aplica o resultado { value, start, end } no textarea; onError(msg) avisa o usuário.
 */
export function handleImageTransfer(e, dt, { insert, onError }) {
  const files = imageFiles(dt);
  if (!files.length) return false;
  e.preventDefault();
  const t = e.target;
  const start = t.selectionStart, end = t.selectionEnd;
  (async () => {
    const refs = [];
    for (const f of files) {
      try {
        const { path } = await notesApi().saveImage({ bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type });
        refs.push(`![imagem](${path})`);
      } catch (err) { onError(cleanError(err)); }
    }
    if (refs.length) insert(insertBlock(t.value, start, end, refs.join('\n')));
  })();
  return true;
}

/** Props para o <textarea>: onPaste/onDrop/onDragOver tratando imagens. */
export function imageDropProps({ insert, onError }) {
  return {
    onPaste: (e) => handleImageTransfer(e, e.clipboardData, { insert, onError }),
    onDrop: (e) => handleImageTransfer(e, e.dataTransfer, { insert, onError }),
    onDragOver: (e) => { if ([...(e.dataTransfer.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); },
  };
}
