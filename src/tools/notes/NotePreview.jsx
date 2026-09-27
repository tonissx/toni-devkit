import { DS } from '../../lib/ds.js';
import { renderMarkdown, toggleTask, highlight } from '../../notes/markdown.js';
import { snippetCode, codeBlocks, removeFences } from '../../notes/note.js';

const { Button, Icon } = DS;

/**
 * Preview do markdown. Cliques: [[link]] → onOpenLink(título) · "Copiar" num bloco → copia ·
 * checkbox de tarefa → onChange(conteúdo com a tarefa alternada).
 * hideCode: não repete os blocos de código (o SnippetCard já os mostra).
 */
export function NotePreview({ content, hideCode, resolve, onOpenLink, onChange, onCopy, onDoubleClick }) {
  const shown = hideCode ? removeFences(content) : content;
  const { html, blocks } = React.useMemo(() => renderMarkdown(shown, { resolve }), [shown, resolve]);

  const onClick = (e) => {
    const link = e.target.closest('.md-wikilink');
    if (link) { e.preventDefault(); onOpenLink(link.dataset.note); return; }
    const copy = e.target.closest('.md-code__copy');
    if (copy) { onCopy(blocks[Number(copy.dataset.copy)]); return; }
    const task = e.target.closest('.md-task');
    if (task && onChange) onChange(toggleTask(content, Number(task.dataset.task)));
  };

  if (!String(shown || '').trim()) {
    if (hideCode) return null;
    return <div className="md-preview md-preview--empty" onDoubleClick={onDoubleClick}>Nada para visualizar ainda.</div>;
  }
  // eslint-disable-next-line react/no-danger — HTML gerado por renderMarkdown (HTML cru escapado)
  return <div className="md-preview" onClick={onClick} onDoubleClick={onDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />;
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
