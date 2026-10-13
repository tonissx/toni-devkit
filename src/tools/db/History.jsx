// Banco — aba Histórico: o que o monitor gravou. Séries no tempo (bloqueadas, sessões, CPU, lotes/s, esperas de
// lock, PLE) com os incidentes marcados; clicar num momento mostra o retrato (amostra + incidentes abertos naquela
// hora, com a árvore de bloqueio gravada). Arrastar aproxima.
import { DS } from '../../lib/ds.js';
import { TimeSeries } from '../../lib/TimeSeries.jsx';
import { dbApi, errText, fmtTime, fmtDur, fmtNum, fmtCompact, oneLine, whoOf, sqlOf, copyText, Tone } from './shared.jsx';

const { Icon, Spinner } = DS;

const PRESETS = [
  { id: '30m', label: '30 min', ms: 30 * 60e3 }, { id: '3h', label: '3 h', ms: 3 * 3600e3 }, { id: '12h', label: '12 h', ms: 12 * 3600e3 },
  { id: '24h', label: '24 h', ms: 86400e3 }, { id: '7d', label: '7 dias', ms: 7 * 86400e3 },
];

export const INCIDENT_KIND = {
  blocking: { label: 'Bloqueio', icon: 'octagon-x', color: 'var(--lg-error)' },
  long: { label: 'Query longa', icon: 'hourglass', color: 'var(--lg-warn)' },
  deadlock: { label: 'Deadlock', icon: 'skull', color: 'var(--lg-fatal)' },
  kill: { label: 'Encerrada', icon: 'power', color: 'var(--tk-text-2)' },
  offline: { label: 'Sem conexão', icon: 'unplug', color: 'var(--tk-text-3)' },
};

