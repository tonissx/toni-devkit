import { DS, mod, isMod } from '../../lib/ds.js';
import { useAutosave, statusLabel, notesApi, cleanError } from '../../notes/client.js';
import { displayTitle, inlineTags, normTag, snippetCode } from '../../notes/note.js';
import { continueList, toggleTaskLines, expandOnSpace } from '../../notes/edit.js';
import { pasteProps } from '../../notes/paste.js';
import { toggleWrap, makeLink, codeToggle } from '../../notes/markup.js';
import { applyToTextarea } from '../../notes/textarea.js';
import { NotePreview, SnippetCard } from './NotePreview.jsx';
import { useSuggest, linkSource, varSource } from './Suggest.jsx';
import { isTemplateFolder } from '../../notes/templates.js';
import { Backlinks } from './Backlinks.jsx';
import { HistoryModal } from './HistoryModal.jsx';
import { normalize } from '../../commands/search.js';
import { useAiMode, aiOn } from '../../ai/ui.jsx';
import { useNoteAi } from './NoteAi.jsx';

const { SegmentedControl, IconButton, Button, Alert, Kbd, Select } = DS;

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
export function NoteEditor({ initial, isNew, focus, cursor, mode, setMode, resolve, onOpenLink, onOpenNote, onDelete, onNoteChange, folderOptions = [], toast }) {
  const { note, update, status, error, flush } = useAutosave(initial, { isNew });

  // Mantém o snapshot do pai (`current.note`) em dia: trocar de aba desmonta o editor e o remonte usa esse snapshot.
  const firstNote = React.useRef(true);
  React.useEffect(() => {
    if (firstNote.current) { firstNote.current = false; return; }
    if (onNoteChange) onNoteChange(note);
  }, [note]);
  const titleRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const titleBefore = React.useRef(null);                  // título exibido quando o campo ganhou foco
  const [renameOffer, setRenameOffer] = React.useState(null); // { from, to, count }
  const [showHistory, setShowHistory] = React.useState(false);
  const title = displayTitle(note);
  const cfg = useAiMode();
  const ai = useNoteAi({ cfg, note, update, bodyRef });

  React.useEffect(() => {
    if (!isNew && initial.id) notesApi().markViewed(initial.id);
    // Nota nova vinda de um [[link]] ou da palette já com título: grava para existir de fato.
    if (isNew && initial.title) update({});
    const el = focus === 'title' ? titleRef.current : bodyRef.current;
    if (el) el.focus();
    // Veio de um template/nota do dia com {{cursor}}: começa ali.
    if (el && el === bodyRef.current && typeof cursor === 'number') el.setSelectionRange(cursor, cursor);
  }, []);

  // Pasta: nota nova só guarda a escolha (o arquivo nasce lá no 1º save); nota gravada é movida no disco.
  const moveTo = async (folder) => {
    if (folder === (note.folder || '')) return;
    if (isNew && status === 'idle') { update({ folder }); return; }
    try {
      if (!(await flush())) return; // erro de gravação já aparece no aviso do editor
      const saved = await notesApi().moveNote(note.id, folder);
      if (saved) toast('Nota movida', folder ? 'para ' + folder : 'para “Sem pasta”');
    } catch (e) { toast('Não foi possível mover', cleanError(e), 'error'); }
  };

  const copy = async (text) => {
    await window.devkit.clipboard.write(text);
    toast('Copiado', note.type === 'snippet' ? 'Snippet na área de transferência' : 'Código na área de transferência');
  };

  // Aplica o resultado de uma função de edit.js/markup.js no textarea (texto + seleção), mantendo o Ctrl+Z.
  const applyEdit = (t, r) => applyToTextarea(t, r, (content) => update({ content }));

  // Autocomplete: [[link]] sempre; em templates (pasta Templates) também {{variáveis}} ao digitar "{".
  const isTemplate = isTemplateFolder(note.folder);
  const sources = React.useMemo(() => (isTemplate ? [varSource, linkSource(note.id)] : [linkSource(note.id)]), [isTemplate, note.id]);
  const suggest = useSuggest({ taRef: bodyRef, apply: applyEdit, sources });

  // Renomear: se outras notas apontavam para o título antigo, oferece atualizar os [[links]] delas.
  const onTitleBlur = async () => {
    const from = titleBefore.current, to = displayTitle(note);
    titleBefore.current = null;
    if (!from || normalize(from) === normalize(to) || to === 'Sem título' || (isNew && status === 'idle')) return;
    try {
      if (!(await flush())) return;
      const count = await notesApi().linkRefs(from, note.id);
      if (count) setRenameOffer({ from, to, count });
    } catch { /* só uma sugestão: sem ela, nada quebra */ }
  };
  const applyRename = async () => {
    const r = renameOffer;
    setRenameOffer(null);
    try {
      if (!(await flush())) return;
      const n = await notesApi().renameLinks(r.from, r.to, note.id);
      toast('Links atualizados', n ? `${n} ${n === 1 ? 'nota agora aponta' : 'notas agora apontam'} para “${r.to}”` : 'Nada a mudar — o título antigo ainda é usado por outra nota ou alias');
    } catch (e) { toast('Não foi possível atualizar os links', cleanError(e), 'error'); }
  };

  const onBodyKey = (e) => {
    const t = e.target;
    if (e.nativeEvent.isComposing) return;
    if (suggest.onKey(e)) return;
    // Tarefas: Enter continua "- [ ]" · Ctrl/⌘+L alterna texto/tarefa/feita · "[]␣"/"todo␣"/"@hoje␣" expandem.
    let r = null;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !isMod(e) && t.selectionStart === t.selectionEnd) r = continueList(t.value, t.selectionStart);
    else if (isMod(e) && !e.shiftKey && e.key.toLowerCase() === 'l') r = toggleTaskLines(t.value, t.selectionStart, t.selectionEnd);
    else if (e.key === ' ' && !isMod(e) && !e.altKey && t.selectionStart === t.selectionEnd) r = expandOnSpace(t.value, t.selectionStart);
    if (isMod(e) && !e.shiftKey && e.key.toLowerCase() === 'l') e.preventDefault();
    if (r) { e.preventDefault(); applyEdit(t, r); return; }
    // Formatação: Ctrl/⌘+B negrito · Ctrl/⌘+I itálico · Ctrl/⌘+K link (só com seleção; sem ela, a palette
    // abre como sempre) · Ctrl/⌘+Shift+K `código` ou bloco ```.
    if (isMod(e) && !e.altKey) {
      const k = e.key.toLowerCase(), s = t.selectionStart, en = t.selectionEnd;
      let f = null;
      if (k === 'b' && !e.shiftKey) f = toggleWrap(t.value, s, en, '**');
      else if (k === 'i' && !e.shiftKey) f = toggleWrap(t.value, s, en, '*');
      else if (k === 'k' && e.shiftKey) f = codeToggle(t.value, s, en);
      else if (k === 'k') f = makeLink(t.value, s, en);
      if (f) { e.preventDefault(); e.stopPropagation(); applyEdit(t, f); return; }
      if ((k === 'b' || k === 'i') && !e.shiftKey) { e.preventDefault(); return; }
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab indenta (2 espaços) em vez de sair do editor.
      e.preventDefault();
      const s = t.selectionStart;
      applyEdit(t, { value: t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd), start: s + 2, end: s + 2 });
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
    <div className="nts-body-wrap">
      <textarea
        ref={bodyRef}
        className="nts-body tk-scroll"
        value={note.content}
        onChange={(e) => update({ content: e.target.value })}
        onKeyDown={onBodyKey}
        onSelect={suggest.sync}
        onBlur={suggest.close}
        onScroll={suggest.close}
        {...pasteProps({
          insert: (r) => applyEdit(bodyRef.current, r),
          onError: (msg) => toast('Não foi possível adicionar a imagem', msg, 'error'),
        })}
        placeholder={'Escreva em Markdown…\n\n# Título\n```sql\nSELECT 1\n```\n- [ ] tarefa   #tag   [[Outra nota]]'}
        spellCheck={false}
        aria-label="Conteúdo da nota (Markdown)"
      />
      {suggest.popup}
    </div>
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
        toast={toast}
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
          onFocus={() => { titleBefore.current = displayTitle(note); }}
          onBlur={onTitleBlur}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); bodyRef.current && bodyRef.current.focus(); } }}
          aria-label="Título (opcional)"
          spellCheck={false}
        />
        <div className="nts-editor__tools">
          <span className={'nts-status is-' + status} role="status">{statusLabel(status)}</span>
          {aiOn(cfg) && ai.button}
          <IconButton size="sm" className="nts-pin" icon="pin" label={note.pinned ? 'Desafixar' : 'Fixar (Pinned)'} active={note.pinned} onClick={() => update({ pinned: !note.pinned })} />
          <IconButton size="sm" className="nts-fav" icon="star" label={note.favorite ? 'Remover dos favoritos' : 'Favoritar'} active={note.favorite} onClick={() => update({ favorite: !note.favorite })} />
          <IconButton size="sm" icon="sticky-note" label="Fixar na tela (sticky note)" disabled={isNew && status === 'idle'}
            onClick={async () => { await flush(); window.devkit.stickies.open(note.id).catch((e) => toast('Não foi possível fixar na tela', cleanError(e), 'error')); }} />
          <IconButton size="sm" icon="history" label="Versões anteriores" onClick={() => setShowHistory(true)} disabled={isNew && status === 'idle'} />
          <IconButton size="sm" icon="trash-2" label="Excluir (vai para a lixeira)" onClick={async () => { await flush(); onDelete(note); }} disabled={isNew && status === 'idle'} />
        </div>
      </div>
      <div className="nts-editor__meta">
        <SegmentedControl size="sm" options={TYPE_OPTIONS} value={note.type} onChange={(type) => update({ type })} />
        {folderOptions.length > 0 && (
          <Select
            size="sm"
            className="nts-folder-select"
            options={[{ value: '', label: 'Sem pasta', icon: 'inbox' }, ...folderOptions]}
            value={note.folder || ''}
            onChange={moveTo}
          />
        )}
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
      {renameOffer && (
        <Alert variant="info" title={`${renameOffer.count} ${renameOffer.count === 1 ? 'nota aponta' : 'notas apontam'} para “${renameOffer.from}”`}>
          <span className="nts-error">Atualizar os [[links]] para “{renameOffer.to}”?</span>
          <Button size="sm" variant="primary" icon="link" onClick={applyRename}>Atualizar links</Button>
          <Button size="sm" variant="ghost" onClick={() => setRenameOffer(null)}>Agora não</Button>
        </Alert>
      )}
      {aiOn(cfg) && ai.panels}
      <div className={'nts-editor__body is-' + mode}>
        {mode !== 'preview' && editor}
        {mode !== 'edit' && preview}
      </div>
      {onOpenNote && <Backlinks noteId={note.id} onOpen={onOpenNote} />}
      {showHistory && <HistoryModal note={note} flush={flush} onClose={() => setShowHistory(false)} toast={toast} />}
      <div className="nts-editor__foot">
        <span>Markdown</span>
        <span><Kbd size="sm">{mod('E')}</Kbd> editar/visualizar</span>
        <span><Kbd size="sm">{mod('L')}</Kbd> tarefa</span>
        <span title="Negrito · itálico · link (com seleção) · Ctrl+Shift+K código"><Kbd size="sm">{mod('B / I / K')}</Kbd> formatar</span>
        {isTemplate
          ? <span title="Variáveis trocadas quando uma nota é criada a partir deste template"><Kbd size="sm">{'{'}</Kbd> variáveis</span>
          : <span><Kbd size="sm">[[</Kbd> link para nota</span>}
        {note.type === 'snippet' && <span><Kbd size="sm">{mod('C', true)}</Kbd> copiar snippet</span>}
        <span className="nts-editor__spacer" />
        <span>{note.content.length} caracteres</span>
      </div>
    </div>
  );
}
