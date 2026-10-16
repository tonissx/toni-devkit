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
const { validFolderPath, validFolderName, normFolder, folderOf, baseName, parentOf, joinPath, isDescendant, buildTree, siblingsOf, copyName } = require('../../src/notes/folders.js');
const { mergeMeta, sanitizeMeta, cleanTag } = require('../../src/notes/foldermeta.js');
const { normalize } = require('../../src/commands/search.js');
const { templateVars, applyTemplate, isTemplateFolder } = require('../../src/notes/templates.js');
const { buildGraph } = require('../../src/notes/graph.js');
const { expandDueWords } = require('../../src/notes/edit.js');

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

function createNotesService({ dir, broadcast = () => {}, events = null, historyGapMs = 10 * 60 * 1000, historyMax }) {
  const store = createStore(dir, historyMax ? { historyMax } : undefined);
  const notes = new Map();
  const folderSet = new Set(); // pastas existentes (diretórios reais, inclusive vazias): 'a', 'a/b'
  const folderMeta = new Map(); // pasta → configuração (.folder.json): só pastas que têm algo configurado
  let historyGap = historyGapMs;
  let viewed = []; // [{ id, at }]
  let loadErrors = [];

  const all = () => [...notes.values()];
  const changed = (type, id) => broadcast({ type, id });

  // Mutações em fila: um auto-save em voo nunca recria o caminho antigo no meio de um rename/mover.
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  /** Registra a pasta e todos os pais dela. */
  const addFolder = (p) => { for (let f = normFolder(p); f; f = parentOf(f)) folderSet.add(f); };
  /**
   * Chaves pelas quais [[links]] encontram a nota: título exibido e aliases, e também a forma com a pasta
   * ("Trabalho/Fluig/Título") — é como se escolhe uma entre notas de mesmo título em pastas diferentes.
   */
  const linkKeys = (n) => {
    const base = [displayTitle(n), ...(n.aliases || [])].map((s) => normalize(s).trim()).filter(Boolean);
    const f = normalize(folderOf(n.file)).trim();
    return f ? [...base, ...base.map((k) => f + '/' + k)] : base;
  };
  /** chave de link → id — mesmo critério (e precedência) de resolveLink. */
  const titleIndex = () => {
    const m = new Map();
    for (const n of notes.values()) for (const k of linkKeys(n)) if (!m.has(k)) m.set(k, n.id);
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
      if (!force && Date.now() - lastSnap.get(prev.id) < historyGap) return;
      await store.snapshot(prev);
      lastSnap.set(prev.id, Date.now());
    } catch (e) { console.error('[notes] histórico', e); } // falhar aqui nunca impede de salvar a nota
  }
  const trashed = new Map(); // id → arquivo em .trash da última exclusão (desfazer apaga a cópia)

  /** Pasta existente com esse nome na raiz, sem diferenciar maiúsculas/acentos ("templates" serve para "Templates"). */
  const rootFolderLike = (name) => [...folderSet].find((f) => !f.includes('/') && normalize(f) === normalize(name)) || null;
  /** A nota está na pasta Templates (ou numa subpasta dela)? */
  const isTemplate = (n) => isTemplateFolder(folderOf(n.file));
  /** Valida uma pasta de destino existente ('' = raiz); devolve o caminho normalizado. */
  function existingFolder(p) {
    const f = normFolder(p);
    if (f) { const e = validFolderPath(f); if (e) err(e); if (!folderSet.has(f)) err('A pasta não existe.'); }
    return f;
  }

  /** Grava a configuração de uma pasta no disco e na memória (vazia = sem `.folder.json`). */
  async function writeMeta(p, meta) {
    await store.writeMeta(p, meta);
    if (Object.keys(meta).length) folderMeta.set(p, meta); else folderMeta.delete(p);
  }
  /** Pasta existente com esse caminho, sem diferenciar maiúsculas (o Windows trata `Docs` e `docs` como a mesma). */
  const existingCI = (p) => [...folderSet].find((f) => f.toLowerCase() === p.toLowerCase()) || null;

  /**
   * Junta o conteúdo da pasta `from` na pasta existente `into`: subpastas são unidas pelo nome, notas mudam de
   * lugar (nome repetido vira " (2)"), a configuração do destino vence e a pasta de origem some.
   */
  async function mergeInto(from, into) {
    const dirs = [...folderSet].filter((f) => f === from || f.startsWith(from + '/')).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const dest = new Map([[from, into]]);
    for (const d of dirs) {
      if (d !== from) {
        const cand = joinPath(dest.get(parentOf(d)), baseName(d));
        let ex = existingCI(cand);
        if (!ex) { await store.mkdir(cand); addFolder(cand); ex = cand; }
        dest.set(d, ex);
      }
      const m = folderMeta.get(d);
      if (m && !folderMeta.has(dest.get(d))) { const { pinned, order, ...keep } = m; await writeMeta(dest.get(d), sanitizeMeta(keep)); }
    }
    for (const n of [...notes.values()]) {
      const nf = folderOf(n.file || '');
      if (nf !== from && !isDescendant(nf, from)) continue;
      const rel = await store.move(n, joinPath(dest.get(nf), baseName(n.file)));
      notes.set(n.id, { ...n, file: rel });
    }
    for (const d of [...dirs].reverse()) if (await store.rmdir(d)) { folderSet.delete(d); folderMeta.delete(d); }
    changed('folders');
    return into;
  }

  /**
   * Renomeia/move o diretório `from` para `to` e ajusta pastas e notas em memória. Com `merge`, se já existe uma
   * pasta com esse nome no destino, junta as duas. Devolve o caminho final.
   */
  async function relocate(from, to, { merge = false } = {}) {
    if (!folderSet.has(from)) err('A pasta não existe.');
    if (from === to) return to;
    if (merge && from.toLowerCase() !== to.toLowerCase()) { const ex = existingCI(to); if (ex) return mergeInto(from, ex); }
    await store.renameDir(from, to);
    const re = (p) => to + p.slice(from.length);
    for (const f of [...folderSet]) if (f === from || f.startsWith(from + '/')) { folderSet.delete(f); folderSet.add(re(f)); }
    for (const [f, m] of [...folderMeta]) if (f === from || f.startsWith(from + '/')) { folderMeta.delete(f); folderMeta.set(re(f), m); } // o .folder.json foi junto com o diretório
    for (const n of [...notes.values()]) if (n.file && n.file.startsWith(from + '/')) notes.set(n.id, { ...n, file: re(n.file) });
    changed('folders');
    return to;
  }

  return {
    dir,
    store,

    async init() {
      const { notes: list, errors, folders, meta } = await store.loadAll();
      loadErrors = errors;
      folderSet.clear();
      folderMeta.clear();
      for (const f of folders || []) addFolder(f);
      for (const [f, m] of Object.entries(meta || {})) folderMeta.set(f, m);
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
        if (f && folderSet.has(f)) {
          next.file = f + '/' + next.id + '.md';
          // Tags padrão da pasta entram em toda nota nova dela (sem duplicar as que já vieram).
          const dflt = (folderMeta.get(f) || {}).tags || [];
          if (dflt.length) next.tags = [...new Set([...(next.tags || []).map(cleanTag), ...dflt])];
        }
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

    /* ─────────────── Templates ─────────────── */

    /** Pasta na raiz com esse nome (a existente, mesmo com outra grafia; senão cria). Devolve o caminho. */
    async ensureRootFolder(name) {
      return rootFolderLike(name) || this.createFolder(name);
    },

    /** Templates (notas da pasta Templates): [{ id, title, folder, preview, tags }], por título. */
    templates() {
      return [...notes.values()].filter(isTemplate).map(summary)
        .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    },

    /**
     * Cria uma nota a partir do template `id` (variáveis trocadas) na pasta `folder` ('' = raiz; dentro
     * de Templates cai na raiz). O título só vem do template se ele usar variáveis ("Chamado {{data}}").
     * → { note, cursor } — cursor = posição de {{cursor}} no conteúdo (ou null).
     */
    async fromTemplate(id, { folder = '' } = {}) {
      const t = notes.get(id);
      if (!t || !isTemplate(t)) err('Template não encontrado.');
      const vars = templateVars(new Date());
      const title = /\{\{/.test(t.title || '') ? applyTemplate(t.title, vars).text.trim() : '';
      const { text, cursor } = applyTemplate(t.content, { ...vars, titulo: title });
      let dest = normFolder(folder);
      if (dest && (!folderSet.has(dest) || isTemplate({ file: dest + '/x.md' }))) dest = '';
      const note = await this.create({
        title, content: text, type: t.type, folder: dest,
        tags: (t.tags || []).filter((x) => normalize(x) !== 'template'),
      });
      if (!note) err('O template está vazio.');
      return { note, cursor };
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

    /** Quantas notas há na lixeira (contador da lateral). */
    trashCount: () => store.countTrash(),

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
    restoreFromTrash(file) { return serial(() => this._restoreFromTrash(file)); },

    async _restoreFromTrash(file) {
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
      for (const n of notes.values()) if (linkKeys(n).includes(t)) return n.id;
      return null;
    },

    tags() {
      const count = new Map();
      for (const n of notes.values()) for (const t of allTags(n)) count.set(t, (count.get(t) || 0) + 1);
      return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, n]) => ({ tag, count: n }));
    },

    /* ─────────────── Links entre notas ─────────────── */

    /**
     * Grafo das notas para o painel Grafo: { nodes, links } (ver src/notes/graph.js).
     * Templates ficam de fora; [[links]] para notas inexistentes viram nós "fantasma".
     */
    graph() {
      const list = [...notes.values()].map((n) => ({
        id: n.id, title: displayTitle(n), folder: folderOf(n.file), type: n.type, tags: allTags(n), content: n.content,
      }));
      return buildGraph(list, titleIndex(), (n) => isTemplateFolder(n.folder));
    },

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

    /**
     * Todas as pastas (inclusive vazias): [{ path, count, ...configuração }] — count = notas diretas;
     * a configuração (color, icon, template, tags, sort, pinned, order) só aparece nas pastas que a têm.
     */
    folders() {
      const count = new Map();
      for (const n of notes.values()) { const f = folderOf(n.file); count.set(f, (count.get(f) || 0) + 1); }
      return [...folderSet].sort().map((path) => ({ path, count: count.get(path) || 0, ...(folderMeta.get(path) || {}) }));
    },

    /** Caminho absoluto de uma pasta existente (para abrir no Explorer / copiar o caminho). */
    folderAbs(path) {
      const p = existingFolder(path);
      return p ? store.resolveIn(p) : dir;
    },

    /**
     * Altera a configuração da pasta com um patch ({ campo: valor | null }; null remove). Devolve a configuração final.
     * `template` precisa ser o id de uma nota da pasta Templates.
     */
    setFolderMeta(path, patch) {
      return serial(async () => {
        const p = existingFolder(path);
        if (!p) err('Escolha uma pasta.');
        if (isTemplateFolder(p)) err('A pasta Templates não tem configuração própria.');
        const clean = { ...(patch || {}) };
        if (clean.template) { const t = notes.get(clean.template); if (!t || !isTemplate(t)) err('Esse template não existe mais.'); }
        const next = mergeMeta(folderMeta.get(p), clean);
        await writeMeta(p, next);
        changed('folders');
        return next;
      });
    },

    /**
     * Sobe (-1) ou desce (+1) a pasta entre as irmãs. A ordem passa a ser manual para todas as irmãs
     * (cada uma ganha uma posição). Devolve false se já está na ponta.
     */
    moveFolderOrder(path, delta) {
      return serial(async () => {
        const p = existingFolder(path);
        if (!p) err('Escolha uma pasta.');
        const sibs = siblingsOf(buildTree(this.folders()), p).map((s) => s.path);
        const at = sibs.indexOf(p), to = at + (delta < 0 ? -1 : 1);
        if (at === -1 || to < 0 || to >= sibs.length) return false;
        [sibs[at], sibs[to]] = [sibs[to], sibs[at]];
        for (let i = 0; i < sibs.length; i++) await writeMeta(sibs[i], mergeMeta(folderMeta.get(sibs[i]), { order: i + 1 }));
        changed('folders');
        return true;
      });
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

    /**
     * Renomeia a pasta (só o último segmento). Devolve o novo caminho. Se já existe uma pasta com esse nome,
     * recusa — a menos que `merge`, que junta as duas (ver `folderClash`).
     */
    renameFolder(path, newName, { merge = false } = {}) {
      return serial(async () => {
        const from = existingFolder(path);
        if (!from) err('Escolha uma pasta.');
        const e = validFolderName(newName);
        if (e) err(e);
        return relocate(from, joinPath(parentOf(from), newName), { merge });
      });
    },

    /** Move a pasta (com tudo dentro) para dentro de `newParent` ('' = raiz). Devolve o novo caminho. `merge` junta com uma de mesmo nome. */
    moveFolder(path, newParent, { merge = false } = {}) {
      return serial(async () => {
        const from = existingFolder(path);
        if (!from) err('Escolha uma pasta.');
        const parent = existingFolder(newParent);
        if (parent === from || isDescendant(parent, from)) err('Não dá para mover uma pasta para dentro dela mesma.');
        return relocate(from, joinPath(parent, baseName(from)), { merge });
      });
    },

    /**
     * A pasta que seria criada ao renomear/mover `path` para `newParent` (ou com `newName`) já existe?
     * Devolve o caminho da pasta existente (a que seria mesclada) ou null. Mudar só a caixa do nome não conta.
     */
    folderClash(path, { newParent, newName } = {}) {
      const from = normFolder(path);
      const to = joinPath(newParent != null ? normFolder(newParent) : parentOf(from), newName != null ? newName : baseName(from));
      if (!from || to.toLowerCase() === from.toLowerCase()) return null;
      return existingCI(to);
    },

    /**
     * Copia a pasta inteira (subpastas, notas com ids novos e configuração, menos "fixada" e posição) para uma
     * irmã "Nome (cópia)". Devolve o caminho da cópia.
     */
    duplicateFolder(path) {
      return serial(async () => {
        const p = existingFolder(path);
        if (!p) err('Escolha uma pasta.');
        const parent = parentOf(p);
        const name = copyName(baseName(p), [...folderSet].filter((f) => parentOf(f) === parent).map(baseName));
        const e = validFolderName(name);
        if (e) err(e);
        const to = joinPath(parent, name);
        const re = (f) => to + f.slice(p.length);
        const dirs = [...folderSet].filter((f) => f === p || f.startsWith(p + '/')).sort((a, b) => a.split('/').length - b.split('/').length);
        for (const d of dirs) {
          await store.mkdir(re(d));
          addFolder(re(d));
          const m = folderMeta.get(d);
          if (m) { const { pinned, order, ...keep } = m; if (Object.keys(keep).length) await writeMeta(re(d), keep); }
        }
        for (const n of [...notes.values()]) {
          if (!inFolder(n, p)) continue;
          const { id, file, ...fields } = n;
          const copy = createNote(fields);
          copy.file = re(file);
          if (n.extra) copy.extra = n.extra;
          await store.write(copy);
          notes.set(copy.id, copy);
        }
        changed('folders');
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
     * Exclui a pasta: as notas vão para .trash\ (mantendo a estrutura e a configuração da pasta) e os diretórios
     * vazios somem. Devolve { notes, folders, meta, kept } para desfazer com restoreFolder — `kept` são as pastas
     * que continuam no disco porque têm arquivos que não são notas.
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
        const removed = [], kept = [], meta = {};
        for (const f of dirs) {
          const m = folderMeta.get(f);
          if (await store.rmdir(f)) {
            folderSet.delete(f); folderMeta.delete(f); removed.push(f);
            if (m) { meta[f] = m; await store.trashMeta(f, m).catch(() => {}); }
          } else kept.push(f);
        }
        changed('folders');
        return { notes: snapshots, folders: removed.sort(), meta, kept: kept.sort() };
      });
    },

    /** Desfaz removeFolder: recria as pastas (com a configuração) e regrava as notas. */
    restoreFolder(snap) {
      return serial(async () => {
        if (!snap) return false;
        for (const f of snap.folders || []) {
          if (validFolderPath(f)) continue;
          await store.mkdir(f).catch(() => {}); // já existir não é problema
          addFolder(f);
          const m = sanitizeMeta((snap.meta || {})[f]);
          if (Object.keys(m).length) await writeMeta(f, m);
          await store.dropTrashMeta(f).catch(() => {});
        }
        for (const note of snap.notes || []) await this._restore(note);
        changed('folders');
        return true;
      });
    },

    /** Pastas excluídas que ainda têm notas na lixeira: [{ path, notes }] (só as de nível mais alto). */
    async trashFolders() {
      const items = await store.listTrash();
      const count = new Map();
      for (const t of items) if (t.folder) count.set(t.folder, (count.get(t.folder) || 0) + 1);
      const paths = [...count.keys()];
      // sobe até a pasta mais alta que não existe mais no disco
      const top = new Map();
      for (const f of paths) {
        let root = f;
        for (let c = parentOf(f); c && !folderSet.has(c); c = parentOf(c)) root = c;
        top.set(root, (top.get(root) || 0) + count.get(f));
      }
      return [...top].map(([path, notes]) => ({ path, notes })).sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
    },

    /**
     * Restaura da lixeira a pasta `path` inteira: subpastas, configuração e todas as notas que estavam nela.
     * Devolve { folder, notes } (quantas notas voltaram).
     */
    restoreFolderFromTrash(path) {
      return serial(async () => {
        const p = normFolder(path);
        const e = validFolderPath(p);
        if (!p || e) err(e || 'Escolha uma pasta.');
        const items = (await store.listTrash()).filter((t) => t.folder === p || isDescendant(t.folder, p));
        const dirs = new Set([p]);
        for (const t of items) for (let f = t.folder; f && (f === p || isDescendant(f, p)); f = parentOf(f)) dirs.add(f);
        const trashDirs = await store.listTrashDirs();
        for (const f of trashDirs) if (f === p || isDescendant(f, p)) dirs.add(f);
        if (!items.length && !trashDirs.includes(p)) err('Essa pasta não está na lixeira.');
        for (const f of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length)) {
          if (!folderSet.has(f)) { await store.mkdir(f).catch(() => {}); addFolder(f); }
          const m = await store.readTrashMeta(f);
          if (Object.keys(m).length && !folderMeta.has(f)) await writeMeta(f, m);
        }
        let restored = 0;
        for (const t of items) { await this._restoreFromTrash(t.file); restored++; }
        for (const f of dirs) await store.dropTrashMeta(f).catch(() => {});
        changed('folders');
        return { folder: p, notes: restored };
      });
    },

    /** Ajusta limites em uso: { historyGapMs (intervalo entre versões), historyMax (versões por nota) }. */
    configure({ historyGapMs: gap, historyMax: max } = {}) {
      if (Number.isFinite(gap) && gap >= 0) historyGap = gap;
      store.configure({ historyMax: max });
    },

    /**
     * Tarefas de todas as notas (fora de código): [{ noteId, noteTitle, index, line, text, checked, due, priority, tags }].
     * filter: { status: 'open' (padrão) | 'done' | 'all', tag }. Ordem: vencimento, prioridade, nota mais recente.
     */
    tasks({ status = 'open', tag } = {}) {
      const out = [];
      for (const n of notes.values()) {
        if (n.type === 'snippet' || isTemplate(n)) continue; // "- [ ]" de um template é modelo, não tarefa
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
    // Lê e grava dentro da fila (serial): duas edições seguidas da mesma nota (marcar + capturar) não se sobrescrevem.
    toggleTask(id, index) {
      return serial(async () => {
        const n = notes.get(id);
        if (!n) throw new Error('Nota não encontrada');
        const content = toggleTaskAt(n.content, index);
        if (content === n.content) return this.get(id);
        return this._save({ id, content });
      });
    },

    /** Captura rápida: acrescenta "- [ ] texto" à nota "Inbox" (criada se não existir). */
    async appendTask(text) {
      const line = expandDueWords(String(text || '').replace(/\s*\n\s*/g, ' ').trim());
      if (!line) throw new Error('Tarefa vazia');
      const item = '- [ ] ' + line;
      return serial(async () => {
        const id = this.resolveLink(INBOX_TITLE);
        const prev = id && notes.get(id);
        if (!prev) return this._save(createNote({ title: INBOX_TITLE, content: item + '\n' }));
        const body = String(prev.content || '');
        const sep = !body || body.endsWith('\n') ? '' : '\n';
        return this._save({ id: prev.id, content: body + sep + item + '\n' });
      });
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