/** O retrato gravado de um incidente (árvore de bloqueio / a query longa / encerrada). */
export function IncidentDetail({ serverId, incident, onClose, toast, onDeadlock }) {
  const [full, setFull] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setFull(null);
    dbApi().incident(serverId, incident.id, incident.t).then((i) => { if (alive) setFull(i); }, (e) => { if (alive) setFull({ error: errText(e) }); });
    return () => { alive = false; };
  }, [incident.id]);
  const k = INCIDENT_KIND[incident.kind] || INCIDENT_KIND.long;
  // Retrato do incidente como nota (para o relatório do ocorrido / o chamado).
  const toNotes = async () => {
    if (!full || full.error) return;
    const lines = [`**${k.label}** · ${fmtTime(incident.t, { date: true })}${incident.durMs != null ? ` · durou ${fmtDur(incident.durMs)}` : ''}`, '', incident.title, ''];
    const rows = full.data && full.data.tree ? full.data.tree.map((n) => ({ id: n.id, depth: n.depth, row: n.row })) : full.data && full.data.row ? [{ id: full.data.row.session_id, depth: 0, row: full.data.row }] : [];
    for (const n of rows.slice(0, 12)) lines.push(`${'  '.repeat(n.depth)}- Sessão ${n.id} — ${whoOf(n.row)}${n.row && n.row.wait_type ? ` · ${n.row.wait_type}` : ''}`, '', '```sql', sqlOf(n.row) || '(sem texto)', '```', '');
    try { await window.devkit.notes.create({ title: `${k.label} ${fmtTime(incident.t, { date: true, millis: false })}`.slice(0, 120), content: lines.join('\n'), tags: ['banco', incident.kind], type: 'note', source: 'db' }); toast('Enviado para Notes', incident.title.slice(0, 80), 'ok'); } catch (e) { toast('Não foi possível criar a nota', errText(e), 'error'); }
  };
  return (
    <aside className="db-detail">
      <div className="db-detail__head">
        <Icon name={k.icon} size={15} style={{ color: k.color }} />
        <b>{k.label}</b>
        {full && !full.error && ['blocking', 'long'].includes(incident.kind) && <button type="button" className="lg-btn" onClick={toNotes} title="Salvar o retrato como nota"><Icon name="notebook-pen" size={12} /><span>Notes</span></button>}
        <span className="lg-muted">{fmtTime(incident.t, { date: true, millis: false })}{incident.durMs != null ? ` · durou ${fmtDur(incident.durMs)}` : incident.open ? ' · ainda acontecendo' : ''}</span>
        {incident.open && <Tone tone="error">acontecendo</Tone>}
        <span className="lg-grow" />
        <button type="button" className="lg-icon" onClick={onClose} aria-label="Fechar"><Icon name="x" size={14} /></button>
      </div>
      <div className="db-detail__who">{incident.title}</div>
      <div className="db-detail__body tk-scroll">
        {!full ? <div className="lg-muted"><Spinner size={12} /> Carregando o retrato…</div>
          : full.error ? <div className="lg-err">{full.error}</div>
            : incident.kind === 'blocking' && full.data ? (
              <>
                {incident.peakBlocked != null && <div className="db-facts"><span>Pico</span><b>{incident.peakBlocked} sessão(ões) esperando · maior espera {fmtDur(incident.peakWaitMs)}</b></div>}
                <div className="db-block__list">
                  {full.data.tree.map((n) => (
                    <div key={n.id} className={'db-bnode' + (n.depth === 0 ? ' is-head' : '')} style={{ paddingLeft: 10 + n.depth * 22 }}>
                      {n.depth > 0 && <span className="db-bnode__elbow">└</span>}
                      <span className="db-bnode__sid">{n.id}</span>
                      {n.depth === 0 && <Tone tone="error" icon="octagon-x">segurava {n.blockedCount}</Tone>}
                      {n.depth === 0 && n.idle && <Tone tone="warn" icon="hourglass">ociosa · transação aberta</Tone>}
                      {n.depth > 0 && n.row && <span className="db-bnode__wait">{n.row.wait_type} · {fmtDur(n.waitMs)}</span>}
                      <span className="db-bnode__who">{whoOf(n.row)}</span>
                    </div>
                  ))}
                </div>
                {full.data.tree.slice(0, 6).map((n) => (
                  <div key={'s' + n.id} className="db-snap">
                    <div className="db-snap__head"><b>Sessão {n.id}</b><span className="lg-muted">{whoOf(n.row)}</span><span className="lg-grow" /><button type="button" className="lg-icon" onClick={() => copyText(sqlOf(n.row), toast, 'SQL copiado')} title="Copiar"><Icon name="copy" size={12} /></button></div>
                    <pre className="db-sql is-small">{sqlOf(n.row) || '(sem texto)'}</pre>
                  </div>
                ))}
              </>
            ) : incident.kind === 'long' && full.data ? (
              <>
                <div className="db-facts">
                  <span>Sessão</span><b>{full.data.row.session_id}</b>
                  <span>Quem</span><b>{whoOf(full.data.row)}</b>
                  <span>Banco</span><b>{full.data.row.database_name || '—'}</b>
                  {incident.peakMs != null && <><span>Durou pelo menos</span><b>{fmtDur(incident.peakMs)}</b></>}
                  <span>Espera</span><b>{full.data.row.wait_type || '—'}</b>
                  <span>CPU / leituras</span><b>{fmtDur(full.data.row.cpu_time)} / {fmtNum(full.data.row.logical_reads)}</b>
                </div>
                <pre className="db-sql">{sqlOf(full.data.row)}</pre>
              </>
            ) : incident.kind === 'deadlock' ? (
              <button type="button" className="lg-btn is-accent" onClick={() => onDeadlock(incident)}><Icon name="skull" size={13} /><span>Ver o desenho na aba Deadlocks</span></button>
            ) : incident.kind === 'kill' && full.data ? (
              <div className="db-facts">
                <span>Sessão</span><b>{full.data.session}</b>
                <span>Login</span><b>{full.data.login || '—'}</b>
                <span>Programa</span><b>{full.data.program || '—'}</b>
                <span>Computador</span><b>{full.data.host || '—'}</b>
                <span>Encerrada às</span><b>{fmtTime(incident.t, { date: true })}</b>
              </div>
            ) : <div className="lg-muted">{incident.kind === 'offline' ? 'O monitor perdeu a conexão com o servidor nesse momento e tentou de novo sozinho.' : 'Sem retrato para este evento.'}</div>}
      </div>
    </aside>
  );
}

