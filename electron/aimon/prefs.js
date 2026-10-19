'use strict';
/**
 * Monitor de IA — preferências, em %APPDATA%\Toni Devkit\aimon.json.
 *
 * background: manter o acompanhamento ligado mesmo com a tela fechada. É o que permite à tela do Git mostrar o selo
 * "sessões de IA ativas" e ao monitor avisar de fora. Desligado por padrão: quem só usa o Git não paga nada por isso.
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');

function createPrefs({ file }) {
  let state = { background: false };
  const queue = createQueue();
  return {
    async init() {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { background: raw.background === true };
      } catch { /* primeira vez */ }
      return state;
    },
    get: () => ({ ...state }),
    async setBackground(on) {
      state = { ...state, background: !!on };
      await queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));
      return state.background;
    },
    flush: () => queue.flush(),
  };
}

module.exports = { createPrefs };
