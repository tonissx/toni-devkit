import { DS } from '../../lib/ds.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { TEMPLATE_VARS } from '../../notes/templates.js';

const { Modal, Button, Icon, Spinner } = DS;

// Template de exemplo criado pelo botão "Criar template de exemplo" (a pasta Templates nasce junto).
const EXAMPLE = [
  '# Reunião — {{data}}',
  '',
  '**Participantes:** ',
  '**Assunto:** {{cursor}}',
  '',
  '## Decisões',
  '- ',
  '',
  '## Próximos passos',
  '- [ ] ',
].join('\n');

const VARS = TEMPLATE_VARS.map((v) => '{{' + v.name + '}}').join(' · ');

/**
 * "Nova nota a partir de template": lista as notas da pasta Templates. Escolher cria a nota
 * (variáveis trocadas) na pasta ativa e abre no editor com o cursor em {{cursor}}.
 */
export function TemplateModal({ folder, onCreated, onEditTemplate, onClose, toast }) {
  const [list, setList] = React.useState(null);
  const [hi, setHi] = React.useState(0);
  const boxRef = React.useRef(null);

  React.useEffect(() => { notesApi().templates().then(setList, () => setList([])); }, []);
  React.useEffect(() => { if (list && list.length && boxRef.current) boxRef.current.focus(); }, [list]); // ↑/↓/Enter já funcionam

  const pick = async (t) => {
    try {
      const { note, cursor } = await notesApi().fromTemplate(t.id, { folder: folder || '' });
      onClose();
      onCreated(note, cursor);
    } catch (e) { toast('Não foi possível usar o template', cleanError(e), 'error'); }
  };

  // Cria a pasta Templates (se preciso) com uma nota nova — o exemplo ou em branco — e abre para editar.
  const newTemplate = async (example) => {
    try {
      const dir = await notesApi().ensureRootFolder('Templates');
      const n = await notesApi().create({ title: example ? 'Reunião' : 'Novo template', content: example ? EXAMPLE : 'Escreva o modelo aqui — digite { para ver as variáveis.', folder: dir });
      onClose();
      onEditTemplate(n);
    } catch (e) { toast('Não foi possível criar o template', cleanError(e), 'error'); }
  };

  const onKeyDown = (e) => {
    if (!list || !list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]); }
  };

  return (
    <Modal open onClose={onClose} icon="layout-template" title="Nova nota a partir de template" width={520}
      description={folder ? `A nota nasce em “${folder}”.` : 'A nota nasce em “Sem pasta”.'}
      footer={<>
        <Button variant="ghost" icon="plus" onClick={() => newTemplate(false)}>Novo template</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </>}>
      <div className="nts-tpl" tabIndex={-1} onKeyDown={onKeyDown} ref={boxRef}>
        {list === null ? (
          <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>
        ) : !list.length ? (
          <div className="nts-tpl__empty">
            <p><b>Nenhum template ainda.</b> Qualquer nota dentro da pasta <b>Templates</b> vira um template.</p>
            <p>Variáveis trocadas ao criar: <code>{VARS}</code>.</p>
            <Button variant="primary" icon="sparkles" onClick={() => newTemplate(true)}>Criar template de exemplo</Button>
          </div>
        ) : (
          <div role="listbox" aria-label="Templates">
            {list.map((t, i) => (
              <button key={t.id} type="button" role="option" aria-selected={i === hi}
                className={'nts-tpl__item' + (i === hi ? ' is-hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(t)}>
                <Icon name="layout-template" size={15} />
                <span className="nts-tpl__main">
                  <span className="nts-tpl__title">{t.title}</span>
                  {t.preview && <span className="nts-tpl__preview">{t.preview}</span>}
                </span>
              </button>
            ))}
            <p className="nts-tpl__hint">Variáveis: <code>{VARS}</code></p>
          </div>
        )}
      </div>
    </Modal>
  );
}
