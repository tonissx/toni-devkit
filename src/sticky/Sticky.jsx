import { DS, isMod } from '../lib/ds.js';
import { useAutosave, notesApi, cleanError } from '../notes/client.js';
import { displayTitle } from '../notes/note.js';
import { continueList, toggleTaskLines, expandOnSpace } from '../notes/edit.js';
import { toggleWrap, makeLink, codeToggle } from '../notes/markup.js';
import { pasteProps } from '../notes/paste.js';
import { applyToTextarea } from '../notes/textarea.js';
import { normalize } from '../commands/search.js';
import { COLORS } from '../stickies/sticky.js';
import { NotePreview } from '../tools/notes/NotePreview.jsx';

const { Icon, Spinner } = DS;

const COLOR_LABEL = { accent: 'Cor do tema', keyword: 'Cor 2', string: 'Cor 3', bool: 'Cor 4', number: 'Cor 5' };

/** Botão do cabeçalho (fora da área de arrastar). */
function HeadButton({ icon, label, active, onClick }) {
  return (
    <button type="button" className={'stk-btn' + (active ? ' is-on' : '')} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Corpo editável: a nota com auto-save (mesmo hook do editor e da Quick Note). */
function StickyBody({ initial, editing, setEditing, setTitle, flushRef }) {
  const { note, update, status, error, flush } = useAutosave(initial, { delay: 400 });
  const ta = React.useRef(null);
  const [titles, setTitles] = React.useState(() => new Map());
  flushRef.current = flush;

  React.useEffect(() => { setTitle(displayTitle(note)); }, [note.title, note.content]);
  // [[links]]: títulos conhecidos (para o estilo de link inexistente). Atualiza quando outra nota muda.
  React.useEffect(() => {
    const load = () => notesApi().list().then((rows) => setTitles(new Map(rows.map((r) => [normalize(r.title).trim(), r.id]))), () => {});
    load();
    return notesApi().onChanged((evt) => { if (evt && evt.type !== 'saved') load(); });
  }, []);
  React.useEffect(() => { if (editing && ta.current) { ta.current.focus(); ta.current.selectionStart = ta.current.selectionEnd = ta.current.value.length; } }, [editing]);

  const resolve = React.useCallback((title) => titles.get(normalize(title).trim()) || null, [titles]);
  const openLink = async (title) => {
    const id = await notesApi().resolveLink(title).catch(() => null);
    notesApi().open(id ? { id } : { new: true, title });
  };
  const applyEdit = (t, r) => applyToTextarea(t, r, (content) => update({ content }));

  // Os atalhos do editor de notas que fazem sentido aqui (tarefas, negrito/itálico, código, Tab).
  const onKeyDown = (e) => {
    const t = e.target;
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); flush(); setEditing(false); return; }
    let r = null;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !isMod(e) && t.selectionStart === t.selectionEnd) r = continueList(t.value, t.selectionStart);
    else if (isMod(e) && !e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); r = toggleTaskLines(t.value, t.selectionStart, t.selectionEnd); }
    else if (e.key === ' ' && !isMod(e) && !e.altKey && t.selectionStart === t.selectionEnd) r = expandOnSpace(t.value, t.selectionStart);
    else if (isMod(e) && !e.altKey) {
      const k = e.key.toLowerCase(), s = t.selectionStart, en = t.selectionEnd;
      if (k === 'b' && !e.shiftKey) r = toggleWrap(t.value, s, en, '**');
      else if (k === 'i' && !e.shiftKey) r = toggleWrap(t.value, s, en, '*');
      else if (k === 'k' && e.shiftKey) r = codeToggle(t.value, s, en);
      else if (k === 'k') r = makeLink(t.value, s, en);
      else if (k === 'e') { e.preventDefault(); flush(); setEditing(false); return; }
    } else if (e.key === 'Tab' && !e.shiftKey) {
      r = { value: t.value.slice(0, t.selectionStart) + '  ' + t.value.slice(t.selectionEnd), start: t.selectionStart + 2, end: t.selectionStart + 2 };
    }
    if (r) { e.preventDefault(); applyEdit(t, r); }
  };

  return (
    <div className="stk-body">
      {status === 'error' && <div className="stk-error" role="alert">Não salvo: {error} <button type="button" onClick={flush}>Tentar de novo</button></div>}
      {editing ? (
        <textarea ref={ta} className="stk-text tk-scroll" value={note.content} spellCheck={false} aria-label="Conteúdo da nota (Markdown)"
          placeholder={'Escreva em Markdown…\n- [ ] tarefa @hoje'} onChange={(e) => update({ content: e.target.value })} onKeyDown={onKeyDown}
          {...pasteProps({ insert: (r) => applyEdit(ta.current, r), onError: () => {} })} />
      ) : (
        <div className="stk-view tk-scroll">
          <NotePreview content={note.content} resolve={resolve} onOpenLink={openLink} onChange={(content) => update({ content })}
            onCopy={(code) => window.devkit.clipboard.write(code)} onDoubleClick={() => setEditing(true)} />
        </div>
      )}
    </div>
  );
}

