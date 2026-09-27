'use strict';
/**
 * Serviço do DevCore (processo principal): fonte única da verdade do estado do jogo.
 * - carrega/salva %APPDATA%/Toni Devkit/devcore.json (escrita atômica, migração por versão);
 * - no boot, calcula o tempo em que o app ficou fechado (com teto) e prepara o resumo de retorno;
 * - heartbeat central: avança o tempo e salva a cada balance.heartbeatSec (o único relógio do jogo);
 * - escuta o Event Bus (uso do DevKit → descobertas) sem que as features conheçam o DevCore;
 * - toda mudança relevante é anunciada às janelas (broadcast) com o snapshot novo.
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx.js');
const { CONTENT } = require('../../src/devcore/content/index.js');
const { migrate } = require('../../src/devcore/engine/state.js');
const { dispatch } = require('../../src/devcore/engine/index.js');
const { snapshot, abilitiesList } = require('../../src/devcore/engine/view.js');

// Ações que as janelas podem pedir (eventos, boot e tick são internos).
const UI_ACTIONS = new Set(['buy', 'upgrade', 'train', 'station', 'ability', 'ackWelcome', 'seen', 'skin']);

function createDevCoreService({ file, now = () => Date.now(), broadcast = () => {} }) {
  let state = null;
  const queue = createQueue();
  let timer = null;

  const save = () => { const json = JSON.stringify(state); return queue.run(file, () => atomicWrite(file, json)); };
  const view = () => snapshot(state, now());

  function apply(action, { announce = true } = {}) {
    const r = dispatch(state, action, now());
    state = r.state;
    if (announce && (r.log.length || action.type !== 'tick')) broadcast({ log: r.log, snapshot: view() });
    return r;
  }

  return {
    file,

    async init() {
      let raw = null;
      try { raw = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* primeiro uso ou arquivo ilegível */ }
      state = migrate(raw, now());
      apply({ type: 'boot' }, { announce: false });
      await save().catch((e) => console.error('[devcore] save', e));
      return view();
    },

    /** Relógio central: avança online e salva (o boot seguinte mede o tempo fechado a partir daqui). */
    start() {
      if (timer) return;
      timer = setInterval(() => { apply({ type: 'tick' }); save().catch(() => {}); }, CONTENT.BALANCE.heartbeatSec * 1000);
      if (timer.unref) timer.unref();
    },
    stop() { clearInterval(timer); timer = null; },

    get: () => view(),
    abilities: () => abilitiesList(state, now()),

    /** Ação vinda da UI/palette. → { ok, error?, log, snapshot } */
    async act(action) {
      if (!action || !UI_ACTIONS.has(action.type)) return { ok: false, error: 'Ação não permitida', log: [], snapshot: view() };
      const r = apply(action);
      await save().catch(() => {});
      return { ok: !r.error, error: r.error, log: r.log, snapshot: view() };
    },

    /** Evento do DevKit (via Event Bus). */
    onEvent(name, data) {
      const r = apply({ type: 'event', name, data });
      if (r.log.length) save().catch(() => {});
    },

    /** Antes de sair: avança até agora e grava. */
    async flush() {
      if (!state) return;
      this.stop();
      apply({ type: 'tick' }, { announce: false });
      await save().catch(() => {});
      await queue.flush();
    },

    /** Só para testes. */
    _state: () => state,
  };
}

module.exports = { createDevCoreService, UI_ACTIONS };