export function History({ server, toast, focusAt, onDeadlock }) {
  const [preset, setPreset] = React.useState('3h');
  const [zoom, setZoom] = React.useState(null); // { from, to }
  const [data, setData] = React.useState(null);
  const [kinds, setKinds] = React.useState(null); // filtro de incidentes
  const [moment, setMoment] = React.useState(null); // { t, sample, incidents }
  const [incident, setIncident] = React.useState(null);
  // Período até agora: anda sozinho a cada 30 s (liveTick). Com zoom, fica parado.
  const [liveTick, setLiveTick] = React.useState(0);
  const range = React.useMemo(() => {
    if (zoom) return zoom;
    const p = PRESETS.find((x) => x.id === preset) || PRESETS[1];
    const to = Date.now();
    return { from: to - p.ms, to };
  }, [preset, zoom, liveTick]);
  React.useEffect(() => {
    let alive = true;
    dbApi().history(server.id, { from: range.from, to: range.to, buckets: 240 })
      .then((h) => { if (alive) setData(h); }, (e) => { if (alive) toast('Histórico', errText(e), 'error'); });
    return () => { alive = false; };
  }, [server.id, range]);
  React.useEffect(() => {
    if (zoom) return undefined;
    const t = setInterval(() => setLiveTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [zoom]);
  // Veio de fora (Logs → Banco): abre no momento pedido.
  React.useEffect(() => {
    if (!focusAt) return;
    setZoom({ from: focusAt - 30 * 60e3, to: focusAt + 30 * 60e3 });
    pick(focusAt);
  }, [focusAt]);

  const pick = async (t) => {
    setIncident(null);
    try { const r = await dbApi().at(server.id, t); setMoment({ t, ...r }); } catch (e) { toast('Histórico', errText(e), 'error'); }
  };

  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Lendo o histórico…</div>;
  const S = data.series;
  const rows = [
    { key: 'b', label: 'Bloqueadas', color: 'var(--lg-error)', data: S.b, kind: 'columns', fmt: fmtNum },
    { key: 'a', label: 'Sessões ativas', color: 'var(--tk-accent)', data: S.a, fmt: fmtNum },
    { key: 'cpu', label: 'CPU do SQL', color: 'var(--db-c-cpu)', data: S.cpu, fmt: (v) => `${Math.round(v)}%` },
    { key: 'bps', label: 'Lotes/s', color: 'var(--tk-blue)', data: S.bps, fmt: (v) => fmtCompact(Math.round(v)) },
    { key: 'lw', label: 'Esperas de lock/s', color: 'var(--db-c-lock)', data: S.lw, fmt: (v) => fmtCompact(Math.round(v * 10) / 10) },
    { key: 'ple', label: 'PLE', color: 'var(--db-c-memory)', data: S.ple, fmt: (v) => fmtDur(v * 1000), min0: false },
  ];
  const incs = data.incidents.filter((i) => !kinds || kinds.includes(i.kind));
  const counts = data.incidents.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
  const markers = data.incidents.filter((i) => i.kind !== 'offline' || true).map((i) => ({ id: i.id, t: i.t, color: (INCIDENT_KIND[i.kind] || INCIDENT_KIND.long).color, title: `${fmtTime(i.t, { millis: false })} — ${i.title}` }));
  const openIncident = (i) => { setMoment(null); setIncident(i); };

  return (
    <div className="db-now">
      <div className="db-now__main tk-scroll">
        <div className="db-toolbar">
          <div className="lg-seg" role="group" aria-label="Período">
            {PRESETS.map((p) => <button key={p.id} type="button" className={!zoom && preset === p.id ? 'is-on' : ''} onClick={() => { setZoom(null); setPreset(p.id); }}>{p.label}</button>)}
          </div>
          {zoom && <span className="lg-range"><Icon name="scan-line" size={12} />{fmtTime(zoom.from, { date: true, millis: false })} – {fmtTime(zoom.to, { millis: false })}<button type="button" onClick={() => setZoom(null)} aria-label="Voltar ao período"><Icon name="x" size={12} /></button></span>}
          <span className="lg-grow" />
          <span className="lg-muted">{fmtNum(data.samples)} amostras{server.background ? '' : ' · só grava com a tela aberta (ligue "monitorar em segundo plano" no servidor)'}</span>
        </div>
        {data.samples === 0 ? (
          <div className="lg-empty">
            <Icon name="history" size={22} />
            <b>Nada gravado neste período</b>
            <span>O histórico guarda o que o monitor viu enquanto estava conectado. Para ter histórico sempre, marque "Monitorar em segundo plano" na edição do servidor.</span>
          </div>
        ) : (
          <TimeSeries title="Servidor" start={data.start} step={data.step} buckets={data.buckets} rows={rows} markers={markers}
            onMarker={(id) => { const i = data.incidents.find((x) => x.id === id); if (i) openIncident(i); }}
            onPick={pick} onRange={(r) => setZoom(r)} range={moment ? { from: moment.t, to: moment.t } : null} />
        )}
        {moment && (
          <section className="db-card db-moment">
            <header className="db-card__head">
              <h3>Às {fmtTime(moment.t, { date: true, millis: false })}</h3>
              <span className="lg-grow" />
              <button type="button" className="lg-icon" onClick={() => setMoment(null)} aria-label="Fechar"><Icon name="x" size={13} /></button>
            </header>
            {moment.sample ? (
              <div className="db-facts is-row">
                <span>Sessões ativas</span><b>{fmtNum(moment.sample.a)}</b>
                <span>Bloqueadas</span><b>{fmtNum(moment.sample.b)}</b>
                <span>Mais longa</span><b>{fmtDur(moment.sample.lx)}</b>
                <span>CPU</span><b>{moment.sample.cpu == null ? '—' : moment.sample.cpu + '%'}</b>
                <span>Lotes/s</span><b>{moment.sample.bps == null ? '—' : fmtCompact(Math.round(moment.sample.bps))}</b>
                {moment.sample.w && <><span>Esperas</span><b>{moment.sample.w.slice(0, 3).map(([t, ms]) => `${t} ${fmtDur(ms)}`).join(' · ')}</b></>}
              </div>
            ) : <div className="lg-muted lg-pad">Nenhuma amostra perto deste momento.</div>}
            {moment.incidents.length > 0 && <div className="db-moment__inc">{moment.incidents.map((i) => <IncidentRow key={i.id} i={i} onClick={() => openIncident(i)} />)}</div>}
          </section>
        )}
        <section className="db-card">
          <header className="db-card__head">
            <h3>Incidentes <small>{fmtNum(data.incidents.length)}</small></h3>
            <div className="lg-chips">
              {Object.keys(INCIDENT_KIND).filter((k) => counts[k]).map((k) => {
                const on = !kinds || kinds.includes(k);
                return <button key={k} type="button" className={'lg-chip' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => setKinds((cur) => { const all = Object.keys(INCIDENT_KIND); const c = cur || all; const n = c.includes(k) ? c.filter((x) => x !== k) : [...c, k]; return n.length === all.length ? null : n; })}><span className="lg-chip__dot" style={{ background: INCIDENT_KIND[k].color }} /><span className="lg-chip__label">{INCIDENT_KIND[k].label}</span><span className="lg-chip__n">{counts[k]}</span></button>;
              })}
            </div>
          </header>
          {incs.length === 0 ? <div className="lg-muted lg-pad">Nenhum incidente neste período — bloqueios acima de 10 s, queries acima de 30 s, deadlocks e quedas aparecem aqui.</div>
            : <div className="db-incs">{incs.map((i) => <IncidentRow key={i.id} i={i} sel={incident && incident.id === i.id} onClick={() => openIncident(i)} />)}</div>}
        </section>
      </div>
      {incident && <IncidentDetail serverId={server.id} incident={incident} toast={toast} onClose={() => setIncident(null)} onDeadlock={onDeadlock} />}
    </div>
  );
}

function IncidentRow({ i, sel, onClick }) {
  const k = INCIDENT_KIND[i.kind] || INCIDENT_KIND.long;
  return (
    <button type="button" className={'db-inc' + (sel ? ' is-sel' : '')} onClick={onClick}>
      <span className="db-inc__bar" style={{ background: k.color }} />
      <Icon name={k.icon} size={14} />
      <span className="db-inc__time">{fmtTime(i.t, { date: true, millis: false })}</span>
      <span className="db-inc__title">{oneLine(i.title, 180)}</span>
      <span className="db-inc__dur">{i.open ? <Tone tone="error">acontecendo</Tone> : i.durMs != null ? fmtDur(i.durMs) : ''}</span>
    </button>
  );
}
