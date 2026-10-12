// Banco — aba Agora: indicadores (com o desenho dos últimos minutos), árvore de bloqueio, sessões ativas, esperas do
// momento e o detalhe de uma sessão (texto, plano, encerrar). Tudo vem do último ciclo do coletor (nada é consultado
// a mais no servidor por estar com a tela aberta, além do plano sob demanda).
import { DS } from '../../lib/ds.js';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';
import { WAIT_HINT, CATEGORY_LABEL } from '../../db/waits.js';
import { Stat } from '../../lib/charts.jsx';
import { dbApi, errText, fmtNum, fmtCompact, fmtTime, Sparkline, copyText, fmtDur, whoOf, sqlOf, oneLine, Tone, WAIT_CAT, STATUS } from './shared.jsx';

const { Icon, Modal, Button, Spinner } = DS;

const ISOLATION = ['—', 'read uncommitted', 'read committed', 'repeatable read', 'serializable', 'snapshot'];

/* ─────────────── Indicadores ─────────────── */

function Kpis({ now, ring }) {
  const s = now.summary || {};
  const r = now.rates || {};
  const series = (k) => ring.map((x) => (x[k] == null ? 0 : x[k]));
  const kpis = [
    { key: 'cpu', label: 'CPU do SQL', value: s.cpu == null ? '—' : `${s.cpu}%`, note: now.cpu ? `outros processos ${Math.max(0, 100 - now.cpu.system_idle - now.cpu.sql_cpu)}%` : 'atualiza a cada minuto', tone: s.cpu >= 85 ? 'error' : s.cpu >= 70 ? 'warn' : null },
    { key: 'batchPerSec', label: 'Lotes/s', value: r.batchPerSec == null ? '—' : fmtCompact(Math.round(r.batchPerSec)), note: r.transactionsPerSec != null ? `${fmtCompact(Math.round(r.transactionsPerSec))} transações/s` : null },
    { key: 'connections', label: 'Conexões', value: fmtNum(r.userConnections), note: null },
    { key: 'active', label: 'Sessões ativas', value: fmtNum(s.active), note: s.longestMs ? `mais longa ${fmtDur(s.longestMs)}` : null },
    { key: 'blocked', label: 'Bloqueadas', value: fmtNum(s.blocked), note: s.blocked ? `${s.heads.length} cabeça${s.heads.length === 1 ? '' : 's'}` : 'nenhuma', tone: s.blocked ? 'error' : null },
    { key: 'ple', label: 'Page life expectancy', value: r.ple == null ? '—' : fmtDur(r.ple * 1000), note: r.memoryGrantsPending ? `${r.memoryGrantsPending} esperando memória` : null, tone: r.ple != null && r.ple < 300 ? 'warn' : null },
  ];
  return (
    <div className="db-kpis">
      {kpis.map((k) => (
        <div key={k.key} className={'db-kpi' + (k.tone ? ' is-' + k.tone : '')}>
          <Stat label={k.label} value={k.value} note={k.note} tone={k.tone} />
          <span className="db-kpi__spark"><Sparkline data={series(k.key)} width={120} height={24} title={`${k.label} nos últimos minutos`} /></span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────── Bloqueio ─────────────── */

function BlockingTree({ tree, selected, onSelect, onKill }) {
  if (!tree.length) return null;
  const heads = tree.filter((n) => n.depth === 0);
  return (
    <section className="db-block">
      <header className="db-block__head">
        <Icon name="octagon-x" size={15} />
        <b>Bloqueio</b>
        <span className="lg-muted">{heads.length} cabeça{heads.length === 1 ? '' : 's'} · {tree.length - heads.length} sessão(ões) esperando</span>
      </header>
      <div className="db-block__list" role="tree">
        {tree.map((n) => {
          const r = n.row || {};
          const head = n.depth === 0;
          return (
            <div key={n.id} role="treeitem" aria-level={n.depth + 1} className={'db-bnode' + (head ? ' is-head' : '') + (selected === n.id ? ' is-sel' : '')} style={{ paddingLeft: 10 + n.depth * 22 }} onClick={() => !n.unknown && onSelect(n.id)}>
              {n.depth > 0 && <span className="db-bnode__elbow" aria-hidden="true">└</span>}
              <span className="db-bnode__sid">{n.id}</span>
              {head && <Tone tone="error" icon="octagon-x">segura {n.blockedCount}</Tone>}
              {head && n.idle && <Tone tone="warn" icon="hourglass" title="Sem comando rodando, mas com transação aberta: alguém fez BEGIN TRAN e não fez COMMIT/ROLLBACK">ociosa · transação aberta{r.transaction_begin_time ? ` há ${fmtDur(Date.now() - r.transaction_begin_time)}` : ''}</Tone>}
              {n.cycle && <Tone tone="error" icon="refresh-cw" title="Ciclo: as sessões esperam umas às outras (deadlock que o SQL Server ainda não resolveu)">ciclo</Tone>}
              {n.unknown && <span className="lg-muted">sessão que já terminou</span>}
              {!head && <span className="db-bnode__wait" title={r.wait_resource || ''}>{r.wait_type || 'esperando'} · {fmtDur(n.waitMs)}</span>}
              <span className="db-bnode__who">{whoOf(r)}</span>
              <span className="db-bnode__sql">{oneLine(sqlOf(r), 160)}</span>
              {head && !n.unknown && <button type="button" className="lg-btn db-danger" onClick={(e) => { e.stopPropagation(); onKill(n); }} title="Encerrar a sessão que está segurando as outras"><Icon name="power" size={12} /><span>Encerrar</span></button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────── Sessões ativas ─────────────── */

const COLS = [
  { key: 'session_id', label: 'Sessão', num: true },
  { key: 'total_elapsed_time', label: 'Duração', num: true, fmt: fmtDur },
  { key: 'wait', label: 'Espera', sort: (r) => r.wait_time || 0 },
  { key: 'blocking_session_id', label: 'Bloqueada por', num: true },
  { key: 'cpu_time', label: 'CPU', num: true, fmt: fmtDur },
  { key: 'logical_reads', label: 'Leituras', num: true, fmt: fmtCompact },
  { key: 'database_name', label: 'Banco' },
  { key: 'who', label: 'Quem', sort: (r) => whoOf(r) },
  { key: 'sql', label: 'Comando', sort: (r) => sqlOf(r) },
];

function Requests({ now, selected, onSelect }) {
  const [sort, setSort] = React.useState({ key: 'total_elapsed_time', dir: -1 });
  const [q, setQ] = React.useState('');
  const heads = new Set(now.tree.filter((n) => n.depth === 0).map((n) => n.id));
  const rows = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = now.requests;
    if (ql) list = list.filter((r) => [r.session_id, r.program_name, r.login_name, r.host_name, r.database_name, r.wait_type, sqlOf(r)].join(' ').toLowerCase().includes(ql));
    const col = COLS.find((c) => c.key === sort.key);
    const val = (r) => (col && col.sort ? col.sort(r) : r[sort.key]);
    return [...list].sort((a, b) => { const x = val(a); const y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  }, [now.requests, sort, q]);
  return (
    <section className="db-card">
      <header className="db-card__head">
        <h3>Sessões ativas <small>{fmtNum(now.requests.length)}</small></h3>
        <div className="lg-search db-filter"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por programa, login, banco, espera ou texto" aria-label="Filtrar sessões" /></div>
      </header>
      {rows.length === 0 ? <div className="lg-muted lg-pad">{now.requests.length ? 'Nada com esse filtro.' : 'Nenhuma sessão rodando agora — o servidor está ocioso.'}</div> : (
        <div className="db-table-wrap tk-scroll">
          <table className="db-table">
            <thead>
              <tr>{COLS.map((c) => (
                <th key={c.key} className={c.num ? 'is-num' : ''} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>{c.label}{sort.key === c.key && <Icon name={sort.dir > 0 ? 'chevron-up' : 'chevron-down'} size={11} />}</button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.session_id} className={(r.blocking_session_id ? 'is-blocked ' : '') + (heads.has(r.session_id) ? 'is-head ' : '') + (selected === r.session_id ? 'is-sel' : '')} onClick={() => onSelect(r.session_id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.session_id); }}>
                  <td className="is-num">{r.session_id}</td>
                  <td className="is-num">{fmtDur(r.total_elapsed_time)}</td>
                  <td title={r.wait_resource || ''}>{r.wait_type ? <span>{r.wait_type} <small>{fmtDur(r.wait_time)}</small></span> : <span className="lg-muted">{r.status}</span>}</td>
                  <td className="is-num">{r.blocking_session_id || ''}</td>
                  <td className="is-num">{fmtDur(r.cpu_time)}</td>
                  <td className="is-num">{fmtCompact(r.logical_reads)}</td>
                  <td>{r.database_name}</td>
                  <td className="db-ellipsis" title={whoOf(r)}>{whoOf(r)}</td>
                  <td className="db-sqlcell" title={oneLine(sqlOf(r), 600)}>{r.command && <b>{r.command} </b>}{oneLine(sqlOf(r), 140)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ─────────────── Esperas ─────────────── */

function Waits({ waits }) {
  if (!waits || !waits.rows.length) return <section className="db-card"><header className="db-card__head"><h3>Esperas</h3></header><div className="lg-muted lg-pad">Sem esperas relevantes nos últimos 15 s.</div></section>;
  const max = Math.max(...waits.rows.map((w) => w.waitMs));
  const cats = Object.entries(waits.byCategory).sort((a, b) => b[1] - a[1]);
  const total = waits.total || 1;
  return (
    <section className="db-card">
      <header className="db-card__head"><h3>Esperas <small>últimos ~15 s</small></h3></header>
      <div className="db-catbar" role="img" aria-label={cats.map(([k, v]) => `${CATEGORY_LABEL[k]} ${Math.round((v / total) * 100)}%`).join(', ')}>
        {cats.map(([k, v]) => <span key={k} style={{ flexGrow: v, background: (WAIT_CAT[k] || WAIT_CAT.other).color }} title={`${CATEGORY_LABEL[k]}: ${Math.round((v / total) * 100)}%`} />)}
      </div>
      <div className="db-legend">{cats.map(([k, v]) => <span key={k}><i style={{ background: (WAIT_CAT[k] || WAIT_CAT.other).color }} />{(WAIT_CAT[k] || WAIT_CAT.other).label} {Math.round((v / total) * 100)}%</span>)}</div>
      <div className="db-waits">
        {waits.rows.slice(0, 8).map((w) => (
          <div key={w.wait_type} className="db-wait" title={WAIT_HINT[w.wait_type] || CATEGORY_LABEL[w.category] || ''}>
            <span className="db-wait__name">{w.wait_type}</span>
            <span className="db-wait__track"><span style={{ width: Math.max(2, (w.waitMs / max) * 100) + '%', background: (WAIT_CAT[w.category] || WAIT_CAT.other).color }} /></span>
            <span className="db-wait__v">{fmtDur(w.waitMs)}<small>{fmtNum(w.tasks)}×</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────── Detalhe e encerrar ─────────────── */

export function KillModal({ serverId, node, onClose, toast }) {
  const r = node.row || {};
  const [busy, setBusy] = React.useState(false);
  const longTran = r.transaction_begin_time && Date.now() - r.transaction_begin_time > 60e3;
  const kill = async () => {
    setBusy(true);
    try {
      await dbApi().kill(serverId, node.id, { login_name: r.login_name, program_name: r.program_name || '' });
      toast(`Sessão ${node.id} encerrada`, 'O SQL Server desfaz a transação dela; as sessões que esperavam seguem.', 'ok');
      onClose(true);
    } catch (e) { toast('Não encerrou', errText(e), 'error'); setBusy(false); }
  };
  return (
    <Modal title={`Encerrar a sessão ${node.id}?`} icon="power" onClose={() => onClose(false)} width={560}
      description="KILL desconecta a sessão e desfaz (ROLLBACK) o que ela fez desde o último COMMIT. Quem estava usando o sistema por ela recebe um erro."
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="destructive" onClick={kill} disabled={busy}>{busy ? 'Encerrando…' : `Encerrar sessão ${node.id}`}</Button></>}>
      <div className="db-facts">
        <span>Login</span><b>{r.login_name || '—'}</b>
        <span>Programa</span><b>{r.program_name || '—'}</b>
        <span>Computador</span><b>{r.host_name || r.client_net_address || '—'}</b>
        <span>Banco</span><b>{r.database_name || '—'}</b>
        {node.blockedCount > 0 && <><span>Segura</span><b>{node.blockedCount} sessão(ões) há até {fmtDur(node.maxWaitMs)}</b></>}
        {r.transaction_begin_time && <><span>Transação aberta</span><b>há {fmtDur(Date.now() - r.transaction_begin_time)}</b></>}
      </div>
      <pre className="db-sql is-small">{sqlOf(r) || '(sem texto)'}</pre>
      {longTran && <div className="db-note is-warn"><Icon name="triangle-alert" size={13} /> A transação é antiga: desfazer pode demorar tanto quanto ela levou para fazer — e os bloqueios continuam até o ROLLBACK terminar.</div>}
    </Modal>
  );
}

export function SessionDetail({ serverId, sid, now, onClose, onKill, toast, onOpenSql }) {
  const fromTree = now.tree.find((n) => n.id === sid);
  const r = (now.requests.find((x) => x.session_id === sid)) || (fromTree && fromTree.row);
  const [full, setFull] = React.useState(false);
  const [plan, setPlan] = React.useState(null);
  const cfg = useAiMode();
  const ai = useAiTask('dbQuery', cfg);
  React.useEffect(() => { ai.close(); }, [sid]);
  if (!r) {
    return (
      <aside className="db-detail">
        <div className="db-detail__head"><b>Sessão {sid}</b><span className="lg-grow" /><button type="button" className="lg-icon" onClick={onClose} aria-label="Fechar"><Icon name="x" size={14} /></button></div>
        <div className="lg-muted lg-pad">A sessão terminou ou deixou de rodar.</div>
      </aside>
    );
  }
  const getPlan = async () => {
    setPlan({ busy: true });
    try {
      const p = await dbApi().plan(serverId, { sessionId: r.command ? r.session_id : null, planHandle: r.plan_handle });
      const file = await dbApi().savePlan(p.xml, `sessao-${r.session_id}`);
      setPlan(file ? { file } : null);
      if (file) toast('Plano salvo', `${file} — abra no SSMS ou no Azure Data Studio`, 'ok');
    } catch (e) { setPlan(null); toast('Sem plano', errText(e), 'error'); }
  };
  const node = fromTree || { id: sid, row: r, blockedCount: 0 };
  const text = full ? String(r.batch_text || '').trim() : sqlOf(r);
  return (
    <aside className="db-detail" aria-label={`Sessão ${sid}`}>
      <div className="db-detail__head">
        <b>Sessão {sid}</b>
        {fromTree && fromTree.depth === 0 && <Tone tone="error" icon="octagon-x">segura {fromTree.blockedCount}</Tone>}
        {r.blocking_session_id > 0 && <Tone tone="warn" icon="hourglass">esperando a {r.blocking_session_id}</Tone>}
        <span className="lg-grow" />
        <button type="button" className="lg-icon" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar"><Icon name="x" size={14} /></button>
      </div>
      <div className="db-detail__who">{whoOf(r) || '—'}{r.client_net_address ? ` · ${r.client_net_address}` : ''}</div>
      <div className="db-detail__actions">
        <button type="button" className="lg-btn" onClick={() => copyText(text, toast, 'SQL copiado')}><Icon name="copy" size={13} /><span>Copiar</span></button>
        {onOpenSql && <button type="button" className="lg-btn" onClick={() => onOpenSql(text)}><Icon name="database" size={13} /><span>SQL Formatter</span></button>}
        {(r.plan_handle || r.command) && <button type="button" className="lg-btn" onClick={getPlan} disabled={plan && plan.busy}>{plan && plan.busy ? <Spinner size={11} /> : <Icon name="list-tree" size={13} />}<span>Plano</span></button>}
        <button type="button" className="lg-btn db-danger" onClick={() => onKill(node)}><Icon name="power" size={13} /><span>Encerrar</span></button>
        {aiOn(cfg) && text && (
          <AiButton ai={ai} label="Por que está lenta" title="Explicar com IA (o texto passa pelo filtro de segredos)" onClick={() => ai.start(() => ({
            sql: text,
            stats: { elapsed: r.total_elapsed_time ? fmtDur(r.total_elapsed_time) : '', wait: r.wait_type ? `${r.wait_type} há ${fmtDur(r.wait_time)}` : '', blockedBy: r.blocking_session_id || null, database: r.database_name, avgReads: r.logical_reads },
          }))} />
        )}
      </div>
      <div className="db-detail__body tk-scroll">
        {aiOn(cfg) && <AiPanel ai={ai} className="lg-ai" />}
        <div className="db-facts">
          <span>Status</span><b>{r.status || (fromTree && fromTree.idle ? 'ociosa' : '—')}{r.command ? ` · ${r.command}` : ''}</b>
          <span>Banco</span><b>{r.database_name || '—'}</b>
          {r.start_time != null && <><span>Começou</span><b>{fmtTime(r.start_time, { millis: false })} ({fmtDur(r.total_elapsed_time)})</b></>}
          {r.wait_type && <><span>Esperando</span><b>{r.wait_type} há {fmtDur(r.wait_time)}{WAIT_HINT[r.wait_type] ? <small>{WAIT_HINT[r.wait_type]}</small> : null}</b></>}
          {r.wait_resource && <><span>Recurso</span><b className="is-mono">{r.wait_resource}</b></>}
          {r.cpu_time != null && <><span>CPU</span><b>{fmtDur(r.cpu_time)}</b></>}
          {r.logical_reads != null && <><span>Leituras / escritas</span><b>{fmtNum(r.logical_reads)} / {fmtNum(r.writes)}</b></>}
          {r.granted_query_memory > 0 && <><span>Memória</span><b>{fmtNum(Math.round(r.granted_query_memory * 8))} KB</b></>}
          {r.percent_complete > 0 && <><span>Progresso</span><b>{Math.round(r.percent_complete)}%</b></>}
          <span>Transações abertas</span><b>{r.open_transaction_count != null ? r.open_transaction_count : '—'}{r.transaction_begin_time ? ` (desde ${fmtTime(r.transaction_begin_time, { millis: false })})` : ''}</b>
          {r.transaction_isolation_level != null && <><span>Isolamento</span><b>{ISOLATION[r.transaction_isolation_level] || r.transaction_isolation_level}</b></>}
          {r.object_name && <><span>Objeto</span><b className="is-mono">{r.object_name}</b></>}
          {r.query_hash && <><span>query_hash</span><b className="is-mono">{r.query_hash}</b></>}
        </div>
        <div className="db-detail__sqlhead">
          <span>{full ? 'Lote inteiro' : r.statement_text ? 'Comando em execução' : 'Último comando'}</span>
          {r.statement_text && r.batch_text && <button type="button" className="lg-btn" onClick={() => setFull((v) => !v)}>{full ? 'Só o comando' : 'Lote inteiro'}</button>}
        </div>
        <pre className="db-sql">{text || '(sem texto)'}</pre>
      </div>
    </aside>
  );
}

/* ─────────────── Aba ─────────────── */

export function Now({ server, now, ring, toast, onOpenSql }) {
  const [sel, setSel] = React.useState(null);
  const [killing, setKilling] = React.useState(null);
  React.useEffect(() => { setSel(null); }, [server.id]);
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && sel && !killing) setSel(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sel, killing]);
  if (!now || now.status === 'idle' || (!now.t && now.status !== 'ok')) {
    const st = STATUS[now && now.status] || STATUS.connecting;
    return (
      <div className={'lg-empty' + (now && (now.status === 'error' || now.status === 'offline') ? ' is-error' : '')}>
        {now && (now.status === 'connecting' || now.status === 'idle') ? <Spinner size={18} /> : <Icon name={st.icon} size={22} />}
        <b>{now && now.status === 'locked' ? 'O Vault está trancado' : now && now.status === 'idle' ? 'Conectando…' : st.label}</b>
        <span>{now && now.error ? now.error : 'Primeira leitura do servidor…'}</span>
      </div>
    );
  }
  return (
    <div className="db-now">
      <div className="db-now__main tk-scroll">
        {now.error && <div className="db-note is-warn"><Icon name="triangle-alert" size={13} /> {now.error}</div>}
        <Kpis now={now} ring={ring} />
        <BlockingTree tree={now.tree} selected={sel} onSelect={setSel} onKill={setKilling} />
        <div className="db-now__grid">
          <Requests now={now} selected={sel} onSelect={setSel} />
          <Waits waits={now.waits} />
        </div>
        <div className="db-foot lg-muted">
          Atualizado às {fmtTime(now.t, { millis: false })} · ciclo de {now.summary && now.summary.tickMs != null ? `${now.summary.tickMs} ms` : '—'} · o próprio monitor não aparece nas listas
        </div>
      </div>
      {sel != null && <SessionDetail serverId={server.id} sid={sel} now={now} onClose={() => setSel(null)} onKill={setKilling} toast={toast} onOpenSql={onOpenSql} />}
      {killing && <KillModal serverId={server.id} node={killing} toast={toast} onClose={(done) => { setKilling(null); if (done) setSel(null); }} />}
    </div>
  );
}
