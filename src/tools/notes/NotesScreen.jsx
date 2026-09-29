import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, recoverUnsaved, shortTime, cleanError } from '../../notes/client.js';
import { createNote } from '../../notes/note.js';
import { normalize } from '../../commands/search.js';
import { NoteEditor } from './NoteEditor.jsx';
import { TasksPanel } from './TasksPanel.jsx';
import { emit } from '../../lib/events.js';

const { PageHeader, Button, EmptyState, Icon, Kbd, Spinner } = DS;

const FILTERS = [
  { id: 'all', label: 'Todas', filter: null },
  { id: 'quick', label: 'Quick', filter: { quick: true } },
  { id: 'pinned', label: 'Pinned', filter: { pinned: true } },
  { id: 'snippet', label: 'Snippets', filter: { type: 'snippet' } },
  { id: 'favorite', label: 'Favoritas', filter: { favorite: true } },
  { id: 'recent', label: 'Recentes', filter: null },
  { id: 'tasks', label: 'Tarefas', filter: null }, // painel próprio (TasksPanel) no lugar do editor
];

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
  const [deleted, setDeleted] = React.useState(null);  // última nota excluída (para desfazer)
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);

  const filterDef = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  const filter = { ...(filterDef.filter || {}), ...(ui.tag ? { tag: ui.tag } : {}) };
  const q = query.trim();

  const refresh = React.useCallback(async () => {
    try {
      const api = notesApi();
      const flt = Object.keys(filter).length ? filter : undefined;
      const [list, all, tg, inf, rec] = await Promise.all([
        q ? api.search(q, { filter: flt, limit: 200 }) : api.list(flt),
        api.list(),
        api.tags(),
        api.info(),
        ui.filter === 'recent' ? api.recent() : null,
      ]);
      setRows(list); setAllRows(all); setTags(tg); setInfo(inf); setRecent(rec); setLoadError(null);
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
  const leaveTasks = (u) => (u.filter === 'tasks' ? { ...u, filter: 'all' } : u);

  const openNote = React.useCallback(async (id, focus) => {
    const note = await notesApi().get(id);
    if (!note) { toast('Nota não encontrada', 'Ela pode ter sido excluída', 'error'); return; }
    setCurrent({ note, isNew: false, focus });
    setUi((u) => ({ ...leaveTasks(u), selectedId: id }));
  }, []);

  const newNote = React.useCallback((title = '') => {
    const note = createNote({ title });
    setCurrent({ note, isNew: true, focus: title ? 'body' : 'title' });
    setUi((u) => ({ ...leaveTasks(u), selectedId: note.id }));
  }, []);

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

  const remove = async (note) => {
    try {
      const snap = await notesApi().get(note.id);
      await notesApi().remove(note.id);
      setDeleted(snap);
      setCurrent(null);
      setUi((u) => ({ ...u, selectedId: null }));
      setTimeout(() => setDeleted((d) => (d && d.id === snap.id ? null : d)), 8000);
    } catch (e) { toast('Erro ao excluir', cleanError(e), 'error'); }
  };
  const undoDelete = async () => {
    const snap = deleted;
    setDeleted(null);
    await notesApi().restore(snap);
    openNote(snap.id);
  };

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
                    onClick={() => openNote(r.id)}>
                    <Icon name={rowIcon(r)} size={14} className="nts-row__icon" />
                    <div className="nts-row__main">
                      <div className="nts-row__title"><Hl text={r.title} idx={r.titleIdx} />{r.tasksOpen + r.tasksDone > 0 && <span className="nts-row__tasks" title="Tarefas concluídas / total">☑ {r.tasksDone}/{r.tasksOpen + r.tasksDone}</span>}</div>
                      <div className="nts-row__sub"><Excerpt ex={q ? r.excerpt : null} fallback={r.preview} /></div>
                      {r.tags.length > 0 && <div className="nts-row__tags">{r.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}</div>}
                    </div>
                    <span className="nts-row__time">{shortTime(r.time)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {deleted && (
            <div className="nts-undo" role="status">
              Nota excluída (movida para .trash)
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
    </div>
  );
}
