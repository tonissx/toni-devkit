'use strict';
// Temas disponíveis (Configurações e command palette).
const THEMES = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Hacking (padrão)' },
  { value: 'min-dark', label: 'Min Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'tokyo-nightstorm', label: 'Tokyo Night Storm' },
  { value: 'night-owl', label: 'Night Owl' },
];

/** Tema efetivo para data-theme ('system' segue o SO). */
function resolveTheme(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

module.exports = { THEMES, resolveTheme };