/**
 * Janela de uma sticky note: a nota fixada na tela. Cabeçalho = área de arrastar, com a faixa na cor escolhida;
 * Visualizar (checklists clicáveis) ou Editar (Ctrl+E / duplo clique). As alterações gravam na própria nota.
 */
export function Sticky() {
  const [me, setMe] = React.useState(null);        // { noteId, color, collapsed }
  const [initial, setInitial] = React.useState(undefined); // undefined = carregando · null = nota não existe
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [menu, setMenu] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const flushRef = React.useRef(() => Promise.resolve(true));
  const api = window.devkit.stickies;

  React.useEffect(() => {
    api.self().then(async (s) => {
      setMe(s);
      if (!s) { setInitial(null); return; }
      const n = await notesApi().get(s.noteId).catch(() => null);
      setInitial(n || null);
      if (n) { setTitle(displayTitle(n)); if (!String(n.content || '').trim()) setEditing(true); }
    });
    // Cor/recolhida mudadas por outra janela: acompanha.
    return api.onChanged((evt) => { if (evt && evt.sticky) setMe((m) => (m && m.noteId === evt.noteId ? { ...m, ...evt.sticky } : m)); });
  }, []);

  React.useEffect(() => {
    const h = (e) => { if (isMod(e) && e.key.toLowerCase() === 'e' && !editing && initial) { e.preventDefault(); setEditing(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editing, initial]);

  const set = async (patch) => {
    setMe((m) => ({ ...m, ...patch }));
    try { setErr(null); setMe(await api.set(patch)); } catch (e) { setErr(cleanError(e)); }
  };
  const close = async () => { await flushRef.current(); api.close(); };
  const openInApp = async () => { await flushRef.current(); if (me) notesApi().open({ id: me.noteId }); };

  const color = me && COLORS.includes(me.color) ? me.color : 'accent';
  const collapsed = !!(me && me.collapsed);

  return (
    <div className={'stk is-' + color + (collapsed ? ' is-collapsed' : '')}>
      <header className="stk-head" onDoubleClick={(e) => { if (!e.target.closest('button') && me) set({ collapsed: !collapsed }); }}>
        <span className="stk-title" title={title}>{title || 'Sticky note'}</span>
        <div className="stk-actions">
          <div className="stk-colors">
            <button type="button" className="stk-btn stk-dot" title="Cor" aria-label="Cor da sticky" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><i /></button>
            {menu && (
              <div className="stk-menu" role="listbox" aria-label="Cor">
                {COLORS.map((c) => (
                  <button type="button" key={c} role="option" aria-selected={c === color} title={COLOR_LABEL[c]}
                    className={'stk-swatch is-' + c + (c === color ? ' is-on' : '')} onClick={() => { setMenu(false); set({ color: c }); }} />
                ))}
              </div>
            )}
          </div>
          {initial && <HeadButton icon={editing ? 'eye' : 'pencil'} label={editing ? 'Visualizar (Ctrl+E)' : 'Editar (Ctrl+E)'} onClick={() => { if (editing) flushRef.current(); setEditing(!editing); }} />}
          {initial && <HeadButton icon="external-link" label="Abrir no Devkit" onClick={openInApp} />}
          <HeadButton icon="x" label="Tirar da tela (a nota continua)" onClick={close} />
        </div>
      </header>
      {!collapsed && (
        initial === undefined ? <div className="stk-msg"><Spinner size={14} /> Carregando…</div>
          : initial === null ? <div className="stk-msg">Esta nota não existe mais.</div>
            : <StickyBody initial={initial} editing={editing} setEditing={setEditing} setTitle={setTitle} flushRef={flushRef} />
      )}
      {err && !collapsed && <div className="stk-error" role="alert">{err}</div>}
    </div>
  );
}
