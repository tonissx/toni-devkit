// Logs — linha do tempo: colunas empilhadas por nível (os mais graves na base, para comparar entre colunas),
// espaço de 2px entre segmentos, topo arredondado. Passar o mouse mostra a contagem de cada nível; arrastar escolhe
// um intervalo (vira filtro); clicar pula a lista para aquele momento. Picos de erro ganham um marcador.
import { DS } from '../../lib/ds.js';
import { LEVEL_BY_ID, levelColor, fmtTick, fmtStep, fmtTime, fmtNum, fmtCompact, sameDay } from './shared.jsx';

const { Icon } = DS;

const H = 92;
const PAD = { l: 6, r: 6, t: 14, b: 18 };
const ORDER_ALL = [6, 5, 4, 3, 2, 1, 0];
const ORDER_PROBLEMS = [6, 5, 4];

function useWidth(ref) {
  const [w, setW] = React.useState(600);
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

/** Retângulo com os cantos de cima arredondados (a ponta da coluna). */
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * props: hist { start, step, buckets, data }, range { from, to } | null, onRange(range|null), onSeek(ms),
 * spikes [b], mode 'all'|'problems', onMode, loading
 */
export function Timeline({ hist, range, onRange, onSeek, spikes, mode, onMode, loading }) {
  const ref = React.useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = React.useState(null); // { b, x }
  const [drag, setDrag] = React.useState(null);   // { b0, b1, moved }

  if (!hist || !hist.buckets) {
    return (
      <div className="lg-timeline is-empty" ref={ref}>
        <span className="lg-muted"><Icon name="clock" size={12} /> Sem data/hora nas linhas — o gráfico do tempo não se aplica a este log.</span>
      </div>
    );
  }
  const order = mode === 'problems' ? ORDER_PROBLEMS : ORDER_ALL;
  const B = hist.buckets;
  const d = hist.data;
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const bw = plotW / B;
  const barW = Math.max(1, Math.min(24, bw - (bw >= 4 ? 2 : bw >= 2 ? 1 : 0)));
  const totals = new Array(B);
  let max = 0;
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (const lv of order) s += d[b * 7 + lv];
    totals[b] = s;
    if (s > max) max = s;
  }
  const yScale = (v) => (max ? (v / max) * plotH : 0);
  const xOf = (b) => PAD.l + b * bw + (bw - barW) / 2;
  const tOf = (b) => hist.start + b * hist.step;
  const bOf = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(B - 1, Math.floor((clientX - rect.left - PAD.l) / bw)));
  };

  const cols = [];
  for (let b = 0; b < B; b++) {
    if (!totals[b]) continue;
    let y = PAD.t + plotH;
    const segs = [];
    // Topo da coluna: o último nível com contagem.
    let topLv = -1;
    for (const lv of order) if (d[b * 7 + lv]) topLv = lv;
    for (const lv of order) {
      const v = d[b * 7 + lv];
      if (!v) continue;
      const h = Math.max(1, yScale(v));
      const gap = lv !== topLv && h >= 6 ? 2 : 0;
      y -= h;
      const x = xOf(b);
      segs.push(lv === topLv && barW >= 6 && h >= 4
        ? <path key={lv} d={topRounded(x, y, barW, h, 3)} fill={levelColor(lv)} />
        : <rect key={lv} x={x} y={y + gap} width={barW} height={Math.max(0.5, h - gap)} fill={levelColor(lv)} />);
    }
    cols.push(<g key={b} className={hover && hover.b === b ? 'is-hover' : ''}>{segs}</g>);
  }

  // Marcas do eixo: ~1 a cada 110px, em colunas inteiras.
  const every = Math.max(1, Math.round(110 / bw));
  const ticks = [];
  for (let b = 0; b < B; b += every) ticks.push(b);

  const sel = drag && drag.moved ? [Math.min(drag.b0, drag.b1), Math.max(drag.b0, drag.b1)] : null;
  const rangeB = range ? [Math.max(0, Math.floor((range.from - hist.start) / hist.step)), Math.min(B - 1, Math.floor((range.to - hist.start) / hist.step))] : null;

  const onDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = bOf(e.clientX);
    setDrag({ b0: b, b1: b, moved: false, x0: e.clientX });
  };
  const onMove = (e) => {
    const b = bOf(e.clientX);
    setHover({ b, x: xOf(b) + barW / 2 });
    if (drag) setDrag((g) => ({ ...g, b1: b, moved: g.moved || Math.abs(e.clientX - g.x0) > 4 }));
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved) {
      const a = Math.min(drag.b0, drag.b1); const z = Math.max(drag.b0, drag.b1);
      onRange({ from: tOf(a), to: tOf(z) + hist.step - 1 });
    } else onSeek(tOf(drag.b0));
    setDrag(null);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && range) { e.stopPropagation(); onRange(null); }
  };

  const hb = hover ? hover.b : null;
  const tip = hb != null && !drag;
  const multiDay = !sameDay(hist.start, hist.start + B * hist.step);

  return (
    <div className={'lg-timeline' + (loading ? ' is-loading' : '')} ref={ref}>
      <div className="lg-timeline__head">
        <span className="lg-timeline__title">Entradas por {fmtStep(hist.step)}</span>
        <span className="lg-muted">máx. {fmtNum(max)} por coluna · arraste para escolher um intervalo, clique para ir até o momento</span>
        <span className="lg-grow" />
        <div className="lg-seg" role="group" aria-label="O que o gráfico mostra">
          <button type="button" className={mode !== 'problems' ? 'is-on' : ''} onClick={() => onMode('all')}>Tudo</button>
          <button type="button" className={mode === 'problems' ? 'is-on' : ''} onClick={() => onMode('problems')} title="Só avisos e erros, com escala própria">Problemas</button>
        </div>
      </div>
      <svg width={width} height={H} className="lg-timeline__svg" role="img" tabIndex={0} onKeyDown={onKey}
        aria-label={`Linha do tempo: ${B} colunas de ${fmtStep(hist.step)}, de ${fmtTime(hist.start, { date: true, millis: false })}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); }}>
        <line x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH + 0.5} y2={PAD.t + plotH + 0.5} className="lg-axis" />
        {rangeB && (
          <>
            <rect x={PAD.l} y={0} width={Math.max(0, xOf(rangeB[0]) - PAD.l - 1)} height={PAD.t + plotH} className="lg-dim" />
            <rect x={xOf(rangeB[1]) + barW + 1} y={0} width={Math.max(0, PAD.l + plotW - xOf(rangeB[1]) - barW - 1)} height={PAD.t + plotH} className="lg-dim" />
          </>
        )}
        {cols}
        {(spikes || []).filter((b) => b < B).map((b) => (
          <path key={'s' + b} d={`M${xOf(b) + barW / 2 - 4},2 h8 l-4,6 z`} className="lg-spike"><title>Pico de erros</title></path>
        ))}
        {sel && <rect x={xOf(sel[0]) - 1} y={PAD.t - 6} width={xOf(sel[1]) + barW - xOf(sel[0]) + 2} height={plotH + 6} className="lg-brush" />}
        {hover && <line x1={hover.x} x2={hover.x} y1={PAD.t - 4} y2={PAD.t + plotH} className="lg-cross" />}
        {ticks.map((b) => (
          <text key={'t' + b} x={xOf(b) + barW / 2} y={H - 4} className="lg-tick" textAnchor={b === 0 ? 'start' : 'middle'}>{fmtTick(tOf(b), multiDay && hist.step < 3600e3 && b === 0 ? 3600e3 : hist.step)}</text>
        ))}
      </svg>
      {tip && totals[hb] >= 0 && (
        <div className="lg-tip" style={{ left: Math.min(Math.max(8, hover.x - 90), width - 190) }}>
          <div className="lg-tip__when">{fmtTime(tOf(hb), { date: multiDay, millis: false })} – {fmtTime(tOf(hb) + hist.step - 1, { millis: false })}</div>
          {ORDER_ALL.filter((lv) => d[hb * 7 + lv] > 0).map((lv) => (
            <div key={lv} className="lg-tip__row"><span className="lg-tip__key" style={{ background: levelColor(lv) }} /><b>{fmtCompact(d[hb * 7 + lv])}</b><span>{LEVEL_BY_ID[lv].name}</span></div>
          ))}
          {!ORDER_ALL.some((lv) => d[hb * 7 + lv] > 0) && <div className="lg-muted">Nada neste intervalo</div>}
        </div>
      )}
    </div>
  );
}
