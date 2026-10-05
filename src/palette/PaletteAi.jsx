// Palette — resposta da IA dentro da palette: pergunta livre ("?…"), "Perguntar às notas" (escopo Notes, "?…") e
// "Explicar o que está copiado". Começa sozinho ao abrir; Esc para (gerando) ou volta para a lista.
import { DS } from '../lib/ds.js';
import { useAiTask, AiPanel, AiMarkdown } from '../ai/ui.jsx';
import { gatherNotes } from '../ai/notesContext.js';

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
  const cmds = (st && st.data && st.data.cmds) || [];
  // [[cmd:id]] vira os itens executáveis abaixo; no texto, sai a marcação.
  const shownText = req.task === 'paletteAsk' && st ? String(st.text || '').replace(/\s*\[\[cmd:[^\]]+\]\]/g, '') : st && st.text;
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
      {cmds.length > 0 && (
        <div className="pl-ai__cmds">
          <div className="tk-menu__heading">Fazer no Devkit</div>
          {cmds.map((id) => {
            const c = commands.find((x) => x.id === id);
            return c && (
              <button key={id} type="button" className="pl-ai__cmd" onClick={() => runCommand(c)}>
                <Icon name={c.icon || 'zap'} size={14} /><span>{c.name}</span><Icon name="corner-down-left" size={12} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
