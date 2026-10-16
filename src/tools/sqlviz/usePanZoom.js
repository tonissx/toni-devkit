// Pan (arrastar o fundo) e zoom (roda) de um canvas SVG, com enquadramento por retângulo. Usado pelo canvas do lineage.
const MIN_K = 0.05, MAX_K = 3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** bounds: { x, y, w, h } do conteúdo. onBackgroundClick: clique no fundo sem arrastar. */
export function usePanZoom(bounds, fitSignal, onBackgroundClick) {
  const wrap = React.useRef(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ x: 24, y: 24, k: 1 });
  const drag = React.useRef(null);
  const boundsRef = React.useRef(bounds);
  boundsRef.current = bounds;

  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = React.useCallback(() => {
    const b = boundsRef.current;
    if (!box.w || !box.h || !b.w) return;
    const k = clamp(Math.min((box.w - 48) / b.w, (box.h - 48) / b.h, 1), MIN_K, MAX_K);
    setView({ k, x: (box.w - b.w * k) / 2 - b.x * k, y: (box.h - b.h * k) / 2 - b.y * k });
  }, [box.w, box.h]);
  const ready = box.w > 0;
  React.useEffect(() => { if (ready) fit(); }, [fitSignal, ready]);

  const zoomAt = React.useCallback((factor, cx, cy) => setView((v) => {
    const k = clamp(v.k * factor, MIN_K, MAX_K);
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
  }), []);
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const h = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [zoomAt]);

  const handlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      wrap.current.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true;
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    },
    onPointerUp: (e) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      wrap.current.releasePointerCapture(e.pointerId);
      if (!d.moved && onBackgroundClick) onBackgroundClick();
    },
  };
  return { wrap, box, view, fit, zoomAt, handlers };
}
