import { DS } from '../../lib/ds.js';
import { renderMarkdown, toggleTask, highlight } from '../../notes/markdown.js';
import { snippetCode, codeBlocks, removeFences } from '../../notes/note.js';
import { secretRefs, sameName } from '../../vault/entry.js';
import { useVaultRefs, copyFromVault, cleanError } from '../../vault/client.js';
import { UnlockForm } from '../vault/UnlockForm.jsx';
import { notesApi } from '../../notes/client.js';
import { embedThumb, peekThumb } from '../../diagrams/thumb.js';
import { paintEmbed } from './embedPaint.js';

const { Button, Icon, Modal } = DS;

/**
 * Preview do markdown. Cliques: [[link]] → onOpenLink(título) · "Copiar" num bloco → copia ·
 * checkbox de tarefa → onChange(conteúdo com a tarefa alternada) · imagem → abre no visualizador do sistema.
 * Cartão ```secret``` (Vault): Copiar → clipboard protegido pelo processo principal · Desbloquear → modal aqui
 * mesmo · Criar/Vault ↗ → abre a ferramenta Vault.
 * hideCode: não repete os blocos de código (o SnippetCard já os mostra). toast(título, texto, variante) opcional.
 * embeds: desenha o ![[Diagrama]] no meio do texto (miniatura; clicar abre o diagrama na ferramenta Diagramas). Só o
 *   editor de Notes liga: Sticky e Lixeira não carregam o Excalidraw por causa de um embed.
 */
