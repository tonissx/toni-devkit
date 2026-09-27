'use strict';
/**
 * Persistência das Notes: um arquivo .md por nota numa pasta comum (Documentos\Devkit Notes).
 *
 * - Escrita atômica: grava <arquivo>.tmp e renomeia por cima — o .md nunca fica pela metade.
 * - Gravações do mesmo arquivo são enfileiradas (nunca em paralelo; a última vence).
 * - Excluir move para .trash\ (nada é apagado de verdade).
 * - Arquivo ilegível é pulado e reportado, sem derrubar os demais.
 * - Estado do app (recentes vistos) fica em .devkit\state.json.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { serialize, parse } = require('../../src/notes/format.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** rename com novas tentativas: no Windows, antivírus/OneDrive seguram o arquivo por instantes (EPERM/EBUSY). */
async function renameRetry(from, to, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await fs.rename(from, to); } catch (e) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await sleep(40 * (i + 1));
    }
  }
}

function createStore(dir) {
  const queues = new Map(); // arquivo → promessa da última gravação
  const trashDir = path.join(dir, '.trash');
  const stateFile = path.join(dir, '.devkit', 'state.json');

  const fileOf = (note) => path.join(dir, note.file || note.id + '.md');

  async function atomicWrite(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.writeFile(tmp, text, 'utf8');
    try { await renameRetry(tmp, file); } catch (e) { fs.unlink(tmp).catch(() => {}); throw e; }
  }

  function enqueue(file, job) {
    const prev = queues.get(file) || Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    queues.set(file, next);
    next.catch(() => {}).finally(() => { if (queues.get(file) === next) queues.delete(file); });
    return next;
  }

  return {
    dir,

    /** Lê todas as notas. { notes, errors: [{ file, error }] } */
    async loadAll() {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const notes = [], errors = [];
      await Promise.all(entries.filter((e) => e.isFile() && /\.md$/i.test(e.name)).map(async (e) => {
        const file = path.join(dir, e.name);
        try {
          const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
          const note = parse(text, e.name, st.mtime);
          note.file = e.name;
          notes.push(note);
        } catch (err) {
          errors.push({ file: e.name, error: String(err.message || err) });
        }
      }));
      return { notes, errors };
    },

    /** Grava a nota (atômico, enfileirado por arquivo). */
    write(note) {
      const file = fileOf(note);
      const text = serialize(note);
      return enqueue(file, () => atomicWrite(file, text));
    },

    /** Move o arquivo da nota para .trash\ (depois das gravações pendentes dele). */
    trash(note) {
      const file = fileOf(note);
      return enqueue(file, async () => {
        await fs.mkdir(trashDir, { recursive: true });
        let dest = path.join(trashDir, path.basename(file));
        try { await fs.access(dest); dest = dest.replace(/\.md$/i, '') + '.' + Date.now() + '.md'; } catch { /* livre */ }
        try { await renameRetry(file, dest); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      });
    },

    /** Espera todas as gravações pendentes (usado antes de sair). */
    async flush() {
      await Promise.all([...queues.values()].map((p) => p.catch(() => {})));
    },

    async readState() {
      try { return JSON.parse(await fs.readFile(stateFile, 'utf8')) || {}; } catch { return {}; }
    },
    writeState(state) {
      return enqueue(stateFile, () => atomicWrite(stateFile, JSON.stringify(state, null, 2)));
    },
  };
}

module.exports = { createStore };
