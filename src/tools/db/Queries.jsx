// Banco — aba Queries: as consultas mais caras. Fonte: cache de planos (desde o último restart ou limpeza do cache,
// agrupadas por query_hash — a mesma query com parâmetros diferentes) ou Query Store de um banco (com período).
// Só sob demanda: nada disso roda no ciclo do monitor.
import { DS } from '../../lib/ds.js';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';
import { PlanView } from './PlanView.jsx';
import { dbApi, errText, fmtNum, fmtCompact, fmtTime, ago, copyText, oneLine, fmtUs } from './shared.jsx';

const { Icon, Spinner } = DS;

const METRICS = [
  { id: 'cpu', label: 'CPU total', col: 'total_cpu_us', fmt: fmtUs },
  { id: 'duration', label: 'Duração total', col: 'total_duration_us', fmt: fmtUs },
  { id: 'reads', label: 'Leituras', col: 'total_reads', fmt: fmtCompact },
  { id: 'executions', label: 'Execuções', col: 'executions', fmt: fmtCompact },
  { id: 'avg_duration', label: 'Duração média', col: 'avg_duration_us', fmt: fmtUs, cacheOnly: true },
  { id: 'avg_cpu', label: 'CPU média', col: 'avg_cpu_us', fmt: fmtUs, cacheOnly: true },
];
const QS_PERIODS = [{ id: 1, label: '1 h' }, { id: 24, label: '24 h' }, { id: 168, label: '7 dias' }];

