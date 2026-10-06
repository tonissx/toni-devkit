// Notes — IA no editor (só com a IA ligada; nada é aplicado sem clique): título e tags, resumo e checklist.
// O botão "IA" abre um menu; o resultado aparece num painel acima do texto, com as ações de aplicar.
import { DS } from '../../lib/ds.js';
import { useAiTask, AiButton, AiPanel } from '../../ai/ui.jsx';
import { applyToTextarea } from '../../notes/textarea.js';

const { Icon } = DS;

/**
 * Menu "IA" + painéis. note/update vêm do editor; bodyRef é o textarea (pode não existir no modo Visualizar).
 * → { button, panels } — o botão vai na barra do editor e os painéis acima do texto.
 */
export function useNoteAi({ cfg, note, update, bodyRef }) {
  const [open, setOpen] = React.useState(false);
  const meta = useAiTask('noteMeta', cfg);
  const summary = useAiTask('noteSummary', cfg);
  const check = useAiTask('noteChecklist', cfg);
  const sel = React.useRef(null); // seleção no momento do pedido de checklist { start, end }
  React.useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!e.target.closest('.nts-ai')) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const busy = meta.busy || summary.busy || check.busy;
  const empty = !note.content.trim();

  const setContent = (value, start = value.length, end = start) => {
    const t = bodyRef.current;
    if (t) applyToTextarea(t, { value, start, end }, (content) => update({ content }));
    else update({ content: value });
  };

  const run = (which) => {
    setOpen(false);
    if (which === 'meta') meta.start(async () => ({ title: note.title, content: note.content, tags: note.tags, existingTags: (await window.devkit.notes.tags().catch(() => [])).map((t) => t.tag) }));
    if (which === 'summary') summary.start(() => ({ title: note.title, content: note.content }));
    if (which === 'check') {
      const t = bodyRef.current;
      const s = t && t.selectionEnd > t.selectionStart ? { start: t.selectionStart, end: t.selectionEnd } : null;
      sel.current = s;
      check.start(() => ({ text: s ? note.content.slice(s.start, s.end) : note.content }));
    }
  };

  const m = meta.st && meta.st.data;
  const addTag = (t) => update({ tags: [...new Set([...(note.tags || []), t])] });
  const list = check.st && check.st.data;
  return {
    button: (
      <span className="nts-ai">
        {busy ? <AiButton ai={[meta, summary, check].find((x) => x.busy)} label="IA" /> : (
          <button type="button" className={'ai-btn' + (open ? ' is-on' : '')} disabled={empty} title={empty ? 'Escreva algo na nota primeiro' : 'IA nesta nota'} onClick={() => setOpen((v) => !v)}>
            <Icon name="sparkles" size={12} /><span>IA</span><Icon name="chevron-down" size={11} />
          </button>
        )}
        {open && (
          <div className="nts-ai__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => run('meta')}><Icon name="tag" size={13} /><span>Sugerir título e tags</span></button>
            <button type="button" role="menuitem" onClick={() => run('summary')}><Icon name="list" size={13} /><span>Resumir</span></button>
            <button type="button" role="menuitem" onClick={() => run('check')}><Icon name="list-checks" size={13} /><span>Transformar em checklist <small>(seleção ou nota toda)</small></span></button>
          </div>
        )}
      </span>
    ),
    panels: (
      <div className="nts-ai__panels">
        <AiPanel ai={meta}
          body={(st) => (st.phase === 'done' && m ? (
            <div className="nts-ai__meta">
              {m.title && <div><span className="nts-ai__label">Título</span> <b>{m.title}</b> {m.title !== note.title && <button type="button" className="ai-panel__link" onClick={() => update({ title: m.title })}>usar</button>}</div>}
              <div>
                <span className="nts-ai__label">Tags</span>{' '}
                {m.tags.length ? m.tags.map((t) => (note.tags || []).includes(t)
                  ? <span key={t} className="nts-chip is-tag is-on">#{t}</span>
                  : <button key={t} type="button" className="nts-chip is-tag" title="Adicionar esta tag" onClick={() => addTag(t)}>+ #{t}</button>)
                  : <span className="ai-panel__muted">nenhuma nova</span>}
              </div>
            </div>
          ) : <span className="ai-panel__muted">{st.text || 'pensando…'}</span>)}
          actions={[{ label: 'Usar título e todas as tags', icon: 'check', primary: true, hidden: !m || (!m.title && !m.tags.length), onClick: () => { update({ ...(m.title ? { title: m.title } : {}), tags: [...new Set([...(note.tags || []), ...m.tags])] }); meta.close(); } }]} />
        <AiPanel ai={summary}
          actions={[{ label: 'Inserir no topo da nota', icon: 'arrow-up-to-line', primary: true, onClick: () => {
            const quote = '> **Resumo**\n' + summary.st.text.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
            setContent(quote + note.content, quote.length); summary.close();
          } }]} />
        <AiPanel ai={check}
          body={(st) => <pre className="nts-ai__list">{st.phase === 'done' && list ? list : st.text}</pre>}
          actions={[
            { label: sel.current ? 'Substituir a seleção' : 'Inserir no fim da nota', icon: 'list-checks', primary: true, hidden: !list, onClick: () => {
              const s = sel.current;
              const v = note.content;
              if (s) setContent(v.slice(0, s.start) + list + v.slice(s.end), s.start, s.start + list.length);
              else setContent(v.replace(/\s*$/, '') + '\n\n' + list + '\n');
              check.close();
            } },
          ]} />
      </div>
    ),
  };
}
