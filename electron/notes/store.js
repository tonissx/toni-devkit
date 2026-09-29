'use strict';
/**
 * Persistência das Notes: um arquivo .md por nota, dentro da pasta das notas (Documentos\Devkit Notes)
 * ou de subpastas dela — cada pasta das Notes é um diretório real. `note.file` é o caminho relativo
 * com "/" ("Trabalho/Fluig/x.md").
 *
 * - Escrita atômica: grava <arquivo>.tmp e renomeia por cima — o .md nunca fica pela metade.
 * - Gravações do mesmo arquivo são enfileiradas (nunca em paralelo; a última vence).
 * - Excluir move para .trash\ (mantendo a subpasta; nada é apagado de verdade).
 * - Arquivo ilegível é pulado e reportado, sem derrubar os demais.
 * - Nomes que começam com "." (.trash, .devkit, .git…) e links simbólicos são ignorados ao carregar.
 * - Estado do app (recentes vistos) fica em .devkit\state.json.
 * - Imagens coladas nas notas ficam em .assets\ (referenciadas como "![](.assets/nome.png)").
 * - Versões anteriores de cada nota ficam em .devkit\history\<id>\<AAAAMMDD-HHmmss-SSS>.md (as HISTORY_MAX
 *   mais recentes). O mtime de um arquivo em .trash\ é a hora em que ele foi excluído.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { serialize, parse } = require('../../src/notes/format.js');
const { normFolder, folderOf, baseName } = require('../../src/notes/folders.js');
const { atomicWrite, renameRetry, createQueue } = require('../lib/fsx.js');

const exists = (p) => fs.access(p).then(() => true, () => false);

const HISTORY_MAX = 50;
const STAMP_RE = /^\d{8}-\d{6}-\d{3}$/;
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Carimbo ordenável (hora local) para o nome da versão: 20260929-142105-123. */
const stampOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
const dateOfStamp = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15), +s.slice(16, 19));
/** Id → nome de diretório seguro (ids derivados de nome de arquivo podem ter espaço/acento). */
const idDir = (id) => String(id || '').replace(/[^\w.-]/g, '_').replace(/^\.+/, '_') || '_';

