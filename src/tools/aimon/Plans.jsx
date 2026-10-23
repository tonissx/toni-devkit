// Monitor de IA — planos das sessões (aprovados, recusados e sem resposta), guardados localmente em
// %APPDATA%\Toni Devkit\aimon-plans.json (electron/aimon/plans.js). Continuam aqui mesmo depois que o Claude Code
// apaga o transcript da sessão. Nada sai da máquina; "Esquecer" e "Limpar" apagam do arquivo.
import { DS } from '../../lib/ds.js';
import { AiMarkdown } from '../../ai/ui.jsx';
import { errText, ago, fmtDateTime, copyText } from '../../lib/fmt.jsx';
import { dur } from './Lanes.jsx';

const { Icon, Spinner, EmptyState, SegmentedControl, Modal, Button } = DS;

const api = () => window.devkit.aimon;

const STATUS = {
  approved: { label: 'Aprovado', icon: 'circle-check', tone: 'ok' },
  rejected: { label: 'Recusado', icon: 'circle-x', tone: 'no' },
  pending: { label: 'Sem resposta', icon: 'circle-dashed', tone: 'idle' },
};
const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'approved', label: 'Aprovados' },
  { value: 'rejected', label: 'Recusados' },
  { value: 'pending', label: 'Sem resposta' },
];

function PlanStatus({ s }) {
  const st = STATUS[s] || STATUS.pending;
  return <span className={'am-pstatus is-' + st.tone}><Icon name={st.icon} size={12} />{st.label}</span>;
}

/**
 * A vida de um plano em três passos: pedido → resposta → commits. Etapa feita fica cheia; a que ainda espera, tracejada.
 * O horário da resposta só existe para planos vistos depois que o Monitor passou a guardá-lo (answeredAt).
 */
function PlanFlow({ plan, commits }) {
  const answered = plan.status !== 'pending';
  const ok = plan.status === 'approved';
  const wait = plan.answeredAt && plan.ts ? dur(plan.answeredAt - plan.ts) : null;
  const n = commits == null ? null : commits.length;
  const steps = [
    { icon: 'file-text', label: 'Plano pedido', sub: ago(plan.ts), state: 'done', title: fmtDateTime(plan.ts) },
    answered
      ? { icon: ok ? 'circle-check' : 'circle-x', label: ok ? 'Aprovado' : 'Recusado', sub: wait ? `em ${wait}` : plan.answeredAt ? ago(plan.answeredAt) : '', state: ok ? 'ok' : 'no', title: plan.answeredAt ? fmtDateTime(plan.answeredAt) : '' }
      : { icon: 'hourglass', label: 'Aguardando você', sub: 'sem resposta', state: 'wait', title: 'O Claude Code ainda espera a sua resposta a este plano' },
    !ok
      ? { icon: 'git-commit-horizontal', label: 'Commits', sub: answered ? 'não executado' : '', state: 'off', title: answered ? 'Um plano recusado não vira commits' : 'Só depois da aprovação' }
      : n == null ? { icon: 'git-commit-horizontal', label: 'Commits', sub: '…', state: 'wait', title: '' }
        : n > 0 ? { icon: 'git-commit-horizontal', label: 'Commits', sub: `${n} depois do plano`, state: 'done', title: '' }
          : { icon: 'git-commit-horizontal', label: 'Commits', sub: 'nenhum ainda', state: 'wait', title: 'A sessão ainda não fez commits depois deste plano' },
  ];
  return (
    <ol className="am-flow" aria-label="Etapas do plano">
      {steps.map((s, i) => (
        <li key={i} className={'am-flow__step is-' + s.state} title={s.title || undefined}>
          <span className="am-flow__dot"><Icon name={s.icon} size={13} /></span>
          <span className="am-flow__txt"><b>{s.label}</b>{s.sub && <small>{s.sub}</small>}</span>
        </li>
      ))}
    </ol>
  );
}

