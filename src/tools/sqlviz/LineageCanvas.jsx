import { DS } from '../../lib/ds.js';
import { LAYOUT as L, visibleColumns, infoLines, colCenterY } from '../../db/lineage.js';
import { usePanZoom } from './usePanZoom.js';

const { IconButton } = DS;

const KIND_LABEL = { table: 'Tabela', temp: 'Temporária', func: 'Função', values: 'VALUES', cte: 'CTE', subquery: 'Subconsulta', branch: 'Ramo', result: 'Resultado', target: 'Destino' };
const FLAG = { join: ['J', 'usada em JOIN'], filter: ['F', 'usada em filtro (WHERE / HAVING)'], group: ['G', 'usada em GROUP BY'], order: ['O', 'usada em ORDER BY'] };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Ponta do arco entre duas caixas: sai da direita da origem e chega à esquerda do destino. */
function arc(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

/**
 * Canvas do lineage. Tabelas à esquerda, resultado à direita. Clicar numa coluna destaca de onde ela vem
 * (colunas, setas e blocos do caminho); o resto esmaece. Texto sempre via React/SVG (escapado).
 */
export function LineageCanvas({ graph, layout, selected, onSelect, up, fitSignal }) {
  const bounds = React.useMemo(() => ({ x: 0, y: 0, w: layout.width, h: layout.height }), [layout]);
  const { wrap, box, view, fit, zoomAt, handlers } = usePanZoom(bounds, fitSignal, () => onSelect(null));
  const dimNode = (id) => up && !up.nodes.has(id);

  return (
    <div ref={wrap} className="sqv__graph" {...handlers}>
      <svg className="sqv__svg" width={box.w} height={box.h} role="group" aria-label="Linhagem da query">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((e, i) => {
            const a = layout.pos[e.from], b = layout.pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + a.w, y1 = a.y + L.head / 2, x2 = b.x, y2 = b.y + L.head / 2;
            const on = up && up.nodes.has(e.from) && up.nodes.has(e.to);
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const join = /JOIN|APPLY/.test(e.label);
            return (
              <g key={'e' + i} className={'sqv__tedge' + (up && !on ? ' is-dim' : '')}>
                <title>{e.cond ? `${e.label} ON ${e.cond}` : e.label}</title>
                <path d={arc(x1, y1, x2, y2)} />
                {(join || e.label !== 'FROM') && <text x={mx} y={my - 4} textAnchor="middle" className={join ? 'sqv__tlabel is-join' : 'sqv__tlabel'}>{cut(e.label, 18)}</text>}
              </g>
            );
          })}
          {graph.colEdges.map((e, i) => {
            const a = layout.pos[e.from.node], b = layout.pos[e.to.node];
            if (!a || !b || e.from.node === e.to.node) return null;
            const on = up && up.edges.has(i);
            return (
              <path
                key={'c' + i}
                d={arc(a.x + a.w, colCenterY(graph, layout.pos, e.from.node, e.from.col), b.x, colCenterY(graph, layout.pos, e.to.node, e.to.col))}
                className={'sqv__cedge is-' + e.kind + (on ? ' is-on' : '') + (up && !on ? ' is-dim' : '') + (e.ambiguous ? ' is-amb' : '')}
              />
            );
          })}
          {graph.nodes.map((n) => {
            const p = layout.pos[n.id];
            const vis = visibleColumns(n);
            const shown = vis.slice(0, L.maxRows);
            const lines = ['table', 'temp', 'func', 'values'].includes(n.kind) ? [] : infoLines(n);
            const infoY = p.y + L.head + L.pad + Math.max(1, shown.length + (vis.length > L.maxRows ? 1 : 0)) * L.row + 8;
            return (
              <g key={n.id} className={'sqv__lnode is-' + n.kind + (dimNode(n.id) ? ' is-dim' : '')}>
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={6} className="sqv__box" />
                <path d={`M${p.x} ${p.y + L.head} V${p.y + 6} a6 6 0 0 1 6 -6 H${p.x + p.w - 6} a6 6 0 0 1 6 6 V${p.y + L.head} Z`} className="sqv__lhead" />
                <text x={p.x + 10} y={p.y + 19} className="sqv__ltitle"><tspan className="sqv__lkind">{KIND_LABEL[n.kind]} </tspan>{cut(n.name, 28)}</text>
                {!shown.length && <text x={p.x + 12} y={p.y + L.head + L.pad + 14} className="sqv__type">(nenhuma coluna usada)</text>}
                {shown.map(({ col, idx }, r) => {
                  const y = p.y + L.head + L.pad + r * L.row;
                  const key = `${n.id}:${idx}`;
                  const isSel = selected && selected.node === n.id && selected.col === idx;
                  const inUp = up && up.cols.has(key);
                  return (
                    <g
                      key={idx}
                      className={'sqv__lrow' + (isSel ? ' is-selected' : '') + (inUp ? ' is-up' : '')}
                      tabIndex={0}
                      role="button"
                      aria-pressed={!!isSel}
                      aria-label={`Coluna ${col.name} de ${n.name}${col.expr ? ', expressão ' + col.expr : ''}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onSelect(isSel ? null : { node: n.id, col: idx }); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSel ? null : { node: n.id, col: idx }); } else if (e.key === 'Escape') onSelect(null); }}
                    >
                      <title>{col.expr ? `${col.name} = ${col.expr}` : col.name}</title>
                      <rect x={p.x + 2} y={y} width={p.w - 4} height={L.row} className="sqv__lrowbg" />
                      <text x={p.x + 10} y={y + 14} className="sqv__col">{cut(col.name, 26)}</text>
                      {col.kind === 'agg' && <text x={p.x + p.w - 10} y={y + 14} textAnchor="end" className="sqv__lbadge is-agg">Σ</text>}
                      {col.kind === 'expr' && <text x={p.x + p.w - 10} y={y + 14} textAnchor="end" className="sqv__lbadge is-expr">ƒ</text>}
                      {col.flags.filter((f) => FLAG[f]).map((f, k) => (
                        <text key={f} x={p.x + p.w - 10 - k * 13} y={y + 14} textAnchor="end" className={'sqv__lbadge is-' + f}>{FLAG[f][0]}<title>{FLAG[f][1]}</title></text>
                      ))}
                    </g>
                  );
                })}
                {vis.length > L.maxRows && <text x={p.x + 10} y={p.y + L.head + L.pad + shown.length * L.row + 14} className="sqv__type">+ {vis.length - L.maxRows} coluna(s)</text>}
                {lines.length > 0 && (
                  <g>
                    <line x1={p.x + 8} x2={p.x + p.w - 8} y1={infoY - 4} y2={infoY - 4} className="sqv__lsep" />
                    {lines.map((ln, k) => (
                      <g key={k} className={'sqv__linfo is-' + ln.kind}>
                        <title>{`${ln.tag}: ${ln.text}`}</title>
                        <text x={p.x + 10} y={infoY + 8 + k * L.infoLine} className="sqv__ltag">{ln.tag}</text>
                        <text x={p.x + 10 + (ln.tag.length * 6.4 + 8)} y={infoY + 8 + k * L.infoLine} className="sqv__ltext">{cut(ln.text, Math.floor((p.w - 28 - ln.tag.length * 6.4) / 6.1))}</text>
                      </g>
                    ))}
                  </g>
                )}
                <title>{`${KIND_LABEL[n.kind]} ${n.name}`}</title>
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
