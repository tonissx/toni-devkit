import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, recoverUnsaved, shortTime, cleanError } from '../../notes/client.js';
import { createNote } from '../../notes/note.js';
import { normalize } from '../../commands/search.js';
import { NoteEditor } from './NoteEditor.jsx';
import { TasksPanel } from './TasksPanel.jsx';
import { FolderTree, NOTE_DRAG } from './FolderTree.jsx';
import { NameModal, DeleteFolderModal, MoveNoteModal } from './FolderDialogs.jsx';
import { buildTree, flattenTree, joinPath, baseName, isDescendant } from '../../notes/folders.js';
import { emit } from '../../lib/events.js';

const { PageHeader, Button, EmptyState, Icon, Kbd, Spinner, ContextMenu } = DS;

const FILTERS = [
  { id: 'all', label: 'Todas', filter: null },
  { id: 'quick', label: 'Quick', filter: { quick: true } },
  { id: 'pinned', label: 'Pinned', filter: { pinned: true } },
  { id: 'snippet', label: 'Snippets', filter: { type: 'snippet' } },
  { id: 'favorite', label: 'Favoritas', filter: { favorite: true } },
  { id: 'recent', label: 'Recentes', filter: null },
  { id: 'tasks', label: 'Tarefas', filter: null }, // painel próprio (TasksPanel) no lugar do editor
];

/** Caminho de pasta depois de `from` virar `to` (a própria pasta ou qualquer subpasta). */
const remapFolder = (p, from, to) => (p === from ? to : p != null && isDescendant(p, from) ? to + p.slice(from.length) : p);

const rowIcon = (n) => (n.type === 'snippet' ? 'braces' : n.quick ? 'sticky-note' : 'file-text');

function Hl({ text, idx }) {
  if (!idx || !idx.length) return text;
  const set = new Set(idx);
  return [...text].map((c, i) => (set.has(i) ? <mark key={i} className="tk-hl">{c}</mark> : c));
}

function Excerpt({ ex, fallback }) {
  if (!ex) return fallback || null;
  const out = [];
  let pos = 0;
  ex.ranges.forEach(([s, e], k) => {
    if (s < pos) return;
    out.push(ex.text.slice(pos, s), <mark key={k} className="tk-hl">{ex.text.slice(s, e)}</mark>);
    pos = e;
  });
  out.push(ex.text.slice(pos));
  return out;
}

