import { DS } from '../../lib/ds.js';
import { notesApi } from '../../notes/client.js';
import { linkQueryAt, completeLink } from '../../notes/edit.js';
import { caretRect } from '../../notes/caret.js';
import { normalize } from '../../commands/search.js';

const { Icon } = DS;

/**
 * Autocomplete de [[link]] para o textarea do editor.
 * useLinkSuggest({ taRef, noteId, apply }) → { popup, sync, onKey }:
 * - sync(): chame depois de cada mudança de texto/cursor (abre/fecha e busca);
 * - onKey(e): chame no começo do onKeyDown — devolve true se tratou a tecla (↑/↓/Enter/Tab/Esc);
 * - popup: o elemento a renderizar dentro do contêiner (position: relative) do textarea.
 */
export function useLinkSuggest({ taRef, noteId, apply }) {
  const [st, setSt] = React.useState(null); // { start, query, items, hi, pos: { top, left } }
  const seq = React.useRef(0);

  const close = () => setSt(null);

  const sync = React.useCallback(() => {
    const t = taRef.current;
    if (!t || t.selectionStart !== t.selectionEnd || document.activeElement !== t) { setSt(null); return; }
    const q = linkQueryAt(t.value, t.selectionStart);
    if (!q) { setSt(null); return; }
    const c = caretRect(t, q.start);
    const pos = { top: t.offsetTop + c.top + c.height + 2, left: Math.min(t.offsetLeft + c.left, t.offsetLeft + t.clientWidth - 300) };
    const my = ++seq.current;
    notesApi().search(q.query, { limit: 9 }).then((rows) => {
      if (my !== seq.current) return;
      const items = rows.filter((r) => r.id !== noteId).slice(0, 8).map((r) => ({ id: r.id, title: r.title, folder: r.folder, type: r.type }));
      const query = q.query.trim();
      if (query && !items.some((i) => normalize(i.title) === normalize(query))) items.push({ id: null, title: query, create: true });
      setSt((prev) => ({ start: q.start, query: q.query, items, pos, hi: prev && prev.start === q.start ? Math.min(prev.hi, Math.max(0, items.length - 1)) : 0 }));
    }).catch(() => setSt(null));
  }, [noteId]);

  const accept = (item) => {
    const t = taRef.current;
    if (!t || !st || !item) return;
    apply(t, completeLink(t.value, st.start, t.selectionStart, item.title));
    seq.current++;
    setSt(null);
  };

  const onKey = (e) => {
    if (!st || !st.items.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setSt({ ...st, hi: (st.hi + d + st.items.length) % st.items.length });
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      accept(st.items[st.hi]);
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); seq.current++; close(); return true; }
    return false;
  };

  const popup = st && st.items.length > 0 && (
    <div className="tk-menu nts-suggest" role="listbox" aria-label="Sugestões de link" style={{ top: st.pos.top, left: Math.max(0, st.pos.left) }}
      onMouseDown={(e) => e.preventDefault() /* mantém o foco no textarea */}>
      {st.items.map((it, i) => (
        <div key={it.id || 'new'} role="option" aria-selected={i === st.hi} className={'tk-menu__item' + (i === st.hi ? ' is-hi' : '')}
          onMouseEnter={() => setSt({ ...st, hi: i })} onClick={() => accept(it)}>
          <Icon name={it.create ? 'file-plus' : it.type === 'snippet' ? 'braces' : 'file-text'} size={14} />
          <span className="nts-suggest__title">{it.create ? <>Nova nota: <b>{it.title}</b></> : it.title}</span>
          {it.folder && <span className="nts-suggest__folder">{it.folder}</span>}
        </div>
      ))}
    </div>
  );

  return { popup, sync, onKey, close };
}
