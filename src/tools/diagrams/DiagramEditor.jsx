import { DS } from '../../lib/ds.js';
import { useAutosave, statusLabel, cleanError } from '../../notes/client.js';
import { loadExcalidraw } from '../../diagrams/excalidraw.js';
import { parseScene, serializeScene } from '../../diagrams/scene.js';
import { exportDiagram } from '../../diagrams/export.js';

const { IconButton, Icon, Button } = DS;

/**
 * Editor de um diagrama: o Excalidraw embutido, com auto-save como nas Notas. Monte com key={note.id}.
 * O desenho é a nota inteira (JSON da cena); texto que não for uma cena (diagrama antigo em Mermaid) NÃO é aberto
 * nem sobrescrito: aparece como somente leitura.
 */
export function DiagramEditor({ initial, onSaved, onDelete, toast }) {
  const parsed = React.useMemo(() => parseScene(initial.content), []); // só o conteúdo de quando abriu
  const { note, update, status, error: saveError } = useAutosave(initial, { onSaved });
  const hostRef = React.useRef(null);
  const handle = React.useRef(null);
  const [loadError, setLoadError] = React.useState('');
  const [loading, setLoading] = React.useState(!parsed.error);

  React.useEffect(() => {
    if (parsed.error) return undefined;
    let cancelled = false;
    let mounted = null;
    loadExcalidraw().then((X) => {
      if (cancelled) return;
      const { scene } = parsed;
      // O onChange do Excalidraw dispara a cada movimento do ponteiro e a cada seleção; só vira gravação quando o
      // desenho muda de fato (versão da cena, imagens ou cor de fundo). A primeira chamada (ao montar) não grava.
      const keyOf = (els, app, files) => `${X.sceneVersion(els)}|${Object.keys(files || {}).length}|${app && app.viewBackgroundColor}`;
      let last = keyOf(scene.elements, scene.appState, scene.files);
      mounted = X.mount(hostRef.current, {
        initialData: { elements: scene.elements, appState: scene.appState, files: scene.files },
        onChange: (els, app, files) => {
          const k = keyOf(els, app, files);
          if (k === last) return;
          last = k;
          update({ content: serializeScene(els, app, files) });
        },
      });
      handle.current = mounted;
      setLoading(false);
    }).catch((e) => { if (!cancelled) { setLoadError(cleanError(e)); setLoading(false); } });
    return () => { cancelled = true; handle.current = null; if (mounted) mounted.unmount(); };
  }, []);

  /** Estado atual do editor, para exportar (o que está na tela, mesmo antes do auto-save). */
  const currentScene = () => {
    const api = handle.current && handle.current.api();
    if (!api) return null;
    return { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() };
  };
  const doExport = async (kind) => {
    const scene = currentScene();
    if (!scene) { toast('Não foi possível exportar', 'O editor ainda está carregando', 'error'); return; }
    try {
      const r = await exportDiagram(kind, { scene, title: note.title });
      if (r) toast('Diagrama exportado', r.name);
    } catch (e) { toast('Não foi possível exportar', cleanError(e), 'error'); }
  };

  const ready = !parsed.error && !loadError && !loading;

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
        <span className={'dgm-status' + (status === 'error' ? ' is-error' : '')} title={saveError || ''}>{statusLabel(status)}</span>
        <Button variant="ghost" size="sm" icon="image" disabled={!ready} onClick={() => doExport('png')}>PNG</Button>
        <Button variant="ghost" size="sm" icon="file-image" disabled={!ready} onClick={() => doExport('svg')}>SVG</Button>
        <Button variant="ghost" size="sm" icon="download" disabled={!ready} onClick={() => doExport('excalidraw')}>.excalidraw</Button>
        <IconButton icon="trash-2" label="Mover para a lixeira" onClick={onDelete} />
      </div>
      <div className="dgm-editor__body">
        {parsed.error ? (
          <div className="dgm-legacy" role="alert">
            <div className="dgm-legacy__msg"><Icon name="triangle-alert" size={16} /> {parsed.error} Ele provavelmente foi criado numa versão anterior (texto Mermaid) e não pode ser aberto no editor visual. O texto está preservado abaixo; nada foi alterado.</div>
            <pre className="dgm-legacy__raw">{parsed.raw}</pre>
          </div>
        ) : (
          <div className="dgm-host">
            <div ref={hostRef} className="dgm-host__inner" />
            {loading && <div className="dgm-host__hint">Carregando o editor…</div>}
            {loadError && <div className="dgm-host__hint is-error" role="alert">{loadError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
