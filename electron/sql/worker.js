'use strict';
// Worker thread: mantém o Pyodide fora do event loop do processo principal.
const { parentPort } = require('node:worker_threads');
const engine = require('./engine');

engine.init().then(
  (e) => parentPort.postMessage({ type: 'ready', sqlparse: e.version }),
  (err) => parentPort.postMessage({ type: 'fatal', error: String(err && err.stack || err) })
);

parentPort.on('message', async ({ id, op, sql, options }) => {
  try {
    const data = op === 'info' ? await engine.info() : await engine.format(sql, options);
    parentPort.postMessage({ id, ok: true, data });
  } catch (err) {
    const msg = String((err && err.message) || err);
    // Erros do Python chegam como PythonError com traceback; mostre só a última linha.
    const last = msg.trim().split('\n').filter(Boolean).pop();
    parentPort.postMessage({ id, ok: false, error: last || msg });
  }
});
