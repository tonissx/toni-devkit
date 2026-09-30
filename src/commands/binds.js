'use strict';
/**
 * Smart Binds: atalhos globais que rodam um comando da palette sem abrir janela nenhuma.
 *
 * O processo principal guarda os binds (userData/binds.json) e registra os atalhos; ao disparar,
 * a janela da palette — oculta — roda o comando do registry (ver electron/binds.js).
 * Só entram comandos que funcionam sem a UI da palette (nada de keepOpen/takesQuery).
 *
 * Aceleradores no formato do Electron: 'Control+Alt+Shift+S'.
 */

/** Comandos que podem receber um atalho global (ids de src/commands/registry.js). */
const BINDABLE = [
  { id: 'clipboard:auto', name: 'Formatar clipboard (SQL ou XML)' },
  { id: 'clipboard:sql', name: 'Formatar SQL do clipboard' },
  { id: 'clipboard:xml', name: 'Formatar XML do clipboard' },
  { id: 'theme:toggle', name: 'Alternar tema claro/escuro' },
];
const BINDABLE_IDS = BINDABLE.map((b) => b.id);

// Um atalho só (F de "Format") que detecta SQL/XML; os específicos ficam opcionais.
// Shift junto evita colisão com AltGr (= Ctrl+Alt) no ABNT2 e com atalhos de IDE (Ctrl+Alt+S, Ctrl+Alt+L…).
const DEFAULT_BINDS = {
  'clipboard:auto': 'Control+Alt+Shift+F',
};

// Atalho da própria palette (electron/palette.js) — não pode ser reaproveitado.
const RESERVED = ['Control+Alt+Space'];

const MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
const NAMED = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`',
};

/** Tecla (não modificadora) a partir de e.code — independe do layout do teclado. */
function keyFromCode(code) {
  if (!code || MOD_CODES.test(code)) return null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if ((m = /^Numpad([0-9])$/.exec(code))) return 'num' + m[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED[code] || null;
}

/**
 * Acelerador do Electron para um keydown, ou null se não serve como atalho global:
 * precisa de Ctrl ou Alt (Shift sozinho atrapalharia a digitação) e de uma tecla não modificadora.
 */
function acceleratorFromEvent(e) {
  if (!e || !(e.ctrlKey || e.altKey)) return null;
  const key = keyFromCode(e.code);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}

/** Rótulo para exibição: 'Control+Alt+Shift+S' → 'Ctrl+Alt+Shift+S'. */
const acceleratorLabel = (acc) => String(acc || '').replace(/\bControl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');

const sameAcc = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Limpa um mapa { commandId: acelerador } vindo do disco ou da UI: só ids bindáveis, só strings,
 * sem atalho reservado e sem o mesmo atalho em dois comandos (fica o primeiro).
 */
function normalizeBinds(raw, ids = BINDABLE_IDS) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const used = [];
  for (const id of ids) {
    const acc = typeof raw[id] === 'string' ? raw[id].trim() : '';
    if (!acc || RESERVED.some((r) => sameAcc(r, acc)) || used.some((u) => sameAcc(u, acc))) continue;
    used.push(acc);
    out[id] = acc;
  }
  return out;
}

module.exports = { BINDABLE, BINDABLE_IDS, DEFAULT_BINDS, RESERVED, acceleratorFromEvent, acceleratorLabel, normalizeBinds };
