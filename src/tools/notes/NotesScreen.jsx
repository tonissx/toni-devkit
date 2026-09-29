import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, recoverUnsaved, shortTime, cleanError } from '../../notes/client.js';
import { createNote } from '../../notes/note.js';
import { normalize } from '../../commands/search.js';
import { NoteEditor } from './NoteEditor.jsx';
import { TasksPanel } from './TasksPanel.jsx';
import { TrashPanel } from './TrashPanel.jsx';
import { TemplateModal } from './TemplateModal.jsx';
import { FolderRow, useFolderDnD, NOTE_DRAG } from './FolderTree.jsx';
import { NameModal, DeleteFolderModal, MoveNoteModal } from './FolderDialogs.jsx';
import { buildTree, flattenTree, joinPath, baseName, isDescendant } from '../../notes/folders.js';
import { emit } from '../../lib/events.js';

const { PageHeader, Button, IconButton, EmptyState, Icon, Kbd, Spinner, ContextMenu } = DS;

const FILTERS = [
  { id: 'all', label: 'Todas', filter: null },
  { id: 'quick', label: 'Quick', filter: { quick: true } },
  { id: 'pinned', label: 'Pinned', filter: { pinned: true } },
  { id: 'snippet', label: 'Snippets', filter: { type: 'snippet' } },
  { id: 'favorite', label: 'Favoritas', filter: { favorite: true } },
  { id: 'recent', label: 'Recentes', filter: null },
  { id: 'tasks', label: 'Tarefas', filter: null }, // painel próprio (TasksPanel) no lugar do editor
  { id: 'trash', label: 'Lixeira', filter: null }, // painel próprio (TrashPanel) no lugar do editor
];

/** Caminho de pasta depois de `from` virar `to` (a própria pasta ou qualquer subpasta). */
const remapFolder = (p, from, to) => (p === from ? to : p != null && isDescendant(p, from) ? to + p.slice(from.length) : p);

