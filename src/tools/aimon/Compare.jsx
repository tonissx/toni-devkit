// Monitor de IA — comparar duas sessões lado a lado (ex.: Claude × Codex na mesma tarefa): tempo, turnos, falhas de ferramenta,
// correções suas, tokens, custo estimado, arquivos e commits. As métricas vêm da leitura que o monitor já fez (electron/aimon/service.js).
import { DS } from '../../lib/ds.js';
import { errText, fmtCompact, fmtNum, ago } from '../../lib/fmt.jsx';
import { dur } from './Lanes.jsx';

const { Icon, Spinner, EmptyState } = DS;

const api = () => window.devkit.aimon;

const usd = (v) => (v == null || !Number.isFinite(v) ? '—' : 'US$ ' + v.toFixed(v < 100 ? 2 : 0).replace('.', ','));
const num = (v) => (v == null ? '—' : fmtNum(v));
// better: 'low' realça o menor valor; null = só mostra. Duração e turnos não entram: menos nem sempre é melhor.
const METRICS = [
  { k: 'provider', label: 'Ferramenta', f: (r) => r.provider },
  { k: 'model', label: 'Modelo', f: (r) => r.model || '—' },
  { k: 'project', label: 'Projeto', f: (r) => r.project || '—' },
  { k: 'durationMs', label: 'Duração (início ao fim)', f: (r) => dur(r.durationMs) },
  { k: 'workMs', label: 'Tempo trabalhando', f: (r) => dur(r.workMs), better: 'low' },
  { k: 'waitMs', label: 'Tempo esperando você', f: (r) => dur(r.waitMs), better: 'low' },
  { k: 'turns', label: 'Pedidos / turnos', f: (r) => num(r.turns) },
  { k: 'corrections', label: 'Correções suas (retrabalho)', f: (r) => num(r.corrections), better: 'low', hint: 'Pedidos seus que corrigem o agente (“errado”, “de novo”, “desfaz”…). Heurística.' },
  { k: 'tools', label: 'Chamadas de ferramenta', f: (r) => num(r.tools) },
  { k: 'toolErrors', label: 'Falhas de ferramenta', f: (r) => num(r.toolErrors), better: 'low' },
  { k: 'total', label: 'Tokens (total)', f: (r) => fmtCompact(r.total), better: 'low' },
  { k: 'out', label: 'Tokens de saída', f: (r) => fmtCompact(r.tokens.output), v: (r) => r.tokens.output },
  { k: 'cost', label: 'Custo estimado', f: (r) => usd(r.cost), better: 'low' },
  { k: 'files', label: 'Arquivos editados', f: (r) => num(r.files) },
  { k: 'commits', label: 'Commits', f: (r) => num(r.commits) },
];

const label = (s) => `${s.provider} · ${s.label || s.title || s.lastText || 'Sessão sem título'} · ${ago(s.lastTs || s.mtime)}`;

export function Compare({ sessions, toast }) {
  const mains = React.useMemo(() => (sessions || []).filter((s) => !s.parentId), [sessions]);
  const [a, setA] = React.useState('');
  const [b, setB] = React.useState('');
  const [rows, setRows] = React.useState(null);
  const [pairs, setPairs] = React.useState([]);
  const sig = mains.map((s) => s.key).join('|');

  React.useEffect(() => { api().pairs().then(setPairs, () => {}); }, [sig]);
  const load = React.useCallback(() => {
    if (!a || !b) { setRows(null); return; }
    api().compare([a, b]).then(setRows, (e) => toast('Monitor de IA', errText(e), 'error'));
  }, [a, b]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { if (!a || !b) return undefined; const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]); // sessões em andamento mudam

  const byKey = (k) => (rows || []).find((r) => r.key === k) || null;
  const ra = byKey(a); const rb = byKey(b);
  const bestOf = (m) => {
    if (!ra || !rb || m.better !== 'low') return null;
    const va = m.v ? m.v(ra) : ra[m.k]; const vb = m.v ? m.v(rb) : rb[m.k];
    if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb) return null;
    return va < vb ? 'a' : 'b';
  };
  const nameOf = (k) => { const s = mains.find((x) => x.key === k); return s ? s.provider : ''; };

  return (
    <div className="am-cmp tk-scroll">
      <div className="am-cmp__pick">
        <label>Sessão A<select className="am-plans__project" value={a} onChange={(e) => setA(e.target.value)}><option value="">Escolha…</option>{mains.map((s) => <option key={s.key} value={s.key}>{label(s)}</option>)}</select></label>
        <span className="lg-muted">×</span>
        <label>Sessão B<select className="am-plans__project" value={b} onChange={(e) => setB(e.target.value)}><option value="">Escolha…</option>{mains.map((s) => <option key={s.key} value={s.key}>{label(s)}</option>)}</select></label>
      </div>
      {pairs.length > 0 && (
        <div className="am-cmp__pairs">
          <span className="lg-muted"><Icon name="sparkles" size={12} /> Pedidos parecidos em ferramentas diferentes:</span>
          {pairs.map((p) => (
            <button key={p.a + p.b} type="button" className="lg-btn" onClick={() => { setA(p.a); setB(p.b); }} title={`Semelhança ${Math.round(p.score * 100)}%`}>
              <span>{nameOf(p.a)} × {nameOf(p.b)}</span><span className="lg-muted am-priv">{p.prompt.slice(0, 60)}</span>
            </button>
          ))}
        </div>
      )}
      {!a || !b ? (
        <EmptyState title="Escolha duas sessões" animate="none" description="Compare a mesma tarefa em ferramentas diferentes (ex.: Claude Code × Codex) ou duas tentativas na mesma ferramenta. Quando há sessões com pedidos parecidos, elas aparecem como sugestão acima." />
      ) : a === b ? (
        <div className="am-note"><Icon name="info" size={12} />Escolha duas sessões diferentes.</div>
      ) : !ra || !rb ? (
        <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>
      ) : (
        <>
          <table className="am-us__table am-cmp__table">
            <thead><tr><th>Métrica</th><th className="am-priv" title={ra.title}>A · {ra.title}</th><th className="am-priv" title={rb.title}>B · {rb.title}</th></tr></thead>
            <tbody>
              {METRICS.map((m) => {
                const best = bestOf(m);
                return (
                  <tr key={m.k}>
                    <td title={m.hint}>{m.label}</td>
                    <td className={best === 'a' ? 'is-best' : ''}>{m.f(ra)}{best === 'a' && <Icon name="check" size={11} />}</td>
                    <td className={best === 'b' ? 'is-best' : ''}>{m.f(rb)}{best === 'b' && <Icon name="check" size={11} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(ra.partial || rb.partial) && <div className="am-note"><Icon name="info" size={12} />Uma das sessões é muito grande e só o final dela foi lido: turnos, tokens e custo podem estar incompletos.</div>}
          <div className="am-note"><Icon name="info" size={12} />O ✓ marca o menor valor onde “menos” é melhor. Ele não diz qual resultado ficou melhor: isso você julga pelo que cada uma entregou (aba Alterações).</div>
        </>
      )}
    </div>
  );
}
