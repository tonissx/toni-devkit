'use strict';
/**
 * Monitor de IA — preferências, em %APPDATA%\Toni Devkit\aimon.json.
 *
 * background: manter o acompanhamento ligado mesmo com a tela fechada. É o que permite à tela do Git mostrar o selo
 * "sessões de IA ativas" e ao monitor avisar de fora. Desligado por padrão: quem só usa o Git não paga nada por isso.
 * notify: avisos do sistema quando uma sessão passa a esperar por você ou dá erro. Também mantém o acompanhamento ligado
 * com a tela fechada (senão não teria como avisar). Desligado por padrão.
 * prices: preços por modelo (US$ por 1 milhão de tokens) que trocam os padrões da estimativa de custo (pricing.js).
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { cleanPrices } = require('./pricing');

function createPrefs({ file }) {
  let state = { background: false, notify: false, prices: {} };
  const queue = createQueue();
  const save = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));
  return {
    async init() {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { background: raw.background === true, notify: raw.notify === true, prices: cleanPrices(raw.prices) };
      } catch { /* primeira vez */ }
      return state;
    },
    get: () => ({ ...state, prices: { ...state.prices } }),
    async setBackground(on) {
      state = { ...state, background: !!on };
      await save();
      return state.background;
    },
    async setNotify(on) {
      state = { ...state, notify: !!on };
      await save();
      return state.notify;
    },
    /** Troca os preços personalizados (vazio volta aos padrões). */
    async setPrices(prices) {
      state = { ...state, prices: cleanPrices(prices) };
      await save();
      return { ...state.prices };
    },
    flush: () => queue.flush(),
  };
}

module.exports = { createPrefs };
