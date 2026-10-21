import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, recoverUnsaved, shortTime, cleanError } from '../../notes/client.js';
import { normalize } from '../../commands/search.js';
import { TEMPLATES, fromTemplate } from '../../diagrams/templates.js';
import { DiagramEditor } from './DiagramEditor.jsx';

const { PageHeader, Button, EmptyState, Icon } = DS;

/**
 * Diagramas: notas do tipo 'diagram' (texto Mermaid) com preview ao vivo.
 * Moram na mesma pasta das Notas — tags, pastas, histórico, lixeira e busca vêm de graça.
 * `request`: { template } cria um diagrama novo · { id } abre um existente (vem da command palette).
 */
export function DiagramsScreen({ toast, request }) {
  const [items, setItems] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [ui, setUi] = usePersisted('diagrams.ui', { selectedId: null });
  const [current, setCurrent] = React.useState(null); // nota completa em edição
  const [menu, setMenu] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try { setItems(await notesApi().list({ type: 'diagram' })); } catch (e) { toast('Não foi possível listar os diagramas', cleanError(e), 'error'); setItems([]); }
  }, [toast]);

  const open = React.useCallback(async (id) => {
    const n = id ? await notesApi().get(id).catch(() => null) : null;
    if (n && n.type === 'diagram') { setCurrent(n); setUi({ selectedId: n.id }); } else { setCurrent(null); setUi({ selectedId: null }); }
  }, [setUi]);

  const create = React.useCallback(async (templateId) => {
    setMenu(false);
    try {
      const n = await notesApi().create(fromTemplate(templateId));
      await refresh();
      if (n) await open(n.id);
    } catch (e) { toast('Não foi possível concluir', cleanError(e), 'error'); }
  }, [refresh, open, toast]);

  // Primeira abertura: recupera o que ficou só no backup local, carrega a lista e reabre o último diagrama.
  React.useEffect(() => {
    recoverUnsaved().catch(() => {}).then(refresh).then(() => ui.selectedId && !request && open(ui.selectedId));
    return notesApi().onChanged((evt) => { if (evt && evt.type !== 'viewed') refresh(); });
  }, []);

  React.useEffect(() => {
    if (!request) return;
    if (request.template) create(request.template);
    else if (request.id) open(request.id);
  }, [request && request.nonce]);

  const remove = async () => {
    if (!current) return;
    const n = current;
    try {
      await notesApi().remove(n.id);
      setCurrent(null); setUi({ selectedId: null });
      toast('Diagrama movido para a lixeira', 'Ele continua recuperável na lixeira de Notas');
    } catch (e) { toast('Não foi possível concluir', cleanError(e), 'error'); }
  };

  const shown = React.useMemo(() => {
    const q = normalize(query);
    return (items || []).filter((n) => !q || normalize(n.title + ' ' + n.tags.join(' ')).includes(q));
  }, [items, query]);

  return (
    <div className="dgm-screen">
      <PageHeader
        icon="workflow"
        title="Diagramas"
        subtitle="ER, fluxos, sequência e estados em Mermaid — preview ao vivo, salvo junto das suas Notas"
        actions={
          <div className="dgm-new">
            <Button variant="primary" icon="plus" onClick={() => setMenu((m) => !m)}>Novo diagrama</Button>
            {menu && (
              <div className="dgm-new__menu" role="menu" onMouseLeave={() => setMenu(false)}>
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" role="menuitem" className="dgm-new__item" onClick={() => create(t.id)}>
                    <Icon name={t.icon} size={14} /> {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />
      <div className="dgm">
        <aside className="dgm__side">
          <label className="tk-input tk-input--sm">
            <Icon name="search" size={14} className="tk-input__icon" />
            <input value={query} placeholder="Buscar diagramas…" aria-label="Buscar diagramas" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="dgm-list tk-scroll">
            {items === null && <div className="dgm-list__empty">Carregando…</div>}
            {items && !shown.length && <div className="dgm-list__empty">{items.length ? 'Nada encontrado' : 'Nenhum diagrama ainda'}</div>}
            {shown.map((n) => (
              <button key={n.id} type="button" className={'dgm-row' + (current && current.id === n.id ? ' is-active' : '')} onClick={() => open(n.id)}>
                <Icon name="workflow" size={14} />
                <span className="dgm-row__title">{n.title}</span>
                <span className="dgm-row__time">{shortTime(n.updated)}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="dgm__main">
          {current
            ? <DiagramEditor key={current.id} initial={current} onSaved={refresh} onDelete={remove} toast={toast} />
            : (
              <div className="dgm-empty">
                <EmptyState
                  title="Nenhum diagrama aberto"
                  description="Crie um diagrama a partir de um modelo ou escolha um da lista."
                  action={<Button variant="primary" icon="plus" onClick={() => create('er')}>Novo diagrama ER</Button>}
                />
              </div>
            )}
        </main>
      </div>
    </div>
  );
}