function createStore(dir) {
  const root = path.resolve(dir);
  const queue = createQueue(); // gravações por arquivo, em ordem
  const trashDir = path.join(root, '.trash');
  const stateFile = path.join(root, '.devkit', 'state.json');
  const assetsDir = path.join(root, '.assets');
  const historyDir = path.join(root, '.devkit', 'history');

  /** Caminho absoluto de um item da lixeira a partir do caminho relativo a .trash ("Pasta/x.md"). */
  function trashPath(rel) {
    const clean = normFolder(rel);
    if (!clean || !/\.md$/i.test(clean) || /^[a-z]:/i.test(clean) || clean.split('/').some((s) => s === '..' || s === '.' || !s)) throw new Error('Item da lixeira inválido');
    const abs = path.resolve(trashDir, clean);
    if (!abs.startsWith(trashDir + path.sep)) throw new Error('Item da lixeira inválido');
    return abs;
  }
  const versionFile = (id, stamp) => {
    if (!STAMP_RE.test(String(stamp || ''))) throw new Error('Versão inválida');
    return path.join(historyDir, idDir(id), stamp + '.md');
  };

  /** Caminho absoluto de um caminho relativo — sempre dentro da pasta das notas (sem "..", sem caminho absoluto). */
  function resolveIn(rel) {
    const clean = normFolder(rel);
    if (!clean || /^[a-z]:/i.test(clean) || clean.split('/').some((s) => s === '..' || s === '.')) throw new Error('Caminho inválido');
    const abs = path.resolve(root, clean);
    if (!abs.startsWith(root + path.sep)) throw new Error('Caminho fora da pasta das notas');
    return abs;
  }

  const fileOf = (note) => resolveIn(note.file || note.id + '.md');
  const enqueue = (file, job) => queue.run(file, job);

  /** Já existe um item com esse nome (sem diferenciar maiúsculas) dentro de `parentAbs`? Devolve o nome existente. */
  async function sibling(parentAbs, name) {
    try {
      const want = name.toLowerCase();
      return (await fs.readdir(parentAbs)).find((n) => n.toLowerCase() === want) || null;
    } catch { return null; }
  }

  return {
    dir,
    resolveIn,

    /** Lê todas as notas, recursivamente. { notes, errors: [{ file, error }], folders: ['a', 'a/b', …] } */
    async loadAll() {
      await fs.mkdir(root, { recursive: true });
      const notes = [], errors = [], folders = [];
      const walk = async (rel) => {
        const abs = rel ? path.join(root, rel) : root;
        let entries;
        try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch (err) {
          if (!rel) throw err; // a raiz ilegível é erro de verdade
          errors.push({ file: rel, error: String(err.message || err) });
          return;
        }
        await Promise.all(entries.map(async (e) => {
          if (e.name.startsWith('.') || e.isSymbolicLink()) return;
          const childRel = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) { folders.push(childRel); await walk(childRel); return; }
          if (!e.isFile() || !/\.md$/i.test(e.name)) return;
          const file = path.join(root, childRel);
          try {
            const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
            // Sem front matter, o id sai do nome do arquivo: em subpasta inclui o caminho (a.md × sub/a.md).
            const note = parse(text, rel ? childRel.replace(/\//g, '__') : e.name, st.mtime);
            note.file = childRel;
            notes.push(note);
          } catch (err) {
            errors.push({ file: childRel, error: String(err.message || err) });
          }
        }));
      };
      await walk('');
      folders.sort();
      return { notes, errors, folders };
    },

    /** Grava a nota (atômico, enfileirado por arquivo; cria a subpasta se preciso). */
    write(note) {
      const file = fileOf(note);
      const text = serialize(note);
      return enqueue(file, () => atomicWrite(file, text));
    },

    /**
     * Move o arquivo da nota para outro caminho relativo (depois das gravações pendentes dele).
     * Nunca sobrescreve: em colisão acrescenta " (2)", " (3)"… Devolve o caminho relativo final.
     */
    move(note, newFile) {
      const from = fileOf(note);
      const wanted = normFolder(newFile);
      const target = resolveIn(wanted);
      return enqueue(from, async () => {
        if (from.toLowerCase() === target.toLowerCase()) return normFolder(note.file || note.id + '.md');
        await fs.mkdir(path.dirname(target), { recursive: true });
        let rel = wanted, to = target;
        for (let n = 2; await exists(to); n++) {
          rel = wanted.replace(/\.md$/i, '') + ` (${n}).md`;
          to = resolveIn(rel);
        }
        try { await renameRetry(from, to); } catch (e) {
          if (e.code === 'ENOENT') throw new Error('O arquivo da nota não foi encontrado — foi movido ou apagado fora do app? Reinicie o Devkit.');
          throw e;
        }
        return rel;
      });
    },

    /**
     * Move o arquivo da nota para .trash\ mantendo a subpasta (depois das gravações pendentes dele).
     * Devolve o caminho relativo a .trash ("Pasta/x.md") ou null se o arquivo já não existia.
     */
    trash(note) {
      const file = fileOf(note);
      return enqueue(file, async () => {
        const sub = folderOf(note.file || '');
        const destDir = sub ? path.join(trashDir, ...sub.split('/')) : trashDir;
        await fs.mkdir(destDir, { recursive: true });
        let dest = path.join(destDir, path.basename(file));
        if (await exists(dest)) dest = dest.replace(/\.md$/i, '') + '.' + Date.now() + '.md';
        try { await renameRetry(file, dest); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
        const now = new Date();
        await fs.utimes(dest, now, now).catch(() => {}); // mtime = hora da exclusão (a lixeira ordena por ela)
        return path.relative(trashDir, dest).split(path.sep).join('/');
      });
    },

    /* ─────────────── Lixeira ─────────────── */

    /** Quantos .md há na lixeira (só conta, sem ler os arquivos — para o contador da lateral). */
    async countTrash() {
      let count = 0;
      const walk = async (abs) => {
        let entries;
        try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) await walk(path.join(abs, e.name));
          else if (e.isFile() && /\.md$/i.test(e.name)) count++;
        }
      };
      await walk(trashDir);
      return count;
    },

    /** Itens da lixeira: [{ file, folder, deletedAt, note }] (file relativo a .trash). Ilegíveis são pulados. */
    async listTrash() {
      const out = [];
      const walk = async (rel) => {
        let entries;
        try { entries = await fs.readdir(rel ? path.join(trashDir, rel) : trashDir, { withFileTypes: true }); } catch { return; }
        await Promise.all(entries.map(async (e) => {
          if (e.isSymbolicLink()) return;
          const childRel = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) { await walk(childRel); return; }
          if (!e.isFile() || !/\.md$/i.test(e.name)) return;
          try { out.push(await this.readTrash(childRel)); } catch { /* ilegível: fica lá, só não aparece */ }
        }));
      };
      await walk('');
      return out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    },

    /** Um item da lixeira: { file, folder, deletedAt, note }. */
    async readTrash(rel) {
      const abs = trashPath(rel);
      const [text, st] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      const clean = normFolder(rel);
      // Sem front matter o id sai do nome — o mesmo que a nota tinha fora da lixeira (sem o sufixo de colisão).
      const name = baseName(clean).replace(/\.\d{13}\.md$/i, '.md');
      const folder = folderOf(clean);
      return { file: clean, folder, deletedAt: st.mtime.toISOString(), note: parse(text, folder ? (folder + '/' + name).replace(/\//g, '__') : name, st.mtime) };
    },

    /** Apaga de vez um item da lixeira (e as pastas que ficarem vazias no caminho). */
    async removeTrash(rel) {
      const abs = trashPath(rel);
      await fs.rm(abs, { force: true });
      for (let d = path.dirname(abs); d !== trashDir && d.startsWith(trashDir + path.sep); d = path.dirname(d)) {
        try { await fs.rmdir(d); } catch { break; }
      }
    },

    /** Esvazia a lixeira inteira. */
    async emptyTrash() {
      await fs.rm(trashDir, { recursive: true, force: true });
    },

    /* ─────────────── Histórico de versões ─────────────── */

    /** Grava uma versão da nota (o conteúdo como estava) e mantém só as HISTORY_MAX mais recentes. */
    async snapshot(note, at = new Date()) {
      const dirAbs = path.join(historyDir, idDir(note.id));
      await atomicWrite(path.join(dirAbs, stampOf(at) + '.md'), serialize(note));
      const names = (await fs.readdir(dirAbs)).filter((n) => STAMP_RE.test(n.slice(0, -3)) && n.endsWith('.md')).sort();
      for (const n of names.slice(0, Math.max(0, names.length - HISTORY_MAX))) await fs.rm(path.join(dirAbs, n), { force: true });
    },

    /** Versões da nota, mais recentes primeiro: [{ stamp, at }]. */
    async listHistory(id) {
      let names;
      try { names = await fs.readdir(path.join(historyDir, idDir(id))); } catch { return []; }
      return names.filter((n) => n.endsWith('.md') && STAMP_RE.test(n.slice(0, -3))).map((n) => n.slice(0, -3)).sort().reverse()
        .map((stamp) => ({ stamp, at: dateOfStamp(stamp).toISOString() }));
    },

    /** Uma versão: a nota como estava (parse do arquivo). */
    async readVersion(id, stamp) {
      const file = versionFile(id, stamp);
      return parse(await fs.readFile(file, 'utf8'), id + '.md', dateOfStamp(stamp));
    },

    /** Apaga todas as versões da nota (usado quando ela sai da lixeira de vez). */
    async removeHistory(id) {
      await fs.rm(path.join(historyDir, idDir(id)), { recursive: true, force: true });
    },

    /** Cria o diretório da pasta (e os pais que faltarem). Recusa nome já usado (sem diferenciar maiúsculas). */
    async mkdir(rel) {
      const abs = resolveIn(rel);
      if (await sibling(path.dirname(abs), path.basename(abs))) throw new Error(`Já existe uma pasta ou arquivo chamado “${baseName(rel)}” aqui.`);
      await fs.mkdir(abs, { recursive: true });
    },

    /** Renomeia/move um diretório (após as gravações pendentes). Recusa destino existente. */
    async renameDir(fromRel, toRel) {
      const from = resolveIn(fromRel), to = resolveIn(toRel);
      await queue.flush();
      if (from.toLowerCase() !== to.toLowerCase()) {
        if (await sibling(path.dirname(to), path.basename(to))) throw new Error(`Já existe uma pasta ou arquivo chamado “${baseName(toRel)}” no destino.`);
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      try { await renameRetry(from, to); } catch (e) {
        if (e.code === 'ENOENT') throw new Error('A pasta não foi encontrada — foi movida ou apagada fora do app? Reinicie o Devkit.');
        throw e;
      }
    },

    /** Remove o diretório se estiver vazio; devolve false se ainda tem algo dentro. */
    async rmdir(rel) {
      try { await fs.rmdir(resolveIn(rel)); return true; } catch (e) {
        if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return false;
        if (e.code === 'ENOENT') return true;
        throw e;
      }
    },

    /** Caminho absoluto de uma imagem de .assets\ (só o nome do arquivo, sem subpastas). */
    assetPath(name) {
      if (!/^[\w-][\w.-]*$/.test(String(name || ''))) throw new Error('Nome de imagem inválido');
      return path.join(assetsDir, name);
    },

    /** Grava uma imagem em .assets\ (atômico). Recusa nome já existente: devolve false. */
    async writeAsset(name, bytes) {
      const file = this.assetPath(name);
      if (await exists(file)) return false;
      await atomicWrite(file, Buffer.from(bytes));
      return true;
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