export function NotesScreen({ toast, request }) {
  const [ui, setUi] = usePersisted('notes.ui', { selectedId: null, mode: 'edit', filter: 'all', tag: null });
  const [query, setQuery] = React.useState('');
  const [rows, setRows] = React.useState(null);        // null = carregando
  const [recent, setRecent] = React.useState(null);
  const [allRows, setAllRows] = React.useState([]);     // todas (para resolver [[links]] e contar)
  const [tags, setTags] = React.useState([]);
  const [info, setInfo] = React.useState(null);
  const [current, setCurrent] = React.useState(null);  // { note, isNew, focus }
  const [loadError, setLoadError] = React.useState(null);
  const [deleted, setDeleted] = React.useState(null);  // última exclusão para desfazer: { kind: 'note'|'folder', snap, label }
  const [folders, setFolders] = React.useState([]);     // [{ path, count }] (diretórios reais, inclusive vazios)
  const [foldersUi, setFoldersUi] = usePersisted('notes.folders', { open: {} });
  const [dialog, setDialog] = React.useState(null);      // { kind: 'create'|'rename'|'delete'|'move', … }
  const [ctxMenu, setCtxMenu] = React.useState(null);    // { x, y, kind: 'folder'|'note', path?, note? }
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);

  const filterDef = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  const folderSel = typeof ui.folder === 'string' ? ui.folder : null; // null = todas as pastas · '' = sem pasta
  const filter = { ...(filterDef.filter || {}), ...(ui.tag ? { tag: ui.tag } : {}), ...(folderSel != null ? { folder: folderSel } : {}) };
  const q = query.trim();

  const refresh = React.useCallback(async () => {
    try {
      const api = notesApi();
      const flt = Object.keys(filter).length ? filter : undefined;
      const [list, all, tg, inf, rec, fld] = await Promise.all([
        q ? api.search(q, { filter: flt, limit: 200 }) : api.list(flt),
        api.list(),
        api.tags(),
        api.info(),
        ui.filter === 'recent' ? api.recent() : null,
        api.folders(),
      ]);
      setRows(list); setAllRows(all); setTags(tg); setInfo(inf); setRecent(rec); setFolders(fld); setLoadError(null);
      // A pasta selecionada deixou de existir (apagada ou renomeada): volta para "todas".
      if (typeof ui.folder === 'string' && ui.folder !== '' && !fld.some((f) => f.path === ui.folder)) setUi((u) => ({ ...u, folder: null }));
    } catch (e) {
      setLoadError(cleanError(e));
      setRows([]);
    }
  }, [q, ui.filter, ui.tag, ui.folder]);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    let t = null;
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);

  const titleMap = React.useMemo(() => new Map(allRows.map((r) => [normalize(r.title), r.id])), [allRows]);
  const resolve = React.useCallback((title) => titleMap.get(normalize(title).trim()) || null, [titleMap]);

  // Abrir/criar uma nota sai do painel Tarefas (que ocupa o lugar do editor).
  const leaveTasks = (u) => (u.filter === 'tasks' ? { ...u, filter: 'all' } : u);

  const openNote = React.useCallback(async (id, focus) => {
    const note = await notesApi().get(id);
    if (!note) { toast('Nota não encontrada', 'Ela pode ter sido excluída', 'error'); return; }
    setCurrent({ note, isNew: false, focus });
    setUi((u) => ({ ...leaveTasks(u), selectedId: id }));
  }, []);

  const newNote = React.useCallback((title = '') => {
    // Dentro da pasta selecionada (a nota só vai para o disco quando tiver conteúdo).
    const note = createNote({ title, ...(folderSel ? { folder: folderSel } : {}) });
    setCurrent({ note, isNew: true, focus: title ? 'body' : 'title' });
    setUi((u) => ({ ...leaveTasks(u), selectedId: note.id }));
  }, [folderSel]);

  // Abertura: recupera alterações que ficaram só no backup local e reabre a última nota.
  React.useEffect(() => {
    recoverUnsaved().then((n) => { if (n) toast('Alterações recuperadas', n + ' nota(s) salvas do backup local'); refresh(); });
    if (ui.selectedId && !request) openNote(ui.selectedId).catch(() => {});
  }, []);

  // Pedidos vindos da palette / de outras ferramentas: abrir nota X ou criar uma nova.
  React.useEffect(() => {
    if (!request) return;
    if (request.new) newNote(request.title || '');
    else if (request.id) openNote(request.id);
    else if (request.view === 'tasks') setUi((u) => ({ ...u, filter: 'tasks' }));
  }, [request && request.nonce]);

  const openLink = async (title) => {
    const id = await notesApi().resolveLink(title);
    if (id) openNote(id); else { newNote(title); emit('note.linked'); }
  };

  // Barra de desfazer (8 s) para a última exclusão: nota ou pasta.
  const armUndo = (d) => { setDeleted(d); setTimeout(() => setDeleted((x) => (x === d ? null : x)), 8000); };

  const remove = async (note) => {
    try {
      const snap = await notesApi().get(note.id);
      await notesApi().remove(note.id);
      armUndo({ kind: 'note', snap, label: 'Nota excluída (movida para .trash)' });
      setCurrent(null);
      setUi((u) => ({ ...u, selectedId: null }));
    } catch (e) { toast('Erro ao excluir', cleanError(e), 'error'); }
  };
  const undoDelete = async () => {
    const d = deleted;
    setDeleted(null);
    if (!d) return;
    try {
      if (d.kind === 'folder') await notesApi().restoreFolder(d.snap);
      else { await notesApi().restore(d.snap); openNote(d.snap.id); }
    } catch (e) { toast('Erro ao desfazer', cleanError(e), 'error'); }
  };

  /* ─────────────── Pastas ─────────────── */
  const guard = async (fn) => { try { await fn(); } catch (e) { toast('Não foi possível concluir', cleanError(e), 'error'); } };
  const selectFolder = (path) => setUi((u) => ({ ...leaveTasks(u), folder: path }));
  const expand = (path) => path && setFoldersUi((f) => ({ ...f, open: { ...f.open, [path]: true } }));
  const toggleOpen = (path) => setFoldersUi((f) => ({ ...f, open: { ...f.open, [path]: !f.open[path] } }));
  // Depois de renomear/mover `from` → `to`: a seleção e as pastas abertas acompanham.
  const followRename = (from, to) => {
    setUi((u) => ({ ...u, folder: remapFolder(typeof u.folder === 'string' ? u.folder : null, from, to) }));
    setFoldersUi((f) => ({ ...f, open: Object.fromEntries(Object.entries(f.open).map(([k, v]) => [remapFolder(k, from, to), v])) }));
  };
  const moveNoteTo = (id, folder) => guard(async () => {
    await notesApi().moveNote(id, folder);
    toast('Nota movida', folder ? 'para ' + folder : 'para “Sem pasta”');
  });
  const moveFolderTo = (path, parent) => guard(async () => {
    const to = await notesApi().moveFolder(path, parent);
    followRename(path, to);
    expand(parent);
  });
  const folderStats = (path) => {
    const inside = folders.filter((f) => f.path === path || isDescendant(f.path, path));
    return { notes: inside.reduce((s, f) => s + f.count, 0), subfolders: inside.length - 1 };
  };
  const deleteFolder = (path) => guard(async () => {
    const snap = await notesApi().removeFolder(path);
    armUndo({ kind: 'folder', snap, label: `Pasta “${baseName(path)}” excluída (${snap.notes.length} ${snap.notes.length === 1 ? 'nota' : 'notas'} em .trash)` });
    if (current && snap.notes.some((n) => n.id === current.note.id)) { setCurrent(null); setUi((u) => ({ ...u, selectedId: null })); }
    setUi((u) => (typeof u.folder === 'string' && (u.folder === path || isDescendant(u.folder, path)) ? { ...u, folder: null } : u));
  });

  const folderMenu = (path) => [
    { id: 'sub', icon: 'folder-plus', label: 'Nova subpasta' },
    { id: 'rename', icon: 'pencil', label: 'Renomear…' },
    { separator: true },
    { id: 'delete', icon: 'trash-2', label: 'Excluir…', danger: true },
  ];
  const noteMenu = (n) => [
    { id: 'move', icon: 'folder-input', label: 'Mover para…' },
    { id: 'pin', icon: 'pin', label: n.pinned ? 'Desafixar' : 'Fixar (Pinned)' },
    { separator: true },
    { id: 'delete', icon: 'trash-2', label: 'Excluir', danger: true },
  ];
  const onMenuSelect = (item) => {
    const c = ctxMenu;
    setCtxMenu(null);
    if (!c) return;
    if (c.kind === 'folder') {
      if (item.id === 'sub') setDialog({ kind: 'create', parent: c.path });
      else if (item.id === 'rename') setDialog({ kind: 'rename', path: c.path });
      else if (item.id === 'delete') setDialog({ kind: 'delete', path: c.path });
    } else if (item.id === 'move') setDialog({ kind: 'move', note: c.note });
    else if (item.id === 'pin') guard(() => notesApi().save({ id: c.note.id, pinned: !c.note.pinned }));
    else if (item.id === 'delete') remove(c.note);
  };

  const folderOptions = React.useMemo(
    () => flattenTree(buildTree(folders)).map((f) => ({ value: f.path, label: '  '.repeat(f.depth) + f.name, icon: 'folder' })),
    [folders]);
  const rootCount = allRows.filter((r) => !r.folder).length;

  // Lista exibida (agrupada) e a ordem plana para navegar com ↑/↓.
  const groups = React.useMemo(() => {
    if (!rows) return [];
    if (ui.filter === 'recent' && !q && recent) {
      return [
        { title: 'Recently Edited', items: recent.edited.map((r) => ({ ...r, time: r.updated })) },
        { title: 'Recently Viewed', items: recent.viewed.map((r) => ({ ...r, time: r.viewedAt })) },
      ].filter((g) => g.items.length);
    }
    if (q || ui.filter !== 'all' || ui.tag || folderSel != null) return [{ title: null, items: rows.map((r) => ({ ...r, time: r.updated })) }];
    const pinned = rows.filter((r) => r.pinned);
    return [
      pinned.length && { title: '📌 Pinned', items: pinned.map((r) => ({ ...r, time: r.updated })) },
      { title: pinned.length ? 'Todas' : null, items: rows.filter((r) => !r.pinned).map((r) => ({ ...r, time: r.updated })) },
    ].filter((g) => g && g.items.length);
  }, [rows, recent, q, ui.filter, ui.tag, folderSel]);
  const flat = groups.flatMap((g) => g.items);

  const moveSel = (dir) => {
    if (!flat.length) return;
    const i = flat.findIndex((r) => r.id === ui.selectedId);
    const next = flat[Math.max(0, Math.min(flat.length - 1, i === -1 ? 0 : i + dir))];
    openNote(next.id);
  };
  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.nts-row.is-sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [ui.selectedId]);

  // Atalhos: Ctrl/⌘+N nova · Ctrl/⌘+F ou / buscar
  React.useEffect(() => {
    const h = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (isMod(e) && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if ((isMod(e) && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const noNotesAtAll = info && info.count === 0 && !current;

  return (
    <div className="nts-screen">
      <PageHeader
        icon="notebook-pen"
        title="Notes"
        subtitle="Sua memória técnica — Markdown, snippets e busca. Capture com Ctrl+Alt+Space → Alt+Q"
        actions={<>
          <Button variant="secondary" icon="folder-open" onClick={() => notesApi().openFolder()}>Abrir pasta</Button>
          <Button variant="primary" icon="plus" kbd={mod('N')} onClick={() => newNote()}>Nova nota</Button>
        </>}
      />
      <div className="nts">
        <aside className="nts__side">
          <label className="tk-input tk-input--sm nts-search">
            <Icon name="search" size={14} className="tk-input__icon" />
            <input
              ref={searchRef}
              value={query}
              placeholder="Buscar em títulos, conteúdo, tags…"
              aria-label="Buscar notas"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); }
                else if (e.key === 'Enter') { e.preventDefault(); if (!current && flat[0]) openNote(flat[0].id, 'body'); else document.querySelector('.nts-body') && document.querySelector('.nts-body').focus(); }
                else if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
              }}
            />
            <Kbd size="sm">/</Kbd>
          </label>
          <div className="nts-filters" role="toolbar" aria-label="Filtros">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={'nts-chip' + (ui.filter === f.id ? ' is-on' : '')} aria-pressed={ui.filter === f.id}
                onClick={() => setUi((u) => ({ ...u, filter: f.id }))}>{f.label}</button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="nts-tagcloud" aria-label="Tags">
              {tags.slice(0, 16).map((t) => (
                <button key={t.tag} type="button" className={'nts-chip is-tag' + (ui.tag === t.tag ? ' is-on' : '')} aria-pressed={ui.tag === t.tag}
                  onClick={() => setUi((u) => ({ ...u, tag: u.tag === t.tag ? null : t.tag }))}>#{t.tag}<span>{t.count}</span></button>
              ))}
            </div>
          )}
          <FolderTree
            folders={folders}
            rootCount={rootCount}
            selected={folderSel}
            open={foldersUi.open || {}}
            onSelect={selectFolder}
            onToggle={toggleOpen}
            onCreate={(parent) => setDialog({ kind: 'create', parent })}
            onContext={(path, x, y) => setCtxMenu({ x, y, kind: 'folder', path })}
            onDropNote={moveNoteTo}
            onDropFolder={moveFolderTo}
          />

          <div ref={listRef} className="nts-list tk-scroll" role="listbox" aria-label="Notas">
            {rows === null && <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>}
            {loadError && <div className="nts-list__msg is-error">Erro ao ler as notas: {loadError}</div>}
            {rows && !loadError && flat.length === 0 && (
              q ? <div className="nts-list__msg"><b>Nenhuma nota para “{q}”.</b><br />Tente outro termo.</div>
                : noNotesAtAll ? <div className="nts-list__msg">Nenhuma nota ainda.</div>
                : <div className="nts-list__msg">Nada neste filtro.</div>
            )}
            {groups.map((g, gi) => (
              <div key={gi} role="group" aria-label={g.title || 'Notas'}>
                {g.title && <div className="tk-menu__heading">{g.title}</div>}
                {g.items.map((r) => (
                  <div key={g.title + r.id} role="option" aria-selected={r.id === ui.selectedId}
                    className={'nts-row' + (r.id === ui.selectedId ? ' is-sel' : '')}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData(NOTE_DRAG, r.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'note', note: r }); }}
                    onClick={() => openNote(r.id)}>
                    <Icon name={rowIcon(r)} size={14} className="nts-row__icon" />
                    <div className="nts-row__main">
                      <div className="nts-row__title"><Hl text={r.title} idx={r.titleIdx} />{r.tasksOpen + r.tasksDone > 0 && <span className="nts-row__tasks" title="Tarefas concluídas / total">☑ {r.tasksDone}/{r.tasksOpen + r.tasksDone}</span>}</div>
                      <div className="nts-row__sub"><Excerpt ex={q ? r.excerpt : null} fallback={r.preview} /></div>
                      {(r.tags.length > 0 || (r.folder && folderSel == null)) && (
                        <div className="nts-row__tags">
                          {r.folder && folderSel == null && <span className="nts-row__folder" title={r.folder}><Icon name="folder" size={10} /> {r.folder}</span>}
                          {r.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}
                        </div>
                      )}
                    </div>
                    <span className="nts-row__time">{shortTime(r.time)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {deleted && (
            <div className="nts-undo" role="status">
              {deleted.label}
              <Button size="sm" variant="ghost" icon="undo-2" onClick={undoDelete}>Desfazer</Button>
            </div>
          )}
          <div className="nts-side__foot">
            <span>{info ? info.count + (info.count === 1 ? ' nota' : ' notas') : ''}</span>
            {info && info.errors.length > 0 && (
              <span className="nts-warn" title={info.errors.map((e) => e.file + ': ' + e.error).join('\n')}>
                <Icon name="triangle-alert" size={12} /> {info.errors.length} arquivo(s) não lidos
              </span>
            )}
          </div>
        </aside>

        <section className="nts__main">
          {ui.filter === 'tasks' ? (
            <TasksPanel tag={ui.tag} onOpen={(id) => openNote(id)} toast={toast} />
          ) : current ? (
            <NoteEditor
              key={current.note.id}
              initial={current.note}
              isNew={current.isNew}
              focus={current.focus}
              mode={ui.mode}
              setMode={(mode) => setUi((u) => ({ ...u, mode }))}
              resolve={resolve}
              onOpenLink={openLink}
              onDelete={remove}
              folderOptions={folderOptions}
              toast={toast}
            />
          ) : (
            <div className="nts-empty">
              {noNotesAtAll ? (
                <EmptyState title="Nenhuma nota ainda."
                  description="Capture sua primeira ideia com Quick Note: Ctrl+Alt+Space → Alt+Q, escreva e pronto."
                  action={<Button variant="primary" icon="plus" kbd={mod('N')} onClick={() => newNote()}>Nova nota</Button>} />
              ) : (
                <EmptyState title="Selecione uma nota" animate="none"
                  description="Use ↑/↓ na busca para navegar, ou crie uma nova."
                  action={<Button variant="secondary" icon="plus" kbd={mod('N')} onClick={() => newNote()}>Nova nota</Button>} />
              )}
            </div>
          )}
        </section>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={Math.min(ctxMenu.x, window.innerWidth - 230)}
          y={Math.min(ctxMenu.y, window.innerHeight - 190)}
          items={ctxMenu.kind === 'folder' ? folderMenu(ctxMenu.path) : noteMenu(ctxMenu.note)}
          onSelect={onMenuSelect}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {dialog && dialog.kind === 'create' && (
        <NameModal
          title={dialog.parent ? `Nova subpasta em “${baseName(dialog.parent)}”` : 'Nova pasta'}
          description={dialog.parent || undefined}
          confirmLabel="Criar"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const path = joinPath(dialog.parent, name);
            await notesApi().createFolder(path);
            expand(dialog.parent);
            selectFolder(path);
          }}
        />
      )}
      {dialog && dialog.kind === 'rename' && (
        <NameModal
          title="Renomear pasta"
          description={dialog.path}
          initial={baseName(dialog.path)}
          confirmLabel="Renomear"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => followRename(dialog.path, await notesApi().renameFolder(dialog.path, name))}
        />
      )}
      {dialog && dialog.kind === 'delete' && (
        <DeleteFolderModal
          name={baseName(dialog.path)}
          {...(() => { const s = folderStats(dialog.path); return { notes: s.notes, subfolders: s.subfolders }; })()}
          onClose={() => setDialog(null)}
          onConfirm={() => deleteFolder(dialog.path)}
        />
      )}
      {dialog && dialog.kind === 'move' && (
        <MoveNoteModal
          folders={folders}
          current={dialog.note.folder || ''}
          onClose={() => setDialog(null)}
          onPick={(f) => moveNoteTo(dialog.note.id, f)}
        />
      )}
    </div>
  );
}
