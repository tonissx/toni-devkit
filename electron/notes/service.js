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
const { createNote, displayTitle, allTags, plainLine } = require('../../src/notes/note.js');
const { searchNotes } = require('../../src/notes/search.js');
const { normalize } = require('../../src/commands/search.js');

const EDITABLE = ['title', 'content', 'type', 'tags', 'aliases', 'pinned', 'favorite', 'quick', 'source'];
const VIEWED_MAX = 20;

/** Resumo leve para listas (sem o conteúdo inteiro). */
function summary(n) {
  const preview = String(n.content || '').replace(/^(```|~~~).*$/gm, '').split('\n').map(plainLine).filter(Boolean).join(' · ');
  return {
    id: n.id, title: displayTitle(n), rawTitle: n.title, type: n.type, tags: allTags(n),
    pinned: n.pinned, favorite: n.favorite, quick: n.quick, created: n.created, updated: n.updated,
    preview: preview.length > 160 ? preview.slice(0, 159) + '…' : preview,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function createNotesService({ dir, broadcast = () => {} }) {
  const store = createStore(dir);
  const notes = new Map();
  let viewed = []; // [{ id, at }]
  let loadErrors = [];

  const all = () => [...notes.values()];
  const changed = (type, id) => broadcast({ type, id });

  return {
    dir,
    store,

    async init() {
      const { notes: list, errors } = await store.loadAll();
      loadErrors = errors;
      for (const n of list) {
        const prev = notes.get(n.id);
        // Dois arquivos com o mesmo id (cópia manual): mantém o mais recente e avisa.
        if (prev) {
          loadErrors.push({ file: n.file, error: `id duplicado (${n.id}) — mantido o mais recente` });
          if (String(prev.updated) >= String(n.updated)) continue;
        }
        notes.set(n.id, n);
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
      return n ? { ...n, tagsAll: allTags(n) } : null;
    },

    /**
     * Cria ou atualiza. Só os campos editáveis vêm do renderer; id/created/file/extra são preservados.
     * Nota nova e vazia não é gravada (Quick Note aberta e fechada sem digitar).
     */
    async save(input) {
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
      if (base.extra) next.extra = base.extra;
      if (prev && EDITABLE.every((k) => same(prev[k], next[k]))) return this.get(prev.id);
      next.updated = new Date().toISOString();
      if (!next.file) next.file = next.id + '.md';
      await store.write(next); // falhou → erro para o renderer (que mantém o texto e tenta de novo)
      notes.set(next.id, next);
      changed('saved', next.id);
      return this.get(next.id);
    },

    /** API para ferramentas/palette: cria uma nota nova com os campos dados. */
    create(partial = {}) {
      const { id, ...fields } = partial; // sempre um id novo
      return this.save(createNote(fields));
    },

    async remove(id) {
      const n = notes.get(id);
      if (!n) return false;
      await store.trash(n);
      notes.delete(id);
      viewed = viewed.filter((v) => v.id !== id);
      changed('removed', id);
      return true;
    },

    /** Desfazer exclusão: grava de novo a nota (o arquivo da lixeira fica como cópia). */
    async restore(note) {
      if (!note || !note.id) return null;
      const n = createNote({ ...note });
      n.file = note.file || n.id + '.md';
      await store.write(n);
      notes.set(n.id, n);
      changed('saved', n.id);
      return this.get(n.id);
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

    flush: () => store.flush(),
  };
}

module.exports = { createNotesService, summary };
