import { DS } from '../../lib/ds.js';
import { useAutosave, statusLabel } from '../../notes/client.js';
import { renderDiagram } from '../../diagrams/render.js';
import { diagramKind } from '../../diagrams/templates.js';
import { DiagramPreview } from './DiagramPreview.jsx';

const { IconButton, Icon } = DS;

const RENDER_DELAY = 300;

/**
 * Editor de um diagrama: texto Mermaid à esquerda, preview ao vivo à direita, auto-save como nas Notas.
 * Monte com key={note.id}. Erro de sintaxe não derruba o preview: o último diagrama válido continua na tela.
 */
export function DiagramEditor({ initial, onSaved, onDelete }) {
  const { note, update, status, error: saveError } = useAutosave(initial, { onSaved });
  const [svg, setSvg] = React.useState('');
  const [renderError, setRenderError] = React.useState('');
  const [busy, setBusy] = React.useState(true);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await renderDiagram(note.content);
      if (mine !== seq.current) return; // chegou depois de uma digitação mais nova
      if (r.svg) { setSvg(r.svg); setRenderError(''); } else setRenderError(r.error || 'Erro ao renderizar');
      setBusy(false);
    }, RENDER_DELAY);
    return () => clearTimeout(t);
  }, [note.content]);

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault(); // Tab indenta (2 espaços) em vez de sair do campo
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value } = el;
    update({ content: value.slice(0, a) + '  ' + value.slice(b) });
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
  };

  const kind = diagramKind(note.content);

  return (
    <div className="dgm-editor">
      <div className="dgm-editor__head">
        <Icon name="workflow" size={16} />
        <input
          className="dgm-title"
          value={note.title}
          placeholder="Título do diagrama"
          aria-label="Título do diagrama"
          onChange={(e) => update({ title: e.target.value })}
        />
        {kind && <span className="dgm-kind">{kind}</span>}
        <span className={'dgm-status' + (status === 'error' ? ' is-error' : '')} title={saveError || ''}>{statusLabel(status)}</span>
        <IconButton icon="trash-2" label="Mover para a lixeira" onClick={onDelete} />
      </div>
      <div className="dgm-editor__body">
        <textarea
          className="dgm-code"
          value={note.content}
          spellCheck={false}
          aria-label="Código Mermaid"
          onChange={(e) => update({ content: e.target.value })}
          onKeyDown={onKeyDown}
        />
        <DiagramPreview svg={svg} error={renderError} busy={busy} fitKey={note.id} />
      </div>
    </div>
  );
}
