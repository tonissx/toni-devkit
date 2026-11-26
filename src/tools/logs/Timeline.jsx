// Logs — linha do tempo: colunas empilhadas por nível (os mais graves na base, para comparar entre colunas),
// espaço de 2px entre segmentos, topo arredondado. Passar o mouse mostra a contagem de cada nível; arrastar escolhe
// um intervalo (vira filtro); clicar pula a lista para aquele momento. Picos de erro ganham um marcador.
// Marcos (deploys, merges da main, manuais) ficam numa faixa fina acima das colunas, com uma linha tracejada clara
// atravessando o gráfico: dá para ver "a partir de qual mudança" algo começou sem cobrir as barras.
import { DS } from '../../lib/ds.js';
import { LEVEL_BY_ID, levelColor, fmtTick, fmtStep, fmtTime, fmtNum, fmtCompact, sameDay } from './shared.jsx';
import { clusterMilestones, shortLabel, countMilestones, kindGroup } from '../../logs/milestones.js';
import { MilestoneMenu, MarkHereMenu, MilestoneIcon, kindLabel, commitsPending, useDismiss } from './MilestoneMenu.jsx';

const { Icon } = DS;

const H = 64;
const PAD = { l: 6, r: 6, t: 10, b: 16 };
const ORDER_ALL = [6, 5, 4, 3, 2, 1, 0];
const ORDER_PROBLEMS = [6, 5, 4];
const STRIP = 14;        // altura da faixa dos marcos
const MARK_MIN_PX = 16;  // ícones mais perto que isso viram um só (com contador)
const MARK_KINDS = [['deploy', 'Deploys', 'deploy/undeploy/restart lidos do log'], ['merge', 'Merges', 'da main dos repositórios ligados'], ['manual', 'Manuais', 'marcados por você (botão direito nas colunas)']];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Detalhe de um marco no tooltip: artefatos, ou PR/título/autor, ou o texto do marco manual. */
function detailOf(m, multiRepo = false) {
  const arts = m.artifacts || [];
  const list = arts.slice(0, 6).join(', ') + (arts.length > 6 ? ` +${arts.length - 6}` : '');
  if (m.kind === 'restart') return arts.length ? `${plural(arts.length, 'app', 'apps')}: ${list}` : 'servidor reiniciado';
  if (m.kind === 'deploy' || m.kind === 'undeploy') return list || m.label;
  if (m.kind === 'merge') return m.label + (m.author ? ' · ' + m.author : '') + (multiRepo && m.repoName ? ' · ' + m.repoName : '');
  return m.label;
}

/** Tooltip dos marcos de uma coluna (todos, até 6). */
function MilestoneTip({ items, repos = [], commitsOf, commitsState, multiDay, style }) {
  const shown = items.slice(0, 6);
  const pending = commitsPending(commitsState);
  return (
    <div className="lg-tip lg-mtip" style={style} role="tooltip">
      {shown.map((m) => {
        const n = repos.length && commitsOf && kindGroup(m.kind) === 'deploy' ? commitsOf(m).length : null;
        // Sem a resposta do repositório, "0 commits" seria falso: mostra o estado em vez do número.
        const note = n == null ? null : n === 0 && pending ? 'Commits da main: ' + pending : plural(n, 'commit', 'commits') + ' na main desde o deploy anterior (estimativa)';
        return (
          <div key={m.id} className="lg-mtip__item">
            <div className="lg-mtip__head"><MilestoneIcon kind={m.kind} /><b>{kindLabel(m)}</b><span className="lg-tip__when">{fmtTime(m.ts, { date: multiDay, millis: false })}</span></div>
            <div className="lg-mtip__txt">{detailOf(m, repos.length > 1)}</div>
            {note && <div className="lg-mtip__note">{note}</div>}
          </div>
        );
      })}
      {items.length > shown.length && <div className="lg-mtip__note">+{plural(items.length - shown.length, 'marco', 'marcos')}</div>}
      <div className="lg-mtip__hint">clique para as ações</div>
    </div>
  );
}

