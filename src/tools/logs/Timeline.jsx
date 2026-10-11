// Logs — linha do tempo: colunas empilhadas por nível (os mais graves na base, para comparar entre colunas),
// espaço de 2px entre segmentos, topo arredondado. Passar o mouse mostra a contagem de cada nível; arrastar escolhe
// um intervalo (vira filtro); clicar pula a lista para aquele momento. Picos de erro ganham um marcador.
import { DS } from '../../lib/ds.js';
import { LEVEL_BY_ID, levelColor, fmtTick, fmtStep, fmtTime, fmtNum, fmtCompact, sameDay } from './shared.jsx';

const { Icon } = DS;

const H = 64;
const PAD = { l: 6, r: 6, t: 10, b: 16 };
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
export function Timeline({ hist, range, onRange, onSeek, spikes, mode, onMode, loading, collapsed, onCollapse }) {
  const ref = React.useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = React.useState(null); // { b, x }
  const [drag, setDrag] = React.useState(null);   // { b0, b1, moved }
  const [kb, setKb] = React.useState(null);       // teclado: { b, anchor } (anchor = início de Shift+setas)

  // Recolhida: uma faixa fina, que ainda avisa dos picos de erro (o espaço vai para as linhas).
  if (collapsed) {
    const n = hist && spikes ? spikes.filter((b) => b < hist.buckets).length : 0;
    return (
      <div className="lg-timeline is-folded" ref={ref}>
        <button type="button" className="lg-timeline__fold" onClick={() => onCollapse(false)} title="Mostrar a linha do tempo" aria-expanded="false">
          <Icon name="chevron-right" size={13} /><span className="lg-timeline__title">Linha do tempo</span>
        </button>
        {hist && <span className="lg-muted">{fmtTime(hist.start, { date: !sameDay(hist.start, hist.start + hist.buckets * hist.step), millis: false })} → {fmtTime(hist.start + hist.buckets * hist.step, { millis: false })}</span>}
        {n > 0 && <span className="lg-timeline__spikes"><Icon name="triangle-alert" size={11} />{n} pico{n === 1 ? '' : 's'} de erro</span>}
      </div>
    );
  }

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

  // O que está sendo inspecionado: arraste (intervalo), mouse ou teclado (uma coluna ou um intervalo com Shift).
  const clampB = (b) => Math.max(0, Math.min(B - 1, b));
  const sel = drag && drag.moved ? [Math.min(drag.b0, drag.b1), Math.max(drag.b0, drag.b1)]
    : kb && kb.anchor != null && kb.anchor !== kb.b ? [Math.min(kb.anchor, kb.b), Math.max(kb.anchor, kb.b)] : null;
  const ib = sel ? null : hover ? clampB(hover.b) : kb ? clampB(kb.b) : null;
  // Apaga o resto só durante uma seleção (no hover bastam o destaque e a linha vertical — apagar tudo a cada
  // movimento do mouse faria o gráfico piscar).
  const inFocus = (b) => !sel || (b >= sel[0] && b <= sel[1]);

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
    cols.push(<g key={b} className={b === ib ? 'is-hover' : !inFocus(b) ? 'is-dim' : ''}>{segs}</g>);
  }

  // Marcas do eixo: ~1 a cada 110px, em colunas inteiras.
  const every = Math.max(1, Math.round(110 / bw));
  const ticks = [];
  for (let b = 0; b < B; b += every) ticks.push(b);

  const rangeB = range ? [Math.max(0, Math.floor((range.from - hist.start) / hist.step)), Math.min(B - 1, Math.floor((range.to - hist.start) / hist.step))] : null;

  const onDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = bOf(e.clientX);
    setDrag({ b0: b, b1: b, moved: false, x0: e.clientX });
  };
  const onMove = (e) => {
    const b = bOf(e.clientX);
    setHover({ b });
    if (kb) setKb(null); // o mouse assume
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
  // Teclado: ←/→ andam entre as colunas (Ctrl = 10), Home/End vão às pontas, Shift estende um intervalo,
  // Enter aplica o intervalo (ou leva a lista até a coluna), Esc desfaz a seleção / tira o filtro de tempo.
  const onKey = (e) => {
    const cur = kb ? clampB(kb.b) : hover ? clampB(hover.b) : B - 1;
    const move = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (move || e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); e.stopPropagation();
      const nb = move ? clampB(cur + move * (e.ctrlKey ? 10 : 1)) : e.key === 'Home' ? 0 : B - 1;
      setHover(null);
      setKb({ b: nb, anchor: e.shiftKey ? (kb && kb.anchor != null ? kb.anchor : cur) : null });
      return;
    }
    if (e.key === 'Enter' && kb) {
      e.preventDefault(); e.stopPropagation();
      if (sel) onRange({ from: tOf(sel[0]), to: tOf(sel[1]) + hist.step - 1 }); else onSeek(tOf(clampB(kb.b)));
      setKb((k) => (k ? { b: k.b, anchor: null } : k));
      return;
    }
    if (e.key === 'Escape') {
      if (kb && kb.anchor != null) { e.stopPropagation(); setKb({ b: kb.b, anchor: null }); } else if (range) { e.stopPropagation(); onRange(null); }
    }
  };

  const multiDay = !sameDay(hist.start, hist.start + B * hist.step);
  const when = (a, z) => `${fmtTime(tOf(a), { date: multiDay, millis: false })} – ${fmtTime(tOf(z) + hist.step - 1, { millis: false })}`;

  // Leitura fixa no cabeçalho (no lugar de um tooltip sobre as barras): nunca cobre os dados e não pula de lugar.
  let readout;
  if (sel) {
    let total = 0; let errs = 0;
    for (let b = sel[0]; b <= sel[1]; b++) { for (const lv of ORDER_ALL) total += d[b * 7 + lv]; errs += d[b * 7 + 5] + d[b * 7 + 6]; }
    readout = (
      <span className="lg-readout is-sel">
        <Icon name="scan-line" size={12} /><b className="lg-readout__when">{when(sel[0], sel[1])}</b>
        <span><b>{fmtCompact(total)}</b> entradas</span>
        {errs > 0 && <span className="lg-readout__lv"><i style={{ background: levelColor(5) }} /><b>{fmtCompact(errs)}</b> erros</span>}
        <span className="lg-muted">{drag ? 'solte para filtrar' : 'Enter filtra · Esc cancela'}</span>
      </span>
    );
  } else if (ib != null) {
    const lvs = ORDER_ALL.filter((lv) => d[ib * 7 + lv] > 0);
    readout = (
      <span className="lg-readout">
        <b className="lg-readout__when">{when(ib, ib)}</b>
        {lvs.length ? lvs.map((lv) => (
          <span key={lv} className="lg-readout__lv"><i style={{ background: levelColor(lv) }} /><b>{fmtCompact(d[ib * 7 + lv])}</b>{LEVEL_BY_ID[lv].label}</span>
        )) : <span className="lg-muted">nada neste intervalo</span>}
      </span>
    );
  } else {
    readout = <span className="lg-muted lg-timeline__hint">máx. {fmtNum(max)} por coluna · arraste = intervalo · clique = ir até o momento</span>;
  }

  return (
    <div className={'lg-timeline' + (loading ? ' is-loading' : '')} ref={ref}>
      <div className="lg-timeline__head">
        <button type="button" className="lg-timeline__fold" onClick={() => onCollapse(true)} title="Recolher a linha do tempo (mais espaço para as linhas)" aria-expanded="true">
          <Icon name="chevron-down" size={13} /><span className="lg-timeline__title">Entradas por {fmtStep(hist.step)}</span>
        </button>
        <div className="lg-timeline__readout" role="status" aria-live={kb ? 'polite' : 'off'}>{readout}</div>
        <div className="lg-seg" role="group" aria-label="O que o gráfico mostra">
          <button type="button" className={mode !== 'problems' ? 'is-on' : ''} onClick={() => onMode('all')}>Tudo</button>
          <button type="button" className={mode === 'problems' ? 'is-on' : ''} onClick={() => onMode('problems')} title="Só avisos e erros, com escala própria">Problemas</button>
        </div>
      </div>
      <svg width={width} height={H} className="lg-timeline__svg" role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setKb(null)}
        aria-label={`Linha do tempo: ${B} colunas de ${fmtStep(hist.step)}, de ${fmtTime(hist.start, { date: true, millis: false })}. Setas andam entre as colunas, Shift+setas seleciona um intervalo, Enter aplica.`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); }}>
        <line x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH + 0.5} y2={PAD.t + plotH + 0.5} className="lg-axis" />
        {rangeB && (
          <>
            <rect x={PAD.l} y={0} width={Math.max(0, xOf(rangeB[0]) - PAD.l - 1)} height={PAD.t + plotH} className="lg-dim" />
            <rect x={xOf(rangeB[1]) + barW + 1} y={0} width={Math.max(0, PAD.l + plotW - xOf(rangeB[1]) - barW - 1)} height={PAD.t + plotH} className="lg-dim" />
          </>
        )}
        {/* Seleção atrás das barras: moldura e fundo leve, sem tingir as cores dos níveis. */}
        {sel && <rect x={xOf(sel[0]) - 2} y={PAD.t - 6} width={xOf(sel[1]) + barW - xOf(sel[0]) + 4} height={plotH + 6} rx="3" className="lg-brush" />}
        {cols}
        {(spikes || []).filter((b) => b < B).map((b) => (
          <path key={'s' + b} d={`M${xOf(b) + barW / 2 - 4},2 h8 l-4,6 z`} className="lg-spike"><title>Pico de erros</title></path>
        ))}
        {ib != null && <line x1={xOf(ib) + barW / 2} x2={xOf(ib) + barW / 2} y1={PAD.t - 4} y2={PAD.t + plotH} className="lg-cross" />}
        {ticks.map((b) => (
          <text key={'t' + b} x={xOf(b) + barW / 2} y={H - 3} className="lg-tick" textAnchor={b === 0 ? 'start' : 'middle'}>{fmtTick(tOf(b), multiDay && hist.step < 3600e3 && b === 0 ? 3600e3 : hist.step)}</text>
        ))}
      </svg>
    </div>
  );
}