export function NotePreview({ content, hideCode, embeds, resolve, onOpenLink, onChange, onCopy, onDoubleClick, toast }) {
  const shown = hideCode ? removeFences(content) : content;
  const names = React.useMemo(() => secretRefs(shown), [shown]);
  const refs = useVaultRefs(names);
  const [unlock, setUnlock] = React.useState(null); // status do cofre enquanto o modal de desbloqueio está aberto
  const secret = React.useCallback((name) => {
    if (!refs) return undefined;
    if (refs.locked) return { locked: true, exists: refs.exists };
    const key = Object.keys(refs.items).find((k) => sameName(k, name));
    return (key !== undefined && refs.items[key]) || { missing: true };
  }, [refs]);
  const { html, blocks } = React.useMemo(() => renderMarkdown(shown, { resolve, secret, embeds }), [shown, resolve, secret, embeds]);

  // ── ![[Diagrama]] ──────────────────────────────────────────────────────────────────────────────────────────────
  // O HTML é regravado a cada mudança do texto (no "Lado a lado", a cada tecla) e isso descarta o DOM que mexemos aqui.
  // Por isso: (1) antes de pintar, reaplica as miniaturas do cache, de forma síncrona (a imagem não pisca); (2) depois,
  // confere cada nota (tipo e data) e gera só o que falta; (3) o diagrama editado em outro lugar atualiza o preview.
  const previewRef = React.useRef(null);
  const embedIds = React.useRef(new Set());
  const [tick, setTick] = React.useState(0);

  React.useLayoutEffect(() => {
    const root = previewRef.current;
    if (!embeds || !root) return;
    const ids = new Set();
    for (const span of root.querySelectorAll('.md-embed[data-note-id]')) {
      ids.add(span.dataset.noteId);
      const cached = peekThumb(span.dataset.noteId);
      if (cached) paintEmbed(span, cached);
    }
    embedIds.current = ids;
  }, [html, embeds]);

  React.useEffect(() => {
    const root = previewRef.current;
    if (!embeds || !root) return undefined;
    const spans = [...root.querySelectorAll('.md-embed[data-note-id]')];
    if (!spans.length) return undefined;
    let gone = false;
    const run = async () => {
      const notes = new Map(); // a mesma nota embutida duas vezes é buscada uma vez
      for (const span of spans) {
        const id = span.dataset.noteId;
        if (!notes.has(id)) notes.set(id, notesApi().get(id).catch(() => null));
        const note = await notes.get(id);
        if (gone || !span.isConnected) continue;
        if (!note) { paintEmbed(span, { state: 'missing' }); continue; }
        if (note.type !== 'diagram') { paintEmbed(span, { state: 'notdiagram' }); continue; }
        const r = await embedThumb(note);
        if (!gone && span.isConnected) paintEmbed(span, r);
      }
    };
    // Sem cache ainda: gera já. Com cache (só conferindo se mudou, como a cada tecla): espera o texto assentar.
    const t = setTimeout(run, spans.some((s) => !peekThumb(s.dataset.noteId)) ? 0 : 250);
    return () => { gone = true; clearTimeout(t); };
  }, [html, embeds, tick]);

  React.useEffect(() => {
    if (!embeds) return undefined;
    let timer = null;
    const off = notesApi().onChanged((evt) => {
      if (!evt) return;
      const relevant = evt.type === 'saved' ? embedIds.current.has(evt.id) : ['removed', 'trash', 'folders'].includes(evt.type);
      if (!relevant) return;
      clearTimeout(timer); // o autosave do Excalidraw dispara muitas vezes seguidas
      timer = setTimeout(() => setTick((n) => n + 1), 300);
    });
    return () => { clearTimeout(timer); off(); };
  }, [embeds]);

  /** Feedback no próprio botão (e no toast, se houver). */
  const flash = (btn, text, ok = true, detail) => {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = text;
    btn.classList.toggle('is-ok', ok);
    btn.classList.toggle('is-err', !ok);
    setTimeout(() => { btn.textContent = old; btn.classList.remove('is-ok', 'is-err'); }, 1600);
    if (toast) toast(ok ? 'Copiado' : 'Não foi possível copiar', detail, ok ? 'ok' : 'error');
  };

  const onVault = (el) => {
    const d = el.dataset;
    if (d.vaultCopy) {
      const what = /^\d+$/.test(d.vaultWhat) ? Number(d.vaultWhat) : d.vaultWhat;
      copyFromVault(d.vaultCopy, what).then((msg) => flash(el, 'Copiado ✓', true, msg), (e) => flash(el, 'Erro', false, cleanError(e)));
    } else if (d.vaultUnlock) window.devkit.vault.status().then(setUnlock);
    else if (d.vaultCreate) window.devkit.app.open('vault', { create: d.vaultCreate });
    else if (d.vaultOpen) window.devkit.app.open('vault', { id: d.vaultOpen });
  };

  const onClick = (e) => {
    const embed = e.target.closest('.md-embed');
    if (embed) { // alvo inválido (is-bad) é só uma etiqueta; os demais abrem o diagrama no editor
      if (embed.dataset.noteId && !embed.classList.contains('is-bad')) window.devkit.app.open('diagrams', { id: embed.dataset.noteId });
      return;
    }
    const link = e.target.closest('.md-wikilink');
    if (link) { e.preventDefault(); onOpenLink(link.dataset.note); return; }
    const vaultBtn = e.target.closest('[data-vault-copy],[data-vault-unlock],[data-vault-create],[data-vault-open]');
    if (vaultBtn) { onVault(vaultBtn); return; }
    const copy = e.target.closest('.md-code__copy');
    if (copy) { onCopy(blocks[Number(copy.dataset.copy)]); return; }
    const img = e.target.closest('.md-img, .md-file');
    if (img) { e.preventDefault(); window.devkit.notes.openAsset(img.dataset.asset); return; }
    const task = e.target.closest('.md-task');
    if (task && onChange) onChange(toggleTask(content, Number(task.dataset.task)));
  };

  if (!String(shown || '').trim()) {
    if (hideCode) return null;
    return <div className="md-preview md-preview--empty" onDoubleClick={onDoubleClick}>Nada para visualizar ainda.</div>;
  }
  // eslint-disable-next-line react/no-danger — HTML gerado por renderMarkdown (HTML cru escapado)
  return (<>
    <div ref={previewRef} className="md-preview" onClick={onClick} onDoubleClick={onDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />
    {unlock && (
      <Modal open onClose={() => setUnlock(null)} icon="lock-keyhole" title="Desbloquear o cofre" width={420}
        description="Os campos das entradas aparecem na nota; os segredos continuam mascarados.">
        <UnlockForm status={unlock} onDone={() => setUnlock(null)} />
      </Modal>
    )}
  </>);
}

/** Cartão de snippet: o código pronto para copiar, em destaque no topo do preview. */
export function SnippetCard({ note, title, onCopy, onEdit }) {
  const code = snippetCode(note);
  const lang = (codeBlocks(note.content)[0] || {}).lang;
  return (
    <div className="nts-snippet">
      <div className="nts-snippet__head">
        <Icon name="braces" size={14} />
        <span className="nts-snippet__title">{title}</span>
        {lang && <span className="nts-snippet__lang">{lang}</span>}
      </div>
      {/* highlight() escapa o código e só adiciona spans tk-syn-* */}
      <pre className="nts-snippet__code" dangerouslySetInnerHTML={{ __html: highlight(code || ' ', lang) }} />
      <div className="nts-snippet__actions">
        <Button size="sm" variant="primary" icon="copy" disabled={!code} onClick={() => onCopy(code)}>Copiar</Button>
        <Button size="sm" variant="ghost" icon="pencil" onClick={onEdit}>Editar</Button>
      </div>
    </div>
  );
}
