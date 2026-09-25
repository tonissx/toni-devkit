// Acesso aos componentes do Toni Devkit Design System (bundle carregado em renderer/ds/toni-devkit.js).
export const DS = window.ToniDevkitDesignSystem_c34f22;
if (!DS) throw new Error('Toni Devkit DS não carregado');
if (DS.__errors && DS.__errors.length) console.warn('[toni-devkit-ds] componentes com erro:', DS.__errors);

export const isMac = (window.devkit && window.devkit.platform) === 'darwin';
/** Rótulo de atalho conforme a plataforma: mod('K') → ⌘K | Ctrl+K */
export const mod = (k, shift) => (isMac ? (shift ? '⌘⇧' : '⌘') + k : 'Ctrl+' + (shift ? 'Shift+' : '') + k);
export const isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
