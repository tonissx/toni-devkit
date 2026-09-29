import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi } from '../../notes/client.js';

const { Icon } = DS;

/**
 * "Mencionada em (N)": notas que apontam para esta com [[link]]. Recolhível (lembra o estado),
 * atualiza sozinha quando qualquer nota muda. Some se ninguém aponta para a nota.
 */
export function Backlinks({ noteId, onOpen }) {
  const [items, setItems] = React.useState([]);
  const [ui, setUi] = usePersisted('notes.backlinks', { open: true });

  React.useEffect(() => {
    let alive = true, t = null;
    const load = () => notesApi().backlinks(noteId).then((r) => { if (alive) setItems(r || []); }).catch(() => {});
    load();
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(load, 150); });
    return () => { alive = false; off(); clearTimeout(t); };
  }, [noteId]);

  if (!items.length) return null;
  return (
    <div className={'nts-backlinks' + (ui.open ? ' is-open' : '')}>
      <button type="button" className="nts-backlinks__head" aria-expanded={ui.open} onClick={() => setUi((u) => ({ ...u, open: !u.open }))}>
        <Icon name={ui.open ? 'chevron-down' : 'chevron-right'} size={12} />
        <Icon name="link" size={12} />
        Mencionada em <span className="nts-backlinks__count">{items.length}</span>
      </button>
      {ui.open && (
        <div className="nts-backlinks__list tk-scroll">
          {items.map((b) => (
            <button key={b.id} type="button" className="nts-backlinks__item" onClick={() => onOpen(b.id)} title={'Abrir “' + b.title + '”'}>
              <span className="nts-backlinks__title">{b.title}{b.folder && <span className="nts-backlinks__folder"><Icon name="folder" size={10} /> {b.folder}</span>}</span>
              {b.line && <span className="nts-backlinks__line">{b.line}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
