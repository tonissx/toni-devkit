// Logs — faixa de marcadores ao lado da rolagem: onde estão os achados do filtro (cor do pior nível), as entradas
// fixadas e a posição da selecionada, no log inteiro. Clique/arraste leva a lista até aquele ponto.
const LV_COLOR = { 4: 'var(--lg-warn)', 5: 'var(--lg-error)', 6: 'var(--lg-fatal)' };

/** props: data ({ hits, worst, pins }), pos (posição selecionada ou null), total (linhas da lista), onGo(posição) */
export function Marks({ data, pos, total, onGo }) {
  const ref = React.useRef(null);
  const B = data.hits.length;
  const go = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
    onGo(Math.round(f * (total - 1)));
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    go(e);
    const move = (ev) => go(ev);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const pct = (b) => (b / B) * 100;
  return (
    <div className="lg-marks" ref={ref} onMouseDown={down} role="presentation" title="Onde estão os achados — clique ou arraste para ir até o ponto">
      {data.hits.map((n, b) => n > 0 && (
        <i key={b} className="lg-marks__hit" style={{ top: pct(b) + '%', height: Math.max(100 / B, 0.4) + '%', background: LV_COLOR[data.worst[b]] || 'var(--tk-accent)' }} />
      ))}
      {data.pins.map((b, k) => <i key={'p' + k} className="lg-marks__pin" style={{ top: pct(b) + '%' }} />)}
      {pos != null && total > 0 && <i className="lg-marks__sel" style={{ top: (pos / total) * 100 + '%' }} />}
    </div>
  );
}
