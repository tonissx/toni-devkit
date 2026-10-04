'use strict';
/**
 * Sticky notes (processo principal): notas fixadas na tela como janelas pequenas, sem moldura.
 *
 * O conteúdo é a própria nota (serviço de Notes); aqui fica só o que é da janela — posição, tamanho, cor, "sempre por
 * cima", recolhida — em %APPDATA%\Toni Devkit\stickies.json (por computador: monitores mudam de uma máquina para outra).
 * As regras de formato e geometria estão em src/stickies/sticky.js.
 *
 * Dependências injetadas (os testes usam versões falsas):
 *   createWindow(noteId, { bounds, onTop, collapsed }) → janela com on/getBounds/setBounds/setAlwaysOnTop/setResizable/
 *     show/hide/focus/destroy/isDestroyed/isVisible
 *   workAreas() → [{ x, y, width, height }] dos monitores · cursorWorkArea() → monitor do cursor
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { MAX_STICKIES, COLLAPSED_HEIGHT, COLORS, normalizeState, fitBounds, cascadeBounds } = require('../../src/stickies/sticky.js');

function createStickiesService({ file, createWindow, workAreas, cursorWorkArea, broadcast = () => {}, saveDelay = 300 }) {
  const queue = createQueue();
  let state = normalizeState(null);
  const wins = new Map(); // noteId → janela
  let quitting = false;
  let timer = null;

  const find = (id) => state.stickies.find((s) => s.noteId === id) || null;
  const alive = (w) => w && !(w.isDestroyed && w.isDestroyed());
  const snapshot = () => ({ hidden: state.hidden, stickies: state.stickies.map((s) => ({ ...s })) });

  const persist = () => {
    clearTimeout(timer);
    timer = null;
    const data = JSON.stringify(state, null, 2);
    return queue.run('stickies', () => atomicWrite(file, data));
  };
  const persistSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { persist().catch((e) => console.error('[stickies]', e.message)); }, saveDelay);
  };
  const changed = (noteId) => broadcast({ noteId, sticky: noteId ? find(noteId) : null, hidden: state.hidden });

  async function init() {
    try {
      state = normalizeState(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[stickies] arquivo ilegível, começando vazio:', e.message);
      state = normalizeState(null);
    }
    return snapshot();
  }

  /** Cria a janela de uma sticky (já no estado), encaixada num monitor que existe. */
  function openWindow(s) {
    if (alive(wins.get(s.noteId))) return wins.get(s.noteId);
    s.bounds = fitBounds(s.bounds || cascadeBounds(state.stickies.map((x) => x.bounds), cursorWorkArea()), workAreas());
    const w = createWindow(s.noteId, { bounds: s.collapsed ? { ...s.bounds, height: COLLAPSED_HEIGHT } : s.bounds, onTop: s.onTop, collapsed: s.collapsed });
    wins.set(s.noteId, w);
    // Mover: guarda a posição. Redimensionar: guarda o tamanho (recolhida, a altura é a do cabeçalho — não conta).
    const track = () => {
      const cur = find(s.noteId);
      if (!cur || !alive(w)) return;
      const b = w.getBounds();
      cur.bounds = cur.collapsed ? { ...cur.bounds, x: b.x, y: b.y, width: b.width } : b;
      persistSoon();
    };
    w.on('moved', track);
    w.on('resized', track);
    // Fechada por fora (Alt+F4) = tirar da tela; fechada porque o app está saindo = continua no estado.
    w.on('closed', () => {
      if (wins.get(s.noteId) === w) wins.delete(s.noteId);
      if (!quitting && find(s.noteId)) {
        state.stickies = state.stickies.filter((x) => x.noteId !== s.noteId);
        persist().catch(() => {});
        changed(s.noteId);
      }
    });
    return w;
  }

  /** Reabre as stickies salvas (na inicialização do app). */
  function restore() {
    if (state.hidden) return;
    for (const s of state.stickies) openWindow(s);
  }

  /** Fixa a nota na tela (ou traz para frente, se já estiver). Mostra as outras se estavam ocultas. */
  async function open(noteId, { color } = {}) {
    if (typeof noteId !== 'string' || !noteId) throw new Error('Nota inválida');
    let s = find(noteId);
    if (!s) {
      if (state.stickies.length >= MAX_STICKIES) throw new Error(`Máximo de ${MAX_STICKIES} sticky notes — feche uma antes`);
      s = { noteId, bounds: null, color: COLORS.includes(color) ? color : COLORS[state.stickies.length % COLORS.length], onTop: false, collapsed: false };
      state.stickies.push(s);
    }
    if (state.hidden) { state.hidden = false; restore(); }
    const w = openWindow(s);
    w.show();
    w.focus();
    await persist();
    changed(noteId);
    return { ...s };
  }

  /** Tira a nota da tela (a nota continua existindo). */
  async function close(noteId) {
    const had = !!find(noteId);
    state.stickies = state.stickies.filter((s) => s.noteId !== noteId);
    const w = wins.get(noteId);
    wins.delete(noteId);
    if (alive(w)) w.destroy();
    if (had) { await persist(); changed(noteId); }
    return had;
  }

  /** Cor, "sempre por cima" ou recolhida. */
  async function set(noteId, patch = {}) {
    const s = find(noteId);
    if (!s) throw new Error('Essa sticky não está mais na tela');
    const w = wins.get(noteId);
    if (patch.color !== undefined && COLORS.includes(patch.color)) s.color = patch.color;
    if (patch.onTop !== undefined) {
      s.onTop = !!patch.onTop;
      if (alive(w)) w.setAlwaysOnTop(s.onTop);
    }
    if (patch.collapsed !== undefined && !!patch.collapsed !== s.collapsed) {
      if (alive(w)) {
        const b = w.getBounds();
        if (!s.collapsed) s.bounds = b; // guarda o tamanho aberto antes de recolher
        s.collapsed = !!patch.collapsed;
        if (w.setResizable) w.setResizable(!s.collapsed);
        w.setBounds(s.collapsed ? { ...b, height: COLLAPSED_HEIGHT } : { ...b, height: s.bounds.height });
      } else s.collapsed = !!patch.collapsed;
    }
    await persist();
    changed(noteId);
    return { ...s };
  }

  /** Oculta todas (continuam fixadas) ou mostra de novo. */
  async function toggleAll() {
    if (!state.stickies.length) { state.hidden = false; return snapshot(); } // nada fixado: nada a alternar
    state.hidden = !state.hidden;
    if (state.hidden) { for (const w of wins.values()) if (alive(w)) w.hide(); }
    else {
      for (const s of state.stickies) {
        const w = openWindow(s);
        if (alive(w)) w.show();
      }
    }
    await persist();
    changed(null);
    return snapshot();
  }

  /** Nota excluída: a sticky dela sai da tela. */
  function noteRemoved(noteId) {
    if (find(noteId)) close(noteId).catch(() => {});
  }

  return {
    init, restore, open, close, set, toggleAll, noteRemoved,
    get: (noteId) => { const s = find(noteId); return s ? { ...s } : null; },
    list: snapshot,
    /** O app vai sair: as janelas fecham, mas as stickies continuam no estado para voltar na próxima vez. */
    setQuitting: () => { quitting = true; },
    flush: async () => { if (timer) await persist(); await queue.flush(); },
    file,
  };
}

module.exports = { createStickiesService };
