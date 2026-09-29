import { DS } from '../../lib/ds.js';
import { notesApi } from '../../notes/client.js';
import { linkQueryAt, completeLink, varQueryAt, completeVar } from '../../notes/edit.js';
import { TEMPLATE_VARS, templateVars, varKey } from '../../notes/templates.js';
import { caretRect } from '../../notes/caret.js';
import { normalize } from '../../commands/search.js';

const { Icon } = DS;

/*
 * Fonte de sugestões: { id, label,
 *   detect(value, pos) → { start, query, … } | null   — o cursor está num ponto que pede sugestão?
 *   load(q) → itens | Promise<itens>                   — itens: { key, icon, title, aside?, desc?, … }
 *   complete(value, start, pos, item) → { value, start, end } }
 */

/** [[link]]: notas pela busca (vazio = recentes) + "Nova nota: …" quando nada tem o título digitado. */
export const linkSource = (noteId) => ({
  id: 'link',
  label: 'Sugestões de link',
  detect: linkQueryAt,
  load: async (q) => {
    const rows = await notesApi().search(q.query, { limit: 9 });
    const items = rows.filter((r) => r.id !== noteId).slice(0, 8)
      .map((r) => ({ key: r.id, icon: r.type === 'snippet' ? 'braces' : 'file-text', title: r.title, aside: r.folder, value: r.title }));
    const query = q.query.trim();
    if (query && !items.some((i) => normalize(i.title) === normalize(query))) {
      items.push({ key: 'new', icon: 'file-plus', title: <>Nova nota: <b>{query}</b></>, value: query });
    }
    return items;
  },
  complete: (value, start, pos, item) => completeLink(value, start, pos, item.value),
});

/** {{variável}} (só em templates): as variáveis com o que fazem e o valor de agora como exemplo. */
export const varSource = {
  id: 'var',
  label: 'Variáveis do template',
  detect: varQueryAt,
  load: (q) => {
    const now = templateVars(new Date());
    const want = varKey(q.query);
    const starts = (v) => varKey(v.name).startsWith(want); // sem acento: "{amanhã" também acha {{amanha}}
    return TEMPLATE_VARS
      .filter((v) => !want || starts(v) || normalize(v.desc).includes(want))
      .sort((a, b) => Number(!starts(a)) - Number(!starts(b)))
      .map((v) => ({ key: v.name, icon: v.name === 'cursor' ? 'text-cursor' : 'braces', title: <code>{'{{' + v.name + '}}'}</code>, desc: v.desc, aside: now[varKey(v.name)], value: v.name }));
  },
  complete: (value, start, pos, item) => completeVar(value, start, pos, item.value),
};

/**
 * Autocomplete no textarea do editor. useSuggest({ taRef, apply, sources }) → { popup, sync, onKey, close }:
 * - sync(): chame depois de cada mudança de texto/cursor (abre/fecha e busca — vale a 1ª fonte que detectar);
 * - onKey(e): chame no começo do onKeyDown — devolve true se tratou a tecla (↑/↓/Enter/Tab/Esc);
 * - popup: o elemento a renderizar dentro do contêiner (position: relative) do textarea.
 */
export function useSuggest({ taRef, apply, sources }) {
  const [st, setSt] = React.useState(null); // { src, q, items, hi, pos: { top, left } }
  const seq = React.useRef(0);
  const srcRef = React.useRef(sources);
  srcRef.current = sources;

  const close = () => { seq.current++; setSt(null); };

  const sync = React.useCallback(() => {
    const t = taRef.current;
    if (!t || t.selectionStart !== t.selectionEnd || document.activeElement !== t) { setSt(null); return; }
    let src = null, q = null;
    for (const s of srcRef.current) { q = s.detect(t.value, t.selectionStart); if (q) { src = s; break; } }
    if (!q) { setSt(null); return; }
    const c = caretRect(t, q.start);
    const pos = { top: t.offsetTop + c.top + c.height + 2, left: Math.min(t.offsetLeft + c.left, t.offsetLeft + t.clientWidth - 320) };
    const my = ++seq.current;
    Promise.resolve(src.load(q)).then((items) => {
      if (my !== seq.current) return;
      setSt((prev) => ({
        src, q, items, pos,
        hi: prev && prev.src === src && prev.q.start === q.start ? Math.min(prev.hi, Math.max(0, items.length - 1)) : 0,
      }));
    }).catch(() => setSt(null));
  }, []);

  const accept = (item) => {
    const t = taRef.current;
    if (!t || !st || !item) return;
    apply(t, st.src.complete(t.value, st.q.start, t.selectionStart, item));
    close();
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
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
    return false;
  };

  const popup = st && st.items.length > 0 && (
    <div className={'tk-menu nts-suggest is-' + st.src.id} role="listbox" aria-label={st.src.label} style={{ top: st.pos.top, left: Math.max(0, st.pos.left) }}
      onMouseDown={(e) => e.preventDefault() /* mantém o foco no textarea */}>
      {st.items.map((it, i) => (
        <div key={it.key} role="option" aria-selected={i === st.hi} className={'tk-menu__item' + (it.desc ? ' has-desc' : '') + (i === st.hi ? ' is-hi' : '')}
          onMouseEnter={() => setSt({ ...st, hi: i })} onClick={() => accept(it)}>
          <Icon name={it.icon} size={14} />
          <span className="nts-suggest__main">
            <span className="nts-suggest__title">{it.title}</span>
            {it.desc && <span className="nts-suggest__desc">{it.desc}</span>}
          </span>
          {it.aside && <span className="nts-suggest__folder">{it.aside}</span>}
        </div>
      ))}
    </div>
  );

  return { popup, sync, onKey, close };
}
