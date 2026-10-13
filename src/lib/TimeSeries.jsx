// Séries no tempo em "pequenos múltiplos": uma faixa por métrica, cada uma com a sua escala (nunca dois eixos no mesmo
// gráfico), todas alinhadas no mesmo tempo. Passar o mouse mostra os valores de todas no cabeçalho (nada cobre os
// dados); arrastar escolhe um intervalo; clicar escolhe um momento; marcadores no topo (incidentes) são clicáveis.
// Teclado: ←/→ andam, Shift+setas seleciona, Enter aplica.
import { DS } from './ds.js';
import { fmtTick, fmtTime, fmtCompact, sameDay } from './fmt.jsx';

const { Icon } = DS;

const ROW_H = 44;
const MARK_H = 16;
const AXIS_H = 16;
const PAD = { l: 132, r: 12 };

function useWidth(ref) {
  const [w, setW] = React.useState(800);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => { const cs = getComputedStyle(el); setW(Math.max(200, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)))); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return w;
}

/**
 * props: start, step, buckets; rows: [{ key, label, color, data: [n|null], fmt?, kind: 'line'|'columns', min0? }];
 * markers: [{ t, color, title, id }]; onMarker(id); onPick(t); onRange({ from, to }); range (destaque); title
 */
export function TimeSeries({ start, step, buckets, rows, markers = [], onMarker, onPick, onRange, range, title }) {
  const ref = React.useRef(null);
  const svgRef = React.useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = React.useState(null);
  const [drag, setDrag] = React.useState(null);
  const [kb, setKb] = React.useState(null);
  const B = Math.max(1, buckets);
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const bw = plotW / B;
  const H = MARK_H + rows.length * ROW_H + AXIS_H;
  const xOf = (b) => PAD.l + b * bw + bw / 2;
  const tOf = (b) => start + b * step;
  const clampB = (b) => Math.max(0, Math.min(B - 1, b));
  const bOf = (clientX) => clampB(Math.floor((clientX - svgRef.current.getBoundingClientRect().left - PAD.l) / bw));
  const multiDay = !sameDay(start, start + B * step);

  const sel = drag && drag.moved ? [Math.min(drag.b0, drag.b1), Math.max(drag.b0, drag.b1)]
    : kb && kb.anchor != null && kb.anchor !== kb.b ? [Math.min(kb.anchor, kb.b), Math.max(kb.anchor, kb.b)] : null;
  const ib = sel ? null : hover != null ? hover : kb ? kb.b : null;

  const onDown = (e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const b = bOf(e.clientX); setDrag({ b0: b, b1: b, moved: false, x0: e.clientX }); };
  const onMove = (e) => { const b = bOf(e.clientX); setHover(b); if (kb) setKb(null); if (drag) setDrag((g) => ({ ...g, b1: b, moved: g.moved || Math.abs(e.clientX - g.x0) > 4 })); };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved && onRange) { const a = Math.min(drag.b0, drag.b1); const z = Math.max(drag.b0, drag.b1); onRange({ from: tOf(a), to: tOf(z) + step }); } else if (onPick) onPick(tOf(drag.b0) + step / 2);
    setDrag(null);
  };
  const onKey = (e) => {
    const cur = kb ? kb.b : hover != null ? hover : B - 1;
    const mv = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (mv) { e.preventDefault(); setHover(null); setKb({ b: clampB(cur + mv * (e.ctrlKey ? 10 : 1)), anchor: e.shiftKey ? (kb && kb.anchor != null ? kb.anchor : cur) : null }); return; }
    if (e.key === 'Enter' && kb) { e.preventDefault(); if (sel && onRange) onRange({ from: tOf(sel[0]), to: tOf(sel[1]) + step }); else if (onPick) onPick(tOf(kb.b) + step / 2); setKb({ b: kb.b, anchor: null }); }
    if (e.key === 'Escape' && kb && kb.anchor != null) { e.stopPropagation(); setKb({ b: kb.b, anchor: null }); }
  };

  const when = (a, z) => `${fmtTime(tOf(a), { date: multiDay, millis: false })} – ${fmtTime(tOf(z) + step - 1, { millis: false })}`;
  let readout;
  if (sel) readout = <span className="ts-readout is-sel"><Icon name="scan-line" size={12} /><b>{when(sel[0], sel[1])}</b><span className="lg-muted">{drag ? 'solte para aproximar' : 'Enter aproxima · Esc cancela'}</span></span>;
  else if (ib != null) {
    readout = (
      <span className="ts-readout">
        <b>{when(ib, ib)}</b>
        {rows.map((r) => <span key={r.key} className="ts-readout__v"><i style={{ background: r.color }} /><b>{r.data[ib] == null ? '—' : (r.fmt || fmtCompact)(r.data[ib])}</b>{r.label}</span>)}
      </span>
    );
  } else readout = <span className="lg-muted ts-hint">passe o mouse para ver os valores · arraste para aproximar · clique para ver o momento</span>;

  const every = Math.max(1, Math.round(110 / bw));
  const ticks = [];
  for (let b = 0; b < B; b += every) ticks.push(b);

  return (
    <div className="ts" ref={ref}>
      <div className="ts-head">
        {title && <span className="ts-title">{title}</span>}
        <div className="ts-readout-wrap" role="status" aria-live={kb ? 'polite' : 'off'}>{readout}</div>
      </div>
      <svg ref={svgRef} width={width} height={H} className="ts-svg" tabIndex={0} onKeyDown={onKey} onBlur={() => setKb(null)}
        role="img" aria-label={`${title || 'Séries'}: ${rows.map((r) => r.label).join(', ')}. Setas andam, Shift+setas seleciona, Enter aplica.`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
        {range && (() => {
          const a = clampB(Math.floor((range.from - start) / step)); const z = clampB(Math.floor((range.to - start) / step));
          return <rect x={PAD.l + a * bw} y={MARK_H} width={(z - a + 1) * bw} height={rows.length * ROW_H} className="ts-range" />;
        })()}
        {sel && <rect x={PAD.l + sel[0] * bw} y={MARK_H - 2} width={(sel[1] - sel[0] + 1) * bw} height={rows.length * ROW_H + 4} rx="3" className="lg-brush" />}
        {rows.map((r, k) => {
          const y0 = MARK_H + k * ROW_H;
          const vals = r.data.filter((v) => v != null && Number.isFinite(v));
          const max = Math.max(r.min0 === false ? 0 : 1e-9, ...vals);
          const min = r.min0 === false && vals.length ? Math.min(...vals) : 0;
          const span = max - min || 1;
          const yv = (v) => y0 + ROW_H - 6 - ((v - min) / span) * (ROW_H - 14);
          let shape;
          if (r.kind === 'columns') {
            const cw = Math.max(1, Math.min(10, bw - (bw >= 4 ? 1.5 : 0)));
            shape = r.data.map((v, b) => (v ? <rect key={b} x={xOf(b) - cw / 2} y={yv(v)} width={cw} height={Math.max(1, y0 + ROW_H - 6 - yv(v))} fill={r.color} opacity={ib == null || b === ib ? 1 : 0.85} /> : null));
          } else {
            let d = ''; let pen = false;
            r.data.forEach((v, b) => { if (v == null || !Number.isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + xOf(b).toFixed(1) + ',' + yv(v).toFixed(1); pen = true; });
            shape = <path d={d} fill="none" stroke={r.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
          }
          const last = [...r.data].reverse().find((v) => v != null);
          return (
            <g key={r.key}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={y0 + ROW_H - 5.5} y2={y0 + ROW_H - 5.5} className="lg-grid" />
              <text x={8} y={y0 + 17} className="ts-label">{r.label}</text>
              <text x={8} y={y0 + 32} className="ts-sub">máx. {vals.length ? (r.fmt || fmtCompact)(Math.max(...vals)) : '—'}{last != null ? ` · agora ${(r.fmt || fmtCompact)(last)}` : ''}</text>
              {shape}
              {ib != null && r.data[ib] != null && r.kind !== 'columns' && <circle cx={xOf(ib)} cy={yv(r.data[ib])} r="4" fill={r.color} className="lg-ring" />}
            </g>
          );
        })}
        {markers.map((m, k) => {
          const b = Math.floor((m.t - start) / step);
          if (b < 0 || b >= B) return null;
          const x = xOf(b);
          return (
            <g key={m.id || k} className="ts-marker" onPointerDown={(e) => e.stopPropagation()} onClick={() => onMarker && onMarker(m.id)}>
              <rect x={x - 7} y={0} width={14} height={MARK_H} fill="transparent" />
              <path d={`M${x - 4.5},2 h9 l-4.5,7 z`} fill={m.color} />
              <title>{m.title}</title>
            </g>
          );
        })}
        {ib != null && <line x1={xOf(ib)} x2={xOf(ib)} y1={MARK_H} y2={MARK_H + rows.length * ROW_H} className="lg-cross" />}
        {ticks.map((b) => <text key={'t' + b} x={xOf(b)} y={H - 3} textAnchor="middle" className="lg-tick">{fmtTick(tOf(b), step)}</text>)}
      </svg>
    </div>
  );
}
