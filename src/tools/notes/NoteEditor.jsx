import { DS, mod, isMod } from '../../lib/ds.js';
import { useAutosave, statusLabel, notesApi } from '../../notes/client.js';
import { displayTitle, inlineTags, normTag, snippetCode } from '../../notes/note.js';
import { NotePreview, SnippetCard } from './NotePreview.jsx';

const { SegmentedControl, IconButton, Button, Alert, Kbd } = DS;

const TYPE_OPTIONS = [
  { value: 'note', label: 'Nota' },
  { value: 'snippet', label: 'Snippet' },
];
const MODE_OPTIONS = [
  { value: 'edit', label: 'Editar' },
  { value: 'split', label: 'Lado a lado' },
  { value: 'preview', label: 'Visualizar' },
];
const NEXT_MODE = { edit: 'split', split: 'preview', preview: 'edit' };

/** Chips de tags do front matter (removíveis) + #tags do texto (só leitura) + campo para adicionar. */
function TagsField({ tags, content, onChange }) {
  const [draft, setDraft] = React.useState('');
  const fromText = inlineTags(content).filter((t) => !tags.includes(t));
  const add = (raw) => {
    const t = normTag(raw);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="nts-tags">
      {tags.map((t) => (
        <span key={t} className="nts-tag">#{t}<button type="button" aria-label={'Remover tag ' + t} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button></span>
      ))}
      {fromText.map((t) => <span key={'i' + t} className="nts-tag is-inline" title="Tag escrita no texto">#{t}</span>)}
      <input
        className="nts-tags__input"
        value={draft}
        placeholder={tags.length || fromText.length ? '+ tag' : '+ tags (ex.: sql, fluig)'}
        aria-label="Adicionar tag"
        onChange={(e) => { const v = e.target.value; if (/[,\s]$/.test(v)) add(v); else setDraft(v); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}

/**
 * Editor de uma nota. Monte com key={id}: trocar de nota desmonta e o auto-save grava o pendente.
 */
export function NoteEditor({ initial, isNew, focus, mode, setMode, resolve, onOpenLink, onDelete, toast }) {
  const { note, update, status, error, flush } = useAutosave(initial, { isNew });
  const titleRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const title = displayTitle(note);

  React.useEffect(() => {
    if (!isNew && initial.id) notesApi().markViewed(initial.id);
    // Nota nova vinda de um [[link]] ou da palette já com título: grava para existir de fato.
    if (isNew && initial.title) update({});
    const el = focus === 'title' ? titleRef.current : bodyRef.current;
    if (el) el.focus();
  }, []);

  const copy = async (text) => {
    await window.devkit.clipboard.write(text);
    toast('Copiado', note.type === 'snippet' ? 'Snippet na área de transferência' : 'Código na área de transferência');
  };

  const onBodyKey = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab indenta (2 espaços) em vez de sair do editor.
      e.preventDefault();
      const t = e.target, s = t.selectionStart, en = t.selectionEnd;
      const v = t.value.slice(0, s) + '  ' + t.value.slice(en);
      update({ content: v });
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    }
  };

  // Atalhos do editor: Ctrl/⌘+E alterna o modo · Ctrl/⌘+Shift+C copia o snippet.
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'e' && !e.shiftKey) { e.preventDefault(); setMode(NEXT_MODE[mode] || 'edit'); }
      else if (k === 'c' && e.shiftKey && note.type === 'snippet') {
        e.preventDefault();
        copy(snippetCode(note));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const editor = (
    <textarea
      ref={bodyRef}
      className="nts-body tk-scroll"
      value={note.content}
      onChange={(e) => update({ content: e.target.value })}
      onKeyDown={onBodyKey}
      placeholder={'Escreva em Markdown…\n\n# Título\n```sql\nSELECT 1\n```\n- [ ] tarefa   #tag   [[Outra nota]]'}
      spellCheck={false}
      aria-label="Conteúdo da nota (Markdown)"
    />
  );
  const preview = (
    <div className="nts-preview tk-scroll">
      {note.type === 'snippet' && <SnippetCard note={note} title={title} onCopy={copy} onEdit={() => { setMode('edit'); requestAnimationFrame(() => bodyRef.current && bodyRef.current.focus()); }} />}
      <NotePreview
        content={note.content}
        hideCode={note.type === 'snippet'}
        resolve={resolve}
        onOpenLink={onOpenLink}
        onCopy={copy}
        onChange={(content) => update({ content })}
        onDoubleClick={mode === 'preview' ? () => setMode('edit') : undefined}
      />
    </div>
  );

  return (
    <div className="nts-editor">
      <div className="nts-editor__head">
        <input
          ref={titleRef}
          className="nts-title"
          value={note.title}
          placeholder={note.title ? '' : (note.content.trim() ? title + '  (título automático)' : 'Sem título')}
          onChange={(e) => update({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); bodyRef.current && bodyRef.current.focus(); } }}
          aria-label="Título (opcional)"
          spellCheck={false}
        />
        <div className="nts-editor__tools">
          <span className={'nts-status is-' + status} role="status">{statusLabel(status)}</span>
          <IconButton size="sm" className="nts-pin" icon="pin" label={note.pinned ? 'Desafixar' : 'Fixar (Pinned)'} active={note.pinned} onClick={() => update({ pinned: !note.pinned })} />
          <IconButton size="sm" className="nts-fav" icon="star" label={note.favorite ? 'Remover dos favoritos' : 'Favoritar'} active={note.favorite} onClick={() => update({ favorite: !note.favorite })} />
          <IconButton size="sm" icon="trash-2" label="Excluir (vai para a lixeira)" onClick={async () => { await flush(); onDelete(note); }} disabled={isNew && status === 'idle'} />
        </div>
      </div>
      <div className="nts-editor__meta">
        <SegmentedControl size="sm" options={TYPE_OPTIONS} value={note.type} onChange={(type) => update({ type })} />
        <TagsField tags={note.tags} content={note.content} onChange={(tags) => update({ tags })} />
        <input
          className="nts-aliases"
          defaultValue={(note.aliases || []).join(', ')}
          placeholder="aliases (ex.: coalesce, isnull)"
          aria-label="Aliases, separados por vírgula"
          onBlur={(e) => update({ aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        />
        <span className="nts-editor__spacer" />
        {note.quick && <span className="nts-quick-badge" title="Dê um título para transformar em Note">Quick Note</span>}
        <SegmentedControl size="sm" options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </div>
      {error && (
        <Alert variant="error" title="Não foi possível salvar — seu texto está seguro aqui">
          <span className="nts-error">{error}</span>
          <Button size="sm" variant="secondary" icon="rotate-ccw" onClick={() => { update({}); flush(); }}>Tentar de novo</Button>
        </Alert>
      )}
      <div className={'nts-editor__body is-' + mode}>
        {mode !== 'preview' && editor}
        {mode !== 'edit' && preview}
      </div>
      <div className="nts-editor__foot">
        <span>Markdown</span>
        <span><Kbd size="sm">{mod('E')}</Kbd> editar/visualizar</span>
        {note.type === 'snippet' && <span><Kbd size="sm">{mod('C', true)}</Kbd> copiar snippet</span>}
        <span className="nts-editor__spacer" />
        <span>{note.content.length} caracteres</span>
      </div>
    </div>
  );
}
