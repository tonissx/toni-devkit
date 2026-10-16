import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, recoverUnsaved, shortTime, cleanError } from '../../notes/client.js';
import { createNote } from '../../notes/note.js';
import { fromMarkdown, isMarkdownFile } from '../../notes/importmd.js';
import { normalize } from '../../commands/search.js';
import { NoteEditor } from './NoteEditor.jsx';
import { TasksPanel } from './TasksPanel.jsx';
import { TrashPanel } from './TrashPanel.jsx';
import { TemplateModal } from './TemplateModal.jsx';
import { GraphPanel } from './GraphPanel.jsx';
import { FolderRow, PinnedFolderRow, useFolderDnD, NOTE_DRAG } from './FolderTree.jsx';
import { NameModal, DeleteFolderModal, MoveNoteModal, MoveFolderModal, ConfirmModal } from './FolderDialogs.jsx';
import { FolderSettingsModal } from './FolderSettings.jsx';
import { NotesSettingsModal, DEFAULT_PREFS } from './NotesSettings.jsx';
import { buildTree, flattenTree, joinPath, baseName, parentOf, isDescendant, siblingsOf, matchFolders } from '../../notes/folders.js';
import { sortNotes, FOLDER_COLORS } from '../../notes/foldermeta.js';
import { emit } from '../../lib/events.js';
import { useAiMode, aiOn } from '../../ai/ui.jsx';
import { AskNotes } from './AskNotes.jsx';
import { sideWidth, SIDE_COLLAPSED, SIDE_MAX, SIDE_DEFAULT, SIDE_WIDE } from '../../notes/panel.js';

const { PageHeader, Button, IconButton, EmptyState, Icon, Kbd, Spinner, ContextMenu } = DS;

