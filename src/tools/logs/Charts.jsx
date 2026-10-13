// Logs — aba Gráficos. Logs de aplicação: indicadores, erros por minuto, níveis e loggers mais frequentes.
// Logs de acesso (IIS, Nginx/Apache): respostas por classe no tempo, latência p50/p95, endpoints (volume, 5xx, lentos).
// SVG próprio: linhas de 2px, barras de no máximo 24px com ponta arredondada, grade fina e discreta, legenda sempre
// que há mais de uma série, tooltip com o valor na frente. Tudo respeita o filtro atual.
import { DS } from '../../lib/ds.js';
import { logsApi, errText, LEVEL_META, levelColor, fmtNum, fmtCompact, fmtMs, fmtStep, useDelayed } from './shared.jsx';
import { Card, Stat, LineChart, StackedColumns, HBars } from '../../lib/charts.jsx';

const { Icon, Spinner } = DS;

function EndpointTable({ items, cols, onFilter }) {
  if (!items || !items.length) return <div className="lg-muted lg-pad">Nada aqui no filtro atual.</div>;
  return (
    <table className="lg-table">
      <thead><tr><th>Endpoint</th>{cols.map((c) => <th key={c.label} className="is-num">{c.label}</th>)}</tr></thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.key} onClick={() => onFilter(e.key)} title="Filtrar por este endpoint">
            <td className="lg-table__ep">{e.key}</td>
            {cols.map((c) => <td key={c.label} className="is-num">{c.get(e)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0).replace('.', ',')}%` : '—');

/**
 * props: id, sum (consulta atual), onFilter(term), onLevels(levels)
 */
export function Charts({ id, sum, onFilter, onLevels }) {
  // data guarda a fotografia da consulta usada no cálculo (snap): histograma e totais sempre batem com os números.
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);
  const busy = useDelayed(pending, 300); // esmaece só se o cálculo demorar
  const lastAt = React.useRef(0);
  const timer = React.useRef(null);
  const latest = React.useRef(sum);
  latest.current = sum;
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; clearTimeout(timer.current); }, []);
  React.useEffect(() => {
    if (!sum) return;
    // Cada resultado vale para a fotografia que o pediu, então é aplicado mesmo que já exista consulta mais nova
    // (com o arquivo crescendo sem parar, descartar o anterior faria os gráficos nunca atualizarem).
    const fetchNow = () => {
      const snap = latest.current;
      if (!snap) return;
      lastAt.current = Date.now();
      if (!snap.viaAppend) setPending(true);
      logsApi().charts({ id, qid: snap.qid }).then((r) => {
        if (!mounted.current) return;
        setPending(false);
        if (!r || r.stale) return;
        setData((d) => (d && d.snap.qid > snap.qid ? d : { ...r, snap })); setError(null);
      }, (e) => { if (mounted.current) { setError(errText(e)); setPending(false); } });
    };
    clearTimeout(timer.current);
    // Ao vivo: no máximo um recálculo a cada 3 s (o arquivo crescendo não faz os gráficos piscarem nem gastar CPU à toa).
    // Filtro novo: na hora.
    const wait = sum.viaAppend ? 3000 - (Date.now() - lastAt.current) : 0;
    if (wait > 0) timer.current = setTimeout(fetchNow, wait); else fetchNow();
  }, [sum && sum.qid]);

  if (error) return <div className="lg-err lg-pad">{error}</div>;
  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Calculando…</div>;
  const snap = data.snap;
  const hist = snap.hist ? { start: snap.hist.start, step: snap.hist.step, buckets: snap.hist.buckets } : null;
  const total = snap.total;

  if (data.http && data.httpStats) {
    const h = data.httpStats;
    const cls = h.classes.reduce((a, c) => a.map((v, k) => v + c[k]), [0, 0, 0, 0]);
    const CLASS = [
      { label: '2xx', color: 'var(--lg-ok)' },
      { label: '3xx', color: 'var(--lg-info)' },
      { label: '4xx', color: 'var(--lg-warn)' },
      { label: '5xx', color: 'var(--lg-error)' },
    ];
    return (
      <div className={'lg-charts tk-scroll' + (busy ? ' is-busy' : '')}>
        <div className="lg-stats">
          <Stat label="Requisições" value={fmtCompact(total)} />
          <Stat label="Erros 5xx" value={pct(cls[3], total)} note={fmtNum(cls[3])} tone={cls[3] ? 'error' : null} />
          <Stat label="Recusadas 4xx" value={pct(cls[2], total)} note={fmtNum(cls[2])} tone={cls[2] ? 'warn' : null} />
          <Stat label="Tempo p50" value={fmtMs(h.overall.p50)} />
          <Stat label="Tempo p95" value={fmtMs(h.overall.p95)} />
          <Stat label="Tempo p99" value={fmtMs(h.overall.p99)} />
        </div>
        {hist && (
          <Card title="Respostas por classe" sub={`por ${fmtStep(hist.step)}`} legend={CLASS.map((c) => ({ label: c.label, color: c.color }))}>
            <StackedColumns hist={hist} series={CLASS.map((c, k) => ({ ...c, data: h.classes.map((x) => x[k]) }))} />
          </Card>
        )}
        {hist && h.overall.withMs > 0 && (
          <Card title="Tempo de resposta" sub={`p50 e p95 por ${fmtStep(hist.step)}`} legend={[{ label: 'p95', color: 'var(--lg-s1)', line: true }, { label: 'p50', color: 'var(--lg-s2)', line: true }]}>
            <LineChart hist={hist} fmt={fmtMs} series={[{ label: 'p95', color: 'var(--lg-s1)', data: h.p95 }, { label: 'p50', color: 'var(--lg-s2)', data: h.p50 }]} />
          </Card>
        )}
        <div className="lg-grid2">
          <Card title="Mais chamados" sub={h.sampled ? 'amostra das 300 mil mais recentes' : null}>
            <EndpointTable items={h.endpoints} onFilter={(k) => onFilter('path:' + JSON.stringify(k.split(' ').pop().replace(/:id/g, '*')))} cols={[{ label: 'chamadas', get: (e) => fmtNum(e.count) }, { label: '5xx', get: (e) => (e.errors ? fmtNum(e.errors) : '') }, { label: 'p95', get: (e) => fmtMs(e.p95) }]} />
          </Card>
          <Card title="Com mais erros 5xx">
            <EndpointTable items={h.failing} onFilter={(k) => onFilter('status:5xx path:' + JSON.stringify(k.split(' ').pop().replace(/:id/g, '*')))} cols={[{ label: '5xx', get: (e) => fmtNum(e.errors) }, { label: 'de', get: (e) => fmtNum(e.count) }, { label: '%', get: (e) => pct(e.errors, e.count) }]} />
          </Card>
          <Card title="Mais lentos (p95)" sub="com pelo menos 3 chamadas">
            <EndpointTable items={h.slowest} onFilter={(k) => onFilter('path:' + JSON.stringify(k.split(' ').pop().replace(/:id/g, '*')))} cols={[{ label: 'p95', get: (e) => fmtMs(e.p95) }, { label: 'chamadas', get: (e) => fmtNum(e.count) }]} />
          </Card>
        </div>
      </div>
    );
  }

  const lv = data.levels || snap.counts;
  const errors = lv[5] + lv[6];
  const rate = data.errorRate || [];
  const lg = data.loggers;
  return (
    <div className={'lg-charts tk-scroll' + (busy ? ' is-busy' : '')}>
      <div className="lg-stats">
        <Stat label="Entradas" value={fmtCompact(total)} />
        <Stat label="Erros" value={fmtCompact(errors)} note={pct(errors, total)} tone={errors ? 'error' : null} />
        <Stat label="Avisos" value={fmtCompact(lv[4])} note={pct(lv[4], total)} tone={lv[4] ? 'warn' : null} />
        <Stat label="Problemas distintos" value={fmtNum(snap.groupsTotal)} />
      </div>
      {hist && (
        <Card title="Erros por minuto" sub={`média em cada ${fmtStep(hist.step)} · ERROR + FATAL`}>
          <LineChart hist={hist} series={[{ label: 'erros/min', color: 'var(--lg-error)', data: rate }]} fmt={(v) => (v >= 10 ? fmtCompact(Math.round(v)) : String(Math.round(v * 10) / 10).replace('.', ','))} />
        </Card>
      )}
      <div className="lg-grid2">
        <Card title="Por nível" sub="clique para ver só o nível">
          <HBars items={LEVEL_META.filter((l) => lv[l.id] > 0).map((l) => ({ label: l.label, value: lv[l.id], color: levelColor(l.id), note: pct(lv[l.id], total), onClick: () => onLevels([l.id]) }))} />
        </Card>
        <Card title="Loggers mais frequentes" sub={lg && lg.sampled ? 'amostra das 300 mil mais recentes' : lg ? `${fmtNum(lg.distinct)} diferentes` : null}>
          {lg && lg.items.length
            ? <HBars items={lg.items.map((it) => ({ label: it.key, value: it.count, note: it.errors ? `${fmtNum(it.errors)} erro${it.errors === 1 ? '' : 's'}` : '', onClick: () => onFilter('logger:' + JSON.stringify(it.key.split('.').pop())) }))} />
            : <div className="lg-muted lg-pad">Este formato não tem logger/categoria.</div>}
        </Card>
      </div>
    </div>
  );
}
