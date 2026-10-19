'use strict';
/**
 * Monitor de IA — preferências, em %APPDATA%\Toni Devkit\aimon.json.
 *
 * background: manter o acompanhamento ligado mesmo com a tela fechada. É o que permite à tela do Git mostrar o selo
 * "sessões de IA ativas" e ao monitor avisar de fora. Desligado por padrão: quem só usa o Git não paga nada por isso.
 * notify: avisos do sistema quando uma sessão passa a esperar por você ou dá erro. Também mantém o acompanhamento ligado
 * com a tela fechada (senão não teria como avisar). Desligado por padrão.
 * prices: preços por modelo (US$ por 1 milhão de tokens) que trocam os padrões da estimativa de custo (pricing.js).
 * limitTokens: limite de uso (tokens contáveis em 5 h) informado por você; vazio = estimado pelas vezes em que o limite estourou.
 * autoReview: revisar sozinho as alterações quando uma sessão fica ociosa. Só roda com a IA em modo Local: nunca envia código à Nuvem sem você pedir.
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { cleanPrices } = require('./pricing');

/** Limite aceito: número positivo e finito (arredondado); qualquer outra coisa vira "sem limite informado". */
const cleanLimit = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

function createPrefs({ file }) {
  let state = { background: false, notify: false, prices: {}, limitTokens: null, autoReview: false };
  const queue = createQueue();
  const save = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));
  return {
    async init() {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { background: raw.background === true, notify: raw.notify === true, prices: cleanPrices(raw.prices), limitTokens: cleanLimit(raw.limitTokens), autoReview: raw.autoReview === true };
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
    async setLimit(n) {
      state = { ...state, limitTokens: cleanLimit(Number(n)) };
      await save();
      return state.limitTokens;
    },
    async setAutoReview(on) {
      state = { ...state, autoReview: !!on };
      await save();
      return state.autoReview;
    },
    flush: () => queue.flush(),
  };
}

module.exports = { createPrefs };
