import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { filterGraph, neighborhood, createLayout, step, reheat, bounds } from '../../notes/graph.js';
import { normalize } from '../../commands/search.js';

const { SegmentedControl, IconButton, Icon, Spinner } = DS;

const MODES = [{ value: 'global', label: 'Global' }, { value: 'local', label: 'Nota atual' }];
const DEPTHS = [{ value: 1, label: '1' }, { value: 2, label: '2' }];
const PALETTE = ['--tk-accent', '--tk-blue', '--tk-cyan', '--tk-violet', '--tk-amber', '--tk-red'];
const FALLBACK = ['#7c9cff', '#4ea1ff', '#35c5d6', '#a78bfa', '#f5b544', '#f06a6a'];

const radius = (n) => Math.min(14, 4 + Math.sqrt(n.degree) * 2.2);
const taskTotal = (n) => (n.tasksOpen || 0) + (n.tasksDone || 0);
const taskLabel = (n) => `${n.tasksDone}/${taskTotal(n)}`;

/**
 * Painel "Grafo": notas como nós e [[links]] como arestas (estilo Obsidian). Arrastar o fundo move,
 * roda dá zoom, arrastar um nó o prende no lugar (duplo clique solta), clique abre a nota, hover destaca
 * os vizinhos. Cores por pasta de 1º nível. "Nota atual" mostra só a vizinhança da nota aberta.
 */
