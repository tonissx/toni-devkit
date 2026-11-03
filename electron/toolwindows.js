'use strict';
// Registro das janelas destacadas: uma por ferramenta. Pura (sem Electron): quem cria a janela de verdade é
// `createWindow(toolId)` (electron/main.js); aqui só ficam as regras — não duplicar, focar a existente, esquecer ao fechar.

/**
 * @param {object} deps
 * @param {(toolId: string) => object} deps.createWindow  cria a BrowserWindow (já carregando a ferramenta)
 * @param {(ids: string[]) => void} deps.broadcast        avisa todas as janelas quais ferramentas estão destacadas
 * @param {(toolId: string) => boolean} deps.isDetachable  false para Início, Configurações e ids desconhecidos
 */
function createToolWindows({ createWindow, broadcast, isDetachable }) {
  const wins = new Map(); // toolId → janela

  const ids = () => [...wins.keys()];
  const alive = (w) => w && !(typeof w.isDestroyed === 'function' && w.isDestroyed());

  function focus(w) {
    if (typeof w.isMinimized === 'function' && w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }

  /** Abre a ferramenta numa janela própria — ou traz a que já existe. Devolve false se a ferramenta não pode ser destacada. */
  function detach(toolId) {
    if (typeof toolId !== 'string' || !isDetachable(toolId)) return false;
    const current = wins.get(toolId);
    if (alive(current)) { focus(current); return true; }
    const w = createWindow(toolId);
    wins.set(toolId, w);
    w.on('closed', () => {
      if (wins.get(toolId) === w) { wins.delete(toolId); broadcast(ids()); }
    });
    broadcast(ids());
    return true;
  }

  /** Fecha a janela destacada (a ferramenta volta a ser só da janela principal). */
  function attach(toolId) {
    const w = wins.get(toolId);
    if (!w) return false;
    wins.delete(toolId);
    broadcast(ids());
    if (alive(w)) w.close();
    return true;
  }

  /** Se a ferramenta está destacada, traz a janela dela e devolve true (a principal não precisa navegar). */
  function focusIfDetached(toolId) {
    const w = wins.get(toolId);
    if (!alive(w)) return false;
    focus(w);
    return true;
  }

  /** A janela destacada da ferramenta (ou null). */
  const get = (toolId) => { const w = wins.get(toolId); return alive(w) ? w : null; };

  function closeAll() {
    for (const w of [...wins.values()]) if (alive(w)) w.close();
    wins.clear();
  }

  return { detach, attach, focusIfDetached, get, list: ids, closeAll };
}

module.exports = { createToolWindows };
