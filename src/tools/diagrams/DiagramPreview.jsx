import { DS } from '../../lib/ds.js';
import { viewBoxOf } from '../../diagrams/svg.js';

const { IconButton, Icon } = DS;

/** Tamanho natural do SVG do Mermaid, pelo viewBox. */
const svgSize = (svg) => viewBoxOf(svg) || { w: 800, h: 600 };

/**
 * Preview do diagrama: pan (arrastar), zoom (roda) e "ajustar à tela".
 * `fitKey` muda quando é outro diagrama — só então reenquadra; editar o texto mantém o zoom e a posição.
 */
export function DiagramPreview({ svg, error, busy, fitKey, canvasRef }) {
  const boxRef = React.useRef(null);
  const drag = React.useRef(null);
  const fitted = React.useRef(null);
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const size = React.useMemo(() => svgSize(svg), [svg]);

  const fit = React.useCallback(() => {
    const el = boxRef.current;
    if (!el || !svg) return;
    const bw = el.clientWidth, bh = el.clientHeight, pad = 32;
    const k = Math.min(1.5, Math.max(0.1, Math.min((bw - pad * 2) / size.w, (bh - pad * 2) / size.h)));
    setView({ k, x: (bw - size.w * k) / 2, y: (bh - size.h * k) / 2 });
  }, [svg, size]);

  React.useEffect(() => {
    if (svg && fitted.current !== fitKey) { fitted.current = fitKey; fit(); }
  }, [svg, fitKey, fit]);

  const zoomAt = React.useCallback((factor, cx, cy) => setView((v) => {
    const k = Math.min(4, Math.max(0.1, v.k * factor));
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
  }), []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const h = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [zoomAt]);

  const onDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  };
  const onUp = () => { drag.current = null; };

  const center = () => { const el = boxRef.current; return el ? [el.clientWidth / 2, el.clientHeight / 2] : [0, 0]; };

  return (
    <div className="dgm-preview">
      <div
        ref={(el) => { boxRef.current = el; if (canvasRef) canvasRef.current = el; }}
        className="dgm-canvas"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={fit}
      >
        {svg && (
          <div
            className="dgm-canvas__inner"
            style={{ width: size.w, height: size.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        {!svg && !error && <div className="dgm-canvas__hint">{busy ? 'Renderizando…' : 'Escreva o diagrama à esquerda'}</div>}
      </div>
      <div className="dgm-zoom">
        <IconButton size="sm" icon="plus" label="Aproximar" onClick={() => zoomAt(1.25, ...center())} />
        <IconButton size="sm" icon="minus" label="Afastar" onClick={() => zoomAt(0.8, ...center())} />
        <IconButton size="sm" icon="maximize" label="Ajustar à tela (duplo clique)" onClick={fit} />
        <span className="dgm-zoom__pct">{Math.round(view.k * 100)}%</span>
      </div>
      {error && (
        <div className="dgm-error" role="alert">
          <Icon name="triangle-alert" size={14} />
          <pre>{error}</pre>
        </div>
      )}
    </div>
  );
}
