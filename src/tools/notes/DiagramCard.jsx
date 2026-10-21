import { DS } from '../../lib/ds.js';
import { sceneThumb } from '../../diagrams/thumb.js';
import { parseScene, sceneIsEmpty } from '../../diagrams/scene.js';

const { Button, Icon } = DS;

/**
 * No lugar do editor de texto, para notas do tipo 'diagram': o conteúdo é o JSON de um desenho e editá-lo à mão o
 * corrompe. Mostra uma miniatura (carrega o Excalidraw sob demanda) e leva para a ferramenta Diagramas.
 * readOnly (lixeira): sem o botão de abrir.
 */
export function DiagramCard({ note, readOnly }) {
  const parsed = React.useMemo(() => parseScene(note.content), [note.content]);
  const empty = !parsed.error && sceneIsEmpty(parsed.scene);
  const count = parsed.error ? 0 : parsed.scene.elements.filter((e) => !e.isDeleted).length;
  const [thumb, setThumb] = React.useState('');
  const [thumbError, setThumbError] = React.useState('');

  React.useEffect(() => {
    setThumb(''); setThumbError('');
    if (parsed.error || empty) return undefined;
    let gone = false;
    sceneThumb(note.content).then((r) => {
      if (gone) return;
      if (r.url) setThumb(r.url); else if (r.error) setThumbError(r.error);
    });
    return () => { gone = true; };
  }, [parsed, empty]);

  return (
    <div className="nts-diagram">
      <div className="nts-diagram__bar">
        <Icon name="workflow" size={16} />
        <span className="nts-diagram__title">
          {parsed.error ? 'Diagrama em outro formato' : empty ? 'Diagrama em branco' : `Diagrama · ${count} ${count === 1 ? 'elemento' : 'elementos'}`}
        </span>
        <span className="nts-editor__spacer" />
        {!readOnly && <Button variant="primary" size="sm" icon="external-link" onClick={() => window.devkit.app.open('diagrams', { id: note.id })}>Abrir em Diagramas</Button>}
      </div>
      {parsed.error ? (
        <div className="nts-diagram__legacy" role="alert">
          <p>{parsed.error} O texto está preservado abaixo e não foi alterado.</p>
          <pre>{parsed.raw}</pre>
        </div>
      ) : (
        <div className="nts-diagram__thumb">
          {thumb && <img src={thumb} alt="Miniatura do diagrama" />}
          {!thumb && !thumbError && !empty && <span className="nts-diagram__hint">Gerando miniatura…</span>}
          {empty && <span className="nts-diagram__hint">Ainda não há nada desenhado. Abra em Diagramas para começar.</span>}
          {thumbError && <span className="nts-diagram__hint is-error">Não foi possível gerar a miniatura: {thumbError}</span>}
        </div>
      )}
    </div>
  );
}