// Filtros refinam a LISTA da lateral; visões trocam a ÁREA PRINCIPAL (editor ↔ painéis). São coisas diferentes
// e ficam em lugares diferentes: filtros em chips na lateral, visões em abas no topo da área principal.
const FILTERS = [
  { id: 'all', label: 'Todas', filter: null },
  { id: 'quick', label: 'Quick', filter: { quick: true } },
  { id: 'pinned', label: 'Pinned', filter: { pinned: true } },
  { id: 'snippet', label: 'Snippets', filter: { type: 'snippet' } },
  { id: 'favorite', label: 'Favoritas', filter: { favorite: true } },
  { id: 'recent', label: 'Recentes', filter: null },
];
const VIEWS = [
  { id: 'note', label: 'Nota', icon: 'file-text' },
  { id: 'tasks', label: 'Tarefas', icon: 'list-checks' },
  { id: 'graph', label: 'Grafo', icon: 'waypoints' },
];
// A Lixeira também é uma visão, mas de uso raro: abre pelo rodapé da lateral, não pelas abas.
const PANEL_VIEWS = ['tasks', 'graph', 'trash'];

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
  const aiCfg = useAiMode();
  const [ui, setUi] = usePersisted('notes.ui', { selectedId: null, mode: 'edit', filter: 'all', tag: null, view: 'note' });
  const [trashCount, setTrashCount] = React.useState(0);
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
  const [foldersLoaded, setFoldersLoaded] = React.useState(false);
  const [prefsRaw, setPrefs] = usePersisted('notes.prefs', DEFAULT_PREFS);
  const prefs = { ...DEFAULT_PREFS, ...prefsRaw };
  const [dialog, setDialog] = React.useState(null);      // { kind: 'create'|'rename'|'delete'|'move'|'movefolder'|'merge'|'folderSettings'|'settings'|'template', … }
  const [ctxMenu, setCtxMenu] = React.useState(null);    // { x, y, kind: 'folder'|'note', path?, note? }
  const [navKey, setNavKey] = React.useState(null);      // item do explorador que recebe o Tab (roving tabindex)
  const [focusNav, setFocusNav] = React.useState(null);  // pede para focar um item depois do próximo render
  const [dropping, setDropping] = React.useState(false); // arrastando arquivo(s) sobre a janela
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);

  // Bandeja lateral: arrastar a borda direita define a largura (só grava ao soltar); duplo clique alterna padrão/larga.
  const [sidePrefs, setSidePrefs] = usePersisted('notes.side', { w: SIDE_DEFAULT });
  const rootRef = React.useRef(null);
  const [liveW, setLiveW] = React.useState(null);
  const maxW = () => (rootRef.current ? rootRef.current.getBoundingClientRect().width * 0.6 : SIDE_MAX);
  const sideW = sideWidth(sidePrefs.w, maxW());
  const shownW = liveW ?? sideW;
  const collapsed = shownW <= SIDE_COLLAPSED;
  const setSideW = (v) => setSidePrefs((p) => ({ ...p, w: sideWidth(v, maxW()) }));
  const drag = {
    onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setLiveW(sideW); },
    onPointerMove: (e) => { if (liveW != null && rootRef.current) setLiveW(sideWidth(e.clientX - rootRef.current.getBoundingClientRect().left - 24, maxW())); },
    onPointerUp: () => { if (liveW != null) { setSideW(liveW); setLiveW(null); } },
    onLostPointerCapture: () => setLiveW(null),
    onDoubleClick: () => setSideW(collapsed ? SIDE_DEFAULT : sideW >= SIDE_WIDE - 8 ? SIDE_DEFAULT : SIDE_WIDE),
    onKeyDown: (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      if (collapsed) { if (e.key === 'ArrowRight') setSideW(SIDE_DEFAULT); return; } // recolhida: → reabre
      setSideW(sideW + (e.key === 'ArrowRight' ? 16 : -16)); // a borda está à direita: → alarga, ← estreita (até recolher)
    },
  };

  // Versões antigas guardavam Tarefas/Lixeira/Grafo como "filtro": vira a visão correspondente.
  React.useEffect(() => {
    if (PANEL_VIEWS.includes(ui.filter)) setUi((u) => ({ ...u, view: u.filter, filter: 'all' }));
  }, []);
  const view = PANEL_VIEWS.includes(ui.view) ? ui.view : PANEL_VIEWS.includes(ui.filter) ? ui.filter : 'note';
  const setView = (v) => setUi((u) => ({ ...u, view: v }));

  const filterDef = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  // Pasta ativa: onde nascem as notas novas (a última pasta clicada ou a pasta da nota aberta). Não filtra a lista.
  const folderSel = typeof ui.folder === 'string' && ui.folder ? ui.folder : null;
  // "Só aqui": a lista (e a busca) ficam restritas à pasta ativa e às subpastas dela.
  const scope = !!ui.scope && !!folderSel;
  const scopeFolder = scope ? folderSel : null;
  const filter = { ...(filterDef.filter || {}), ...(ui.tag ? { tag: ui.tag } : {}), ...(scopeFolder ? { folder: scopeFolder, recursive: true } : {}) };
  const q = query.trim();

  const refresh = React.useCallback(async () => {
    try {
      const api = notesApi();
      const flt = Object.keys(filter).length ? filter : undefined;
      const [list, all, tg, inf, rec, fld, trash] = await Promise.all([
        q ? api.search(q, { filter: flt, limit: 200 }) : api.list(flt),
        api.list(),
        api.tags(),
        api.info(),
        ui.filter === 'recent' ? api.recent() : null,
        api.folders(),
        api.trashCount().catch(() => 0),
      ]);
      setRows(list); setAllRows(all); setTags(tg); setInfo(inf); setRecent(rec); setFolders(fld); setTrashCount(trash); setLoadError(null); setFoldersLoaded(true);
      // A pasta ativa deixou de existir (apagada ou renomeada): novas notas voltam para a raiz (e o "Só aqui" desliga junto).
      setUi((u) => (typeof u.folder === 'string' && u.folder && !fld.some((f) => f.path === u.folder) ? { ...u, folder: null } : u));
      // A tag ativa deixou de existir: sem isso a lista fica filtrada por algo que o usuário nem vê.
      setUi((u) => (u.tag && !tg.some((t) => t.tag === u.tag) ? { ...u, tag: null } : u));
    } catch (e) {
      setLoadError(cleanError(e));
      setRows([]);
    }
  }, [q, ui.filter, ui.tag, scopeFolder]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Chaves de pastas que já não existem saem do estado "aberta" (senão o objeto só cresce).
  React.useEffect(() => {
    if (!foldersLoaded) return;
    const known = new Set(folders.map((f) => f.path));
    setFoldersUi((f) => {
      const open = f.open || {};
      const keep = Object.entries(open).filter(([k]) => known.has(k));
      return keep.length === Object.keys(open).length ? f : { ...f, open: Object.fromEntries(keep) };
    });
  }, [folders, foldersLoaded]);
  React.useEffect(() => {
    let t = null;
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);

  // [[Título]] e [[Pasta/Título]] (a forma com pasta separa notas de mesmo título). Em empate, a primeira vence — como no serviço.
  const titleMap = React.useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      for (const k of [normalize(r.title), r.folder ? normalize(r.folder + '/' + r.title) : null]) if (k && !m.has(k)) m.set(k, r.id);
    }
    return m;
  }, [allRows]);
  const resolve = React.useCallback((title) => titleMap.get(normalize(title).trim()) || null, [titleMap]);

  // Abrir/criar uma nota volta para a visão "Nota" (os painéis ocupam o lugar do editor).
  const toNoteView = (u) => (u.view && u.view !== 'note' ? { ...u, view: 'note' } : u);

  // cursor: posição inicial no corpo (template com {{cursor}}) — força um modo com o editor visível.
  const openNote = React.useCallback(async (id, focus, cursor) => {
    const note = await notesApi().get(id);
    if (!note) { toast('Nota não encontrada', 'Ela pode ter sido excluída', 'error'); return; }
    setCurrent({ note, isNew: false, focus, cursor: typeof cursor === 'number' ? cursor : undefined });
    // A árvore mostra onde a nota está: abre as pastas dela e passa a ser a pasta ativa.
    if (note.folder) setFoldersUi((f) => ({ ...f, open: { ...f.open, ...Object.fromEntries(ancestors(note.folder).map((p) => [p, true])) } }));
    // Com "Só aqui" ligado a pasta ativa fica onde está (abrir uma nota de subpasta não estreita a lista).
    setUi((u) => ({ ...toNoteView(u), selectedId: id, folder: u.scope && u.folder ? u.folder : note.folder || null, ...(typeof cursor === 'number' && u.mode === 'preview' ? { mode: 'split' } : {}) }));
  }, []);

  /**
   * Nota nova. `where` = pasta de destino (padrão: a pasta ativa). Se a pasta tem template padrão a nota nasce dele
   * (e sem título dado); tags padrão da pasta já aparecem no editor. A nota só vai para o disco quando tiver conteúdo.
   */
  const newNote = React.useCallback(async (title = '', where) => {
    const folder = where !== undefined ? where : folderSel;
    const meta = (folder && folders.find((f) => f.path === folder)) || {};
    if (meta.template && !title) {
      try {
        const r = await notesApi().fromTemplate(meta.template, { folder });
        await openNote(r.note.id, 'body', r.cursor);
        return;
      } catch { /* template apagado ou vazio: cai na nota em branco */ }
    }
    const note = createNote({ title, ...(folder ? { folder } : {}), ...(meta.tags && meta.tags.length ? { tags: meta.tags } : {}) });
    setCurrent({ note, isNew: true, focus: title ? 'body' : 'title' });
    setUi((u) => ({ ...toNoteView(u), selectedId: note.id }));
  }, [folderSel, folders, openNote]);

  // Importar markdown como notas novas (arrastar .md para o app / colar). Cai na pasta ativa.
  const importNotes = React.useCallback(async (items) => {
    let last = null, count = 0;
    for (const it of items) {
      try {
        const f = fromMarkdown(it.text, it.fileName);
        const n = await notesApi().create({ ...f, ...(folderSel ? { folder: folderSel } : {}) });
        if (n) { last = n; count++; }
      } catch (e) { toast('Não foi possível importar' + (it.fileName ? ' ' + it.fileName : ''), cleanError(e), 'error'); }
    }
    if (last) { await openNote(last.id, 'body'); toast(count === 1 ? 'Nota criada' : count + ' notas criadas', count === 1 ? (last.title || 'a partir do markdown') : undefined); }
  }, [folderSel, openNote, toast]);

  React.useEffect(() => {
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const mdOf = (dt) => [...(dt.files || [])].filter(isMarkdownFile);
    let depth = 0;
    const onEnter = (e) => { if (hasFiles(e)) { depth++; setDropping(true); } };
    const onLeave = (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDropping(false); } };
    const onOver = (e) => { if (hasFiles(e)) e.preventDefault(); }; // sem isto o Electron abre o arquivo na janela
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      depth = 0; setDropping(false);
      const files = mdOf(e.dataTransfer);
      e.preventDefault();
      if (!files.length) return; // imagens soltas no editor seguem com images.js
      Promise.all(files.map(async (f) => ({ text: await f.text(), fileName: f.name }))).then(importNotes);
    };
    const onPaste = (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = mdOf(dt);
      if (files.length) {
        e.preventDefault();
        Promise.all(files.map(async (f) => ({ text: await f.text(), fileName: f.name }))).then(importNotes);
        return;
      }
      const t = e.target;
      const editable = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      const text = dt.getData('text/plain');
      if (!editable && text && text.trim()) { e.preventDefault(); importNotes([{ text, fileName: '' }]); }
    };
    window.addEventListener('dragenter', onEnter, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('dragenter', onEnter, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [importNotes]);

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
    else if (PANEL_VIEWS.includes(request.view)) setView(request.view);
    else if (request.view === 'template') setDialog({ kind: 'template' });
  }, [request && request.nonce]);

  const openLink = async (title) => {
    const id = await notesApi().resolveLink(title);
    if (id) openNote(id); else { newNote(title); emit('note.linked'); }
  };

  // Barra de desfazer para a última exclusão (nota ou pasta); o tempo vem das configurações (padrão 8 s).
  const armUndo = (d) => { setDeleted(d); setTimeout(() => setDeleted((x) => (x === d ? null : x)), prefs.undoSec * 1000); };

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
  const selectFolder = (path) => setUi((u) => ({ ...u, folder: path })); // ação da lista: não troca a visão
  const expand = (path) => path && setFoldersUi((f) => ({ ...f, open: { ...f.open, [path]: true } }));
  const toggleOpen = (path) => setFoldersUi((f) => ({ ...f, open: { ...f.open, [path]: !(f.open || {})[path] } }));
  // Clicar numa pasta ainda não selecionada a marca como destino das notas novas e a abre (nunca a recolhe, para
  // não fechar a pasta só por escolhê-la como destino). Clicar de novo na já selecionada alterna aberta/fechada;
  // a setinha e ←/→ também alternam.
  const clickFolder = (path) => {
    if (folderSel === path) toggleOpen(path);
    else { selectFolder(path); expand(path); }
  };
  const expandAll = () => setFoldersUi((f) => ({ ...f, open: Object.fromEntries(folders.map((x) => [x.path, true])) }));
  const collapseAll = () => setFoldersUi((f) => ({ ...f, open: {} }));
  const metaOf = (path) => folders.find((f) => f.path === path) || {};
  // Mostra a pasta no explorador: limpa busca e filtros, abre os ancestrais e foca a linha (breadcrumb, atalhos, busca).
  const revealFolder = (path) => {
    setQuery('');
    setUi((u) => ({ ...toNoteView(u), filter: 'all', tag: null, scope: false, folder: path }));
    setFoldersUi((f) => ({ ...f, open: { ...f.open, ...Object.fromEntries(ancestors(path).map((p) => [p, true])) } }));
    setFocusNav('f:' + path);
  };
  // Depois de renomear/mover `from` → `to`: a seleção e as pastas abertas acompanham.
  const followRename = (from, to) => {
    setUi((u) => ({ ...u, folder: remapFolder(typeof u.folder === 'string' ? u.folder : null, from, to) }));
    setFoldersUi((f) => ({ ...f, open: Object.fromEntries(Object.entries(f.open).map(([k, v]) => [remapFolder(k, from, to), v])) }));
  };
  const moveNoteTo = (id, folder) => guard(async () => {
    await notesApi().moveNote(id, folder);
    toast('Nota movida', folder ? 'para ' + folder : 'para “Sem pasta”');
  });
  // Mover pasta: se já existe uma de mesmo nome no destino, pergunta antes de mesclar.
  const moveFolderTo = (path, parent) => guard(async () => {
    const run = (merge) => guard(async () => {
      const to = await notesApi().moveFolder(path, parent, { merge });
      followRename(path, to);
      expand(parent);
      if (merge) toast('Pastas mescladas', to);
    });
    const clash = await notesApi().folderClash(path, { newParent: parent });
    if (clash) setDialog({ kind: 'merge', from: path, into: clash, run: () => run(true) });
    else await run(false);
  });
  const duplicateFolder = (path) => guard(async () => {
    const to = await notesApi().duplicateFolder(path);
    expand(parentOf(path));
    selectFolder(to);
    toast('Pasta duplicada', to);
  });
  const togglePinFolder = (path) => guard(() => notesApi().setFolderMeta(path, { pinned: metaOf(path).pinned ? null : true }));
  const reorderFolder = (path, delta) => guard(() => notesApi().moveFolderOrder(path, delta));
  const copyFolderPath = (path) => guard(async () => {
    const abs = await notesApi().folderAbs(path);
    await window.devkit.clipboard.write(abs);
    toast('Caminho copiado', abs);
  });
  const newNoteIn = (path) => { selectFolder(path); expand(path); newNote('', path); };
  const folderStats = (path) => {
    const inside = folders.filter((f) => f.path === path || isDescendant(f.path, path));
    return { notes: inside.reduce((s, f) => s + f.count, 0), subfolders: inside.length - 1 };
  };
  const deleteFolder = (path) => guard(async () => {
    const snap = await notesApi().removeFolder(path);
    armUndo({ kind: 'folder', snap, label: `Pasta “${baseName(path)}” excluída (${snap.notes.length} ${snap.notes.length === 1 ? 'nota' : 'notas'} na Lixeira)` });
    // Sobrou arquivo que não é nota dentro da pasta: ela continua no disco e o app não apaga o que não é dele.
    if (snap.kept && snap.kept.length) toast('Pasta mantida no disco', `“${snap.kept[0]}” tem arquivos que não são notas. Apague ou mova por fora do app.`, 'warn');
    if (current && snap.notes.some((n) => n.id === current.note.id)) { setCurrent(null); setUi((u) => ({ ...u, selectedId: null })); }
    setUi((u) => (typeof u.folder === 'string' && (u.folder === path || isDescendant(u.folder, path)) ? { ...u, folder: null } : u));
  });

  const folderMenu = (path) => {
    const sibs = siblingsOf(tree, path).map((s) => s.path), at = sibs.indexOf(path);
    const pinned = !!metaOf(path).pinned;
    return [
      { id: 'newnote', icon: 'file-plus', label: 'Nova nota aqui', shortcut: mod('N') },
      { id: 'sub', icon: 'folder-plus', label: 'Nova subpasta' },
      { separator: true },
      { id: 'rename', icon: 'pencil', label: 'Renomear…', shortcut: 'F2' },
      { id: 'move', icon: 'folder-input', label: 'Mover para…' },
      { id: 'dup', icon: 'copy', label: 'Duplicar' },
      { id: 'pin', icon: pinned ? 'pin-off' : 'pin', label: pinned ? 'Desafixar do topo' : 'Fixar no topo' },
      { id: 'settings', icon: 'settings-2', label: 'Configurações da pasta…' },
      { separator: true },
      { id: 'up', icon: 'arrow-up', label: 'Subir', shortcut: 'Alt+↑', disabled: at <= 0 },
      { id: 'down', icon: 'arrow-down', label: 'Descer', shortcut: 'Alt+↓', disabled: at === -1 || at >= sibs.length - 1 },
      { separator: true },
      { id: 'open', icon: 'external-link', label: 'Abrir no Explorer' },
      { id: 'copypath', icon: 'clipboard-copy', label: 'Copiar caminho' },
      { separator: true },
      { id: 'delete', icon: 'trash-2', label: 'Excluir…', shortcut: 'Del', danger: true },
    ];
  };
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
      const p = c.path;
      if (item.id === 'newnote') newNoteIn(p);
      else if (item.id === 'sub') setDialog({ kind: 'create', parent: p });
      else if (item.id === 'rename') setDialog({ kind: 'rename', path: p });
      else if (item.id === 'move') setDialog({ kind: 'movefolder', path: p });
      else if (item.id === 'dup') duplicateFolder(p);
      else if (item.id === 'pin') togglePinFolder(p);
      else if (item.id === 'settings') setDialog({ kind: 'folderSettings', path: p });
      else if (item.id === 'up') reorderFolder(p, -1);
      else if (item.id === 'down') reorderFolder(p, 1);
      else if (item.id === 'open') guard(() => notesApi().openFolder(p));
      else if (item.id === 'copypath') copyFolderPath(p);
      else if (item.id === 'delete') setDialog({ kind: 'delete', path: p });
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
  const useTree = !q && ui.filter === 'all' && !ui.tag && !scope && folders.length > 0;
  const openMap = foldersUi.open || {};
  const tree = React.useMemo(() => buildTree(folders), [folders]);
  // Notas de cada pasta, na ordem configurada nela (padrão: editadas recentemente).
  const notesBy = React.useMemo(() => {
    const m = new Map();
    for (const r of rows || []) { const k = r.folder || ''; if (!m.has(k)) m.set(k, []); m.get(k).push({ ...r, time: r.updated }); }
    for (const f of folders) if (f.sort && m.has(f.path)) m.set(f.path, sortNotes(m.get(f.path), f.sort));
    return m;
  }, [rows, folders]);
  const pinnedFolders = React.useMemo(() => flattenTree(tree).filter((f) => metaOf(f.path).pinned), [tree, folders]);
  // Busca: pastas cujo nome/caminho casa com o que foi digitado aparecem antes das notas.
  const folderHits = React.useMemo(() => (q ? matchFolders(folders, q, normalize).slice(0, 6) : []), [q, folders]);
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

  /* ─────────────── Teclado no explorador (roving tabindex) ─────────────── */
  const navItems = () => (listRef.current ? [...listRef.current.querySelectorAll('[data-nav]')] : []);
  const navSel = (key) => '[data-nav="' + key.replace(/["\\]/g, '\\$&') + '"]';
  const focusItem = (el) => { if (!el) return; setNavKey(el.dataset.nav); el.focus(); el.scrollIntoView({ block: 'nearest' }); };

  // Só um item do explorador entra na ordem do Tab: o último focado, senão a nota aberta, senão o primeiro.
  React.useEffect(() => {
    const items = navItems();
    if (!items.length) return;
    const want = items.find((el) => el.dataset.nav === navKey) || items.find((el) => el.dataset.nav === 'n:' + ui.selectedId) || items[0];
    for (const el of items) el.tabIndex = el === want ? 0 : -1;
  });
  React.useEffect(() => {
    if (!focusNav || !listRef.current) return;
    const el = listRef.current.querySelector(navSel(focusNav));
    if (el) focusItem(el);
    setFocusNav(null);
  }, [focusNav, foldersUi]);

  const menuAt = (el, ctx) => { const r = el.getBoundingClientRect(); setCtxMenu({ x: r.left + 28, y: r.bottom - 4, ...ctx }); };

  const onTreeKeyDown = (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.nav) return; // teclas de dentro de botões/campos seguem o curso normal
    const key = el.dataset.nav, kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
    const folder = kind === 'f' || kind === 'pf';
    const items = navItems(), i = items.indexOf(el);
    const go = (n) => { e.preventDefault(); focusItem(items[Math.max(0, Math.min(items.length - 1, n))]); };
    const reorder = e.altKey && kind === 'f'; // Alt+↑/↓ numa pasta reordena em vez de navegar
    if (e.key === 'ArrowDown' && !reorder) go(i + 1);
    else if (e.key === 'ArrowUp' && !reorder) go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'ArrowRight' && kind === 'f') {
      e.preventDefault();
      if (!openMap[id]) expand(id); else if (items[i + 1] && items[i + 1].dataset.nav !== key) focusItem(items[i + 1]); // aberta: entra nela
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (kind === 'f' && openMap[id]) toggleOpen(id);
      else { const parent = kind === 'f' ? parentOf(id) : el.dataset.folder; if (parent) focusItem(listRef.current.querySelector(navSel('f:' + parent))); }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (kind === 'f') { selectFolder(id); toggleOpen(id); }
      else if (kind === 'pf') revealFolder(id);
      else openNote(id, e.key === 'Enter' ? 'body' : undefined);
    } else if (e.key === 'F2' && kind === 'f') { e.preventDefault(); setDialog({ kind: 'rename', path: id }); }
    else if (e.key === 'Delete') {
      e.preventDefault();
      if (kind === 'f') setDialog({ kind: 'delete', path: id });
      else if (kind === 'n' || kind === 'p') { const n = (rows || []).find((r) => r.id === id); if (n) { focusItem(items[i + 1] || items[i - 1]); remove(n); } }
    } else if (reorder && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); reorderFolder(id, e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (folder) menuAt(el, { kind: 'folder', path: id });
      else { const n = (rows || []).find((r) => r.id === id); if (n) menuAt(el, { kind: 'note', note: n }); }
    }
  };

  // Atalhos: Ctrl/⌘+N nova · Ctrl/⌘+F ou / buscar
  React.useEffect(() => {
    const h = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      // Ctrl/⌘+N nova · Ctrl/⌘+Shift+N a partir de template
      if (isMod(e) && e.key.toLowerCase() === 'n') { e.preventDefault(); if (e.shiftKey) setDialog({ kind: 'template' }); else newNote(); }
      else if ((isMod(e) && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [newNote]); // newNote muda com a pasta selecionada (Ctrl+N cria dentro dela)

  /** Linha de uma nota. Na árvore (inTree) a pasta é óbvia pelo aninhamento, então não repete o caminho. */
  const noteRow = (r, key, { inTree = false, i = 0, nav = 'n', level = 1 } = {}) => (
    <div key={key} role={useTree ? 'treeitem' : 'option'} aria-selected={r.id === ui.selectedId}
      aria-level={useTree ? level : undefined} data-nav={nav + ':' + r.id} data-folder={r.folder || ''} tabIndex={-1}
      className={'nts-row' + (r.id === ui.selectedId ? ' is-sel' : '') + (inTree ? ' is-cascade' : '')}
      style={inTree ? { '--i': Math.min(i, 12) } : undefined}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(NOTE_DRAG, r.id); e.dataTransfer.effectAllowed = 'move'; }}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'note', note: r }); }}
      onClick={() => openNote(r.id)}
      {...dnd.dropProps(r.folder || '', 'n:' + key)}>
      <Icon name={rowIcon(r)} size={14} className="nts-row__icon" />
      <div className="nts-row__main">
        <div className="nts-row__title"><Hl text={r.title} idx={r.titleIdx} />{r.pinned && inTree && <Icon name="pin" size={10} className="nts-row__pin" />}{r.tasksOpen + r.tasksDone > 0 && <span className="nts-row__tasks" title="Tarefas concluídas / total"><Icon name="list-checks" size={11} /> {r.tasksDone}/{r.tasksOpen + r.tasksDone}</span>}</div>
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
  const renderFolder = (node, level = 1) => {
    const isOpen = !!openMap[node.path];
    const own = notesBy.get(node.path) || [];
    return (
      <div key={'f:' + node.path} role="none">
        <FolderRow
          path={node.path} name={node.name} total={node.total} isOpen={isOpen} level={level} meta={node.meta}
          active={folderSel === node.path} isOver={dnd.over === node.path}
          dropProps={dnd.dropProps(node.path)}
          onClick={() => clickFolder(node.path)} onToggle={toggleOpen}
          onContext={(path, x, y) => setCtxMenu({ x, y, kind: 'folder', path })}
        />
        {isOpen && (
          <div className={'nts-branch' + (node.meta && node.meta.color ? ' has-color' : '')} role="group"
            style={node.meta && node.meta.color ? { '--fc': FOLDER_COLORS[node.meta.color] } : undefined}>
            {node.children.map((c) => renderFolder(c, level + 1))}
            {own.map((r, i) => noteRow(r, 'in:' + node.path + ':' + r.id, { inTree: true, i, level: level + 1 }))}
            {!node.children.length && !own.length && <div className="nts-branch__empty">Pasta vazia</div>}
          </div>
        )}
      </div>
    );
  };

  // Cor da pasta selecionada: a etiqueta de destino e o "Só aqui" a seguem (sem cor = destaque do app).
  const selColor = folderSel && FOLDER_COLORS[metaOf(folderSel).color];
  const selVars = selColor ? { '--fc': selColor } : undefined;

  const noNotesAtAll = info && info.count === 0 && !current;

  return (
    <div className="nts-screen">
      {dropping && <div className="nts-dropzone" aria-hidden="true"><Icon name="file-down" size={28} /> Solte o .md para criar uma nota</div>}
      <PageHeader
        icon="notebook-pen"
        title="Notes"
        subtitle="Sua memória técnica — Markdown, snippets e busca. Capture com Ctrl+Alt+Space → Alt+Q · arraste um .md ou cole para criar"
        actions={<>
          <Button variant="secondary" icon="folder-open" onClick={() => notesApi().openFolder()}>Abrir pasta</Button>
          <IconButton icon="settings" label="Configurações de Notes" onClick={() => setDialog({ kind: 'settings' })} />
          <IconButton icon="layout-template" label={'Nova nota a partir de template (' + mod('N', true) + ')'} onClick={() => setDialog({ kind: 'template' })} />
          <Button variant="primary" icon="plus" kbd={mod('N')} onClick={() => newNote()}>Nova nota</Button>
        </>}
      />
      <div className="nts" ref={rootRef}>
        <aside className={'nts__side' + (liveW != null ? ' is-dragging' : '') + (collapsed ? ' is-collapsed' : '')} style={{ width: shownW }}>
          <div className="nts__grip" role="separator" aria-orientation="vertical" aria-label="Largura da lista de notas"
            title="Arraste para alargar, estreitar ou recolher · duplo clique alterna"
            aria-valuemin={SIDE_COLLAPSED} aria-valuemax={SIDE_MAX} aria-valuenow={shownW} tabIndex={0} {...drag} />
          {collapsed && (
            <button type="button" className="nts__reopen" aria-label="Mostrar lista de notas" title="Mostrar lista de notas" onClick={() => setSideW(SIDE_DEFAULT)}>
              <Icon name="chevron-right" size={12} />
            </button>
          )}
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
          {aiOn(aiCfg) && query.trim().length > 0 && <AskNotes key={query.trim()} cfg={aiCfg} question={query} folder={folderSel} scoped={scope} onOpen={(id) => openNote(id)} />}
          <div className="nts-filters" role="toolbar" aria-label="Filtros">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={'nts-chip' + (ui.filter === f.id ? ' is-on' : '')} aria-pressed={ui.filter === f.id}
                onClick={() => setUi((u) => ({ ...u, filter: f.id }))}>{f.label}</button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="nts-tagcloud" aria-label="Tags">
              {[...tags.slice(0, 16), ...tags.slice(16).filter((t) => t.tag === ui.tag)].map((t) => (
                <button key={t.tag} type="button" className={'nts-chip is-tag' + (ui.tag === t.tag ? ' is-on' : '')} aria-pressed={ui.tag === t.tag}
                  onClick={() => setUi((u) => ({ ...u, tag: u.tag === t.tag ? null : t.tag }))}>#{t.tag}<span>{t.count}</span></button>
              ))}
            </div>
          )}
          <div className="nts-listbar">
            <span className="nts-listbar__title">{useTree ? 'Explorador' : 'Notas'}</span>
            {folderSel && (
              <button type="button" className="nts-listbar__dest" style={selVars} title="Novas notas nascem nesta pasta — clique para limpar" onClick={() => selectFolder(null)}>
                <Icon name="folder" size={11} /> {baseName(folderSel)} <Icon name="x" size={10} />
              </button>
            )}
            {folderSel && (
              <button type="button" className={'nts-listbar__scope' + (scope ? ' is-on' : '')} aria-pressed={scope}
                title={scope ? 'Mostrando só esta pasta e as subpastas — clique para voltar ao explorador' : 'Mostrar só as notas desta pasta (e subpastas); a busca também fica restrita a ela'}
                onClick={() => setUi((u) => ({ ...u, scope: !u.scope }))}>
                <Icon name="filter" size={10} /> Só aqui
              </button>
            )}
            <span className="nts-editor__spacer" />
            {useTree && <IconButton size="sm" icon="chevrons-up-down" label="Expandir todas as pastas" onClick={expandAll} />}
            {useTree && <IconButton size="sm" icon="chevrons-down-up" label="Recolher todas as pastas" onClick={collapseAll} />}
            <IconButton size="sm" icon="folder-plus" label="Nova pasta" onClick={() => setDialog({ kind: 'create', parent: '' })} />
          </div>

          <div ref={listRef} className={'nts-list tk-scroll' + (dnd.over === '' ? ' is-drop-root' : '')} role={useTree ? 'tree' : 'listbox'} aria-label="Notas" {...dnd.dropProps('')}
            onKeyDown={onTreeKeyDown}
            onFocus={(e) => { const k = e.target.dataset && e.target.dataset.nav; if (k && k !== navKey) setNavKey(k); }}
            onClick={(e) => { if (folderSel && (e.target === e.currentTarget || e.target.getAttribute('role') === 'group')) selectFolder(null); }}>
            {rows === null && <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>}
            {loadError && <div className="nts-list__msg is-error">Erro ao ler as notas: {loadError}</div>}
            {rows && !loadError && !useTree && flat.length === 0 && !(q && folderHits.length > 0) && (
              q ? <div className="nts-list__msg"><b>Nenhuma nota para “{q}”.</b><br />Tente outro termo.</div>
                : noNotesAtAll ? <div className="nts-list__msg">Nenhuma nota ainda.</div>
                : (
                  <div className="nts-list__msg">
                    Nada neste filtro.
                    {(ui.filter !== 'all' || ui.tag) && (
                      <><br /><Button size="sm" variant="secondary" onClick={() => setUi((u) => ({ ...u, filter: 'all', tag: null }))}>Limpar filtros</Button></>
                    )}
                  </div>
                )
            )}

            {useTree ? (
              <>
                {pinnedFolders.length > 0 && (
                  <div role="group" aria-label="Pastas fixadas">
                    <div className="tk-menu__heading">📁 Pastas fixadas</div>
                    {pinnedFolders.map((f) => (
                      <PinnedFolderRow key={'pf:' + f.path} path={f.path} meta={metaOf(f.path)} onReveal={revealFolder}
                        onContext={(path, x, y) => setCtxMenu({ x, y, kind: 'folder', path })} />
                    ))}
                  </div>
                )}
                {rows && rows.some((r) => r.pinned) && (
                  <div role="group" aria-label="Pinned">
                    <div className="tk-menu__heading">📌 Pinned</div>
                    {rows.filter((r) => r.pinned).map((r) => noteRow({ ...r, time: r.updated }, 'pin:' + r.id, { nav: 'p' }))}
                  </div>
                )}
                <div role="group" aria-label="Pastas e notas">
                  {tree.map((n) => renderFolder(n))}
                  {(notesBy.get('') || []).length > 0 && <div className="tk-menu__heading">Sem pasta</div>}
                  {(notesBy.get('') || []).map((r) => noteRow(r, 'root:' + r.id, { inTree: true }))}
                </div>
              </>
            ) : (
              <>
                {folderHits.length > 0 && (
                  <div role="group" aria-label="Pastas">
                    <div className="tk-menu__heading">Pastas</div>
                    {folderHits.map((f) => (
                      <PinnedFolderRow key={'pf:' + f.path} path={f.path} role="option" meta={metaOf(f.path)} onReveal={revealFolder}
                        onContext={(path, x, y) => setCtxMenu({ x, y, kind: 'folder', path })} />
                    ))}
                  </div>
                )}
                {groups.map((g, gi) => (
                  <div key={gi} role="group" aria-label={g.title || 'Notas'}>
                    {g.title && <div className="tk-menu__heading">{g.title}</div>}
                    {g.items.map((r) => noteRow(r, g.title + r.id))}
                  </div>
                ))}
              </>
            )}
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
            <button type="button" className={'nts-side__trash' + (view === 'trash' ? ' is-on' : '')} aria-pressed={view === 'trash'}
              title="Notas excluídas — restaurar ou excluir de vez" onClick={() => setView(view === 'trash' ? 'note' : 'trash')}>
              <Icon name="trash-2" size={12} /> Lixeira{trashCount > 0 && <span className="nts-side__trash-n">{trashCount}</span>}
            </button>
          </div>
        </aside>

        <section className="nts__main">
          <div className="nts-views" role="tablist" aria-label="Visão">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
                className={'nts-views__tab' + (view === v.id ? ' is-on' : '')} onClick={() => setView(v.id)}>
                <Icon name={v.icon} size={13} /> {v.label}
              </button>
            ))}
            {view === 'trash' && (
              <span className="nts-views__tab is-on is-extra" role="tab" aria-selected="true"><Icon name="trash-2" size={13} /> Lixeira</span>
            )}
          </div>
          {view === 'tasks' ? (
            <TasksPanel tag={ui.tag} onOpen={(id) => openNote(id)} toast={toast} />
          ) : view === 'trash' ? (
            <TrashPanel onOpen={(id) => openNote(id)} toast={toast} />
          ) : view === 'graph' ? (
            <GraphPanel currentId={current ? current.note.id : ui.selectedId} onOpen={(id) => openNote(id)} onOpenLink={openLink} toast={toast} />
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
              onNoteChange={(n) => setCurrent((c) => (c && c.note.id === n.id ? { ...c, note: n } : c))}
              folderOptions={folderOptions}
              autosaveMs={prefs.autosaveMs}
              onRevealFolder={revealFolder}
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
          y={Math.max(8, Math.min(ctxMenu.y, window.innerHeight - (ctxMenu.kind === 'folder' ? 470 : 190)))}
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
          clashOf={(name) => notesApi().folderClash(dialog.path, { newName: name })}
          onSubmit={async (name, opts) => followRename(dialog.path, await notesApi().renameFolder(dialog.path, name, opts))}
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
      {dialog && dialog.kind === 'movefolder' && (
        <MoveFolderModal
          path={dialog.path}
          folders={folders}
          onClose={() => setDialog(null)}
          onPick={(parent) => moveFolderTo(dialog.path, parent)}
        />
      )}
      {dialog && dialog.kind === 'merge' && (
        <ConfirmModal
          icon="merge"
          title={`Mesclar “${baseName(dialog.from)}” em “${dialog.into}”?`}
          description="Já existe uma pasta com esse nome no destino. As notas e subpastas das duas ficam juntas (nome de nota repetido ganha “(2)”) e a configuração da pasta de destino é mantida."
          confirmLabel="Mesclar"
          onClose={() => setDialog(null)}
          onConfirm={dialog.run}
        />
      )}
      {dialog && dialog.kind === 'folderSettings' && (
        <FolderSettingsModal path={dialog.path} meta={metaOf(dialog.path)} onClose={() => setDialog(null)} />
      )}
      {dialog && dialog.kind === 'settings' && (
        <NotesSettingsModal prefs={prefs} setPrefs={setPrefs} toast={toast} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