export function GraphPanel({ currentId, onOpen, onOpenLink, toast }) {
  const [opts, setOpts] = usePersisted('notes.graph', { mode: 'global', depth: 1, orphans: true, ghosts: false, pending: false });
  const [raw, setRaw] = React.useState(null); // null = carregando
  const [query, setQuery] = React.useState('');
  const [hover, setHover] = React.useState(null); // id do nó sob o ponteiro
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const L = React.useRef(null);                  // layout atual (mutável; a animação mexe nele)
  const view = React.useRef({ ox: 0, oy: 0, k: 1, w: 0, h: 0, dpr: 1 });
  const raf = React.useRef(0);
  const drag = React.useRef(null);               // { node, wasFixed, moved, sx, sy } | { pan, sx, sy, ox, oy, moved }
  const colors = React.useRef(null);
  const stateRef = React.useRef({});             // hover/query/current para o draw (fora do ciclo do React)

  /* ─────────────── Dados ─────────────── */
  React.useEffect(() => {
    let t = null, alive = true;
    const load = () => notesApi().graph().then((g) => alive && setRaw(g)).catch((e) => { if (alive) { setRaw({ nodes: [], links: [] }); toast('Não foi possível montar o grafo', cleanError(e), 'error'); } });
    load();
    const off = notesApi().onChanged(() => { clearTimeout(t); t = setTimeout(load, 200); });
    return () => { alive = false; off(); clearTimeout(t); };
  }, []);

  const local = opts.mode === 'local';
  const shown = React.useMemo(() => {
    if (!raw) return null;
    if (local) return currentId ? neighborhood(filterGraph(raw, { ghosts: opts.ghosts }), currentId, opts.depth) : { nodes: [], links: [] };
    return filterGraph(raw, { orphans: opts.orphans, ghosts: opts.ghosts });
  }, [raw, local, currentId, opts.depth, opts.orphans, opts.ghosts]);

  /* ─────────────── Desenho ─────────────── */
  const readColors = () => {
    const cs = getComputedStyle(canvasRef.current);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    colors.current = {
      palette: PALETTE.map((p, i) => v(p, FALLBACK[i])),
      green: v('--tk-success', '#3DDC84'),
      text: v('--tk-text', '#e6e6e6'), text2: v('--tk-text-2', '#b3b3b3'), text3: v('--tk-text-3', '#808080'),
      border: v('--tk-border-strong', '#3a3a3a'), bg: v('--tk-bg', '#050506'), accent: v('--tk-accent', '#7c9cff'), amber: v('--tk-amber', '#f5b544'),
      font: '500 11px ' + v('--tk-font-sans', 'system-ui, sans-serif'),
    };
  };

  const folderColor = React.useMemo(() => {
    const tops = [...new Set((raw ? raw.nodes : []).map((n) => (n.folder || '').split('/')[0]).filter(Boolean))].sort();
    const idx = new Map(tops.map((t, i) => [t, i + 1])); // 0 = sem pasta
    return (n) => (n.folder ? idx.get(n.folder.split('/')[0]) : 0);
  }, [raw]);

  const draw = () => {
    const c = canvasRef.current, lay = L.current;
    if (!c || !lay) return;
    if (!colors.current) readColors();
    const col = colors.current, v = view.current, s = stateRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    const X = (x) => x * v.k + v.ox, Y = (y) => y * v.k + v.oy;
    const ns = lay.nodes;

    // Quem fica em destaque: vizinhos do hover, ou quem casa com a busca.
    let focus = null;
    if (s.hover != null && lay.at.has(s.hover)) {
      focus = new Set([s.hover]);
      for (const [a, b] of lay.links) { if (ns[a].id === s.hover) focus.add(ns[b].id); if (ns[b].id === s.hover) focus.add(ns[a].id); }
    }
    const q = normalize(s.query || '').trim();
    const matches = q ? new Set(ns.filter((n) => normalize(n.title).includes(q)).map((n) => n.id)) : null;
    // Filtro "Pendentes": quem tem tarefa aberta fica em destaque (é o foco), o resto esmaece.
    const pend = s.pending ? new Set(ns.filter((n) => n.tasksOpen > 0).map((n) => n.id)) : null;
    const lit = (id) => (focus ? focus.has(id) : matches ? matches.has(id) : pend ? pend.has(id) : true);

    // Arestas
    ctx.lineWidth = 1;
    for (const [a, b] of lay.links) {
      const p = ns[a], r = ns[b];
      const on = focus && focus.has(p.id) && focus.has(r.id) && (p.id === s.hover || r.id === s.hover);
      ctx.strokeStyle = on ? col.accent : col.border;
      ctx.globalAlpha = on ? 0.9 : (focus || matches) ? 0.12 : 0.55;
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(r.x), Y(r.y)); ctx.stroke();
    }

    // Nós
    const maxDeg = ns.reduce((m, n) => Math.max(m, n.degree), 0);
    for (const n of ns) {
      const rr = radius(n) * Math.max(0.6, Math.min(1.6, v.k));
      ctx.globalAlpha = lit(n.id) ? 1 : 0.18;
      ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), rr, 0, Math.PI * 2);
      if (n.ghost) {
        ctx.fillStyle = col.bg; ctx.fill();
        ctx.setLineDash([3, 3]); ctx.strokeStyle = col.text3; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col.palette[folderColor(n) % col.palette.length]; ctx.fill();
      }
      if (n.id === s.current || (matches && matches.has(n.id)) || n.fixed) {
        ctx.lineWidth = 2; ctx.strokeStyle = n.id === s.current ? col.text : matches && matches.has(n.id) ? col.amber : col.text3;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), rr + (taskTotal(n) > 0 && !n.ghost ? 6 : 3), 0, Math.PI * 2); ctx.stroke(); // afasta do anel de progresso
      }
      // Progresso das tarefas: trilho + arco verde (começa às 12h, sentido horário). Só em notas com tarefas.
      const total = taskTotal(n);
      if (total > 0 && !n.ghost) {
        const ar = rr + 2, cx = X(n.x), cy = Y(n.y), frac = n.tasksDone / total;
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.strokeStyle = col.border;
        ctx.beginPath(); ctx.arc(cx, cy, ar, 0, Math.PI * 2); ctx.stroke();
        if (frac > 0) {
          ctx.strokeStyle = col.green;
          ctx.beginPath(); ctx.arc(cx, cy, ar, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
    }

    // Rótulos: com zoom, para os mais ligados, e sempre para destaque/hover/atual.
    ctx.font = col.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    for (const n of ns) {
      const show = v.k >= 1.1 || (maxDeg >= 3 && n.degree >= Math.max(3, maxDeg * 0.5)) || n.id === s.hover || n.id === s.current
        || (focus && focus.has(n.id)) || (matches && matches.has(n.id));
      if (!show) continue;
      ctx.globalAlpha = lit(n.id) ? 1 : 0.25;
      const base = n.title.length > 40 ? n.title.slice(0, 39) + '…' : n.title;
      const label = taskTotal(n) > 0 && !n.ghost ? `${base}  ·  ${taskLabel(n)}` : base;
      const tx = X(n.x), ty = Y(n.y) + radius(n) * Math.max(0.6, Math.min(1.6, v.k)) + (taskTotal(n) > 0 ? 7 : 4);
      ctx.lineWidth = 3; ctx.strokeStyle = col.bg; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = n.id === s.hover ? col.text : n.ghost ? col.text3 : col.text2; ctx.fillText(label, tx, ty);
    }
    ctx.globalAlpha = 1;
  };

  const requestDraw = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; draw(); }); };
  // Anima enquanto o layout está quente (ou arrastando); parado, não gasta CPU.
  const tick = () => {
    raf.current = 0;
    const hot = L.current && step(L.current);
    draw();
    if (hot || (drag.current && drag.current.node)) raf.current = requestAnimationFrame(tick);
  };
  const kick = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick); };

  const fit = () => {
    const lay = L.current, v = view.current;
    if (!lay || !v.w) return;
    const b = bounds(lay), pad = 60;
    const k = Math.max(0.15, Math.min(2, Math.min((v.w - pad * 2) / Math.max(1, b.maxX - b.minX), (v.h - pad * 2) / Math.max(1, b.maxY - b.minY))));
    v.k = k;
    v.ox = v.w / 2 - ((b.minX + b.maxX) / 2) * k;
    v.oy = v.h / 2 - ((b.minY + b.maxY) / 2) * k;
    requestDraw();
  };

  // Novo grafo → novo layout (mantém posições de quem já existia). O 1º já sai "pré-acomodado" e enquadrado.
  React.useEffect(() => {
    if (!shown) return;
    const first = !L.current;
    L.current = createLayout(shown, L.current);
    if (first) {
      const n = Math.max(1, shown.nodes.length);
      for (let i = 0, max = Math.min(160, Math.ceil(60000 / n)); i < max && step(L.current); i++);
      fit();
    }
    kick();
  }, [shown]);

  React.useEffect(() => { stateRef.current = { hover, query, current: currentId, pending: opts.pending }; requestDraw(); }, [hover, query, currentId, opts.pending]);
  // Trocar Global ↔ Nota atual (ou a nota) reenquadra.
  React.useEffect(() => { const t = setTimeout(fit, 350); return () => clearTimeout(t); }, [opts.mode, local ? currentId : null, opts.depth]);

  // Tamanho do canvas acompanha o painel (nítido em telas HiDPI); tema novo → relê as cores.
  React.useEffect(() => {
    const wrap = wrapRef.current, c = canvasRef.current;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect(), v = view.current, dpr = window.devicePixelRatio || 1;
      if (!v.w) { v.ox = r.width / 2; v.oy = r.height / 2; }
      Object.assign(v, { w: r.width, h: r.height, dpr });
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      requestDraw();
    });
    ro.observe(wrap);
    const mo = new MutationObserver(() => { colors.current = null; requestDraw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => { ro.disconnect(); mo.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); };
  }, []);

  /* ─────────────── Interação ─────────────── */
  const toWorld = (e) => {
    const r = canvasRef.current.getBoundingClientRect(), v = view.current;
    return { x: (e.clientX - r.left - v.ox) / v.k, y: (e.clientY - r.top - v.oy) / v.k, sx: e.clientX, sy: e.clientY };
  };
  const hit = (p) => {
    const lay = L.current;
    if (!lay) return null;
    const v = view.current;
    let best = null, bestD = Infinity;
    for (const n of lay.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y) * v.k;
      if (d <= radius(n) * Math.max(0.6, Math.min(1.6, v.k)) + 5 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    canvasRef.current.setPointerCapture(e.pointerId);
    const p = toWorld(e), n = hit(p);
    if (n) { drag.current = { node: n, wasFixed: n.fixed, moved: false, sx: p.sx, sy: p.sy }; n.fixed = true; }
    else drag.current = { pan: true, sx: p.sx, sy: p.sy, ox: view.current.ox, oy: view.current.oy, moved: false };
  };
  const onPointerMove = (e) => {
    const p = toWorld(e), d = drag.current;
    if (d) {
      if (Math.hypot(p.sx - d.sx, p.sy - d.sy) > 4) d.moved = true;
      if (d.node && d.moved) { d.node.x = p.x; d.node.y = p.y; reheat(L.current, 0.25); if (!raf.current) kick(); }
      else if (d.pan) { view.current.ox = d.ox + (p.sx - d.sx); view.current.oy = d.oy + (p.sy - d.sy); requestDraw(); }
      return;
    }
    const n = hit(p);
    const id = n ? n.id : null;
    if (id !== hover) setHover(id);
    canvasRef.current.style.cursor = n ? 'pointer' : 'grab';
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.node && !d.moved) {
      d.node.fixed = d.wasFixed; // clique simples não prende
      if (d.node.ghost) onOpenLink(d.node.title); else onOpen(d.node.id);
    }
  };
  const onDoubleClick = (e) => {
    const n = hit(toWorld(e));
    if (n && n.fixed) { n.fixed = false; reheat(L.current, 0.3); kick(); }
  };
  const onWheel = (e) => {
    const v = view.current, r = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.max(0.15, Math.min(4, v.k * Math.exp(-e.deltaY * 0.0015)));
    v.ox = mx - ((mx - v.ox) / v.k) * k;
    v.oy = my - ((my - v.oy) / v.k) * k;
    v.k = k;
    requestDraw();
  };
  // Roda do mouse sem rolar a página (listener não passivo).
  React.useEffect(() => {
    const c = canvasRef.current;
    const h = (e) => { e.preventDefault(); onWheel(e); };
    c.addEventListener('wheel', h, { passive: false });
    return () => c.removeEventListener('wheel', h);
  }, []);

  // Enter na busca centraliza no primeiro resultado.
  const focusMatch = () => {
    const q = normalize(query).trim(), lay = L.current, v = view.current;
    const n = q && lay && lay.nodes.find((x) => normalize(x.title).includes(q));
    if (!n) return;
    v.k = Math.max(v.k, 1.2);
    v.ox = v.w / 2 - n.x * v.k; v.oy = v.h / 2 - n.y * v.k;
    requestDraw();
  };

  const set = (k) => (val) => setOpts((o) => ({ ...o, [k]: val }));
  const counts = shown ? `${shown.nodes.filter((n) => !n.ghost).length} notas · ${shown.links.length} links` : '';
  const hoverNode = hover && L.current && L.current.at.has(hover) ? L.current.nodes[L.current.at.get(hover)] : null;

  return (
    <div className="nts-tasks nts-graph">
      <div className="nts-tasks__head nts-graph__head">
        <Icon name="waypoints" size={15} />
        <h2>Grafo</h2>
        <span className="nts-tasks__count">{counts}</span>
        <span className="nts-editor__spacer" />
        <SegmentedControl size="sm" options={MODES} value={opts.mode} onChange={set('mode')} />
        {local && <SegmentedControl size="sm" options={DEPTHS} value={opts.depth} onChange={set('depth')} />}
        <label className="tk-input tk-input--sm nts-graph__search">
          <Icon name="search" size={13} className="tk-input__icon" />
          <input value={query} placeholder="Destacar…" aria-label="Destacar notas no grafo" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') focusMatch(); else if (e.key === 'Escape') setQuery(''); }} />
        </label>
        {!local && <button type="button" className={'nts-chip' + (opts.orphans ? ' is-on' : '')} aria-pressed={opts.orphans} onClick={() => set('orphans')(!opts.orphans)} title="Notas sem nenhum link">Órfãs</button>}
        <button type="button" className={'nts-chip' + (opts.ghosts ? ' is-on' : '')} aria-pressed={opts.ghosts} onClick={() => set('ghosts')(!opts.ghosts)} title="[[Links]] para notas que ainda não existem">Inexistentes</button>
        <button type="button" className={'nts-chip' + (opts.pending ? ' is-on' : '')} aria-pressed={!!opts.pending} onClick={() => set('pending')(!opts.pending)} title="Destacar notas com tarefas abertas (- [ ])">Pendentes</button>
        <IconButton size="sm" icon="scan" label="Centralizar" onClick={fit} />
      </div>
      <div ref={wrapRef} className="nts-graph__wrap">
        <canvas ref={canvasRef} className="nts-graph__canvas"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={() => { if (!drag.current) setHover(null); }} onDoubleClick={onDoubleClick} />
        {raw === null && <div className="nts-graph__msg"><Spinner size={14} /> Montando o grafo…</div>}
        {shown && !shown.nodes.length && raw !== null && (
          <div className="nts-graph__msg">
            {local && !currentId ? 'Abra uma nota para ver a vizinhança dela.'
              : local ? 'Esta nota ainda não tem links — use [[Título]] para ligar a outra nota.'
              : 'Nenhuma nota para mostrar com estes filtros.'}
          </div>
        )}
        {hoverNode && (
          <div className="nts-graph__tip">
            <b>{hoverNode.title}</b>
            <span>{hoverNode.ghost ? 'Não existe ainda — clique para criar' : `${hoverNode.folder || 'Sem pasta'} · ${hoverNode.degree} ${hoverNode.degree === 1 ? 'link' : 'links'}`}</span>
            {taskTotal(hoverNode) > 0 && !hoverNode.ghost && (
              <span>{hoverNode.tasksDone} de {taskTotal(hoverNode)} {taskTotal(hoverNode) === 1 ? 'tarefa' : 'tarefas'}
                {hoverNode.tasksOpen > 0 ? ` · ${hoverNode.tasksOpen} ${hoverNode.tasksOpen === 1 ? 'pendente' : 'pendentes'}` : ' · tudo concluído'}</span>
            )}
          </div>
        )}
        <div className="nts-graph__help">arrastar move · roda aproxima · clique abre · arrastar um nó o prende (duplo clique solta)</div>
      </div>
    </div>
  );
}
