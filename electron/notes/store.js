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
const { atomicWrite, renameRetry, createQueue } = require('../lib/fsx.js');

function createStore(dir) {
  const queue = createQueue(); // gravações por arquivo, em ordem
  const trashDir = path.join(dir, '.trash');
  const stateFile = path.join(dir, '.devkit', 'state.json');

  const fileOf = (note) => path.join(dir, note.file || note.id + '.md');

  const enqueue = (file, job) => queue.run(file, job);

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
    flush: () => queue.flush(),

    async readState() {
      try { return JSON.parse(await fs.readFile(stateFile, 'utf8')) || {}; } catch { return {}; }
    },
    writeState(state) {
      return enqueue(stateFile, () => atomicWrite(stateFile, JSON.stringify(state, null, 2)));
    },
  };
}

module.exports = { createStore };
