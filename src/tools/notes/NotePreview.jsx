import { DS } from '../../lib/ds.js';
import { renderMarkdown, toggleTask, highlight } from '../../notes/markdown.js';
import { snippetCode, codeBlocks, removeFences } from '../../notes/note.js';
import { secretRefs, sameName } from '../../vault/entry.js';
import { useVaultRefs, copyFromVault, cleanError } from '../../vault/client.js';
import { UnlockForm } from '../vault/UnlockForm.jsx';

const { Button, Icon, Modal } = DS;

/**
 * Preview do markdown. Cliques: [[link]] → onOpenLink(título) · "Copiar" num bloco → copia ·
 * checkbox de tarefa → onChange(conteúdo com a tarefa alternada) · imagem → abre no visualizador do sistema.
 * Cartão ```secret``` (Vault): Copiar → clipboard protegido pelo processo principal · Desbloquear → modal aqui
 * mesmo · Criar/Vault ↗ → abre a ferramenta Vault.
 * hideCode: não repete os blocos de código (o SnippetCard já os mostra). toast(título, texto, variante) opcional.
 */
export function NotePreview({ content, hideCode, resolve, onOpenLink, onChange, onCopy, onDoubleClick, toast }) {
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
  const { html, blocks } = React.useMemo(() => renderMarkdown(shown, { resolve, secret }), [shown, resolve, secret]);

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
    const link = e.target.closest('.md-wikilink');
    if (link) { e.preventDefault(); onOpenLink(link.dataset.note); return; }
    const vaultBtn = e.target.closest('[data-vault-copy],[data-vault-unlock],[data-vault-create],[data-vault-open]');
    if (vaultBtn) { onVault(vaultBtn); return; }
    const copy = e.target.closest('.md-code__copy');
    if (copy) { onCopy(blocks[Number(copy.dataset.copy)]); return; }
    const img = e.target.closest('.md-img');
    if (img) { window.devkit.notes.openAsset(img.dataset.asset); return; }
    const task = e.target.closest('.md-task');
    if (task && onChange) onChange(toggleTask(content, Number(task.dataset.task)));
  };

  if (!String(shown || '').trim()) {
    if (hideCode) return null;
    return <div className="md-preview md-preview--empty" onDoubleClick={onDoubleClick}>Nada para visualizar ainda.</div>;
  }
  // eslint-disable-next-line react/no-danger — HTML gerado por renderMarkdown (HTML cru escapado)
  return (<>
    <div className="md-preview" onClick={onClick} onDoubleClick={onDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />
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
