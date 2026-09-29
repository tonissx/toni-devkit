import { DS } from '../../lib/ds.js';
import { notesApi, shortTime, cleanError } from '../../notes/client.js';
import { NotePreview } from './NotePreview.jsx';

const { Button, EmptyState, Spinner, Icon, Modal } = DS;

const noop = () => {};

/**
 * Painel "Lixeira": notas excluídas (arquivos em .trash\), mais recentes primeiro. Restaurar volta
 * para a pasta de origem (recriada se preciso); excluir de vez e esvaziar pedem confirmação.
 */
export function TrashPanel({ onOpen, toast }) {
  const [items, setItems] = React.useState(null); // null = carregando
  const [sel, setSel] = React.useState(null);     // file
  const [confirm, setConfirm] = React.useState(null); // { kind: 'one', item } | { kind: 'all' }
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const list = await notesApi().trashList();
      setItems(list);
      setSel((s) => (list.some((i) => i.file === s) ? s : list[0] ? list[0].file : null));
      setError(null);
    } catch (e) { setError(cleanError(e)); setItems([]); }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    let t = null;
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);

  const current = items && items.find((i) => i.file === sel);

  const restore = async (item) => {
    try {
      const n = await notesApi().restoreFromTrash(item.file);
      toast('Nota restaurada', (n.folder ? 'em ' + n.folder : 'em “Sem pasta”') + (n.id !== item.id ? ' — como cópia (já existia uma nota com o mesmo id)' : ''),
        'ok');
      onOpen(n.id);
    } catch (e) { toast('Não foi possível restaurar', cleanError(e), 'error'); }
  };
  const destroy = async (item) => {
    try { await notesApi().deleteFromTrash(item.file); toast('Excluída de vez', item.title); }
    catch (e) { toast('Não foi possível excluir', cleanError(e), 'error'); }
  };
  const empty = async () => {
    try { const n = await notesApi().emptyTrash(); toast('Lixeira esvaziada', n + (n === 1 ? ' nota excluída de vez' : ' notas excluídas de vez')); }
    catch (e) { toast('Não foi possível esvaziar', cleanError(e), 'error'); }
  };

  return (
    <div className="nts-tasks nts-trash">
      <div className="nts-tasks__head">
        <Icon name="trash-2" size={15} />
        <h2>Lixeira</h2>
        {items && <span className="nts-tasks__count">{items.length} {items.length === 1 ? 'nota' : 'notas'}</span>}
        <span className="nts-editor__spacer" />
        <Button size="sm" variant="ghost" icon="folder-open" onClick={() => notesApi().openFolder()}>Abrir pasta</Button>
        <Button size="sm" variant="secondary" icon="trash" disabled={!items || !items.length} onClick={() => setConfirm({ kind: 'all' })}>Esvaziar lixeira</Button>
      </div>
      {error && <div className="nts-list__msg is-error">Erro ao ler a lixeira: {error}</div>}
      {items === null ? (
        <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>
      ) : !items.length ? (
        <div className="nts-empty">
          <EmptyState title="A lixeira está vazia" animate="none" description="Notas excluídas ficam aqui até você restaurar ou excluir de vez." />
        </div>
      ) : (
        <div className="nts-trash__body">
          <div className="nts-trash__list tk-scroll" role="listbox" aria-label="Notas excluídas">
            {items.map((it) => (
              <button key={it.file} type="button" role="option" aria-selected={it.file === sel}
                className={'nts-row nts-trash__item' + (it.file === sel ? ' is-sel' : '')} onClick={() => setSel(it.file)}
                onDoubleClick={() => restore(it)}>
                <Icon name={it.type === 'snippet' ? 'braces' : 'file-text'} size={14} className="nts-row__icon" />
                <div className="nts-row__main">
                  <div className="nts-row__title">{it.title}</div>
                  <div className="nts-row__sub">{it.preview}</div>
                  <div className="nts-row__tags">
                    <span className="nts-row__folder" title="Pasta de origem"><Icon name={it.folder ? 'folder' : 'inbox'} size={10} /> {it.folder || 'Sem pasta'}</span>
                  </div>
                </div>
                <span className="nts-row__time" title={'Excluída em ' + new Date(it.deletedAt).toLocaleString('pt-BR')}>{shortTime(it.deletedAt)}</span>
              </button>
            ))}
          </div>
          {current && (
            <div className="nts-trash__view">
              <div className="nts-trash__actions">
                <span className="nts-trash__title">{current.title}</span>
                <Button size="sm" variant="ghost" icon="x" onClick={() => setConfirm({ kind: 'one', item: current })}>Excluir de vez</Button>
                <Button size="sm" variant="primary" icon="rotate-ccw" onClick={() => restore(current)}>Restaurar</Button>
              </div>
              <div className="nts-preview tk-scroll">
                <NotePreview content={current.content} resolve={() => null} onOpenLink={noop} onCopy={noop} />
              </div>
            </div>
          )}
        </div>
      )}
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} icon="trash" width={440}
          title={confirm.kind === 'all' ? 'Esvaziar a lixeira?' : `Excluir “${confirm.item.title}” de vez?`}
          description={confirm.kind === 'all'
            ? `${items.length} ${items.length === 1 ? 'nota será apagada' : 'notas serão apagadas'} do disco, junto com o histórico de versões delas. Não dá para desfazer.`
            : 'O arquivo é apagado do disco, junto com o histórico de versões da nota. Não dá para desfazer.'}
          footer={<>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button variant="primary" icon="trash" onClick={() => { const c = confirm; setConfirm(null); c.kind === 'all' ? empty() : destroy(c.item); }}>
              {confirm.kind === 'all' ? 'Esvaziar' : 'Excluir de vez'}
            </Button>
          </>} />
      )}
    </div>
  );
}
