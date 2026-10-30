// Logs — "Explicar" com IA no detalhe de uma entrada. Um hook só para o painel lateral (LogView) e a janela destacada
// (popout.jsx) usarem a mesma lógica: cada um roda a tarefa na própria janela, sem passar pela principal.
import { useAiMode, useAiTask, AiButton, aiOn } from '../../ai/ui.jsx';
import { logsApi, fmtTime } from './shared.jsx';

/** → { ai, aiSlot } para o <Detail>; ambos null com a IA desligada. Fecha a explicação ao trocar de entrada (i). */
export function useExplainEntry(id, formatLabel, i) {
  const cfg = useAiMode();
  const task = useAiTask('logError', cfg);
  React.useEffect(() => { task.close(); }, [i]);
  const explain = (entry) => task.start(async () => {
    const ctx = await logsApi().context({ id, i: entry.i, before: 8, after: 0 }).catch(() => ({ rows: [] }));
    const g = entry.group;
    return {
      text: entry.text.slice(0, 20000), format: formatLabel, logger: entry.parsed.logger,
      before: ctx.rows.filter((r) => r.i !== entry.i).map((r) => r.text).join('\n'),
      group: g ? { total: g.total, first: fmtTime(g.first, { date: true, millis: false }), last: fmtTime(g.last, { date: true, millis: false }) } : null,
    };
  });
  if (!aiOn(cfg)) return { ai: null, aiSlot: null };
  return {
    ai: task,
    aiSlot: (entry) => <AiButton ai={task} label="Explicar" onClick={() => explain(entry)} title="Explicar o erro com IA (o texto passa pelo filtro de segredos)" />,
  };
}
