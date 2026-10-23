import { DS } from '../../lib/ds.js';
import { rankNotes } from '../../notes/quickopen.js';

const { Modal, Input, Icon } = DS;

const rowIcon = (n) => (n.type === 'snippet' ? 'braces' : n.type === 'diagram' ? 'workflow' : n.quick ? 'sticky-note' : 'file-text');

function Hl({ text, idx }) {
  if (!idx || !idx.length) return text;
  const set = new Set(idx);
  return [...text].map((c, i) => (set.has(i) ? <mark key={i} className="tk-hl">{c}</mark> : c));
}

/** Ctrl/⌘+P: abrir nota pelo nome (só notas). Sem texto, mostra as abertas por último. */
export function QuickOpen({ notes, recentIds, onPick, onClose }) {
  const [q, setQ] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const rows = React.useMemo(() => rankNotes(notes, q, { recentIds, limit: 50 }), [notes, q, recentIds]);
  const listRef = React.useRef(null);
  React.useEffect(() => { setHi(0); }, [q]);
  React.useEffect(() => {
    const el = listRef.current && listRef.current.children[hi];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  const pick = (id) => { onClose(); onPick(id); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && rows[hi]) { e.preventDefault(); pick(rows[hi].note.id); }
  };
  return (
    <Modal open onClose={onClose} icon="search" title="Abrir nota" width={520}>
      <Input autoFocus size="sm" value={q} placeholder="Nome da nota…" aria-label="Buscar nota" onChange={(e) => setQ(e.target.value)} onKeyDown={key} />
      <div className="nts-move tk-scroll" role="listbox" aria-label="Notas" ref={listRef}>
        {rows.map(({ note: n, idx }, i) => (
          <button key={n.id} type="button" role="option" aria-selected={i === hi}
            className={'nts-move__item' + (i === hi ? ' is-hi' : '')}
            onMouseEnter={() => setHi(i)} onClick={() => pick(n.id)}>
            <Icon name={rowIcon(n)} size={14} />
            <span><Hl text={n.title} idx={idx} /></span>
            {n.folder && <span className="nts-move__path">{n.folder}</span>}
          </button>
        ))}
        {!rows.length && <div className="nts-list__msg">{q ? `Nenhuma nota para “${q}”.` : 'Nenhuma nota ainda.'}</div>}
      </div>
    </Modal>
  );
}
