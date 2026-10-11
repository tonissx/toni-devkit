// Logs — aba Gráficos. Logs de aplicação: indicadores, erros por minuto, níveis e loggers mais frequentes.
// Logs de acesso (IIS, Nginx/Apache): respostas por classe no tempo, latência p50/p95, endpoints (volume, 5xx, lentos).
// SVG próprio: linhas de 2px, barras de no máximo 24px com ponta arredondada, grade fina e discreta, legenda sempre
// que há mais de uma série, tooltip com o valor na frente. Tudo respeita o filtro atual.
import { DS } from '../../lib/ds.js';
import { logsApi, errText, LEVEL_META, levelColor, fmtNum, fmtCompact, fmtMs, fmtTick, fmtTime, fmtStep, sameDay } from './shared.jsx';

const { Icon, Spinner } = DS;

function useWidth(ref, initial = 500) {
  const [w, setW] = React.useState(initial);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return w;
}

/** Marcas "redondas" do eixo Y (0, 250, 500…). */
function niceTicks(max, n = 3) {
  if (!(max > 0)) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

function Card({ title, sub, children, legend, className = '' }) {
  return (
    <section className={'lg-card ' + className}>
      <header className="lg-card__head">
        <div><h3>{title}</h3>{sub && <small>{sub}</small>}</div>
        {legend && <div className="lg-legend">{legend.map((l) => <span key={l.label}><i className={l.line ? 'is-line' : ''} style={{ background: l.color }} />{l.label}</span>)}</div>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, note, tone }) {
  return (
    <div className={'lg-stat' + (tone ? ' is-' + tone : '')}>
      <span className="lg-stat__label">{label}</span>
      <span className="lg-stat__value">{value}</span>
      {note && <span className="lg-stat__note">{note}</span>}
    </div>
  );
}

/**
 * Linhas no tempo. series: [{ label, color, data: [n|NaN] }]; hist: { start, step, buckets }; fmt: valor → texto.
 */
function LineChart({ series, hist, fmt = fmtCompact, height = 150 }) {
  const ref = React.useRef(null);
  const width = useWidth(ref);
  const [hb, setHb] = React.useState(null);
  const PAD = { l: 56, r: 54, t: 10, b: 20 };
  const B = hist.buckets;
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const max = Math.max(0, ...series.flatMap((s) => s.data.filter(Number.isFinite)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (b) => PAD.l + (B === 1 ? plotW / 2 : (b / (B - 1)) * plotW);
  const y = (v) => PAD.t + plotH - (v / top) * plotH;
  const path = (data) => {
    let d = ''; let pen = false;
    data.forEach((v, b) => { if (!Number.isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(b).toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
    return d;
  };
  const every = Math.max(1, Math.round(110 / (plotW / B)));
  const multiDay = !sameDay(hist.start, hist.start + B * hist.step);
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const b = Math.round(((e.clientX - r.left - PAD.l) / plotW) * (B - 1));
    setHb(Math.max(0, Math.min(B - 1, b)));
  };
  // Rótulo direto no fim de cada série (≤ 4 séries).
  const ends = series.map((s) => { let b = s.data.length - 1; while (b >= 0 && !Number.isFinite(s.data[b])) b--; return b >= 0 ? { s, b, v: s.data[b] } : null; }).filter(Boolean);
  return (
    <div className="lg-chart" ref={ref}>
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHb(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(t) + 0.5} y2={y(t) + 0.5} className="lg-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="lg-tick">{fmt(t)}</text>
          </g>
        ))}
        {series.map((s) => <path key={s.label} d={path(s.data)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {series.length <= 4 && ends.map(({ s, b, v }) => (
          <g key={'e' + s.label}>
            <circle cx={x(b)} cy={y(v)} r="4" fill={s.color} className="lg-ring" />
            {series.length > 1 && <text x={x(b) + 8} y={y(v) + 4} className="lg-endlabel">{s.label}</text>}
          </g>
        ))}
        {Array.from({ length: Math.ceil(B / every) }, (_, k) => k * every).map((b) => (
          <text key={'x' + b} x={x(b)} y={height - 4} textAnchor={b === 0 ? 'start' : 'middle'} className="lg-tick">{fmtTick(hist.start + b * hist.step, hist.step)}</text>
        ))}
        {hb != null && <line x1={x(hb)} x2={x(hb)} y1={PAD.t} y2={PAD.t + plotH} className="lg-cross" />}
        {hb != null && series.map((s) => Number.isFinite(s.data[hb]) && <circle key={'h' + s.label} cx={x(hb)} cy={y(s.data[hb])} r="4" fill={s.color} className="lg-ring" />)}
      </svg>
      {hb != null && (
        <div className="lg-tip" style={{ left: Math.min(Math.max(8, x(hb) - 80), width - 180) }}>
          <div className="lg-tip__when">{fmtTime(hist.start + hb * hist.step, { date: multiDay, millis: false })} · {fmtStep(hist.step)}</div>
          {series.map((s) => <div key={s.label} className="lg-tip__row"><span className="lg-tip__key is-line" style={{ background: s.color }} /><b>{Number.isFinite(s.data[hb]) ? fmt(s.data[hb]) : '—'}</b><span>{s.label}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Colunas empilhadas no tempo. series: [{ label, color, data }] (de baixo para cima). */
function StackedColumns({ series, hist, height = 150 }) {
  const ref = React.useRef(null);
  const width = useWidth(ref);
  const [hb, setHb] = React.useState(null);
  const PAD = { l: 44, r: 8, t: 10, b: 20 };
  const B = hist.buckets;
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const bw = plotW / B;
  const barW = Math.max(1, Math.min(24, bw - (bw >= 4 ? 2 : 0)));
  const tot = Array.from({ length: B }, (_, b) => series.reduce((s, x) => s + (x.data[b] || 0), 0));
  const ticks = niceTicks(Math.max(0, ...tot));
  const top = ticks[ticks.length - 1] || 1;
  const xb = (b) => PAD.l + b * bw + (bw - barW) / 2;
  const every = Math.max(1, Math.round(110 / bw));
  return (
    <div className="lg-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} onPointerLeave={() => setHb(null)}
        onPointerMove={(e) => { const r = ref.current.getBoundingClientRect(); setHb(Math.max(0, Math.min(B - 1, Math.floor((e.clientX - r.left - PAD.l) / bw)))); }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH - (t / top) * plotH + 0.5} y2={PAD.t + plotH - (t / top) * plotH + 0.5} className="lg-grid" />
            <text x={PAD.l - 6} y={PAD.t + plotH - (t / top) * plotH + 4} textAnchor="end" className="lg-tick">{fmtCompact(t)}</text>
          </g>
        ))}
        {Array.from({ length: B }, (_, b) => {
          let yy = PAD.t + plotH;
          return (
            <g key={b} opacity={hb != null && hb !== b ? 0.75 : 1}>
              {series.map((s, k) => {
                const v = s.data[b] || 0;
                if (!v) return null;
                const h = Math.max(1, (v / top) * plotH);
                yy -= h;
                const gap = k < series.length - 1 && h >= 6 ? 2 : 0;
                return <rect key={k} x={xb(b)} y={yy + gap} width={barW} height={Math.max(0.5, h - gap)} fill={s.color} />;
              })}
            </g>
          );
        })}
        {Array.from({ length: Math.ceil(B / every) }, (_, k) => k * every).map((b) => (
          <text key={'x' + b} x={xb(b) + barW / 2} y={height - 4} textAnchor={b === 0 ? 'start' : 'middle'} className="lg-tick">{fmtTick(hist.start + b * hist.step, hist.step)}</text>
        ))}
      </svg>
      {hb != null && (
        <div className="lg-tip" style={{ left: Math.min(Math.max(8, xb(hb) - 80), width - 180) }}>
          <div className="lg-tip__when">{fmtTime(hist.start + hb * hist.step, { millis: false })} · {fmtStep(hist.step)}</div>
          {series.slice().reverse().map((s) => <div key={s.label} className="lg-tip__row"><span className="lg-tip__key" style={{ background: s.color }} /><b>{fmtNum(s.data[hb] || 0)}</b><span>{s.label}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Barras horizontais: rótulo, barra, valor na ponta. items: [{ label, value, color?, note?, onClick? }] */
function HBars({ items, color = 'var(--tk-accent)', fmt = fmtNum }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="lg-hbars">
      {items.map((it) => (
        <button type="button" key={it.label} className="lg-hbar" onClick={it.onClick} disabled={!it.onClick} title={it.title || `${it.label}: ${fmt(it.value)}`}>
          <span className="lg-hbar__label">{it.icon}{it.label}</span>
          <span className="lg-hbar__track"><span className="lg-hbar__fill" style={{ width: Math.max(1, (it.value / max) * 100) + '%', background: it.color || color }} /></span>
          <span className="lg-hbar__value">{fmt(it.value)}{it.note && <small>{it.note}</small>}</span>
        </button>
      ))}
    </div>
  );
}

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
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!sum) return undefined;
    let alive = true;
    setBusy(true);
    logsApi().charts({ id, qid: sum.qid }).then((r) => { if (!alive || !r || r.stale) return; setData(r); setError(null); setBusy(false); }, (e) => { if (alive) { setError(errText(e)); setBusy(false); } });
    return () => { alive = false; };
  }, [sum && sum.qid]);

  if (error) return <div className="lg-err lg-pad">{error}</div>;
  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Calculando…</div>;
  const hist = sum.hist ? { start: sum.hist.start, step: sum.hist.step, buckets: sum.hist.buckets } : null;
  const total = sum.total;

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

  const lv = data.levels || sum.counts;
  const errors = lv[5] + lv[6];
  const rate = data.errorRate || [];
  const lg = data.loggers;
  return (
    <div className={'lg-charts tk-scroll' + (busy ? ' is-busy' : '')}>
      <div className="lg-stats">
        <Stat label="Entradas" value={fmtCompact(total)} />
        <Stat label="Erros" value={fmtCompact(errors)} note={pct(errors, total)} tone={errors ? 'error' : null} />
        <Stat label="Avisos" value={fmtCompact(lv[4])} note={pct(lv[4], total)} tone={lv[4] ? 'warn' : null} />
        <Stat label="Problemas distintos" value={fmtNum(sum.groupsTotal)} />
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
