// Monitor de IA — recursos com IA, no padrão do devkit (modo Desligada/Local/Nuvem, "Ver o que é enviado", cancelar com Esc).
// Só produzem texto para copiar: nenhum botão comita nem muda o repositório. Tudo que sai de uma sessão é mascarado pelas
// tarefas (src/ai/tasks-aimon.js) e a tela mostra exatamente o que vai antes de enviar.
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';

const api = () => window.devkit.aimon;

const offReason = (cfg) => (aiOn(cfg) ? null : 'IA desligada');

/** Resumir e Briefing para retomar — no cabeçalho da sessão. */
export function SessionAi({ session, events }) {
  const cfg = useAiMode();
  const summary = useAiTask('aimonSummary', cfg);
  const brief = useAiTask('aimonBrief', cfg);
  const empty = !events || !events.some((e) => e.kind === 'prompt' || e.kind === 'text');
  const reason = offReason(cfg) || (empty ? 'Sessão sem conteúdo' : null);

  const gatherBrief = async () => {
    let changes = [];
    try { const c = await api().gitChanges(session.key); changes = (c.files || []).slice(0, 40).map((f) => ({ kind: f.kind, path: f.path })); } catch { /* sem Git: segue só com o resumo */ }
    // Último plano aprovado desta sessão (do arquivo local de planos), para o briefing saber o rumo combinado.
    let plan = null;
    try {
      await api().plansScan();
      const { rows } = await api().plans({ status: 'approved' });
      const last = rows.find((r) => r.sessionId === session.sessionId); // já vêm do mais novo ao mais antigo
      if (last) { const p = await api().plan(last.id); plan = p && p.plan; }
    } catch { /* sem plano: o briefing segue sem ele */ }
    return { ...(await api().digest(session.key)), changes, lastPlan: plan };
  };
  return (
    <div className="am-ai">
      <div className="am-ai__bar">
        <AiButton ai={summary} label="Resumir sessão" disabled={!!reason} reason={reason} onClick={() => summary.start(() => api().digest(session.key))} />
        <AiButton ai={brief} label="Briefing para retomar" disabled={!!reason} reason={reason} onClick={() => brief.start(gatherBrief)}
          title="Gera um texto para colar numa sessão nova continuar este trabalho" />
      </div>
      <div className="am-priv"><AiPanel ai={summary} /></div>
      <div className="am-priv"><AiPanel ai={brief} /></div>
    </div>
  );
}

/** Sugerir mensagem de commit e Revisar alterações — na aba Alterações. `dirty`: há alterações não comitadas. */
export function ChangesAi({ session, events, dirty, toast }) {
  const cfg = useAiMode();
  const commit = useAiTask('commitMessage', cfg);
  const review = useAiTask('aimonReview', cfg);
  const reason = offReason(cfg) || (dirty ? null : 'Sem alterações');

  const input = async () => {
    const r = await api().gitAiInput(session.key);
    if (!r.diff) { toast('Sem alterações', 'Não há nada alterado na pasta desta sessão para enviar à IA.', 'warn'); return null; }
    return r;
  };
  return (
    <div className="am-ai">
      <div className="am-ai__bar">
        <AiButton ai={commit} label="Sugerir mensagem de commit" disabled={!!reason} reason={reason}
          onClick={() => commit.start(async () => { const r = await input(); return r && { diff: r.diff, recent: r.recent, branch: r.branch }; })}
          title="Sugere a mensagem a partir das alterações da sessão. Não comita: você copia e usa onde quiser." />
        <AiButton ai={review} label="Revisar alterações" disabled={!!reason} reason={reason}
          onClick={() => review.start(async () => {
            const r = await input();
            if (!r) return null;
            const first = (events || []).find((e) => e.kind === 'prompt');
            return { diff: r.diff, branch: r.branch, goal: first ? first.summary : '' };
          })}
          title="A IA lê o diff não comitado e aponta riscos e o que testar" />
      </div>
      <div className="am-priv"><AiPanel ai={commit} /></div>
      <div className="am-priv"><AiPanel ai={review} /></div>
    </div>
  );
}
