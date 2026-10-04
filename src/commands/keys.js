'use strict';
/**
 * Teclado da command palette. Regra única: letras são sempre texto (digitar = buscar);
 * navegação e ações rápidas usam Alt+letra. Ctrl fica com o campo (Ctrl+A, Ctrl+C…).
 *
 * As teclas são lidas por e.code (KeyT…), que não depende do layout do teclado.
 * Bônus: o atalho global já usa Alt — Ctrl+Alt+Space e depois Q (sem soltar o Alt) = Quick Note.
 */

const letterOf = (code) => (/^Key[A-Z]$/.test(code || '') ? code.slice(3).toLowerCase() : null);

// Válidas em qualquer lugar da palette.
const GLOBAL = {
  t: { type: 'scope', scope: 'tools' },
  a: { type: 'scope', scope: 'actions' },
  n: { type: 'scope', scope: 'notes' },
  q: { type: 'command', id: 'notes:quick' },
};

// Dentro de Notes (inclusive Pinned/Recentes): Alt+N passa a ser "New Note"; Alt+S cria uma sticky note.
const IN_NOTES = {
  n: { type: 'command', id: 'notes:new' },
  p: { type: 'command', id: 'notes:pinned' },
  r: { type: 'command', id: 'notes:recent' },
  s: { type: 'command', id: 'stickies:new' },
};

/**
 * Ação de uma tecla na palette, ou null (a tecla segue para o campo de texto).
 * → { type: 'scope', scope } | { type: 'command', id } | null
 */
function paletteKey(e, scope) {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const k = letterOf(e.code);
  if (!k) return null;
  const inNotes = !!scope && scope.startsWith('notes');
  return (inNotes && IN_NOTES[k]) || GLOBAL[k] || null;
}

/** Rótulo do atalho de uma tecla (para Kbd): 't' → 'Alt+T'. */
const keyHint = (k) => 'Alt+' + String(k).toUpperCase();

module.exports = { paletteKey, keyHint };
