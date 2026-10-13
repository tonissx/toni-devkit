// Banco — visualizador do plano de execução (Showplan XML), sem sair do DevKit. O desenho vai da instrução (esquerda)
// às tabelas (direita), como no SSMS: cada caixa mostra o operador, o objeto e a fatia do custo; a espessura da seta é
// o volume de linhas. À direita, os insights (o que está caro/errado e o que fazer) e o detalhe do operador escolhido.
import { DS } from '../../lib/ds.js';
import { parsePlan, analyze, layout } from '../../db/showplan.js';
import { copyText, fmtNum, fmtDur } from './shared.jsx';

const { Icon, Modal, Button } = DS;

const NODE_W = 196, NODE_H = 68, GAP_X = 64, GAP_Y = 16, PAD = 20;
const SEV = {
  error: { icon: 'octagon-x', label: 'Crítico' },
  warn: { icon: 'triangle-alert', label: 'Atenção' },
  info: { icon: 'lightbulb', label: 'Dica' },
};
const rowsOf = (n) => (n.runtime ? n.runtime.rows : n.estRows) || 0;
const edgeW = (rows) => Math.min(9, 1.5 + Math.log10(rows + 1) * 1.1);
const compact = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',') + ' mil' : String(Math.round(n)));
const pct = (n) => (n < 0.5 ? '<1' : Math.round(n)) + '%';
const mb = (kb) => (kb == null ? '—' : kb >= 1024 ? (kb / 1024).toFixed(kb >= 10240 ? 0 : 1).replace('.', ',') + ' MB' : kb + ' KB');

function worst(list) { return list.reduce((w, i) => (!w || ({ error: 0, warn: 1, info: 2 }[i.severity] < { error: 0, warn: 1, info: 2 }[w]) ? i.severity : w), null); }

