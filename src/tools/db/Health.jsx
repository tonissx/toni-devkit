// Banco — aba Saúde: o que pede atenção (log enchendo e por quê, disco, backups, jobs que falharam, memória), uso do
// log por banco, discos, backups, conexões por programa e índices que o otimizador sentiu falta (só sugestão: o
// CREATE INDEX é para copiar e revisar, nunca aplicado pelo Devkit). Sob demanda.
import { DS } from '../../lib/ds.js';
import { missingIndexSql } from '../../db/health.js';
import { dbApi, errText, fmtNum, fmtBytes, fmtTime, ago, copyText, Tone } from './shared.jsx';

const { Icon, Spinner } = DS;

const LEVEL = { crit: { tone: 'error', icon: 'octagon-x', label: 'Crítico' }, warn: { tone: 'warn', icon: 'triangle-alert', label: 'Atenção' }, info: { tone: 'muted', icon: 'info', label: 'Dica' } };

function Bar({ pct, tone }) {
  return <span className={'db-bar' + (tone ? ' is-' + tone : '')}><span style={{ width: Math.min(100, Math.max(1, pct || 0)) + '%' }} /></span>;
}

export function Health({ server, toast }) {
  const [h, setH] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const load = async () => {
    setBusy(true);
    try { setH(await dbApi().health(server.id)); } catch (e) { setH({ error: errText(e) }); } finally { setBusy(false); }
  };
  React.useEffect(() => { setH(null); load(); }, [server.id]);
  if (!h) return <div className="lg-muted lg-pad"><Spinner size={12} /> Conferindo o servidor…</div>;
  if (h.error) return <div className="lg-err lg-pad">{h.error}</div>;
  const toneOf = (pct) => (pct >= 90 ? 'error' : pct >= 80 ? 'warn' : null);
  return (
    <div className="db-now">
      <div className="db-now__main tk-scroll">
        <div className="db-toolbar">
          <span className="lg-muted">{h.findings.length ? `${h.findings.length} ponto(s) de atenção` : 'Nada pedindo atenção agora'}</span>
          <span className="lg-grow" />
          <button type="button" className="lg-btn" onClick={load} disabled={busy}>{busy ? <Spinner size={11} /> : <Icon name="refresh-cw" size={13} />}<span>Conferir de novo</span></button>
        </div>
        {h.errors.length > 0 && <div className="db-note is-warn"><Icon name="lock-keyhole" size={13} /> Partes sem permissão: {h.errors.join(' · ')}</div>}
        {h.findings.length > 0 && (
          <section className="db-card">
            <header className="db-card__head"><h3>Atenção</h3></header>
            <div className="db-findings">
              {h.findings.map((f, k) => {
                const L = LEVEL[f.level];
                return (
                  <div key={k} className={'db-finding is-' + L.tone}>
                    <Tone tone={L.tone} icon={L.icon}>{L.label}</Tone>
                    <span className="db-finding__text"><b>{f.text}</b>{f.hint && <small>{f.hint}</small>}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <div className="db-now__grid">
          <section className="db-card">
            <header className="db-card__head"><h3>Log de transações</h3><small className="lg-muted">por banco</small></header>
            <div className="db-rows">
              {h.logs.map((l) => (
                <div key={l.db} className="db-rowbar" title={l.reuseWait && l.reuseWait !== 'NOTHING' ? `Esperando ${l.reuseWait} para liberar espaço` : ''}>
                  <span className="db-rowbar__name">{l.db}</span>
                  <Bar pct={l.pct} tone={toneOf(l.pct)} />
                  <span className="db-rowbar__v"><b>{l.pct == null ? '—' : l.pct + '%'}</b> de {fmtBytes((l.sizeKb || 0) * 1024)}</span>
                  {l.reuseWait && l.reuseWait !== 'NOTHING' && <span className="db-rowbar__why">{l.reuseWait}</span>}
                </div>
              ))}
            </div>
          </section>
          <section className="db-card">
            <header className="db-card__head"><h3>Discos</h3><small className="lg-muted">onde ficam os arquivos dos bancos</small></header>
            <div className="db-rows">
              {h.disks.length === 0 && <div className="lg-muted">Sem acesso aos volumes (precisa de VIEW SERVER STATE).</div>}
              {h.disks.map((d) => (
                <div key={d.mount} className="db-rowbar">
                  <span className="db-rowbar__name">{d.mount}</span>
                  <Bar pct={d.pct} tone={toneOf(d.pct)} />
                  <span className="db-rowbar__v"><b>{fmtBytes(d.freeBytes)}</b> livres de {fmtBytes(d.totalBytes)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <section className="db-card">
          <header className="db-card__head"><h3>Backups</h3></header>
          <div className="db-table-wrap">
            <table className="db-table">
              <thead><tr><th>Banco</th><th>Recuperação</th><th>Completo</th><th>Diferencial</th><th>Log</th></tr></thead>
              <tbody>
                {h.backups.map((b) => (
                  <tr key={b.database_name}>
                    <td>{b.database_name}</td><td>{b.recovery_model_desc}</td>
                    <td title={b.last_full ? fmtTime(b.last_full, { date: true, millis: false }) : ''}>{b.last_full ? ago(b.last_full) : <Tone tone="warn">nunca</Tone>}</td>
                    <td>{b.last_diff ? ago(b.last_diff) : '—'}</td>
                    <td>{b.recovery_model_desc === 'SIMPLE' ? <span className="lg-muted">não se aplica</span> : b.last_log ? ago(b.last_log) : <Tone tone="warn">nunca</Tone>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {h.jobs.length > 0 && (
          <section className="db-card">
            <header className="db-card__head"><h3>Jobs que falharam (24 h)</h3></header>
            <div className="db-rows">{h.jobs.map((j, k) => <div key={k} className="db-job"><b>{j.job_name}</b><span className="lg-muted">{fmtTime(j.run_at, { date: true, millis: false })}</span><small>{String(j.message || '').slice(0, 400)}</small></div>)}</div>
          </section>
        )}
        <section className="db-card">
          <header className="db-card__head"><h3>Conexões por programa</h3><small className="lg-muted">transação aberta numa conexão ociosa costuma ser a origem dos bloqueios</small></header>
          <div className="db-table-wrap">
            <table className="db-table">
              <thead><tr><th>Programa</th><th>Login</th><th>Computador</th><th className="is-num">Sessões</th><th className="is-num">Ativas</th><th className="is-num">Com transação</th></tr></thead>
              <tbody>
                {h.connections.slice(0, 40).map((c, k) => (
                  <tr key={k} className={c.open_transactions > 0 ? 'is-blocked' : ''}>
                    <td className="db-ellipsis">{c.program_name || '—'}</td><td>{c.login_name}</td><td>{c.host_name || '—'}</td>
                    <td className="is-num">{fmtNum(c.sessions)}</td><td className="is-num">{fmtNum(c.active)}</td><td className="is-num">{c.open_transactions ? <b>{fmtNum(c.open_transactions)}</b> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="db-card">
          <header className="db-card__head"><h3>Índices que o otimizador sentiu falta</h3><small className="lg-muted">desde o último restart · revise antes de criar: índices demais pesam nas gravações</small></header>
          {h.missing.length === 0 ? <div className="lg-muted lg-pad">Nenhuma sugestão.</div> : (
            <div className="db-table-wrap">
              <table className="db-table">
                <thead><tr><th>Tabela</th><th>Colunas</th><th className="is-num">Buscas</th><th className="is-num">Ganho estimado</th><th /></tr></thead>
                <tbody>
                  {h.missing.map((m, k) => (
                    <tr key={k}>
                      <td className="db-ellipsis">{m.table_name}</td>
                      <td className="db-ellipsis is-mono">{[m.equality_columns, m.inequality_columns].filter(Boolean).join(', ')}{m.included_columns ? ` + (${m.included_columns})` : ''}</td>
                      <td className="is-num">{fmtNum(Number(m.user_seeks) + Number(m.user_scans))}</td>
                      <td className="is-num">{Math.round(m.avg_user_impact)}%</td>
                      <td><button type="button" className="lg-btn" onClick={() => copyText(missingIndexSql(m), toast, 'CREATE INDEX copiado')}><Icon name="copy" size={12} /><span>CREATE INDEX</span></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
