import { DS } from '../lib/ds.js';
import { useAutosave, statusLabel } from '../notes/client.js';
import { pasteProps } from '../notes/paste.js';
import { applyToTextarea } from '../notes/textarea.js';

const { Icon, Kbd } = DS;

/**
 * Quick Note dentro da palette: só o texto. Sem título/pasta/tipo — o título sai da 1ª linha
 * e #tags no texto viram tags. Auto-save contínuo; Esc ou Ctrl+Enter gravam e fecham.
 * Se a gravação falhar, a palette não fecha no primeiro Esc (o texto também fica no backup local).
 */
export function QuickNote({ initial, onClose, onOpenInApp }) {
  const { note, update, status, error, flush } = useAutosave(initial, { isNew: true, delay: 300 });
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [imageError, setImageError] = React.useState(null);
  const ta = React.useRef(null);

  // Colar/arrastar: imagem vai para .assets\, tabela do Excel/SSMS vira tabela Markdown, URL sobre seleção vira link.
  const imageProps = pasteProps({
    insert: (r) => {
      setImageError(null);
      if (ta.current) applyToTextarea(ta.current, r, (content) => update({ content }));
    },
    onError: setImageError,
  });

  React.useEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.focus();
    t.selectionStart = t.selectionEnd = t.value.length;
    if (initial.content) update({}); // veio com texto (ex.: "Criar Quick Note com …") → grava já
  }, []);

  const finish = async (then = onClose) => {
    const ok = await flush();
    if (!ok && !confirmClose) { setConfirmClose(true); return; }
    then();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey)) {
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      finish(() => (note.content.trim() ? onOpenInApp(note.id) : onClose()));
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const t = e.target, s = t.selectionStart;
      update({ content: t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd) });
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    }
  };

  const lines = Math.min(14, Math.max(5, note.content.split('\n').length + 1));

  return (
    <div className="pl-quick">
      <div className="pl-quick__head">
        <Icon name="sticky-note" size={15} />
        <span className="pl-quick__title">Quick Note</span>
        <span className="pl-quick__hint">sem título · #tag vira tag · [[Nota]] vira link</span>
      </div>
      <textarea
        ref={ta}
        className="pl-quick__text tk-scroll"
        rows={lines}
        value={note.content}
        onChange={(e) => { setConfirmClose(false); update({ content: e.target.value }); }}
        onKeyDown={onKeyDown}
        {...imageProps}
        placeholder="O que você descobriu? (Markdown)"
        spellCheck={false}
        aria-label="Quick Note (Markdown)"
      />
      {imageError && (
        <div className="pl-status is-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <span><b>Imagem não adicionada.</b> {imageError}</span>
        </div>
      )}
      {error && (
        <div className="pl-status is-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <span><b>Não salvo — seu texto está guardado neste computador.</b> {error}{confirmClose ? ' · Esc de novo fecha mesmo assim (a gravação é tentada de novo depois).' : ''}</span>
        </div>
      )}
      <div className="tk-palette__foot">
        <span>Markdown</span>
        <span className={'pl-quick__status is-' + status} role="status">{status === 'idle' ? 'Auto-save' : statusLabel(status)}</span>
        <span style={{ marginLeft: 'auto' }}><Kbd size="sm">Ctrl+↵</Kbd> salvar</span>
        <span><Kbd size="sm">Ctrl+Shift+↵</Kbd> abrir no app</span>
        <span><Kbd size="sm">Esc</Kbd> fechar</span>
      </div>
    </div>
  );
}