/** 'a/b/c' → ['a', 'a/b', 'a/b/c'] */
const ancestors = (p) => p.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));

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
  // Pasta ativa: onde nascem as notas novas (a última pasta clicada ou a pasta da nota aberta). Não filtra a lista.
  const folderSel = typeof ui.folder === 'string' && ui.folder ? ui.folder : null;
  const filter = { ...(filterDef.filter || {}), ...(ui.tag ? { tag: ui.tag } : {}) };
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
      // A pasta ativa deixou de existir (apagada ou renomeada): novas notas voltam para a raiz.
      setUi((u) => (typeof u.folder === 'string' && u.folder && !fld.some((f) => f.path === u.folder) ? { ...u, folder: null } : u));
    } catch (e) {
      setLoadError(cleanError(e));
      setRows([]);
    }
  }, [q, ui.filter, ui.tag]);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    let t = null;
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);

  const titleMap = React.useMemo(() => new Map(allRows.map((r) => [normalize(r.title), r.id])), [allRows]);
  const resolve = React.useCallback((title) => titleMap.get(normalize(title).trim()) || null, [titleMap]);

  // Abrir/criar uma nota sai do painel Tarefas (que ocupa o lugar do editor).
  const leaveTasks = (u) => (u.filter === 'tasks' || u.filter === 'trash' ? { ...u, filter: 'all' } : u);

  // cursor: posição inicial no corpo (template/nota do dia com {{cursor}}) — força um modo com o editor visível.
  const openNote = React.useCallback(async (id, focus, cursor) => {
    const note = await notesApi().get(id);
    if (!note) { toast('Nota não encontrada', 'Ela pode ter sido excluída', 'error'); return; }
    setCurrent({ note, isNew: false, focus, cursor: typeof cursor === 'number' ? cursor : undefined });
    // A árvore mostra onde a nota está: abre as pastas dela e passa a ser a pasta ativa.
    if (note.folder) setFoldersUi((f) => ({ ...f, open: { ...f.open, ...Object.fromEntries(ancestors(note.folder).map((p) => [p, true])) } }));
    setUi((u) => ({ ...leaveTasks(u), selectedId: id, folder: note.folder || null, ...(typeof cursor === 'number' && u.mode === 'preview' ? { mode: 'split' } : {}) }));
  }, []);

  // Nota do dia (Ctrl+Shift+D / botão Hoje / palette): abre a de hoje ou cria em "Diário".
  const openDaily = React.useCallback(async () => {
    try {
      const r = await notesApi().daily();
      await openNote(r.note.id, 'body', r.cursor);
      if (r.created) toast('Nota do dia criada', 'em ' + (r.note.folder || 'Sem pasta') + ' — com as tarefas vencidas e de hoje');
    } catch (e) { toast('Não foi possível abrir a nota do dia', cleanError(e), 'error'); }
  }, [openNote]);

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
    else if (request.id) openNote(request.id, request.cursor != null ? 'body' : undefined, request.cursor);
    else if (request.view === 'tasks') setUi((u) => ({ ...u, filter: 'tasks' }));
    else if (request.view === 'daily') openDaily();
    else if (request.view === 'template') setDialog({ kind: 'template' });
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
      armUndo({ kind: 'note', snap, label: 'Nota movida para a Lixeira' });
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
  const toggleOpen = (path) => setFoldersUi((f) => ({ ...f, open: { ...f.open, [path]: !(f.open || {})[path] } }));
  // Clicar na pasta expande/recolhe as notas dela em cascata e a marca como destino das notas novas.
  const clickFolder = (path) => { toggleOpen(path); selectFolder(path); };
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
    armUndo({ kind: 'folder', snap, label: `Pasta “${baseName(path)}” excluída (${snap.notes.length} ${snap.notes.length === 1 ? 'nota' : 'notas'} na Lixeira)` });
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

  const dnd = useFolderDnD({
    onDropNote: (id, folder) => {
      const n = allRows.find((r) => r.id === id);
      if (n && (n.folder || '') !== folder) moveNoteTo(id, folder);
    },
    onDropFolder: moveFolderTo,
  });

  // Lista exibida (agrupada) e a ordem plana para navegar com ↑/↓.
  const groups = React.useMemo(() => {
    if (!rows) return [];
    if (ui.filter === 'recent' && !q && recent) {
      return [
        { title: 'Recently Edited', items: recent.edited.map((r) => ({ ...r, time: r.updated })) },
        { title: 'Recently Viewed', items: recent.viewed.map((r) => ({ ...r, time: r.viewedAt })) },
      ].filter((g) => g.items.length);
    }
    if (q || ui.filter !== 'all' || ui.tag) return [{ title: null, items: rows.map((r) => ({ ...r, time: r.updated })) }];
    const pinned = rows.filter((r) => r.pinned);
    return [
      pinned.length && { title: '📌 Pinned', items: pinned.map((r) => ({ ...r, time: r.updated })) },
      { title: pinned.length ? 'Todas' : null, items: rows.filter((r) => !r.pinned).map((r) => ({ ...r, time: r.updated })) },
    ].filter((g) => g && g.items.length);
  }, [rows, recent, q, ui.filter, ui.tag]);

  // Com pastas (e sem busca/filtro/tag) a lista vira uma árvore em cascata: cada pasta abre as subpastas e as notas dela.
  const useTree = !q && ui.filter === 'all' && !ui.tag && folders.length > 0;
  const openMap = foldersUi.open || {};
  const tree = React.useMemo(() => buildTree(folders), [folders]);
  const notesBy = React.useMemo(() => {
    const m = new Map();
    for (const r of rows || []) { const k = r.folder || ''; if (!m.has(k)) m.set(k, []); m.get(k).push({ ...r, time: r.updated }); }
    return m;
  }, [rows]);
  const walk = (nodes) => nodes.flatMap((n) => (openMap[n.path] ? [...walk(n.children), ...(notesBy.get(n.path) || [])] : []));
  const flat = useTree ? [...walk(tree), ...(notesBy.get('') || [])] : groups.flatMap((g) => g.items); // ordem visível, para ↑/↓

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
      // Ctrl/⌘+N nova · Ctrl/⌘+Shift+N a partir de template · Ctrl/⌘+Shift+D nota do dia
      if (isMod(e) && e.key.toLowerCase() === 'n') { e.preventDefault(); if (e.shiftKey) setDialog({ kind: 'template' }); else newNote(); }
      else if (isMod(e) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openDaily(); }
      else if ((isMod(e) && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [newNote, openDaily]); // newNote muda com a pasta selecionada (Ctrl+N cria dentro dela)

  /** Linha de uma nota. Na árvore (inTree) a pasta é óbvia pelo aninhamento, então não repete o caminho. */
  const noteRow = (r, key, { inTree = false, i = 0 } = {}) => (
    <div key={key} role={useTree ? 'treeitem' : 'option'} aria-selected={r.id === ui.selectedId}
      className={'nts-row' + (r.id === ui.selectedId ? ' is-sel' : '') + (inTree ? ' is-cascade' : '')}
      style={inTree ? { '--i': Math.min(i, 12) } : undefined}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(NOTE_DRAG, r.id); e.dataTransfer.effectAllowed = 'move'; }}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'note', note: r }); }}
      onClick={() => openNote(r.id)}
      {...dnd.dropProps(r.folder || '', 'n:' + key)}>
      <Icon name={rowIcon(r)} size={14} className="nts-row__icon" />
      <div className="nts-row__main">
        <div className="nts-row__title"><Hl text={r.title} idx={r.titleIdx} />{r.pinned && inTree && <Icon name="pin" size={10} className="nts-row__pin" />}{r.tasksOpen + r.tasksDone > 0 && <span className="nts-row__tasks" title="Tarefas concluídas / total">☑ {r.tasksDone}/{r.tasksOpen + r.tasksDone}</span>}</div>
        <div className="nts-row__sub"><Excerpt ex={q ? r.excerpt : null} fallback={r.preview} /></div>
        {(r.tags.length > 0 || (r.folder && !inTree)) && (
          <div className="nts-row__tags">
            {r.folder && !inTree && <span className="nts-row__folder" title={r.folder}><Icon name="folder" size={10} /> {r.folder}</span>}
            {r.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}
          </div>
        )}
      </div>
      <span className="nts-row__time">{shortTime(r.time)}</span>
    </div>
  );

  /** Pasta + (se aberta) o ramo com subpastas e notas dela, recuado e com uma linha-guia leve. */
  const renderFolder = (node) => {
    const isOpen = !!openMap[node.path];
    const own = notesBy.get(node.path) || [];
    return (
      <div key={'f:' + node.path} role="none">
        <FolderRow
          path={node.path} name={node.name} total={node.total} isOpen={isOpen}
          active={folderSel === node.path} isOver={dnd.over === node.path}
          dropProps={dnd.dropProps(node.path)}
          onClick={() => clickFolder(node.path)} onToggle={toggleOpen}
          onContext={(path, x, y) => setCtxMenu({ x, y, kind: 'folder', path })}
        />
        {isOpen && (
          <div className="nts-branch" role="group">
            {node.children.map((c) => renderFolder(c))}
            {own.map((r, i) => noteRow(r, 'in:' + node.path + ':' + r.id, { inTree: true, i }))}
            {!node.children.length && !own.length && <div className="nts-branch__empty">Pasta vazia</div>}
          </div>
        )}
      </div>
    );
  };

  const noNotesAtAll = info && info.count === 0 && !current;

  return (
    <div className="nts-screen">
      <PageHeader
        icon="notebook-pen"
        title="Notes"
        subtitle="Sua memória técnica — Markdown, snippets e busca. Capture com Ctrl+Alt+Space → Alt+Q"
        actions={<>
          <Button variant="secondary" icon="folder-open" onClick={() => notesApi().openFolder()}>Abrir pasta</Button>
          <Button variant="secondary" icon="calendar-days" onClick={openDaily}>Hoje</Button>
          <IconButton icon="layout-template" label={'Nova nota a partir de template (' + mod('N', true) + ')'} onClick={() => setDialog({ kind: 'template' })} />
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
          <div className="nts-listbar">
            <span className="nts-listbar__title">{useTree ? 'Explorador' : 'Notas'}</span>
            {folderSel && (
              <button type="button" className="nts-listbar__dest" title="Novas notas nascem nesta pasta — clique para limpar" onClick={() => selectFolder(null)}>
                <Icon name="folder" size={11} /> {baseName(folderSel)} <Icon name="x" size={10} />
              </button>
            )}
            <span className="nts-editor__spacer" />
            <IconButton size="sm" icon="folder-plus" label="Nova pasta" onClick={() => setDialog({ kind: 'create', parent: '' })} />
          </div>

          <div ref={listRef} className={'nts-list tk-scroll' + (dnd.over === '' ? ' is-drop-root' : '')} role={useTree ? 'tree' : 'listbox'} aria-label="Notas" {...dnd.dropProps('')}>
            {rows === null && <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>}
            {loadError && <div className="nts-list__msg is-error">Erro ao ler as notas: {loadError}</div>}
            {rows && !loadError && !useTree && flat.length === 0 && (
              q ? <div className="nts-list__msg"><b>Nenhuma nota para “{q}”.</b><br />Tente outro termo.</div>
                : noNotesAtAll ? <div className="nts-list__msg">Nenhuma nota ainda.</div>
                : <div className="nts-list__msg">Nada neste filtro.</div>
            )}

            {useTree ? (
              <>
                {rows && rows.some((r) => r.pinned) && (
                  <div role="group" aria-label="Pinned">
                    <div className="tk-menu__heading">📌 Pinned</div>
                    {rows.filter((r) => r.pinned).map((r) => noteRow({ ...r, time: r.updated }, 'pin:' + r.id))}
                  </div>
                )}
                <div role="group" aria-label="Pastas e notas">
                  {tree.map((n) => renderFolder(n))}
                  {(notesBy.get('') || []).length > 0 && <div className="tk-menu__heading">Sem pasta</div>}
                  {(notesBy.get('') || []).map((r) => noteRow(r, 'root:' + r.id, { inTree: true }))}
                </div>
              </>
            ) : groups.map((g, gi) => (
              <div key={gi} role="group" aria-label={g.title || 'Notas'}>
                {g.title && <div className="tk-menu__heading">{g.title}</div>}
                {g.items.map((r) => noteRow(r, g.title + r.id))}
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
          ) : ui.filter === 'trash' ? (
            <TrashPanel onOpen={(id) => openNote(id)} toast={toast} />
          ) : current ? (
            <NoteEditor
              key={current.note.id}
              initial={current.note}
              isNew={current.isNew}
              focus={current.focus}
              cursor={current.cursor}
              mode={ui.mode}
              setMode={(mode) => setUi((u) => ({ ...u, mode }))}
              resolve={resolve}
              onOpenLink={openLink}
              onOpenNote={(id) => openNote(id)}
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
      {dialog && dialog.kind === 'template' && (
        <TemplateModal
          folder={folderSel}
          onClose={() => setDialog(null)}
          onCreated={(note, cursor) => openNote(note.id, 'body', cursor)}
          onEditTemplate={(note) => openNote(note.id, 'body')}
          toast={toast}
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
