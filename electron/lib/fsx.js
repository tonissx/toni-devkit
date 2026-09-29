'use strict';
/**
 * Utilitários de arquivo do processo principal (usados por Notes e DevCore).
 * - atomicWrite: grava <arquivo>.<pid>.tmp e renomeia por cima — nunca deixa arquivo pela metade
 *   (texto em UTF-8 ou Buffer, para binários como as imagens das Notes).
 * - renameRetry: no Windows, antivírus/OneDrive seguram arquivos por instantes (EPERM/EBUSY).
 * - createQueue: serializa trabalhos por chave (gravações do mesmo arquivo nunca em paralelo).
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renameRetry(from, to, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await fs.rename(from, to); } catch (e) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await sleep(40 * (i + 1));
    }
  }
}

async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, text, 'utf8');
  try { await renameRetry(tmp, file); } catch (e) { fs.unlink(tmp).catch(() => {}); throw e; }
}

function createQueue() {
  const queues = new Map(); // chave → promessa do último trabalho
  return {
    run(key, job) {
      const prev = queues.get(key) || Promise.resolve();
      const next = prev.catch(() => {}).then(job);
      queues.set(key, next);
      next.catch(() => {}).finally(() => { if (queues.get(key) === next) queues.delete(key); });
      return next;
    },
    /** Espera todos os trabalhos pendentes. */
    async flush() { await Promise.all([...queues.values()].map((p) => p.catch(() => {}))); },
  };
}

module.exports = { atomicWrite, renameRetry, createQueue };
