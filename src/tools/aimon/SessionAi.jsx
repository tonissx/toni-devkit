// Monitor de IA — recursos com IA, no padrão do devkit (modo Desligada/Local/Nuvem, "Ver o que é enviado", cancelar com Esc).
// Só produzem texto para copiar: nenhum botão comita nem muda o repositório. Tudo que sai de uma sessão é mascarado pelas
// tarefas (src/ai/tasks-aimon.js) e a tela mostra exatamente o que vai antes de enviar.
import { DS } from '../../lib/ds.js';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn, aiCopy } from '../../ai/ui.jsx';
import { errText } from '../../lib/fmt.jsx';

const { Icon } = DS;
const api = () => window.devkit.aimon;

const offReason = (cfg) => (aiOn(cfg) ? null : 'IA desligada');

/**
 * Retomar, Resumir, Briefing e PR — no cabeçalho da sessão. `slot`: elemento do cabeçalho onde os botões entram (undefined =
 * dentro da própria faixa; null = o cabeçalho ainda não montou, nada é desenhado).
 */
export function SessionAi({ session, events, toast, slot }) {
  const cfg = useAiMode();
  const summary = useAiTask('aimonSummary', cfg);
  const brief = useAiTask('aimonBrief', cfg);
  const empty = !events || !events.some((e) => e.kind === 'prompt' || e.kind === 'text');
  const reason = offReason(cfg) || (empty ? 'Sessão sem conteúdo' : null);

  // Último plano aprovado desta sessão (do arquivo local de planos): o rumo combinado, para o briefing e para a descrição de PR.
  const lastPlan = async () => {
    try {
      await api().plansScan();
      const { rows } = await api().plans({ status: 'approved' });
      const last = rows.find((r) => r.sessionId === session.sessionId); // já vêm do mais novo ao mais antigo
      if (last) { const p = await api().plan(last.id); return p && p.plan; }
    } catch { /* sem plano: segue sem ele */ }
    return null;
  };
  const changesOf = async () => {
    try { const c = await api().gitChanges(session.key); return (c.files || []).slice(0, 40).map((f) => ({ kind: f.kind, path: f.path })); } catch { return []; } // sem Git: segue só com o resto
  };
  const gatherBrief = async () => ({ ...(await api().digest(session.key)), changes: await changesOf(), lastPlan: await lastPlan() });
  // Descrição de PR: plano aprovado + commits da sessão + arquivos tocados. Só texto para copiar; nada é aberto nem enviado ao GitHub.
  const pr = useAiTask('aimonPr', cfg);
  const gatherPr = async () => {
    const d = await api().digest(session.key);
    const changed = (await changesOf()).map((c) => c.path);
    return { title: d.title, branch: d.branch, goal: (d.prompts || [])[0] || '', plan: await lastPlan(), commits: d.commits, files: [...new Set([...(d.files || []), ...changed])] };
  };
  // Retomar com um clique: abre um terminal na pasta da sessão (ver electron/aimon/resume.js). Só sessão principal; subagente não se retoma.
  const canResume = !session.parentId && !!session.cwd;
  const resume = async (mode) => {
    try {
      const o = await api().resume({ key: session.key, mode });
      toast('Terminal aberto', o.command, 'ok');
    } catch (e) { toast('Não foi possível abrir o terminal', errText(e), 'error'); }
  };
  const openWithBrief = async () => {
    const text = brief.st && brief.st.text;
    if (!text) return;
    await aiCopy(text, null);
    await resume('new');
    toast('Briefing copiado', 'Cole no terminal que acabou de abrir para começar a sessão nova.', 'ok');
  };
  // Com o motivo (IA desligada, sessão sem conteúdo) no tooltip em vez de dentro do botão: três botões repetindo "IA desligada" ocupam espaço à toa.
  const tip = (base) => (reason ? `${reason} — ${base}` : base);
  const buttons = (
    <>
      <button type="button" className="lg-btn is-accent" disabled={!canResume} onClick={() => resume('resume')}
        title={canResume ? `Abre um terminal em ${session.cwd} e retoma esta sessão (${session.provider === 'codex' ? 'codex resume' : 'claude --resume'}), com todo o contexto dela` : 'Só sessões principais com pasta conhecida podem ser retomadas'}>
        <Icon name="square-terminal" size={12} /><span>Retomar</span>
      </button>
      <AiButton ai={summary} label="Resumir" disabled={!!reason} onClick={() => summary.start(() => api().digest(session.key))}
        title={tip('Resume a sessão em até 6 tópicos')} />
      <AiButton ai={brief} label="Briefing" disabled={!!reason} onClick={() => brief.start(gatherBrief)}
        title={tip('Gera um texto para colar numa sessão nova continuar este trabalho')} />
      <AiButton ai={pr} label="PR" disabled={!!reason} onClick={() => pr.start(gatherPr)}
        title={tip('Monta a descrição de um pull request a partir do plano aprovado, dos commits e dos arquivos da sessão. Só gera o texto: nada é aberto nem enviado.')} />
    </>
  );
  // Os botões vão para a linha do cabeçalho (ao lado de "Abrir no Git"), no `slot`; os resultados ficam numa faixa abaixo, só quando há algo.
  const anyPanel = !!(summary.st || brief.st || pr.st);
  return (
    <>
      {slot === undefined ? <div className="am-ai"><div className="am-ai__bar">{buttons}</div></div> : slot ? ReactDOM.createPortal(buttons, slot) : null}
      {anyPanel && (
        <div className="am-ai">
          <div className="am-priv"><AiPanel ai={summary} /></div>
          <div className="am-priv"><AiPanel ai={pr} /></div>
          <div className="am-priv"><AiPanel ai={brief} actions={[{ label: 'Abrir sessão nova com este briefing', icon: 'square-terminal', primary: true, disabled: !canResume, onClick: openWithBrief }]} /></div>
        </div>
      )}
    </>
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