export function Queries({ server, toast, onOpenSql }) {
  const [source, setSource] = React.useState('cache');
  const [metric, setMetric] = React.useState('cpu');
  const [hours, setHours] = React.useState(24);
  const [dbs, setDbs] = React.useState([]);
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [plan, setPlan] = React.useState(null); // { busy } enquanto busca · { xml, name, title } com o plano aberto
  const cfg = useAiMode();
  const ai = useAiTask('dbQuery', cfg);
  React.useEffect(() => { ai.close(); }, [sel]);
  React.useEffect(() => { dbApi().queryStoreDbs(server.id).then(setDbs, () => setDbs([])); }, [server.id]);
  const m = METRICS.find((x) => x.id === metric) || METRICS[0];
  const load = async () => {
    setBusy(true); setError(null);
    try {
      const r = source === 'cache'
        ? await dbApi().topQueries(server.id, { metric, top: 50 })
        : await dbApi().queryStoreTop(server.id, source, { metric: m.cacheOnly ? 'cpu' : metric, top: 50, fromIso: new Date(Date.now() - hours * 3600e3).toISOString(), toIso: new Date().toISOString() });
      setRows(r); setSel(null);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  React.useEffect(() => { load(); }, [server.id, source, metric, hours]);
  const total = rows ? rows.reduce((s, r) => s + (Number(r[m.col]) || 0), 0) : 0;
  const cur = sel != null && rows ? rows[sel] : null;

  return (
    <div className="db-now">
      <div className="db-now__main tk-scroll">
        <div className="db-toolbar">
          <select className="lg-select db-source" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Fonte">
            <option value="cache">Cache de planos (desde o último restart)</option>
            {dbs.map((d) => <option key={d.database_name} value={d.database_name}>Query Store · {d.database_name}</option>)}
          </select>
          <div className="lg-seg" role="group" aria-label="Ordenar por">
            {METRICS.filter((x) => source === 'cache' || !x.cacheOnly).map((x) => <button key={x.id} type="button" className={metric === x.id ? 'is-on' : ''} onClick={() => setMetric(x.id)}>{x.label}</button>)}
          </div>
          {source !== 'cache' && <div className="lg-seg" role="group" aria-label="Período">{QS_PERIODS.map((p) => <button key={p.id} type="button" className={hours === p.id ? 'is-on' : ''} onClick={() => setHours(p.id)}>{p.label}</button>)}</div>}
          <span className="lg-grow" />
          <button type="button" className="lg-btn" onClick={load} disabled={busy}>{busy ? <Spinner size={11} /> : <Icon name="refresh-cw" size={13} />}<span>Atualizar</span></button>
        </div>
        {source === 'cache' && dbs.length === 0 && <div className="lg-muted db-hint">Nenhum banco com Query Store ligado — o cache de planos some quando o SQL Server reinicia ou precisa de memória.</div>}
        {error ? <div className="lg-err lg-pad">{error}</div> : !rows ? <div className="lg-muted lg-pad"><Spinner size={12} /> Consultando…</div> : rows.length === 0 ? <div className="lg-muted lg-pad">Nada no cache ainda.</div> : (
          <div className="db-table-wrap tk-scroll">
            <table className="db-table">
              <thead><tr>
                <th className="is-num">#</th><th className="is-num">{m.label}</th><th className="is-num">% do top</th><th className="is-num">Execuções</th>
                <th className="is-num">Média</th><th className="is-num">Leituras/exec</th><th>Banco / objeto</th><th>Última</th><th>Query</th>
              </tr></thead>
              <tbody>
                {rows.map((r, k) => {
                  const avgDur = r.avg_duration_us != null ? r.avg_duration_us : r.executions ? r.total_duration_us / r.executions : null;
                  return (
                    <tr key={(r.query_hash || '') + k} className={sel === k ? 'is-sel' : ''} onClick={() => setSel(k)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(k); }}>
                      <td className="is-num">{k + 1}</td>
                      <td className="is-num"><b>{m.fmt(r[m.col])}</b></td>
                      <td className="is-num"><span className="db-pctbar"><span style={{ width: (total ? (Number(r[m.col]) / total) * 100 : 0) + '%' }} /></span>{total ? Math.round((Number(r[m.col]) / total) * 100) : 0}%</td>
                      <td className="is-num">{fmtCompact(Number(r.executions))}</td>
                      <td className="is-num">{fmtUs(avgDur)}</td>
                      <td className="is-num">{fmtCompact(r.executions ? Math.round(Number(r.total_reads) / Number(r.executions)) : null)}</td>
                      <td className="db-ellipsis">{[r.database_name, r.object_name].filter(Boolean).join(' · ') || '—'}</td>
                      <td title={fmtTime(r.last_execution, { date: true, millis: false })}>{ago(r.last_execution)}</td>
                      <td className="db-sqlcell">{r.risks && r.risks.length > 0 && <Icon name="triangle-alert" size={11} />} {oneLine(r.statement_text, 140)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {cur && (
        <aside className="db-detail">
          <div className="db-detail__head"><b>#{sel + 1} · {m.label} {m.fmt(cur[m.col])}</b><span className="lg-grow" /><button type="button" className="lg-icon" onClick={() => setSel(null)} aria-label="Fechar"><Icon name="x" size={14} /></button></div>
          <div className="db-detail__actions">
            <button type="button" className="lg-btn" onClick={() => copyText(cur.statement_text, toast, 'SQL copiado')}><Icon name="copy" size={13} /><span>Copiar</span></button>
            {onOpenSql && <button type="button" className="lg-btn" onClick={() => onOpenSql(cur.statement_text)}><Icon name="database" size={13} /><span>SQL Formatter</span></button>}
            {cur.plan_handle && <button type="button" className="lg-btn" disabled={plan && plan.busy} onClick={async () => { setPlan({ busy: true }); try { const p = await dbApi().plan(server.id, { planHandle: cur.plan_handle }); setPlan({ xml: p.xml, name: `query-${String(cur.query_hash || sel + 1)}`, title: `Plano · #${sel + 1}` }); } catch (e) { setPlan(null); toast('Sem plano', errText(e), 'error'); } }}>{plan && plan.busy ? <Spinner size={11} /> : <Icon name="list-tree" size={13} />}<span>Plano</span></button>}
            {aiOn(cfg) && (
              <AiButton ai={ai} label="Por que está lenta" title="Explicar com IA (o texto passa pelo filtro de segredos)" onClick={() => ai.start(() => ({
                sql: cur.statement_text,
                stats: {
                  executions: Number(cur.executions), avgDuration: fmtUs(cur.executions ? cur.total_duration_us / cur.executions : null),
                  avgCpu: fmtUs(cur.executions ? cur.total_cpu_us / cur.executions : null), avgReads: cur.executions ? Math.round(Number(cur.total_reads) / Number(cur.executions)) : null,
                  plans: cur.plans, database: cur.database_name,
                },
              }))} />
            )}
          </div>
          <div className="db-detail__body tk-scroll">
            {aiOn(cfg) && <AiPanel ai={ai} className="lg-ai" />}
            <div className="db-facts">
              <span>Execuções</span><b>{fmtNum(Number(cur.executions))}{cur.plans > 1 ? ` · ${cur.plans} planos diferentes` : ''}</b>
              <span>CPU</span><b>{fmtUs(cur.total_cpu_us)} total · {fmtUs(cur.executions ? cur.total_cpu_us / cur.executions : null)} por execução</b>
              <span>Duração</span><b>{fmtUs(cur.total_duration_us)} total · máx. {fmtUs(cur.max_duration_us)}</b>
              <span>Leituras</span><b>{fmtCompact(Number(cur.total_reads))} total</b>
              {cur.first_seen != null && <><span>No cache desde</span><b>{fmtTime(cur.first_seen, { date: true, millis: false })}</b></>}
              {cur.query_hash && <><span>query_hash</span><b className="is-mono">{cur.query_hash}</b></>}
            </div>
            {cur.risks && cur.risks.length > 0 && <div className="db-note is-warn"><Icon name="triangle-alert" size={13} /><span>{cur.risks.join(' · ')}</span></div>}
            <pre className="db-sql">{String(cur.statement_text || '').trim()}</pre>
          </div>
        </aside>
      )}
      {plan && plan.xml && <PlanView xml={plan.xml} title={plan.title} toast={toast} onClose={() => setPlan(null)} onSave={async () => { const f = await dbApi().savePlan(plan.xml, plan.name); if (f) toast('Plano salvo', f, 'ok'); }} />}
    </div>
  );
}