/** Posição de um popover ancorado em `x` (px) numa área de largura `w`: abre para a direita, ou para a esquerda perto da borda. */
const popAt = (x, w, top, room = 300) => (x < w - room ? { top, left: Math.max(0, x - 12), right: 'auto' } : { top, right: Math.max(0, w - x - 12), left: 'auto' });

/** Largura do conteúdo (sem o padding do contêiner): é o espaço que o SVG tem de verdade. */
function useWidth(ref) {
  const [w, setW] = React.useState(600);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = getComputedStyle(el);
      setW(Math.max(10, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
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
 * spikes [b], mode 'all'|'problems', onMode, loading, collapsed, onCollapse(bool)
 * marcos: milestones (já filtrados por `show`), allMilestones (todos, para as contagens do menu "Marcos"),
 * show { deploy, merge, manual }, onShow(patch), repos (ligados), commitsOf(m), commitsState, onMarkHere(ts, label),
 * onMilestone({ type: 'edit', m, label } | { type: 'delete', m })
 */
export function Timeline({ hist, range, onRange, onSeek, spikes, mode, onMode, loading, collapsed, onCollapse,
  milestones = [], allMilestones, show, onShow, repos = [], commitsOf, commitsState, onMarkHere, onMilestone }) {
  const ref = React.useRef(null);
  const svgRef = React.useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = React.useState(null); // { b }
  const [drag, setDrag] = React.useState(null);   // { b0, b1, moved }
  const [kb, setKb] = React.useState(null);       // teclado: { b, anchor } (anchor = início de Shift+setas)
  const [mHover, setMHover] = React.useState(null); // id do marco sob o mouse/foco (tooltip)
  const [menu, setMenu] = React.useState(null);     // { id, items, x } — menu de um marco aberto
  const [ctx, setCtx] = React.useState(null);       // { x, y, ts } — botão direito nas colunas
  const [showOpen, setShowOpen] = React.useState(false);
  const showRef = React.useRef(null);
  useDismiss(showRef, () => setShowOpen(false), showOpen);

  // Recolhida: uma faixa fina, que ainda avisa dos picos de erro (o espaço vai para as linhas).
  if (collapsed) {
    const n = hist && spikes ? spikes.filter((b) => b < hist.buckets).length : 0;
    const mc = hist && hist.buckets ? countMilestones(milestones, hist.start, hist.start + hist.buckets * hist.step) : null;
    const parts = mc ? [['deploy', plural(mc.deploy, 'deploy', 'deploys')], ['merge', plural(mc.merge, 'merge', 'merges')], ['manual', plural(mc.manual, 'manual', 'manuais')]].filter(([k]) => mc[k] > 0) : [];
    return (
      <div className="lg-timeline is-folded" ref={ref}>
        <button type="button" className="lg-timeline__fold" onClick={() => onCollapse(false)} title="Mostrar a linha do tempo" aria-expanded="false">
          <Icon name="chevron-right" size={13} /><span className="lg-timeline__title">Linha do tempo</span>
        </button>
        {hist && <span className="lg-muted">{fmtTime(hist.start, { date: !sameDay(hist.start, hist.start + hist.buckets * hist.step), millis: false })} → {fmtTime(hist.start + hist.buckets * hist.step, { millis: false })}</span>}
        {n > 0 && <span className="lg-timeline__spikes"><Icon name="triangle-alert" size={11} />{n} pico{n === 1 ? '' : 's'} de erro</span>}
        {parts.length > 0 && (
          <span className="lg-timeline__marks" title="Marcos neste log (abra a linha do tempo para ver onde)">
            {parts.map(([k, t], j) => <React.Fragment key={k}>{j > 0 && <span className="lg-muted">·</span>}<span><MilestoneIcon kind={k} />{t}</span></React.Fragment>)}
          </span>
        )}
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
  const multiDay = !sameDay(hist.start, hist.start + B * hist.step);

  // Marcos: um grupo por coluna (ou por colunas vizinhas, se estreitas demais para dois ícones lado a lado).
  const clusters = clusterMilestones(milestones, hist, Math.max(0, Math.ceil(MARK_MIN_PX / bw) - 1));
  const cxOf = (b) => xOf(b) + barW / 2;
  const hasStrip = clusters.length > 0;
  const hoverC = mHover && !menu && !ctx ? clusters.find((c) => c.items[0].id === mHover) : null;
  // Coluna sob o ponteiro: mede a partir do próprio SVG (o contêiner tem padding e borda — medir por ele desloca a
  // troca de coluna para antes do meio da barra). Cada coluna ocupa a faixa inteira [b·bw, (b+1)·bw): a barra fica
  // no centro dela, então a troca acontece no vão entre duas barras.
  const bOf = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
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

  const rangeB = range ? [Math.max(0, Math.floor((range.from - hist.start) / hist.step)), range.to == null ? B - 1 : Math.min(B - 1, Math.floor((range.to - hist.start) / hist.step))] : null;

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
  // Botão direito nas colunas: "Marcar deploy aqui…" no instante sob o ponteiro.
  const onContext = (e) => {
    if (!onMarkHere) return;
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ts = Math.round(Math.max(hist.start, Math.min(hist.start + B * hist.step - 1, hist.start + ((x - PAD.l) / bw) * hist.step)));
    setMenu(null); setDrag(null);
    setCtx({ x, y: e.clientY - rect.top + (hasStrip ? STRIP : 0) + 4, ts });
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
        {onShow && show && (
          <div className="lg-pop-wrap" ref={showRef}>
            <button type="button" className={'lg-tlbtn' + (MARK_KINDS.some(([k]) => !show[k]) ? ' is-partial' : '')} onClick={() => setShowOpen((o) => !o)} aria-expanded={showOpen} aria-haspopup="menu"
              title="Marcos na linha do tempo: deploys, merges da main e marcos manuais">
              <Icon name="milestone" size={12} /><span>Marcos</span><Icon name="chevron-down" size={11} />
            </button>
            {showOpen && (() => {
              const n = countMilestones(allMilestones || milestones, hist.start, hist.start + B * hist.step);
              return (
                <div className="lg-pop lg-menu lg-mmenu" role="menu" aria-label="Marcos mostrados" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setShowOpen(false); } }}>
                  {MARK_KINDS.map(([k, label, hint]) => (
                    <button key={k} type="button" role="menuitemcheckbox" aria-checked={!!show[k]} onClick={() => onShow({ [k]: !show[k] })} title={hint}>
                      <Icon name={show[k] ? 'square-check' : 'square'} size={14} className={show[k] ? 'lg-mmenu__on' : ''} /><MilestoneIcon kind={k} /><span>{label}</span><small>{fmtNum(n[k])}</small>
                    </button>
                  ))}
                  <div className="lg-mmenu__note">{repos.length ? 'Merges: só os da main, a partir ' + (repos.length > 1 ? 'dos repositórios ligados.' : 'do repositório ligado.') : 'Ligue um repositório no cabeçalho para ver os merges da main.'} Botão direito nas colunas marca um deploy à mão.</div>
                </div>
              );
            })()}
          </div>
        )}
        <div className="lg-seg" role="group" aria-label="O que o gráfico mostra">
          <button type="button" className={mode !== 'problems' ? 'is-on' : ''} onClick={() => onMode('all')}>Tudo</button>
          <button type="button" className={mode === 'problems' ? 'is-on' : ''} onClick={() => onMode('problems')} title="Só avisos e erros, com escala própria">Problemas</button>
        </div>
      </div>
      <div className="lg-timeline__plot">
      {hasStrip && (
        <div className="lg-mstrip" style={{ width }} role="group" aria-label="Marcos">
          {clusters.map((c, k) => {
            const id = c.items[0].id;
            const cx = cxOf(c.b);
            const n = c.items.length;
            // Rótulo curto só quando cabe até o próximo ícone (senão fica só o ícone; o resto está no tooltip).
            const next = k + 1 < clusters.length ? cxOf(clusters[k + 1].b) : PAD.l + plotW + PAD.r;
            const room = next - cx - 12 - (n > 1 ? 4 + String(n).length * 6 : 0);
            const txt = n === 1 ? shortLabel(c.items[0]) : '';
            const label = txt && room >= txt.length * 6 + 4 ? txt : '';
            const open = menu && menu.id === id;
            return (
              <button key={id} type="button" data-mm-anchor="" className={'lg-mark is-' + c.kind + (open || (hoverC && hoverC === c) ? ' is-hot' : '')} style={{ left: cx }}
                aria-haspopup="menu" aria-expanded={!!open}
                aria-label={(n > 1 ? `${n} marcos: ` : '') + c.items.map((m) => `${kindLabel(m)} ${shortLabel(m, 40)} às ${fmtTime(m.ts, { date: multiDay, millis: false })}`).join('; ')}
                onClick={() => { setCtx(null); setMHover(null); setMenu(open ? null : { id, items: c.items, x: cx }); }}
                onMouseEnter={() => setMHover(id)} onMouseLeave={() => setMHover((h) => (h === id ? null : h))}
                onFocus={() => setMHover(id)} onBlur={() => setMHover((h) => (h === id ? null : h))}>
                <MilestoneIcon kind={c.kind} />
                {n > 1 && <b className="lg-mark__n">{n}</b>}
                {label && <span className="lg-mark__label">{label}</span>}
              </button>
            );
          })}
        </div>
      )}
      <svg ref={svgRef} width={width} height={H} className="lg-timeline__svg" role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setKb(null)}
        aria-label={`Linha do tempo: ${B} colunas de ${fmtStep(hist.step)}, de ${fmtTime(hist.start, { date: true, millis: false })}. Setas andam entre as colunas, Shift+setas seleciona um intervalo, Enter aplica.`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); }} onContextMenu={onContext}>
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
        {/* Linhas dos marcos: finas, tracejadas e claras (as colunas continuam legíveis); acendem no hover/menu. */}
        {clusters.map((c) => {
          const hot = (menu && menu.id === c.items[0].id) || (hoverC && hoverC === c);
          return c.bs.map((b) => (
            <line key={'m' + c.items[0].id + ':' + b} x1={cxOf(b) + 0.5} x2={cxOf(b) + 0.5} y1={0} y2={PAD.t + plotH} className={'lg-mline is-' + c.kind + (hot ? ' is-hot' : '')} />
          ));
        })}
        {ib != null && <line x1={xOf(ib) + barW / 2} x2={xOf(ib) + barW / 2} y1={PAD.t - 4} y2={PAD.t + plotH} className="lg-cross" />}
        {ticks.map((b) => (
          <text key={'t' + b} x={xOf(b) + barW / 2} y={H - 3} className="lg-tick" textAnchor={b === 0 ? 'start' : 'middle'}>{fmtTick(tOf(b), multiDay && hist.step < 3600e3 && b === 0 ? 3600e3 : hist.step)}</text>
        ))}
      </svg>
      {hoverC && <MilestoneTip items={hoverC.items} repos={repos} commitsOf={commitsOf} commitsState={commitsState} multiDay={multiDay} style={popAt(cxOf(hoverC.b), width, STRIP + 2, 330)} />}
      {menu && (
        <MilestoneMenu key={menu.id} milestones={menu.items} repos={repos} commitsOf={commitsOf} commitsState={commitsState} multiDay={multiDay} style={popAt(menu.x, width, STRIP + 2)}
          onSeek={onSeek} onRange={onRange} onClose={() => setMenu(null)}
          onEdit={onMilestone ? (m, label) => onMilestone({ type: 'edit', m, label }) : null}
          onDelete={onMilestone ? (m) => onMilestone({ type: 'delete', m }) : null} />
      )}
      {ctx && <MarkHereMenu key={ctx.ts} ts={ctx.ts} multiDay={multiDay} style={popAt(ctx.x, width, ctx.y)} onClose={() => setCtx(null)} onSubmit={(label) => onMarkHere(ctx.ts, label)} />}
      </div>
    </div>
  );
}
