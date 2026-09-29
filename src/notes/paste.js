// Colar/arrastar no editor de Notes (renderer). Ordem de decisão no Ctrl+V:
//   1. Tem texto? → tabela (TSV do Excel/SSMS) vira tabela Markdown; URL sobre seleção vira [texto](url);
//      senão, colagem normal. O texto vem antes da imagem porque o Excel copia as células também como imagem.
//   2. Só imagem (print, "Copiar imagem" do navegador) → grava em .assets\ e insere ![imagem](…).
// Ctrl+Shift+V cola o texto puro, sem transformar nada. Arrastar arquivos de imagem também funciona.
import { handleImageTransfer } from './images.js';
import { smartPaste } from './markup.js';

let plainUntil = 0; // Ctrl+Shift+V acabou de ser pressionado → próxima colagem é texto puro

/** Props para o <textarea>: onPaste/onDrop/onDragOver/onKeyDownCapture. insert(r) aplica { value, start, end }. */
export function pasteProps({ insert, onError }) {
  return {
    onKeyDownCapture: (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainUntil = Date.now() + 1000;
    },
    onPaste: (e) => {
      const plain = Date.now() < plainUntil;
      plainUntil = 0;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (text) {
        if (plain) return;
        const t = e.target;
        const r = smartPaste(t.value, t.selectionStart, t.selectionEnd, text);
        if (r) { e.preventDefault(); insert(r); }
        return;
      }
      handleImageTransfer(e, e.clipboardData, { insert, onError });
    },
    onDrop: (e) => handleImageTransfer(e, e.dataTransfer, { insert, onError }),
    onDragOver: (e) => { if ([...(e.dataTransfer.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); },
  };
}
