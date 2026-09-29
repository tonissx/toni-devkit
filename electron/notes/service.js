'use strict';
/**
 * Serviço de Notes (processo principal): fonte única da verdade para todas as janelas.
 * Mantém todas as notas em memória (leitura/busca instantâneas) e delega a gravação ao store.
 * Toda alteração é anunciada via broadcast → as janelas atualizam listas sozinhas.
 *
 * É também o ponto de integração do resto do DevKit: uma ferramenta cria/consulta notas por
 * aqui (IPC notes:create / notes:search). Import/export, sync e templates entrariam neste nível.
 */
const { createStore } = require('./store.js');
const { createNote, displayTitle, allTags, plainLine, tasksOf, taskStats, toggleTaskAt, wikiLinks, replaceLinks, maskCode } = require('../../src/notes/note.js');
const { searchNotes } = require('../../src/notes/search.js');
const { validFolderPath, validFolderName, normFolder, folderOf, baseName, parentOf, joinPath, isDescendant } = require('../../src/notes/folders.js');
const { normalize } = require('../../src/commands/search.js');

const EDITABLE = ['title', 'content', 'type', 'tags', 'aliases', 'pinned', 'favorite', 'quick', 'source'];
const VIEWED_MAX = 20;
const INBOX_TITLE = 'Inbox'; // nota que recebe as tarefas capturadas pela palette (task: …)
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const IMAGE_MAX = 20 * 1024 * 1024;
const LINK_LINE_RE = /\[\[([^[\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;

/** Resumo leve para listas (sem o conteúdo inteiro). */
function summary(n) {
  const { open, done } = taskStats(n.content);
  const preview = String(n.content || '').replace(/^(```|~~~).*$/gm, '').split('\n').map(plainLine).filter(Boolean).join(' · ');
  return {
    id: n.id, title: displayTitle(n), rawTitle: n.title, type: n.type, tags: allTags(n),
    pinned: n.pinned, favorite: n.favorite, quick: n.quick, created: n.created, updated: n.updated,
    tasksOpen: open, tasksDone: done, folder: folderOf(n.file),
    preview: preview.length > 160 ? preview.slice(0, 159) + '…' : preview,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function createNotesService({ dir, broadcast = () => {}, events = null, historyGapMs = 10 * 60 * 1000 }) {
  const store = createStore(dir);
  const notes = new Map();
  const folderSet = new Set(); // pastas existentes (diretórios reais, inclusive vazias): 'a', 'a/b'
  let viewed = []; // [{ id, at }]
  let loadErrors = [];

  const all = () => [...notes.values()];
  const changed = (type, id) => broadcast({ type, id });

  // Mutações em fila: um auto-save em voo nunca recria o caminho antigo no meio de um rename/mover.
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  /** Registra a pasta e todos os pais dela. */
  const addFolder = (p) => { for (let f = normFolder(p); f; f = parentOf(f)) folderSet.add(f); };
  /** normalize(título exibido | alias) → id — mesmo critério (e precedência) de resolveLink. */
  const titleIndex = () => {
    const m = new Map();
    for (const n of notes.values()) {
      for (const k of [displayTitle(n), ...(n.aliases || [])].map((s) => normalize(s).trim())) if (k && !m.has(k)) m.set(k, n.id);
    }
    return m;
  };
  const inFolder = (n, p) => folderOf(n.file) === p || isDescendant(folderOf(n.file), p);
  const err = (msg) => { throw new Error(msg); };

  // Histórico: ao salvar uma mudança, guarda a versão anterior — no máximo uma a cada historyGapMs por nota
  // (digitar 30 min seguidos gera ~3 versões, não uma por tecla).
  const lastSnap = new Map(); // id → ms da última versão guardada
  async function snapshotPrev(prev, force = false) {
    if (!prev || !String(prev.content || '').trim() && !String(prev.title || '').trim()) return;
    try {
      if (!lastSnap.has(prev.id)) {
        const [last] = await store.listHistory(prev.id);
        lastSnap.set(prev.id, last ? Date.parse(last.at) : 0);
      }
      if (!force && Date.now() - lastSnap.get(prev.id) < historyGapMs) return;
      await store.snapshot(prev);
      lastSnap.set(prev.id, Date.now());
    } catch (e) { console.error('[notes] histórico', e); } // falhar aqui nunca impede de salvar a nota
  }
  const trashed = new Map(); // id → arquivo em .trash da última exclusão (desfazer apaga a cópia)

  /** Valida uma pasta de destino existente ('' = raiz); devolve o caminho normalizado. */
  function existingFolder(p) {
    const f = normFolder(p);
    if (f) { const e = validFolderPath(f); if (e) err(e); if (!folderSet.has(f)) err('A pasta não existe.'); }
    return f;
  }

  /** Renomeia/move o diretório `from` para `to` e ajusta pastas e notas em memória. */
  async function relocate(from, to) {
    if (!folderSet.has(from)) err('A pasta não existe.');
    if (from === to) return;
    await store.renameDir(from, to);
    const re = (p) => to + p.slice(from.length);
    for (const f of [...folderSet]) if (f === from || f.startsWith(from + '/')) { folderSet.delete(f); folderSet.add(re(f)); }
    for (const n of [...notes.values()]) if (n.file && n.file.startsWith(from + '/')) notes.set(n.id, { ...n, file: re(n.file) });
    changed('folders');
  }

  return {
    dir,
    store,

    async init() {
      const { notes: list, errors, folders } = await store.loadAll();
      loadErrors = errors;
      folderSet.clear();
      for (const f of folders || []) addFolder(f);
      for (const n of list) {
        const prev = notes.get(n.id);
        // Dois arquivos com o mesmo id (cópia manual): mantém o mais recente e avisa.
        if (prev) {
          loadErrors.push({ file: n.file, error: `id duplicado (${n.id}) — mantido o mais recente` });
          if (String(prev.updated) >= String(n.updated)) continue;
        }
        notes.set(n.id, n);
        addFolder(folderOf(n.file));
      }
      const st = await store.readState();
      viewed = Array.isArray(st.viewed) ? st.viewed.filter((v) => notes.has(v.id)) : [];
      return this.info();
    },

    info: () => ({ dir, count: notes.size, errors: loadErrors }),

    list(filter) {
      return searchNotes(all(), '', { filter, limit: Infinity }).map((r) => summary(r.note));
    },

    get(id) {
      const n = notes.get(id);
      return n ? { ...n, tagsAll: allTags(n), folder: folderOf(n.file) } : null;
    },

    /**
     * Cria ou atualiza. Só os campos editáveis vêm do renderer; id/created/file/extra são preservados.
     * Nota nova e vazia não é gravada (Quick Note aberta e fechada sem digitar).
     */
    save(input) { return serial(() => this._save(input)); },

    async _save(input) {
      if (!input || !input.id) throw new Error('Nota sem id');
      const prev = notes.get(input.id);
      const patch = {};
      for (const k of EDITABLE) if (input[k] !== undefined) patch[k] = input[k];
      if (!prev && !String(patch.content || '').trim() && !String(patch.title || '').trim()) return null;
      const base = prev || createNote({ id: input.id, created: input.created });
      const next = createNote({ ...base, ...patch, id: base.id, created: base.created, updated: base.updated });
      // Dar um título promove a Quick Note a Note.
      if (String(next.title).trim()) next.quick = false;
      next.file = base.file;
      // Nota nova pode nascer dentro de uma pasta (só existente); nota existente ignora `folder`.
      if (!prev) {
        const f = normFolder(input.folder);
        if (f && folderSet.has(f)) next.file = f + '/' + next.id + '.md';
      }
      if (base.extra) next.extra = base.extra;
      if (prev && EDITABLE.every((k) => same(prev[k], next[k]))) return this.get(prev.id);
      next.updated = new Date().toISOString();
      if (!next.file) next.file = next.id + '.md';
      if (prev && (prev.content !== next.content || prev.title !== next.title)) await snapshotPrev(prev);
      await store.write(next); // falhou → erro para o renderer (que mantém o texto e tenta de novo)
      notes.set(next.id, next);
      changed('saved', next.id);
      // Anuncia criações no Event Bus (o DevCore escuta; o Notes não sabe disso).
      if (!prev && events) events.emit(next.type === 'snippet' ? 'snippet.created' : 'note.created');
      else if (prev && events && prev.type !== 'snippet' && next.type === 'snippet') events.emit('snippet.created');
      return this.get(next.id);
    },

    /** API para ferramentas/palette: cria uma nota nova com os campos dados. */
    create(partial = {}) {
      const { id, ...fields } = partial; // sempre um id novo
      return this.save(createNote(fields));
    },

    remove(id) {
      return serial(async () => {
        const n = notes.get(id);
        if (!n) return false;
        const t = await store.trash(n);
        if (t) trashed.set(id, t);
        notes.delete(id);
        viewed = viewed.filter((v) => v.id !== id);
        changed('removed', id);
        return true;
      });
    },

    /** Desfazer exclusão: grava de novo a nota e tira da lixeira a cópia daquela exclusão. */
    restore(note) { return serial(() => this._restore(note)); },

    async _restore(note) {
      if (!note || !note.id) return null;
      const { folder, tagsAll, ...clean } = note; // campos derivados de get()
      const n = createNote({ ...clean });
      n.file = note.file || n.id + '.md';
      await store.write(n); // recria a subpasta se ela não existir mais
      notes.set(n.id, n);
      addFolder(folderOf(n.file));
      if (trashed.has(n.id)) { await store.removeTrash(trashed.get(n.id)).catch(() => {}); trashed.delete(n.id); }
      changed('saved', n.id);
      return this.get(n.id);
    },

    /* ─────────────── Histórico de versões ─────────────── */

    /** Versões anteriores da nota, mais recentes primeiro: [{ stamp, at, title, chars }]. */
    async history(id) {
      const list = await store.listHistory(id);
      return Promise.all(list.map(async (v) => {
        try {
          const n = await store.readVersion(id, v.stamp);
          return { ...v, title: displayTitle(n), chars: String(n.content || '').length };
        } catch { return { ...v, title: '(versão ilegível)', chars: 0 }; }
      }));
    },

    /** Uma versão: { stamp, at, title, rawTitle, content }. */
    async version(id, stamp) {
      const n = await store.readVersion(id, stamp);
      const [meta] = (await store.listHistory(id)).filter((v) => v.stamp === stamp);
      return { stamp, at: meta ? meta.at : null, title: displayTitle(n), rawTitle: n.title, content: n.content };
    },

    /**
     * Volta a nota para uma versão (título e conteúdo). Antes guarda o estado atual como versão —
     * restaurar também dá para desfazer pelo histórico.
     */
    restoreVersion(id, stamp) {
      return serial(async () => {
        const cur = notes.get(id);
        if (!cur) err('Nota não encontrada.');
        const v = await store.readVersion(id, stamp);
        await snapshotPrev(cur, true);
        return this._save({ id, content: v.content, title: v.title });
      });
    },

    /* ─────────────── Lixeira ─────────────── */

    /** Notas excluídas: [{ file, id, title, folder, deletedAt, content, preview, exists }], mais recentes primeiro. */
    async trashList() {
      return (await store.listTrash()).map((t) => {
        const s = summary({ ...t.note, file: t.file });
        return { file: t.file, id: t.note.id, title: s.title, folder: t.folder, deletedAt: t.deletedAt, content: t.note.content, preview: s.preview, type: t.note.type, exists: notes.has(t.note.id) };
      });
    },

    /**
     * Restaura um item da lixeira para a pasta onde estava (recriada se preciso). Se já existe uma nota
     * com o mesmo id (ex.: foi restaurada antes), volta como cópia com id novo. Devolve a nota.
     */
    restoreFromTrash(file) {
      return serial(async () => {
        const t = await store.readTrash(file);
        const { id, ...fields } = t.note;
        const dup = notes.has(id);
        const n = dup ? createNote({ ...fields, title: displayTitle(t.note) + ' (restaurada)' }) : createNote({ ...t.note });
        const name = dup ? n.id + '.md' : baseName(t.file).replace(/\.\d{13}\.md$/i, '.md');
        let rel = joinPath(t.folder, name);
        if ([...notes.values()].some((x) => (x.file || '').toLowerCase() === rel.toLowerCase())) rel = joinPath(t.folder, n.id + '.md');
        n.file = rel;
        await store.write(n);
        notes.set(n.id, n);
        addFolder(t.folder);
        await store.removeTrash(t.file);
        changed('saved', n.id);
        changed('folders');
        return this.get(n.id);
      });
    },

    /** Apaga de vez um item da lixeira (e o histórico da nota, se ela não existe mais). */
    deleteFromTrash(file) {
      return serial(async () => {
        const t = await store.readTrash(file);
        await store.removeTrash(t.file);
        if (!notes.has(t.note.id)) { await store.removeHistory(t.note.id).catch(() => {}); lastSnap.delete(t.note.id); }
        changed('trash');
        return true;
      });
    },

    /** Esvazia a lixeira (e o histórico das notas que só existiam nela). Devolve quantas notas apagou. */
    emptyTrash() {
      return serial(async () => {
        const items = await store.listTrash();
        await store.emptyTrash();
        for (const t of items) if (!notes.has(t.note.id)) { await store.removeHistory(t.note.id).catch(() => {}); lastSnap.delete(t.note.id); }
        trashed.clear();
        changed('trash');
        return items.length;
      });
    },

    search(query, opts = {}) {
      return searchNotes(all(), query, opts).map((r) => ({ ...summary(r.note), score: r.score, titleIdx: r.titleIdx, excerpt: r.excerpt }));
    },

    recent() {
      const edited = all().sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 10).map(summary);
      const seen = viewed.map((v) => notes.get(v.id) && { ...summary(notes.get(v.id)), viewedAt: v.at }).filter(Boolean).slice(0, 10);
      return { edited, viewed: seen };
    },

    markViewed(id) {
      if (!notes.has(id)) return;
      viewed = [{ id, at: new Date().toISOString() }, ...viewed.filter((v) => v.id !== id)].slice(0, VIEWED_MAX);
      store.writeState({ viewed }).catch(() => {});
    },

    /** [[Título]] → id (compara título exibido e aliases, sem acento/maiúscula). */
    resolveLink(title) {
      const t = normalize(title).trim();
      if (!t) return null;
      for (const n of notes.values()) {
        if (normalize(displayTitle(n)) === t || (n.aliases || []).some((a) => normalize(a) === t)) return n.id;
      }
      return null;
    },

    tags() {
      const count = new Map();
      for (const n of notes.values()) for (const t of allTags(n)) count.set(t, (count.get(t) || 0) + 1);
      return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, n]) => ({ tag, count: n }));
    },

    /* ─────────────── Links entre notas ─────────────── */

    /**
     * Notas que apontam para `id` com [[link]] (por título exibido ou alias):
     * [{ id, title, folder, updated, line }] — line = a 1ª linha com o link, sem markdown. Mais recentes primeiro.
     */
    backlinks(id) {
      if (!notes.has(id)) return [];
      const index = titleIndex();
      const out = [];
      for (const n of notes.values()) {
        if (n.id === id) continue;
        const src = String(n.content || '');
        const lines = src.split('\n');
        const at = maskCode(src).split('\n').findIndex((l) => [...l.matchAll(LINK_LINE_RE)].some((m) => index.get(normalize(m[1]).trim()) === id));
        if (at === -1) continue;
        const line = plainLine(lines[at]);
        out.push({ id: n.id, title: displayTitle(n), folder: folderOf(n.file), updated: n.updated, line: line.length > 140 ? line.slice(0, 139) + '…' : line });
      }
      return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    },

    /** Quantas notas (fora `exceptId`) têm [[title]] — para oferecer a atualização ao renomear. */
    linkRefs(title, exceptId) {
      const t = normalize(title).trim();
      if (!t) return 0;
      let count = 0;
      for (const n of notes.values()) {
        if (n.id !== exceptId && wikiLinks(n.content).some((l) => normalize(l).trim() === t)) count++;
      }
      return count;
    },

    /**
     * Depois de renomear uma nota: [[from]] → [[to]] em todas as outras (mantendo rótulos).
     * Não mexe em nada se `from` ainda resolve para alguma nota (ex.: virou alias). Devolve quantas notas mudaram.
     */
    async renameLinks(from, to, exceptId) {
      if (!String(to || '').trim() || this.resolveLink(from)) return 0;
      let changedCount = 0;
      for (const n of [...notes.values()]) {
        if (n.id === exceptId) continue;
        const content = replaceLinks(n.content, from, to);
        if (content === n.content) continue;
        await this.save({ id: n.id, content });
        changedCount++;
      }
      return changedCount;
    },

    /* ─────────────── Pastas ─────────────── */

    /** Todas as pastas (inclusive vazias): [{ path, count }] — count = notas diretas. */
    folders() {
      const count = new Map();
      for (const n of notes.values()) { const f = folderOf(n.file); count.set(f, (count.get(f) || 0) + 1); }
      return [...folderSet].sort().map((path) => ({ path, count: count.get(path) || 0 }));
    },

    createFolder(path) {
      return serial(async () => {
        const p = normFolder(path);
        if (!p) err('Digite um nome para a pasta.');
        const e = validFolderPath(p);
        if (e) err(e);
        if (parentOf(p)) existingFolder(parentOf(p));
        await store.mkdir(p);
        addFolder(p);
        changed('folders');
        return p;
      });
    },

    /** Renomeia a pasta (só o último segmento). Devolve o novo caminho. */
    renameFolder(path, newName) {
      return serial(async () => {
        const from = existingFolder(path);
        if (!from) err('Escolha uma pasta.');
        const e = validFolderName(newName);
        if (e) err(e);
        const to = joinPath(parentOf(from), newName);
        await relocate(from, to);
        return to;
      });
    },

    /** Move a pasta (com tudo dentro) para dentro de `newParent` ('' = raiz). Devolve o novo caminho. */
    moveFolder(path, newParent) {
      return serial(async () => {
        const from = existingFolder(path);
        if (!from) err('Escolha uma pasta.');
        const parent = existingFolder(newParent);
        if (parent === from || isDescendant(parent, from)) err('Não dá para mover uma pasta para dentro dela mesma.');
        const to = joinPath(parent, baseName(from));
        await relocate(from, to);
        return to;
      });
    },

    /** Move uma nota para a pasta `folder` ('' = raiz). */
    moveNote(id, folder) {
      return serial(async () => {
        const n = notes.get(id);
        if (!n) err('Nota não encontrada.');
        const dest = existingFolder(folder);
        const cur = n.file || n.id + '.md';
        if (folderOf(cur) === dest) return this.get(id);
        const rel = await store.move(n, joinPath(dest, baseName(cur)));
        notes.set(id, { ...n, file: rel }); // novo objeto: o cache de busca é por objeto
        changed('saved', id);
        return this.get(id);
      });
    },

    /**
     * Exclui a pasta: as notas vão para .trash\ (mantendo a estrutura) e os diretórios vazios somem.
     * Devolve { notes, folders } para desfazer com restoreFolder.
     */
    removeFolder(path) {
      return serial(async () => {
        const p = existingFolder(path);
        if (!p) err('Escolha uma pasta.');
        const doomed = [...notes.values()].filter((n) => inFolder(n, p));
        const snapshots = doomed.map((n) => this.get(n.id));
        for (const n of doomed) {
          const t = await store.trash(n);
          if (t) trashed.set(n.id, t);
          notes.delete(n.id);
        }
        viewed = viewed.filter((v) => notes.has(v.id));
        const dirs = [...folderSet].filter((f) => f === p || f.startsWith(p + '/')).sort((a, b) => b.length - a.length);
        const removed = [];
        for (const f of dirs) if (await store.rmdir(f)) { folderSet.delete(f); removed.push(f); }
        changed('folders');
        return { notes: snapshots, folders: removed.sort() };
      });
    },

    /** Desfaz removeFolder: recria as pastas e regrava as notas. */
    restoreFolder(snap) {
      return serial(async () => {
        if (!snap) return false;
        for (const f of snap.folders || []) {
          if (validFolderPath(f)) continue;
          await store.mkdir(f).catch(() => {}); // já existir não é problema
          addFolder(f);
        }
        for (const note of snap.notes || []) await this._restore(note);
        changed('folders');
        return true;
      });
    },

    /**
     * Tarefas de todas as notas (fora de código): [{ noteId, noteTitle, index, line, text, checked, due, priority, tags }].
     * filter: { status: 'open' (padrão) | 'done' | 'all', tag }. Ordem: vencimento, prioridade, nota mais recente.
     */
    tasks({ status = 'open', tag } = {}) {
      const out = [];
      for (const n of notes.values()) {
        if (n.type === 'snippet') continue;
        const tags = allTags(n);
        if (tag && !tags.includes(tag)) continue;
        for (const t of tasksOf(n.content)) {
          if (status === 'open' && t.checked) continue;
          if (status === 'done' && !t.checked) continue;
          out.push({ noteId: n.id, noteTitle: displayTitle(n), noteUpdated: n.updated, tags, ...t });
        }
      }
      const rank = (v) => (v == null ? Infinity : v);
      const due = (v) => v || '9999-99-99';
      return out.sort((a, b) => due(a.due).localeCompare(due(b.due)) || rank(a.priority) - rank(b.priority)
        || String(b.noteUpdated).localeCompare(String(a.noteUpdated)) || a.noteId.localeCompare(b.noteId) || a.index - b.index);
    },

    /** Marca/desmarca a n-ésima tarefa (índice de tasks()) da nota. */
    async toggleTask(id, index) {
      const n = notes.get(id);
      if (!n) throw new Error('Nota não encontrada');
      const content = toggleTaskAt(n.content, index);
      if (content === n.content) return this.get(id);
      return this.save({ id, content });
    },

    /** Captura rápida: acrescenta "- [ ] texto" à nota "Inbox" (criada se não existir). */
    async appendTask(text) {
      const line = String(text || '').replace(/\s*\n\s*/g, ' ').trim();
      if (!line) throw new Error('Tarefa vazia');
      const id = this.resolveLink(INBOX_TITLE);
      const prev = id && notes.get(id);
      const item = '- [ ] ' + line;
      if (!prev) return this.create({ title: INBOX_TITLE, content: item + '\n' });
      const body = String(prev.content || '');
      const sep = !body || body.endsWith('\n') ? '' : '\n';
      return this.save({ id: prev.id, content: body + sep + item + '\n' });
    },

    /**
     * Imagem colada/arrastada no editor: grava em .assets\ e devolve { path: '.assets/<nome>' }
     * para o markdown. Aceita PNG/JPG/GIF/WebP até 20 MB.
     */
    async saveImage({ bytes, mime } = {}) {
      const ext = IMAGE_EXT[String(mime || '').toLowerCase()];
      if (!ext) err('Formato de imagem não suportado (use PNG, JPG, GIF ou WebP).');
      const size = bytes ? bytes.byteLength : 0;
      if (!size) err('Imagem vazia.');
      if (size > IMAGE_MAX) err('Imagem grande demais (máximo 20 MB).');
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      for (let i = 0; i < 8; i++) {
        const name = `${stamp}-${Math.random().toString(16).slice(2, 6).padEnd(4, '0')}.${ext}`;
        if (await store.writeAsset(name, bytes)) return { path: '.assets/' + name };
      }
      err('Não foi possível gerar um nome para a imagem.');
    },

    /** Caminho absoluto de uma imagem referenciada como ".assets/<nome>" (ou só "<nome>"). */
    assetFile(ref) {
      return store.assetPath(String(ref || '').replace(/^\.assets\//, ''));
    },

    flush: () => store.flush(),
  };
}

module.exports = { createNotesService, summary };
