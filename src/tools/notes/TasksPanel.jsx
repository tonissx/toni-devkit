import { DS } from '../../lib/ds.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { isoDate } from '../../notes/edit.js';

const { SegmentedControl, EmptyState, Spinner, Icon } = DS;

const STATUS_OPTIONS = [
  { value: 'open', label: 'Abertas' },
  { value: 'done', label: 'Concluídas' },
];

const dueLabel = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Agrupa por prazo: vencidas · hoje · próximas · sem data (concluídas ficam num grupo só). */
function group(tasks, status, today) {
  if (status === 'done') return tasks.length ? [{ id: 'done', title: 'Concluídas', items: tasks }] : [];
  const g = { late: [], today: [], next: [], none: [] };
  for (const t of tasks) {
    if (!t.due) g.none.push(t);
    else if (t.due < today) g.late.push(t);
    else if (t.due === today) g.today.push(t);
    else g.next.push(t);
  }
  return [
    { id: 'late', title: 'Vencidas', items: g.late },
    { id: 'today', title: 'Hoje', items: g.today },
    { id: 'next', title: 'Próximas', items: g.next },
    { id: 'none', title: 'Sem data', items: g.none },
  ].filter((x) => x.items.length);
}

/**
 * Painel "Tarefas": todas as "- [ ]" de todas as notas. Marcar aqui grava na nota de origem;
 * clicar no texto abre a nota. Atualiza sozinho quando qualquer nota muda (notes:changed).
 */
export function TasksPanel({ tag, onOpen, toast }) {
  const [status, setStatus] = React.useState('open');
  const [tasks, setTasks] = React.useState(null); // null = carregando
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      setTasks(await notesApi().tasks({ status, tag: tag || undefined }));
      setError(null);
    } catch (e) { setError(cleanError(e)); setTasks([]); }
  }, [status, tag]);

  React.useEffect(() => { setTasks(null); refresh(); }, [refresh]);
  React.useEffect(() => {
    let t = null;
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
    return () => { off(); clearTimeout(t); };
  }, [refresh]);

  const toggle = async (task) => {
    try { await notesApi().toggleTask(task.noteId, task.index); }
    catch (e) { toast('Não foi possível atualizar a tarefa', cleanError(e), 'error'); }
  };

  const today = isoDate();
  const groups = tasks ? group(tasks, status, today) : [];
  const total = tasks ? tasks.length : 0;

  return (
    <div className="nts-tasks">
      <div className="nts-tasks__head">
        <h2>Tarefas{tag ? <span className="nts-tasks__tag"> #{tag}</span> : null}</h2>
        <span className="nts-tasks__count" role="status">
          {tasks ? `${total} ${status === 'open' ? (total === 1 ? 'aberta' : 'abertas') : (total === 1 ? 'concluída' : 'concluídas')}` : ''}
        </span>
        <span className="nts-editor__spacer" />
        <SegmentedControl size="sm" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </div>
      <div className="nts-tasks__body tk-scroll">
        {tasks === null && <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>}
        {error && <div className="nts-list__msg is-error">Erro ao ler as tarefas: {error}</div>}
        {tasks && !error && total === 0 && (
          <EmptyState
            title={status === 'open' ? 'Nenhuma tarefa aberta.' : 'Nenhuma tarefa concluída.'}
            animate="none"
            description={status === 'open' ? 'Escreva “- [ ] algo” numa nota, use Ctrl+L, ou capture pela palette: task: algo.' : 'Marque uma tarefa para vê-la aqui.'}
          />
        )}
        {groups.map((g) => (
          <section key={g.id} className={'nts-tasks__group is-' + g.id} aria-label={g.title}>
            <div className="tk-menu__heading">{g.title} <span className="nts-tasks__n">{g.items.length}</span></div>
            {g.items.map((t) => (
              <div key={t.noteId + ':' + t.index} className={'nts-task' + (t.checked ? ' is-done' : '')}>
                <input type="checkbox" className="md-task" checked={t.checked} onChange={() => toggle(t)} aria-label={t.checked ? 'Reabrir tarefa' : 'Concluir tarefa'} />
                <div className="nts-task__main">
                  <button type="button" className="nts-task__text" onClick={() => onOpen(t.noteId)} title="Abrir a nota">{t.text || '(sem texto)'}</button>
                  <div className="nts-task__meta">
                    {t.priority && <span className={'nts-pill is-p' + t.priority} title={'Prioridade ' + t.priority}>!{t.priority}</span>}
                    {t.due && <span className={'nts-pill is-due' + (!t.checked && t.due < today ? ' is-late' : '')} title={t.due}><Icon name="calendar" size={11} /> {dueLabel(t.due)}</span>}
                    <span className="nts-task__note"><Icon name="file-text" size={11} /> {t.noteTitle}</span>
                  </div>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
