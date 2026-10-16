import { DS } from '../../lib/ds.js';
import { ER } from '../../db/erlayout.js';
import { fkGeom, linkedColumns } from './erExport.js';

const { IconButton } = DS;

const MIN_K = 0.05, MAX_K = 3;
const CULL_ABOVE = 300; // acima disso, só desenha o que está na tela
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const title = (t) => (t.schema && t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name);

/**
 * Canvas SVG do diagrama ER: pan (arrastar o fundo), zoom (roda), arrastar tabelas, destaque por seleção/busca e
 * navegação por teclado (Tab entre tabelas, setas para a vizinha mais próxima, Enter/Espaço seleciona, Esc limpa).
 * Tudo vai para o DOM como texto de React/SVG (escapado), nunca como HTML.
 */
export function ErCanvas({ schema, nodes, groups, selectedId, onSelect, matches, onMoveNode, onRemove, fitSignal, focusReq, related }) {
  const wrap = React.useRef(null);
  const nodeRefs = React.useRef(new Map());
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

  // Retângulo que envolve tudo (tabelas e grupos): o enquadramento usa isto, então funciona com qualquer origem.
  const bounds = React.useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of Object.values(nodes)) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
    for (const g of groups || []) { x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h); }
    return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [nodes, groups]);
  const boundsRef = React.useRef(bounds);
  boundsRef.current = bounds;
  const fit = React.useCallback(() => {
    const b = boundsRef.current;
    if (!box.w || !box.h || !b.w) return;
    const k = clamp(Math.min((box.w - 48) / b.w, (box.h - 48) / b.h, 1), MIN_K, MAX_K);
    setView({ k, x: (box.w - b.w * k) / 2 - b.x * k, y: (box.h - b.h * k) / 2 - b.y * k });
  }, [box.w, box.h]);
  const ready = box.w > 0;
  React.useEffect(() => { if (ready) fit(); }, [fitSignal, ready]);

  // Centraliza numa tabela (busca).
  React.useEffect(() => {
    if (!focusReq || !nodes[focusReq.id] || !box.w) return;
    const n = nodes[focusReq.id];
    setView((v) => { const k = Math.max(v.k, 0.8); return { k, x: box.w / 2 - (n.x + n.w / 2) * k, y: box.h / 2 - (n.y + n.h / 2) * k }; });
  }, [focusReq]);

  const zoomAt = (factor, cx, cy) => setView((v) => {
    const k = clamp(v.k * factor, MIN_K, MAX_K);
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
  });
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

  // Fundo: pan. Nó: arrastar (move a tabela) ou clicar (seleciona).
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    wrap.current.setPointerCapture(e.pointerId);
  };
  const onNodeDown = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const n = nodes[id];
    drag.current = { kind: 'node', id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y, moved: false };
    wrap.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else onMoveNode(d.id, d.nx + dx / view.k, d.ny + dy / view.k);
  };
  const onUp = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    wrap.current.releasePointerCapture(e.pointerId);
    if (d.kind === 'pan' && !d.moved) onSelect(null);
    if (d.kind === 'node' && !d.moved) onSelect(d.id === selectedId ? null : d.id);
  };

  // Teclado: seta para a tabela mais próxima naquela direção.
  const onNodeKey = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id === selectedId ? null : id); return; }
    if (e.key === 'Escape') { onSelect(null); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) { e.preventDefault(); onRemove(id); return; }
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const a = nodes[id];
    let best = null, bestScore = Infinity;
    for (const [oid, n] of Object.entries(nodes)) {
      if (oid === id) continue;
      const dx = n.x - a.x, dy = n.y - a.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 0) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = oid; }
    }
    if (best && nodeRefs.current.get(best)) {
      nodeRefs.current.get(best).focus();
      const n = nodes[best];
      setView((v) => { // mantém a tabela focada dentro da tela
        const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
        const ox = sx < 20 ? 20 - sx : sx + n.w * v.k > box.w - 20 ? box.w - 20 - (sx + n.w * v.k) : 0;
        const oy = sy < 20 ? 20 - sy : sy + n.h * v.k > box.h - 20 ? box.h - 20 - (sy + n.h * v.k) : 0;
        return ox || oy ? { ...v, x: v.x + ox, y: v.y + oy } : v;
      });
    }
  };

  const tableById = React.useMemo(() => new Map(schema.tables.map((t) => [t.id, t])), [schema]);
  const links = React.useMemo(() => linkedColumns(schema), [schema]);
  const culling = schema.tables.length > CULL_ABOVE;
  const vis = (n) => {
    if (!culling) return true;
    const x0 = -view.x / view.k - 200, y0 = -view.y / view.k - 200;
    const x1 = x0 + box.w / view.k + 400, y1 = y0 + box.h / view.k + 400;
    return n.x + n.w >= x0 && n.x <= x1 && n.y + n.h >= y0 && n.y <= y1;
  };
  const dimmed = (id) => related && !related.has(id);

  return (
    <div ref={wrap} className="sqv__graph" onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp}>
      <svg className="sqv__svg" width={box.w} height={box.h} role="group" aria-label="Diagrama entidade-relacionamento">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {(groups || []).map((g) => (
            <g key={g.key} className="sqv__group" style={{ '--g': g.color }}>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
              <text x={g.x + 12} y={g.y + 16}>{g.key} · {g.count}</text>
            </g>
          ))}
          {schema.fks.map((f, i) => {
            const a = nodes[f.from], b = nodes[f.to];
            if (!a || !b || (culling && !vis(a) && !vis(b))) return null;
            const { p, c, color, mx, my } = fkGeom(f, nodes, (id) => tableById.get(id));
            const hot = related && related.has(f.from) && related.has(f.to) && (f.from === selectedId || f.to === selectedId);
            const off = related && !hot;
            return (
              <g key={f.name + i} className={'sqv__fk' + (hot ? ' is-hot' : '') + (off ? ' is-dim' : '')}>
                <title>{`${f.name}: ${f.from}(${f.fromCols.join(', ')}) → ${f.to}(${f.toCols.join(', ')})`}</title>
                <path d={p.d} className="sqv__edge" style={{ stroke: color }} />
                <circle cx={p.x1} cy={p.y1} r={3.5} fill={color} />
                <circle cx={p.x2} cy={p.y2} r={3.5} fill={color} />
                {hot && <text x={mx} y={my - 6} textAnchor="middle" className="sqv__fklabel" style={{ fill: color }}>{f.fromCols.join(', ')} → {f.toCols.join(', ')}</text>}
                <text x={c.child.x} y={c.child.y} textAnchor={c.child.anchor} className="sqv__card">{c.child.text}</text>
                <text x={c.parent.x} y={c.parent.y} textAnchor={c.parent.anchor} className="sqv__card">{c.parent.text}</text>
              </g>
            );
          })}
          {schema.tables.map((t) => {
            const n = nodes[t.id];
            if (!n || !vis(n)) return null;
            const cls = 'sqv__node' + (t.id === selectedId ? ' is-selected' : '') + (matches && matches.has(t.id) ? ' is-match' : '') + (dimmed(t.id) ? ' is-dim' : '');
            return (
              <g
                key={t.id}
                ref={(el) => { if (el) nodeRefs.current.set(t.id, el); else nodeRefs.current.delete(t.id); }}
                className={cls}
                tabIndex={0}
                role="button"
                aria-pressed={t.id === selectedId}
                aria-label={`Tabela ${title(t)}, ${t.columns.length} colunas`}
                onPointerDown={(e) => onNodeDown(e, t.id)}
                onKeyDown={(e) => onNodeKey(e, t.id)}
              >
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="sqv__box" />
                <path d={`M${n.x} ${n.y + ER.head} V${n.y + 6} a6 6 0 0 1 6 -6 H${n.x + n.w - 6} a6 6 0 0 1 6 6 V${n.y + ER.head} Z`} className="sqv__head" />
                <text x={n.x + 10} y={n.y + 20} className="sqv__title">{title(t)}</text>
                {t.columns.map((c, i) => {
                  const y = n.y + ER.head + ER.pad + i * ER.row + 14;
                  const lk = links.has(t.id) ? links.get(t.id).get(c.name) : null;
                  return (
                    <g key={c.name + i}>
                      {lk && <rect x={n.x + 1} y={y - 14} width={n.w - 2} height={ER.row} className="sqv__link" style={{ fill: lk }} />}
                      {lk && <rect x={n.x + 1} y={y - 14} width={3} height={ER.row} style={{ fill: lk }} />}
                      {(c.pk || c.fk) && <text x={n.x + 10} y={y} className={c.pk ? 'sqv__pk' : 'sqv__fkm'}>{c.pk ? 'PK' : 'FK'}</text>}
                      <text x={n.x + 34} y={y} className="sqv__col">{c.name}</text>
                      <text x={n.x + n.w - 10} y={y} textAnchor="end" className="sqv__type">{c.type}{c.nullable ? '' : ' •'}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="sqv__tools" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton size="sm" icon="plus" label="Aproximar" onClick={() => zoomAt(1.25, box.w / 2, box.h / 2)} />
        <IconButton size="sm" icon="minus" label="Afastar" onClick={() => zoomAt(0.8, box.w / 2, box.h / 2)} />
        <IconButton size="sm" icon="maximize" label="Enquadrar" onClick={fit} />
        <span className="sqv__zoom">{Math.round(view.k * 100)}%</span>
      </div>
    </div>
  );
}
