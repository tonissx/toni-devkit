// Notes — "Perguntar às notas": a busca local escolhe as notas, a IA responde só com elas e cita [[títulos]]
// (que abrem a nota). Notas com a tag "privado" e as da pasta Templates ficam de fora; com `folder` dá para
// restringir a pergunta a uma pasta (e subpastas).
import { DS } from '../../lib/ds.js';
import { useAiTask, AiButton, AiPanel, AiMarkdown } from '../../ai/ui.jsx';
import { gatherNotes } from '../../ai/notesContext.js';

const { Toggle } = DS;

export function AskNotes({ cfg, question, folder, scoped = false, onOpen }) {
  const ai = useAiTask('notesAsk', cfg);
  const [onlyFolder, setOnlyFolder] = React.useState(scoped);
  const q = String(question || '').trim();
  const used = (ai.st && ai.st.input && ai.st.input.notes) || [];
  const find = (t) => used.find((n) => n.title.toLowerCase() === String(t).trim().toLowerCase());
  const resolve = (t) => (find(t) || {}).id || null;
  const open = (t) => { const n = find(t); if (n) onOpen(n.id); };
  const where = folder && onlyFolder ? folder : null;
  return (
    <div className="nts-ask">
      {!ai.st && folder && (
        <Toggle size="sm" checked={onlyFolder} onChange={setOnlyFolder} label={`Só na pasta “${folder}” (e subpastas)`} />
      )}
      {!ai.st && <AiButton ai={ai} label="Perguntar às notas" onClick={() => ai.start(() => gatherNotes(q, 6, { folder: where }))} disabled={q.length < 4} reason="Escreva a pergunta na busca" />}
      <AiPanel ai={ai} className="nts-ask__panel"
        body={(st) => (
          <>
            {st.text ? <AiMarkdown text={st.text} resolve={resolve} onLink={open} /> : <span className="ai-panel__muted">pensando…</span>}
            {st.phase === 'done' && used.length > 0 && (
              <div className="nts-ask__src">Notas consultadas: {used.map((n) => <button key={n.id} type="button" className="ai-panel__link" onClick={() => onOpen(n.id)}>{n.title}</button>)}</div>
            )}
          </>
        )} />
    </div>
  );
}
