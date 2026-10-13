// Gráficos em SVG próprio, compartilhados pelas ferramentas (Logs, Banco): linhas de 2px, barras de no máximo 24px com
// ponta arredondada, grade fina, legenda quando há mais de uma série, tooltip com o valor na frente.
// Classes CSS lg-* (renderer/logs.css, carregado em todas as telas).
import { fmtNum, fmtCompact, fmtTick, fmtTime, fmtStep, sameDay } from './fmt.jsx';

export function useWidth(ref, initial = 500) {
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
export function niceTicks(max, n = 3) {
  if (!(max > 0)) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

export function Card({ title, sub, children, legend, className = '' }) {
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

export function Stat({ label, value, note, tone }) {
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
export function LineChart({ series, hist, fmt = fmtCompact, height = 150 }) {
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
export function StackedColumns({ series, hist, height = 150 }) {
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
export function HBars({ items, color = 'var(--tk-accent)', fmt = fmtNum }) {
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