function Graph({ stmt, insights, selected, onSelect, containerRef }) {
  const { pos, cols, rows } = React.useMemo(() => layout(stmt.tree), [stmt]);
  const [zoom, setZoom] = React.useState(1);
  const W = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X;
  const H = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;
  const box = (id) => { const p = pos.get(id); return { x: PAD + p.col * (NODE_W + GAP_X), y: PAD + p.row * (NODE_H + GAP_Y) }; };
  const nodes = []; const edges = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.children) {
      const a = box(c.id), b = box(n.id);
      const x1 = a.x, y1 = a.y + NODE_H / 2, x2 = b.x + NODE_W, y2 = b.y + NODE_H / 2;
      edges.push({ k: n.id + '>' + c.id, d: `M ${x1} ${y1} C ${x1 - 28} ${y1}, ${x2 + 28} ${y2}, ${x2} ${y2}`, w: edgeW(rowsOf(c)), rows: rowsOf(c), mx: (x1 + x2) / 2, my: (y1 + y2) / 2, actual: !!c.runtime });
      walk(c);
    }
  };
  walk(stmt.tree);
  const sevOf = (id) => worst(insights.filter((i) => i.nodeId === id));
  const fit = () => { const el = containerRef.current; if (el) setZoom(Math.max(0.4, Math.min(1, (el.clientWidth - 8) / W))); };
  React.useEffect(() => { setZoom(1); }, [stmt]);
  return (
    <div className="db-plan__graphwrap">
      <div className="db-plan__zoom" role="group" aria-label="Zoom">
        <button type="button" className="lg-icon" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Diminuir" title="Diminuir"><Icon name="zoom-out" size={14} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="lg-icon" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label="Aumentar" title="Aumentar"><Icon name="zoom-in" size={14} /></button>
        <button type="button" className="lg-icon" onClick={fit} aria-label="Ajustar à largura" title="Ajustar à largura"><Icon name="maximize" size={14} /></button>
      </div>
      <div className="db-plan__graph tk-scroll" ref={containerRef}>
        <div style={{ width: W * zoom, height: H * zoom }}>
          <div className="db-plan__canvas" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
            <svg className="db-plan__edges" width={W} height={H} aria-hidden="true">
              {edges.map((e) => <path key={e.k} d={e.d} strokeWidth={e.w} className={e.actual ? 'is-actual' : ''} />)}
              {edges.map((e) => <text key={e.k + 't'} x={e.mx} y={e.my - 5} textAnchor="middle">{compact(e.rows)}</text>)}
            </svg>
            {nodes.map((n) => {
              const b = box(n.id);
              const sev = n.virtual ? null : sevOf(n.id);
              const heat = n.costPct >= 25 ? ' is-hot' : n.costPct >= 10 ? ' is-warm' : '';
              return (
                <button key={n.id} type="button" data-node={n.id} disabled={!!n.virtual}
                  className={'db-plan__node' + heat + (selected === n.id ? ' is-sel' : '') + (n.virtual ? ' is-root' : '')}
                  style={{ left: b.x, top: b.y, width: NODE_W, height: NODE_H }} onClick={() => onSelect(n.id)}
                  title={n.virtual ? n.label : `${n.label}${n.object ? ' — ' + n.object.full : ''}\nCusto próprio: ${pct(n.costPct)}`}>
                  <span className="db-plan__nhead">
                    <Icon name={n.icon} size={14} />
                    <b>{n.label}</b>
                    {sev && <span className={'db-plan__nbadge is-' + sev} title={SEV[sev].label}><Icon name={SEV[sev].icon} size={11} /></span>}
                  </span>
                  <span className="db-plan__nobj">{n.virtual ? `${compact(n.estRows)} linha(s) · custo ${stmt.cost.toFixed(3).replace('.', ',')}` : (n.object && n.object.table ? n.object.table + (n.object.index ? ' · ' + n.object.index : '') : n.logical !== n.physical ? n.logical : ' ')}</span>
                  {!n.virtual && <span className="db-plan__ncost"><b>{pct(n.costPct)}</b><small>{compact(rowsOf(n))} linha(s){n.runtime && n.runtime.executions > 1 ? ` · ${compact(n.runtime.executions)}×` : ''}</small></span>}
                  {!n.virtual && <span className="db-plan__nbar"><span style={{ width: Math.min(100, n.costPct) + '%' }} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Operators({ stmt, selected, onSelect }) {
  const [sort, setSort] = React.useState({ k: 'ownCost', dir: -1 });
  const val = (n, k) => (k === 'rows' ? rowsOf(n) : k === 'execs' ? (n.runtime ? n.runtime.executions : 0) : k === 'ms' ? (n.runtime ? n.runtime.elapsedMs : 0) : n[k] ?? 0);
  const list = [...stmt.nodes].sort((a, b) => (val(a, sort.k) - val(b, sort.k)) * sort.dir || a.id - b.id);
  const th = (k, label, numeric = true) => (
    <th className={numeric ? 'is-num' : ''} aria-sort={sort.k === k ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="db-plan__sort" onClick={() => setSort((s) => (s.k === k ? { k, dir: -s.dir } : { k, dir: -1 }))}>{label}{sort.k === k && <Icon name={sort.dir < 0 ? 'arrow-down' : 'arrow-up'} size={10} />}</button>
    </th>
  );
  return (
    <div className="db-table-wrap tk-scroll db-plan__ops">
      <table className="db-table">
        <thead><tr>{th('id', '#')}<th>Operador</th><th>Objeto</th>{th('ownCost', 'Custo')}{th('rows', stmt.isActual ? 'Linhas (reais)' : 'Linhas (est.)')}{stmt.isActual && th('execs', 'Execuções')}{stmt.isActual && th('ms', 'Tempo')}</tr></thead>
        <tbody>
          {list.map((n) => (
            <tr key={n.id} className={selected === n.id ? 'is-sel' : ''} onClick={() => onSelect(n.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(n.id); }}>
              <td className="is-num">{n.id}</td>
              <td><Icon name={n.icon} size={12} /> {n.label}</td>
              <td className="db-ellipsis">{n.object ? n.object.full + (n.object.index ? ` · ${n.object.index}` : '') : '—'}</td>
              <td className="is-num"><span className="db-pctbar"><span style={{ width: Math.min(100, n.costPct) + '%' }} /></span>{pct(n.costPct)}</td>
              <td className="is-num">{fmtNum(Math.round(rowsOf(n)))}</td>
              {stmt.isActual && <td className="is-num">{n.runtime ? fmtNum(n.runtime.executions) : '—'}</td>}
              {stmt.isActual && <td className="is-num">{n.runtime ? fmtDur(n.runtime.elapsedMs) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeDetail({ n, stmt }) {
  if (!n) return null;
  const r = n.runtime;
  return (
    <section className="db-plan__sec">
      <h4><Icon name={n.icon} size={13} /> {n.label} <small className="lg-muted">#{n.id}</small></h4>
      <div className="db-facts is-compact">
        <span>Custo próprio</span><b>{pct(n.costPct)} · {n.ownCost.toFixed(4).replace('.', ',')}</b>
        <span>Custo da subárvore</span><b>{n.subtreeCost.toFixed(4).replace('.', ',')}</b>
        {n.object && <><span>Objeto</span><b>{n.object.full}{n.object.index ? ` · ${n.object.index}` : ''}{n.object.kind ? <small>{n.object.kind}</small> : null}</b></>}
        <span>Linhas estimadas</span><b>{fmtNum(Math.round(n.estRows || 0))}{n.tableCard ? <small>de {fmtNum(Math.round(n.tableCard))} na tabela</small> : null}</b>
        {r && <><span>Linhas reais</span><b>{fmtNum(r.rows)}{r.rowsRead && r.rowsRead !== r.rows ? <small>{fmtNum(r.rowsRead)} lidas</small> : null}</b>
          <span>Execuções</span><b>{fmtNum(r.executions)}</b>
          <span>Tempo</span><b>{fmtDur(r.elapsedMs)} · CPU {fmtDur(r.cpuMs)}</b>
          {r.logicalReads > 0 && <><span>Leituras lógicas</span><b>{fmtNum(r.logicalReads)}</b></>}</>}
        {n.estIO != null && <><span>E/S · CPU (est.)</span><b>{n.estIO.toFixed(4).replace('.', ',')} · {(n.estCPU || 0).toFixed(4).replace('.', ',')}</b></>}
        {n.rowSize != null && <><span>Tamanho da linha</span><b>{n.rowSize} B</b></>}
        {n.parallel && <><span>Paralelo</span><b>sim</b></>}
        {n.mode && <><span>Modo</span><b>{n.mode}</b></>}
      </div>
      {n.seek.length > 0 && <div className="db-plan__code"><span>Seek</span><code>{n.seek.join(' AND ')}</code></div>}
      {n.predicate.length > 0 && <div className="db-plan__code"><span>Filtro</span><code>{n.predicate.join(' AND ')}</code></div>}
      {n.output.length > 0 && <div className="db-plan__code"><span>Colunas</span><code>{n.output.slice(0, 20).join(', ')}{n.output.length > 20 ? ` … (+${n.output.length - 20})` : ''}</code></div>}
    </section>
  );
}

export function PlanView({ xml, title, onClose, onSave, toast }) {
  const parsed = React.useMemo(() => parsePlan(xml), [xml]);
  const [si, setSi] = React.useState(() => {
    // Abre na instrução mais cara.
    if (!parsed.statements) return 0;
    return parsed.statements.reduce((best, s, i) => (s.cost > parsed.statements[best].cost ? i : best), 0);
  });
  const [tab, setTab] = React.useState('graph');
  const [sel, setSel] = React.useState(null);
  const graphRef = React.useRef(null);
  const stmt = parsed.statements ? parsed.statements[Math.min(si, parsed.statements.length - 1)] : null;
  const an = React.useMemo(() => (stmt ? analyze(stmt) : null), [stmt]);
  React.useEffect(() => { setSel(null); }, [si]);
  const node = stmt && sel != null ? stmt.nodes.find((n) => n.id === sel) : null;
  const pick = (id) => {
    setSel(id);
    if (id != null) {
      setTab((t) => (t === 'xml' ? 'graph' : t));
      requestAnimationFrame(() => { const el = graphRef.current && graphRef.current.querySelector(`[data-node="${id}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); });
    }
  };
  const footer = (
    <>
      <Button variant="ghost" icon="copy" onClick={() => copyText(xml, toast, 'XML do plano copiado')}>Copiar XML</Button>
      <Button variant="ghost" icon="download" onClick={onSave}>Salvar .sqlplan</Button>
      <Button variant="primary" onClick={onClose}>Fechar</Button>
    </>
  );
  if (!stmt) {
    return <Modal title={title || 'Plano de execução'} icon="list-tree" onClose={onClose} width={560} footer={footer} description={parsed.error || 'Plano indisponível'} />;
  }
  const g = stmt.grant;
  const counts = an.insights.reduce((c, i) => { c[i.severity] = (c[i.severity] || 0) + 1; return c; }, {});
  return (
    <Modal title={title || 'Plano de execução'} icon="list-tree" onClose={onClose} width="min(1380px, 96vw)" className="db-planmodal" footer={footer}
      description={`${stmt.isActual ? 'Plano real (com o que foi executado)' : 'Plano estimado (do cache)'}${parsed.version ? ` · Showplan ${parsed.version}` : ''}`}>
      <div className="db-plan">
        <div className="db-plan__sum">
          <div className="db-plan__stat"><span>Custo</span><b>{stmt.cost.toFixed(2).replace('.', ',')}</b></div>
          <div className="db-plan__stat"><span>Operadores</span><b>{stmt.nodes.length}</b></div>
          <div className="db-plan__stat"><span>Linhas (est.)</span><b>{compact(stmt.estRows)}</b></div>
          <div className="db-plan__stat"><span>Paralelismo</span><b>{stmt.dop > 1 ? `DOP ${stmt.dop}` : 'serial'}</b></div>
          {g && g.grantedKb != null && <div className="db-plan__stat" title={g.usedKb != null ? `Usou ${mb(g.usedKb)} de ${mb(g.grantedKb)}` : ''}><span>Memory grant</span><b>{mb(g.grantedKb)}</b></div>}
          {stmt.timeStats && stmt.timeStats.elapsedMs != null && <div className="db-plan__stat"><span>Tempo</span><b>{fmtDur(stmt.timeStats.elapsedMs)}</b></div>}
          <div className={'db-plan__stat' + (counts.error ? ' is-error' : counts.warn ? ' is-warn' : '')}><span>Achados</span><b>{an.insights.length ? `${an.insights.length}${counts.error ? ` · ${counts.error} crítico(s)` : ''}` : 'nenhum'}</b></div>
          <span className="lg-grow" />
          {parsed.statements.length > 1 && (
            <select className="lg-select" value={si} onChange={(e) => setSi(Number(e.target.value))} aria-label="Instrução do plano">
              {parsed.statements.map((s, i) => <option key={i} value={i}>#{i + 1} · custo {s.cost.toFixed(2).replace('.', ',')} · {s.text.replace(/\s+/g, ' ').slice(0, 60)}</option>)}
            </select>
          )}
        </div>
        <div className="db-plan__body">
          <div className="db-plan__main">
            <div className="lg-tabs" role="tablist">
              {[['graph', 'Gráfico', 'git-fork'], ['ops', 'Operadores', 'table-2'], ['xml', 'XML', 'code-xml']].map(([v, l, ic]) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'is-on' : ''} onClick={() => setTab(v)}><Icon name={ic} size={14} /><span>{l}</span></button>
              ))}
            </div>
            {tab === 'graph' && (stmt.nodes.length ? <Graph stmt={stmt} insights={an.insights} selected={sel} onSelect={pick} containerRef={graphRef} /> : <div className="lg-muted lg-pad">Este plano não tem operadores.</div>)}
            {tab === 'ops' && <Operators stmt={stmt} selected={sel} onSelect={pick} />}
            {tab === 'xml' && <pre className="db-sql db-plan__xml tk-scroll">{xml}</pre>}
          </div>
          <aside className="db-plan__side tk-scroll">
            <section className="db-plan__sec">
              <h4><Icon name="sparkles" size={13} /> Insights</h4>
              {an.insights.length === 0 && <div className="db-note"><Icon name="circle-check" size={13} /><span>Nada de errado saltou aos olhos neste plano.</span></div>}
              <div className="db-plan__ins">
                {an.insights.map((i, k) => (
                  <div key={k} className={'db-plan__insight is-' + i.severity + (i.nodeId != null && i.nodeId === sel ? ' is-sel' : '')}>
                    <button type="button" className="db-plan__insbtn" disabled={i.nodeId == null} onClick={() => { setTab('graph'); pick(i.nodeId); }}>
                      <span className="db-plan__sev"><Icon name={SEV[i.severity].icon} size={12} />{SEV[i.severity].label}</span>
                      <b>{i.title}</b>
                      <small>{i.detail}</small>
                    </button>
                    {i.sql && <div className="db-plan__sql"><pre className="db-sql tk-scroll">{i.sql}</pre><button type="button" className="lg-btn" onClick={() => copyText(i.sql, toast, 'CREATE INDEX copiado')}><Icon name="copy" size={12} /><span>Copiar CREATE INDEX</span></button></div>}
                  </div>
                ))}
              </div>
            </section>
            {an.top.length > 0 && (
              <section className="db-plan__sec">
                <h4><Icon name="flame" size={13} /> Operadores mais caros</h4>
                <div className="db-plan__top">
                  {an.top.map((n) => (
                    <button key={n.id} type="button" className={sel === n.id ? 'is-sel' : ''} onClick={() => { setTab('graph'); pick(n.id); }}>
                      <span className="db-plan__toplabel"><Icon name={n.icon} size={12} />{n.label}{n.object && n.object.table ? ` · ${n.object.table}` : ''}</span>
                      <span className="db-pctbar is-wide"><span style={{ width: Math.min(100, n.costPct) + '%' }} /></span>
                      <b>{pct(n.costPct)}</b>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <NodeDetail n={node} stmt={stmt} />
            {stmt.params.length > 0 && (
              <section className="db-plan__sec">
                <h4><Icon name="variable" size={13} /> Parâmetros</h4>
                <div className="db-facts is-compact">
                  {stmt.params.map((p) => <React.Fragment key={p.name}><span>{p.name}</span><b>{p.type}<small>compilado {p.compiled ?? '—'}{p.runtime != null ? ` · executado ${p.runtime}` : ''}</small></b></React.Fragment>)}
                </div>
              </section>
            )}
            {stmt.waits.length > 0 && (
              <section className="db-plan__sec">
                <h4><Icon name="hourglass" size={13} /> Esperas da execução</h4>
                <div className="db-facts is-compact">{stmt.waits.map((w) => <React.Fragment key={w.type}><span>{w.type}</span><b>{fmtDur(w.ms)}{w.count ? ` · ${fmtNum(w.count)}×` : ''}</b></React.Fragment>)}</div>
              </section>
            )}
            <section className="db-plan__sec">
              <h4><Icon name="info" size={13} /> Instrução</h4>
              <pre className="db-sql tk-scroll">{stmt.text || '—'}</pre>
              <div className="db-facts is-compact">
                {stmt.cardinalityModel != null && <><span>Estimador</span><b>CE {stmt.cardinalityModel}</b></>}
                {stmt.optLevel && <><span>Otimização</span><b>{stmt.optLevel}</b></>}
                {stmt.compile.timeMs != null && <><span>Compilação</span><b>{fmtDur(stmt.compile.timeMs)}{stmt.compile.memoryKb != null ? ` · ${mb(stmt.compile.memoryKb)}` : ''}</b></>}
                {stmt.queryHash && <><span>query_hash</span><b className="is-mono">{stmt.queryHash}</b></>}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
