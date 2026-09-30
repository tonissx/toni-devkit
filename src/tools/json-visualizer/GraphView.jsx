import { DS } from '../../lib/ds.js';
import { LAYOUT as L } from './engine.js';
import { edgePath, edgeLabel, edgeLabelPos, rowY } from './exportImage.js';

const { IconButton } = DS;

const MIN_K = 0.05, MAX_K = 3;
const CULL_ABOVE = 300; // acima disso, só desenha o que está na tela
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Grafo SVG com pan (arrastar) e zoom (roda). As posições vêm de layoutTree. */
export function GraphView({ graph, size, matches, selectedId, onSelect, onToggle, onExpandAll, onCollapseAll, fitSignal }) {
  const wrap = React.useRef(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ x: 24, y: 24, k: 1 });
  const drag = React.useRef(null);

  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = React.useCallback(() => {
    if (!box.w || !box.h || !size.width) return;
    const k = clamp(Math.min((box.w - 48) / size.width, (box.h - 48) / size.height, 1), MIN_K, MAX_K);
    setView({ k, x: Math.max(24, (box.w - size.width * k) / 2), y: Math.max(24, (box.h - size.height * k) / 2) });
  }, [box.w, box.h, size.width, size.height]);

  // Enquadra ao montar e quando o pai pede (abrir arquivo, exemplo, botão).
  const ready = box.w > 0;
  React.useEffect(() => { if (ready) fit(); }, [fitSignal, ready]);

  const zoomAt = (factor, cx, cy) => setView((v) => {
    const k = clamp(v.k * factor, MIN_K, MAX_K);
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
  });

  // Zoom com a roda (listener não passivo para poder bloquear a rolagem da página).
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const h = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    wrap.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    drag.current = null;
    wrap.current.releasePointerCapture(e.pointerId);
    if (!moved) onSelect(null); // clique no fundo limpa a seleção
  };
  // O pan só começa no fundo (os nós param o pointerdown), então o clique num nó nunca é um arraste.
  const nodeClick = (e, n) => { e.stopPropagation(); onSelect(n); };

  // Arestas do caminho até o nó selecionado ficam em destaque.
  const hot = React.useMemo(() => {
    const s = new Set();
    if (selectedId == null) return s;
    const parentEdge = new Map(graph.edges.map((e) => [e.to, e]));
    for (let id = selectedId, e; (e = parentEdge.get(id)); id = e.from) s.add(e.to);
    return s;
  }, [graph, selectedId]);

  const culling = graph.nodes.length > CULL_ABOVE;
  const vis = (n) => {
    if (!culling) return true;
    const x0 = -view.x / view.k - 200, y0 = -view.y / view.k - 200;
    const x1 = x0 + box.w / view.k + 400, y1 = y0 + box.h / view.k + 400;
    return n.x + n.w >= x0 && n.x <= x1 && n.y + n.h >= y0 && n.y <= y1;
  };

  return (
    <div
      ref={wrap}
      className="jsv__graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="jsv__svg" width={box.w} height={box.h}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((e) => {
            const a = graph.nodes[e.from], b = graph.nodes[e.to];
            if (culling && !vis(a) && !vis(b)) return null;
            const p = edgeLabelPos(b);
            return (
              <React.Fragment key={e.to}>
                <path d={edgePath(a, b)} className={'jsv__edge' + (hot.has(e.to) ? ' is-hot' : '')} />
                <text x={p.x} y={p.y} textAnchor="end" className="jsv__elabel">{edgeLabel(e)}</text>
              </React.Fragment>
            );
          })}
          {graph.nodes.map((n) => {
            if (!vis(n)) return null;
            const cls = 'jsv__node' + (n.id === selectedId ? ' is-selected' : '') + (matches && matches.has(n.id) ? ' is-match' : '');
            return (
              <g key={n.id} className={cls} onClick={(e) => nodeClick(e, n)} onPointerDown={(e) => e.stopPropagation()}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="jsv__box" />
                {n.rows.map((r, i) => (
                  <React.Fragment key={i}>
                    {r.key && <text x={n.x + L.padX} y={rowY(n, i)} className="jsv__t-key">{r.key}</text>}
                    <text x={n.x + L.padX + (r.key ? (r.key.length + 2) * L.charW : 0)} y={rowY(n, i)} className={'jsv__t-' + r.type}>{r.value}</text>
                  </React.Fragment>
                ))}
                {!n.rows.length && !n.collapsed && (
                  <text x={n.x + L.padX} y={rowY(n, 0)} className="jsv__t-null">{n.kind === 'array' ? '[]' : '{}'}</text>
                )}
                {n.collapsed && <text x={n.x + L.padX} y={rowY(n, n.rows.length)} className="jsv__t-null">+ {n.hiddenChildren} oculto(s)</text>}
                {n.childCount > 0 && (
                  <g
                    className="jsv__toggle"
                    onClick={(e) => { e.stopPropagation(); onToggle(n); }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <circle cx={n.x + n.w} cy={n.y + n.h / 2} r={8} />
                    <text x={n.x + n.w} y={n.y + n.h / 2 + 4} textAnchor="middle">{n.collapsed ? '+' : '−'}</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="jsv__tools" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton size="sm" icon="plus" label="Aproximar" onClick={() => zoomAt(1.25, box.w / 2, box.h / 2)} />
        <IconButton size="sm" icon="minus" label="Afastar" onClick={() => zoomAt(0.8, box.w / 2, box.h / 2)} />
        <IconButton size="sm" icon="maximize" label="Enquadrar" onClick={fit} />
        <IconButton size="sm" icon="chevrons-up-down" label="Expandir tudo" onClick={onExpandAll} />
        <IconButton size="sm" icon="chevrons-down-up" label="Recolher tudo" onClick={onCollapseAll} />
        <span className="jsv__zoom">{Math.round(view.k * 100)}%</span>
      </div>
    </div>
  );
}
