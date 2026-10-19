// Monitor de IA — busca global: "onde foi que eu pedi/resolvi aquilo?". Procura nos prompts e nas respostas de todas as
// sessões gravadas em disco (Claude Code e Codex, últimos dias) e nos planos guardados. Sem índice nem cópia: os arquivos
// são lidos na hora (electron/aimon/search.js). Somente leitura.
import { DS } from '../../lib/ds.js';
import { errText, fmtDateTime, copyText } from '../../lib/fmt.jsx';

const { Icon, Spinner, EmptyState, SegmentedControl } = DS;

const api = () => window.devkit.aimon;

const DAYS = [{ value: '7', label: '7 dias' }, { value: '14', label: '14 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }];
const KIND = { prompt: { label: 'Você pediu', icon: 'message-square' }, text: { label: 'Agente respondeu', icon: 'bot' } };
const PLAN = { approved: 'Aprovado', rejected: 'Recusado', pending: 'Sem resposta' };

function Snippet({ s }) {
  return <span className="am-sr__snip am-priv">{s.before}<mark>{s.hit}</mark>{s.after}</span>;
}

/** Agrupa os trechos por sessão, na ordem em que a primeira ocorrência apareceu (já vêm das sessões mais recentes). */
function group(results) {
  const out = []; const idx = new Map();
  for (const r of results) {
    if (!idx.has(r.key)) { idx.set(r.key, out.length); out.push({ key: r.key, r, hits: [] }); }
    out[idx.get(r.key)].hits.push(r);
  }
  return out;
}

export function Search({ sessions, onOpenSession, onPlans, toast }) {
  const [q, setQ] = React.useState('');
  const [days, setDays] = React.useState('14');
  const [res, setRes] = React.useState(null);   // { results, plans, scanned, truncated } | null
  const [busy, setBusy] = React.useState(false);
  const seq = React.useRef(0);
  const known = React.useMemo(() => new Set((sessions || []).map((s) => s.key)), [sessions]);

  React.useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { seq.current++; setRes(null); setBusy(false); return undefined; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api().search(needle, { days: Number(days), limit: 60 }).then((r) => { if (seq.current === my) { setRes(r); setBusy(false); } },
        (e) => { if (seq.current === my) { setBusy(false); toast('Monitor de IA', errText(e), 'error'); } });
    }, 350); // não varre os arquivos a cada tecla
    return () => clearTimeout(t);
  }, [q, days]);

  const resume = async (r) => {
    try { const o = await api().resume({ provider: r.provider, sessionId: r.sessionId, cwd: r.cwd, mode: 'resume' }); toast('Sessão retomada', `Abri o terminal: ${o.command}`, 'ok'); } catch (e) { toast('Não foi possível retomar', errText(e), 'error'); }
  };
  const groups = res ? group(res.results) : [];
  const plans = (res && res.plans) || [];

  return (
    <div className="am-sr">
      <div className="am-sr__bar">
        <input className="am-search am-sr__q" type="search" autoFocus placeholder="Buscar nos prompts, respostas e planos de todas as sessões…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar nas sessões" />
        <SegmentedControl size="sm" options={DAYS} value={days} onChange={setDays} />
        {busy && <span className="lg-muted"><Spinner size={12} /> Procurando…</span>}
      </div>
      <div className="am-sr__body tk-scroll">
        {!res && !busy && <EmptyState title="Procure em todo o seu histórico" animate="none" description="Digite pelo menos 2 letras. A busca lê as sessões gravadas em disco (não só as de hoje) e os planos guardados; nada é copiado nem enviado." />}
        {res && groups.length === 0 && plans.length === 0 && !busy && <div className="lg-muted lg-pad">Nada encontrado em {res.scanned} sessão(ões) dos últimos {days} dias.</div>}
        {plans.length > 0 && (
          <section className="am-sr__sec">
            <h3 className="am-group__title"><Icon name="list-checks" size={13} /><span>Planos</span><small>{plans.length}</small></h3>
            {plans.map((p) => (
              <button key={p.id} type="button" className="am-sr__item" onClick={() => (p.sessionId && known.has('claude:' + p.sessionId) ? onOpenSession('claude:' + p.sessionId) : onPlans())} title="Abrir">
                <span className="am-sr__head"><b className="am-priv">{p.title}</b><span className="lg-pill">{PLAN[p.status] || p.status}</span>{p.project && <span className="lg-pill am-priv">{p.project}</span>}<span className="lg-muted">{fmtDateTime(p.ts)}</span></span>
                {p.snippet && <span className="am-sr__snip am-priv">{p.snippet}</span>}
              </button>
            ))}
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key} className="am-sr__sec">
            <div className="am-sr__sess">
              <span className="am-sr__head"><Icon name="folder" size={13} /><b className="am-priv">{g.r.project || 'Sem projeto'}</b><span className="lg-pill">{g.r.provider}</span>{g.r.parentId && <span className="lg-pill">subagente</span>}<span className="lg-muted">{fmtDateTime(g.hits[0].ts)}</span></span>
              <span className="am-sr__acts">
                {known.has(g.key) && <button type="button" className="lg-btn" onClick={() => onOpenSession(g.key)} title="Abre a timeline desta sessão"><Icon name="list" size={12} /><span>Abrir</span></button>}
                {!g.r.parentId && g.r.cwd && <button type="button" className="lg-btn" onClick={() => resume(g.r)} title={`Abre um terminal na pasta da sessão e retoma (${g.r.provider === 'codex' ? 'codex resume' : 'claude --resume'})`}><Icon name="square-terminal" size={12} /><span>Retomar</span></button>}
                {!g.r.parentId && <button type="button" className="lg-btn" onClick={() => copyText(g.r.provider === 'codex' ? `codex resume ${g.r.sessionId}` : `claude --resume ${g.r.sessionId}`, toast, 'Comando copiado')} title="Copia o comando para retomar esta sessão"><Icon name="copy" size={12} /><span>Copiar comando</span></button>}
              </span>
            </div>
            {g.hits.map((h, i) => (
              <div key={i} className="am-sr__item is-static">
                <span className="am-sr__kind"><Icon name={(KIND[h.kind] || KIND.text).icon} size={12} />{(KIND[h.kind] || KIND.text).label}</span>
                <Snippet s={h.snippet} />
              </div>
            ))}
          </section>
        ))}
        {res && res.truncated && <div className="am-note"><Icon name="info" size={12} />A busca parou no limite de resultados ou de tempo. Refine o texto ou reduza o período para ver o resto.</div>}
      </div>
    </div>
  );
}
