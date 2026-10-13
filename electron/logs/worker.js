'use strict';
// Worker thread da ferramenta Logs: índice e consultas fora do processo principal (ver engine.js).
// Mensagens: { id, op, args } → { id, ok, data | error }. Eventos (progresso de leitura): { type: 'event', evt }.
const { parentPort } = require('node:worker_threads');
const { createEngine } = require('./engine');

const engine = createEngine({ emit: (evt) => parentPort.postMessage({ type: 'event', evt }) });

parentPort.on('message', async (m) => {
  try {
    const data = await engine.call(m.op, m.args);
    parentPort.postMessage({ id: m.id, ok: true, data });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e) });
  }
});
parentPort.postMessage({ type: 'ready' });