export function Plans({ sessions, onOpenSession, onOpenCommit, toast }) {
  const [filter, setFilter] = React.useState('all');
  const [project, setProject] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [dq, setDq] = React.useState('');
  const [data, setData] = React.useState(null); // { rows, projects }
  const [sel, setSel] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null); // 'one' | 'all'
  const selRef = React.useRef(null);
  selRef.current = sel;

  React.useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]); // não busca a cada tecla

  const load = React.useCallback(() => api().plans({ status: filter, project, q: dq }).then(setData, (e) => toast('Planos', errText(e), 'error')), [filter, project, dq]);
  React.useEffect(() => { load(); }, [load]);
  // Procura planos novos nos transcripts agora e a cada 10 s (só compara tamanho e data dos arquivos que não mudaram).
  React.useEffect(() => {
    let alive = true;
    const scan = () => api().plansScan().then((changed) => { if (alive && changed) load(); }, () => {});
    scan();
    const t = setInterval(scan, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [load]);

  // O processo principal varre os planos junto com o acompanhamento e avisa quando entra algum (ainda sem resposta) ou muda o status.
  React.useEffect(() => api().onChanged((evt) => { if (evt && evt.type === 'plans') load(); }), [load]);

  React.useEffect(() => {
    if (!sel) { setDetail(null); return; }
    setDetail(null);
    api().plan(sel).then((d) => { if (selRef.current === sel) setDetail(d); }, () => {});
  }, [sel]);

  const rows = data ? data.rows : [];
  const current = rows.find((r) => r.id === sel) || null;
  const sessionKey = detail && detail.sessionId ? 'claude:' + detail.sessionId : null;
  const live = !!(sessionKey && sessions.some((s) => s.key === sessionKey));

  const goSession = () => {
    if (!live) { toast('Sessão fora da janela', detail && detail.orphan ? 'O transcript desta sessão não existe mais; o plano continua guardado aqui.' : 'O Monitor só acompanha as últimas 24 h.', 'warn'); return; }
    onOpenSession(sessionKey);
  };
  const forget = async () => {
    const what = confirm; setConfirm(null);
    try {
      if (what === 'all') { await api().plansClear(); setSel(null); } else if (sel) { await api().planForget(sel); setSel(null); }
      load();
    } catch (e) { toast('Não foi possível esquecer', errText(e), 'error'); }
  };

  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Procurando planos…</div>;
  const empty = rows.length === 0;
  return (
    <div className="am-body">
      <aside className="am-side">
        <div className="am-plans__filters">
          <SegmentedControl size="sm" options={FILTERS} value={filter} onChange={(v) => { setFilter(v); setSel(null); }} />
          <input className="am-search" type="search" placeholder="Buscar nos planos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar nos planos" />
          {data.projects.length > 1 && (
            <select className="lg-select am-plans__project" value={project} onChange={(e) => { setProject(e.target.value); setSel(null); }} aria-label="Projeto">
              <option value="all">Todos os projetos</option>
              {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
        <div className="am-list am-list--plans tk-scroll">
          {empty && <div className="gt-msg">{dq || filter !== 'all' || project !== 'all' ? 'Nenhum plano com esses filtros.' : 'Nenhum plano encontrado nas sessões ainda.'}</div>}
          {rows.map((r) => (
            <button key={r.id} type="button" className={'am-session' + (sel === r.id ? ' is-sel' : '')} onClick={() => setSel(r.id)}>
              <span className="am-session__top"><span className="am-session__title am-priv">{r.title}</span></span>
              <span className="am-session__meta">
                <PlanStatus s={r.status} />
                {r.project && <span className="lg-pill am-priv" title="Projeto">{r.project}</span>}
                <span className="lg-muted" title={fmtDateTime(r.ts)}>{ago(r.ts)}</span>
                {r.orphan && <span className="lg-pill" title="O transcript da sessão foi apagado; só esta cópia resta"><Icon name="archive" size={10} />arquivado</span>}
              </span>
              <span className="am-plans__snip am-priv">{r.snippet}</span>
            </button>
          ))}
        </div>
        <div className="am-plans__foot">
          <span className="lg-muted">{rows.length} plano(s) · guardados só neste computador</span>
          <button type="button" className="gt-op is-ghost is-sm" disabled={!rows.length} onClick={() => setConfirm('all')} title="Apaga todos os planos guardados (os transcripts não são tocados)"><Icon name="trash-2" size={13} /><span>Limpar</span></button>
        </div>
      </aside>
      <main className="am-main">
        {!current ? (
          <EmptyState title={empty ? 'Sem planos ainda' : 'Escolha um plano'} animate="none"
            description="Cada plano que o Claude Code leva para aprovação fica aqui, com a sua resposta (aprovado ou recusado e o motivo). A cópia continua guardada mesmo depois que a sessão é apagada." />
        ) : (
          <>
            <div className="am-main__head">
              <div className="am-main__title"><b className="am-priv">{current.title}</b><PlanStatus s={current.status} /></div>
              <div className="am-main__meta lg-muted">
                <span title={fmtDateTime(current.ts)}>{ago(current.ts)}</span>
                {current.project && <span className="am-priv">{current.project}{current.branch ? ' · ' + current.branch : ''}</span>}
                {current.sessionTitle && <span className="am-priv" title="Título da sessão">{current.sessionTitle}</span>}
              </div>
              <div className="am-plans__actions">
                <button type="button" className="lg-btn" disabled={!detail} onClick={() => copyText(detail.plan, toast, 'Plano copiado')}><Icon name="copy" size={12} /><span>Copiar plano</span></button>
                <button type="button" className="lg-btn" disabled={!detail} onClick={goSession} title={live ? 'Abrir a timeline da sessão' : 'A sessão está fora das últimas 24 h'}><Icon name="external-link" size={12} /><span>Ir para a sessão</span></button>
                <button type="button" className="lg-btn" onClick={() => setConfirm('one')}><Icon name="trash-2" size={12} /><span>Esquecer</span></button>
              </div>
            </div>
            <div className="am-plans__body tk-scroll">
              <PlanFlow plan={detail || current} commits={detail ? detail.commits || [] : null} />
              {current.status === 'rejected' && (
                <div className="am-plans__reason">
                  <Icon name="message-square" size={13} />
                  <div><b>Motivo da recusa</b><span className="am-priv">{current.reason || 'O usuário recusou sem escrever um motivo.'}</span></div>
                </div>
              )}
              {detail && detail.commits && detail.commits.length > 0 && (
                <div className="am-plans__commits">
                  <h4 className="am-changes__h"><Icon name="git-commit-horizontal" size={13} />Commits depois deste plano ({detail.commits.length})</h4>
                  <div className="am-commits">
                    {detail.commits.map((c) => (
                      <button key={c.hash} type="button" className="am-commit" onClick={() => onOpenCommit(detail, c)} title="Abrir este commit no histórico do Git">
                        <code>{c.hash.slice(0, 7)}</code><span className="am-commit__msg am-priv">{c.subject || '(sem mensagem)'}</span>{c.branch && <span className="lg-pill">{c.branch}</span>}<span className="lg-muted" title={fmtDateTime(c.ts)}>{ago(c.ts)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detail ? <div className="am-priv"><AiMarkdown text={detail.plan} /></div> : <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>}
            </div>
          </>
        )}
      </main>
      {confirm && (
        <Modal title={confirm === 'all' ? 'Apagar todos os planos guardados?' : 'Esquecer este plano?'} icon="trash-2" onClose={() => setConfirm(null)} width={480}
          description={confirm === 'all'
            ? 'Remove as cópias guardadas pelo Monitor. Os transcripts do Claude Code e os arquivos em ~/.claude/plans não são tocados, e os planos que já foram lidos não voltam sozinhos.'
            : 'Remove só a cópia guardada pelo Monitor. O transcript do Claude Code e o arquivo em ~/.claude/plans não são tocados.'}
          footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="destructive" onClick={forget}>{confirm === 'all' ? 'Apagar tudo' : 'Esquecer'}</Button></>} />
      )}
    </div>
  );
}
