// Palette — resposta da IA dentro da palette: pergunta livre ("?…"), "Perguntar às notas" (escopo Notes, "?…") e
// "Explicar o que está copiado". Começa sozinho ao abrir; Esc para (gerando) ou volta para a lista.
import { DS } from '../lib/ds.js';
import { useAiTask, AiPanel, AiMarkdown } from '../ai/ui.jsx';
import { gatherNotes } from '../ai/notesContext.js';
import { relatedCommands, riskyCommands } from '../ai/related.js';

const { Icon } = DS;

/**
 * req: { task, input?, question?, title }. Para 'notesAsk' a entrada é montada aqui (busca nas notas).
 * runCommand(id) executa um comando sugerido ([[cmd:id]]); openNote(id) abre uma nota citada.
 */
export function PaletteAi({ cfg, req, commands, runCommand, openNote, onCopy }) {
  const ai = useAiTask(req.task, cfg);
  React.useEffect(() => {
    ai.start(() => (req.task === 'notesAsk' ? gatherNotes(req.question) : req.input));
  }, []);
  const st = ai.st;
  const used = (st && st.input && st.input.notes) || [];
  const find = (t) => used.find((n) => n.title.toLowerCase() === String(t).trim().toLowerCase());
  // Ações do Devkit: as que a busca local acha (na hora, sem depender do modelo) + as que o modelo citou.
  const local = React.useMemo(() => (req.task === 'paletteAsk' ? relatedCommands(req.question, commands).map((c) => c.id) : []), [req]);
  const cmds = [...new Set([...local, ...((st && st.data && st.data.cmds) || [])])].slice(0, 4);
  // [[cmd:id]] vira os itens executáveis abaixo; no texto, sai a marcação.
  // Pronta: o texto já limpo pela tarefa (sem ids); gerando: tira as marcações [[cmd:…]] enquanto chega.
  const shownText = req.task !== 'paletteAsk' || !st ? st && st.text
    : st.phase === 'done' && st.data ? st.data.text || (cmds.length ? 'O Devkit já tem isso pronto — veja abaixo.' : '')
    : String(st.text || '').replace(/\s*\[\[cmd:[^\]]+\]\]/g, '');
  const risky = st && st.phase === 'done' ? riskyCommands(st.text) : [];
  return (
    <div className="pl-ai">
      <div className="pl-ai__title"><Icon name="sparkles" size={13} /> {req.title}</div>
      <AiPanel ai={ai} className="pl-ai__panel"
        body={() => (
          <>
            {shownText ? <AiMarkdown text={shownText} resolve={(t) => (find(t) || {}).id || null} onLink={(t) => { const n = find(t); if (n) openNote(n.id); }} /> : <span className="ai-panel__muted">pensando…</span>}
            {st && st.phase === 'done' && used.length > 0 && (
              <div className="pl-ai__src">Notas consultadas: {used.map((n) => <button key={n.id} type="button" className="ai-panel__link" onClick={() => openNote(n.id)}>{n.title}</button>)}</div>
            )}
          </>
        )}
        actions={[{ label: 'Copiar resposta', icon: 'copy', onClick: () => onCopy(shownText) }]} />
      {risky.length > 0 && (
        <div className="pl-ai__risky" role="note">{risky.map((m) => <div key={m}><Icon name="triangle-alert" size={13} /><span><b>Cuidado:</b> {m}.</span></div>)}</div>
      )}
      {cmds.length > 0 && (
        <div className="pl-ai__cmds">
          <div className="tk-menu__heading">Fazer no Devkit</div>
          {cmds.map((id, k) => {
            const c = commands.find((x) => x.id === id);
            return c && (
              <button key={id} type="button" className={'pl-ai__cmd' + (k === 0 ? ' is-first' : '')} title={c.description || ''} onClick={() => runCommand(c)}>
                <Icon name={c.icon || 'zap'} size={14} /><span>{c.name}{c.description && <small>{c.description}</small>}</span>{k === 0 && <kbd className="pl-ai__enter">↵</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
