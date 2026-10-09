'use strict';
/**
 * Smart Binds de formatação: pega o texto SELECIONADO no programa em foco (a palette fica oculta, o foco não sai de lá).
 * Guarda o clipboard → escreve um sentinela → Ctrl+C simulado → espera o clipboard mudar. Sem mudança = nada selecionado:
 * restaura o clipboard anterior e rejeita. Com seleção, ela fica no clipboard para o comando formatar e sobrescrever.
 * Dependências por parâmetro para a sequência ser testável em node.
 */
const POLL_MS = 25;
const POLL_TRIES = 24; // ~600 ms para o programa responder ao Ctrl+C
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createSelectionCopier({ clipboard, win, sleep = wait }) {
  return async function copySelection() {
    if (!win || typeof win.copy !== 'function') throw new Error('Copiar a seleção só funciona no Windows');
    // `await` em toda leitura: conforme a versão do Electron o clipboard devolve valor direto ou Promise.
    const readText = async () => String((await clipboard.readText()) ?? '');
    const prevText = await readText();
    const prevImage = !prevText && clipboard.availableFormats && (await clipboard.availableFormats()).some((f) => f.startsWith('image/'))
      ? await clipboard.readImage() : null;
    const restore = () => {
      if (prevImage && clipboard.write) clipboard.write({ image: prevImage });
      else clipboard.writeText(prevText);
    };
    const sentinel = 'devkit-selecao-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    clipboard.writeText(sentinel);
    try { await win.copy(); } catch (e) {
      restore();
      if (e && e.code === 'BLOCKED') throw new Error('O Windows bloqueou o Ctrl+C (programa em modo administrador?)');
      throw new Error('Não consegui copiar a seleção: ' + String((e && e.message) || e));
    }
    for (let i = 0; i < POLL_TRIES; i++) {
      const now = await readText();
      if (now !== sentinel) {
        if (!now.trim()) break;
        return now;
      }
      await sleep(POLL_MS);
    }
    restore();
    throw new Error('Nenhum texto selecionado');
  };
}

module.exports = { createSelectionCopier };
