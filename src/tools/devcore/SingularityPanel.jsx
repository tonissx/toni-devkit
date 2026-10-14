import { DS } from '../../lib/ds.js';
import { formatNum } from '../../devcore/engine/format.js';
import { sfx } from './audio.js';

const { Button, Icon, Modal } = DS;

/**
 * Aba Singularity: a Rede (constelação de nós) e a cerimônia do reset. Regras e textos vêm da view
 * (engine/view.js singularityView); aqui só desenho e interação.
 *
 * Geometria: o Núcleo no centro; cada setor ocupa 60° (no sentido horário a partir do topo); o anel (`ring`) é a
 * distância do centro e `at` (−1…1) a posição dentro do setor. As sinapses ficam na fronteira entre dois setores.
 */
const R0 = 72;        // raio do anel 1
const STEP = 58;      // distância entre anéis
const SPREAD = 26;    // graus de `at` = ±1 dentro do setor (60° por setor; sobra a fronteira para as sinapses)
const HALF = 530;     // metade do mundo (unidades)
const SIZE = { core: 66, minor: 30, notable: 40, keystone: 44, mastery: 52, repeat: 36, bridge: 34, founder: 38 };

function layout(nodes, sectors) {
  const idx = Object.fromEntries(sectors.map((s, i) => [s.id, i]));
  const pos = {};
  for (const n of nodes) {
    if (n.kind === 'core') { pos[n.id] = { x: 0, y: 0 }; continue; }
    const deg = n.angle != null ? n.angle : n.kind === 'bridge' ? -90 + idx[n.sectors[0]] * 60 + 30 : -90 + idx[n.sector] * 60 + n.at * SPREAD;
    const r = R0 + (n.ring - 1) * STEP;
    const a = (deg * Math.PI) / 180;
    pos[n.id] = { x: r * Math.cos(a), y: r * Math.sin(a) };
  }
  return pos;
}

const hueOf = (n, sec) => (n.kind === 'core' ? '#E9E3FF' : n.kind === 'founder' ? '#FFD27A' : sec[n.sector || (n.sectors || [])[0]].hue);

/** Pan e zoom do palco: arrastar move, roda do mouse aproxima (em volta do cursor), botões para ajustar. */
function usePanZoom(stage) {
  const [view, setView] = React.useState(null); // { k, x, y }: o mundo é desenhado em translate(x,y) scale(k)
  const fit = React.useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const k = Math.min(el.clientWidth, el.clientHeight) / (HALF * 2) * 0.98;
    setView({ k, x: el.clientWidth / 2 - HALF * k, y: el.clientHeight / 2 - HALF * k });
  }, []);
  React.useLayoutEffect(() => { fit(); }, []);
  React.useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, []);
  const zoomAt = (factor, cx, cy) => setView((v) => {
    if (!v) return v;
    const k = Math.max(0.3, Math.min(2.4, v.k * factor));
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
  });
  const drag = React.useRef(null);
  const handlers = {
    onWheel: (e) => { const r = stage.current.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); },
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest('.dc-sg__node, .dc-sg__tools')) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      d.x = e.clientX; d.y = e.clientY;
      setView((v) => (v ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    },
    onPointerUp: () => { drag.current = null; },
  };
  const center = () => { const el = stage.current; return [el.clientWidth / 2, el.clientHeight / 2]; };
  return { view, handlers, fit, zoomIn: () => zoomAt(1.25, ...center()), zoomOut: () => zoomAt(1 / 1.25, ...center()) };
}

/** Linhas entre nós ligados: acesas (os dois comprados), abertas (um comprado e o outro disponível) ou apagadas. */
function Edges({ nodes, pos, sec, byId }) {
  const owned = (n) => n.status === 'owned';
  const lines = [];
  for (const n of nodes) for (const l of n.links) {
    const m = byId[l];
    if (!m) continue;
    const a = pos[n.id]; const b = pos[l];
    const state = owned(n) && owned(m) ? 'is-on' : (owned(n) && m.status === 'available') || (owned(m) && n.status === 'available') ? 'is-open' : '';
    const hue = hueOf(n.kind === 'core' ? m : n, sec);
    lines.push(<line key={n.id + '>' + l} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={'dc-sg__edge ' + state} style={{ '--hue': hue }} />);
  }
  return lines;
}

/** Fatias dos setores (fundo) e os nomes na borda. */
function Sectors({ sectors, flash }) {
  return sectors.map((s, i) => {
    const a0 = ((-90 + i * 60 - 30) * Math.PI) / 180;
    const a1 = ((-90 + i * 60 + 30) * Math.PI) / 180;
    const r = R0 + 6.6 * STEP;
    const d = `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
    return <path key={s.id} d={d} className={'dc-sg__wedge' + (flash === s.id ? ' is-flash' : '')} style={{ '--hue': s.hue }} />;
  });
}

function SectorLabels({ sectors, total }) {
  return sectors.map((s, i) => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    const r = R0 + 6.95 * STEP + 28;
    return (
      <div key={s.id} className="dc-sg__sector" style={{ left: HALF + r * Math.cos(a), top: HALF + r * Math.sin(a), '--hue': s.hue }}>
        <Icon name={s.icon} size={14} /> <b>{s.name}</b> <small>{s.owned}/{total[s.id]}</small>
      </div>
    );
  });
}

function NodeButton({ n, p, sec, selected, onPick, onHover, onBuy, pop, deny }) {
  const d = SIZE[n.kind];
  const hue = hueOf(n, sec);
  const hue2 = n.kind === 'bridge' ? sec[n.sectors[1]].hue : hue;
  const label = `${n.name} — ${n.kindName}${n.kind === 'repeat' && n.rank ? ' nível ' + n.rank : ''}. ${n.status === 'owned' && n.kind !== 'repeat' ? 'Comprado' : n.cost + ' Insight'}`;
  return (
    <button type="button" className={'dc-sg__node is-' + n.kind + ' is-' + n.status + (n.affordable ? ' is-affordable' : '') + (selected ? ' is-selected' : '') + (n.fresh ? ' is-fresh' : '') + (pop ? ' is-pop' : '') + (deny ? ' is-deny' : '')}
      style={{ left: HALF + p.x, top: HALF + p.y, '--d': d + 'px', '--hue': hue, '--hue2': hue2 }}
      aria-label={label} aria-pressed={selected}
      onClick={() => onPick(n.id)} onDoubleClick={() => onBuy(n)} onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(n.id)} onBlur={() => onHover(null)}>
      <span className="dc-sg__glyph"><Icon name={n.icon} size={Math.round(d * 0.46)} /></span>
      {n.kind === 'repeat' && n.rank > 0 && <span className="dc-sg__rank">{n.rank}</span>}
      {n.affordable && n.status === 'available' && <span className="dc-sg__cost">{n.cost}</span>}
    </button>
  );
}

/** Saldo que anda até o valor novo (e pisca ao gastar). */
function AnimatedNumber({ value }) {
  const [shown, setShown] = React.useState(value);
  const [spend, setSpend] = React.useState(false);
  const from = React.useRef(value);
  React.useEffect(() => {
    const a = from.current;
    if (a === value) return undefined;
    if (value < a) { setSpend(true); setTimeout(() => setSpend(false), 450); }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 450);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <b className={spend ? 'is-spend' : ''}>{shown}</b>;
}

const FX_MS = 1200;
let fxSeq = 0;
/**
 * O "gatilho" da Rede: compara os nós com o snapshot anterior e dispara som e efeito — compra (pop, onda, faíscas,
 * pulso pela ligação, nota subindo em combo), nós recém-abertos (anel + "ting"), paradigma/maestria (tremor),
 * setor completo (fanfarra e brilho), desfazer/reorganizar (descendo).
 */
function useTreeFx(sg, pos, sec, enabled) {
  const prev = React.useRef(null);
  const combo = React.useRef({ n: -1, at: 0 });
  const [fx, setFx] = React.useState([]);
  const [pulses, setPulses] = React.useState([]);
  const [pop, setPop] = React.useState(null);
  const [shake, setShake] = React.useState(false);
  const [comboN, setComboN] = React.useState(0);
  const [spent, setSpent] = React.useState(null);
  const [sectorFlash, setSectorFlash] = React.useState(null);
  const later = (ms, f) => setTimeout(f, ms);
  const add = (list, set) => { set((x) => [...x, ...list]); later(FX_MS, () => set((x) => x.filter((e) => !list.includes(e)))); };
  React.useEffect(() => {
    const before = prev.current;
    prev.current = { nodes: Object.fromEntries(sg.nodes.map((n) => [n.id, { rank: n.rank, status: n.status }])), sectors: Object.fromEntries(sg.sectors.map((s) => [s.id, s.owned])), insight: sg.insight };
    if (!before || !enabled) return;
    const was = (id) => before.nodes[id] || { rank: 0, status: 'locked' };
    const bought = sg.nodes.filter((n) => n.kind !== 'core' && n.rank > was(n.id).rank);
    const undone = sg.nodes.filter((n) => n.rank < was(n.id).rank);
    const opened = sg.nodes.filter((n) => n.status === 'available' && !['available', 'owned'].includes(was(n.id).status));
    if (undone.length > 1) sfx('tree-respec'); else if (undone.length === 1) sfx('tree-undo');
    if (bought.length === 1) {
      const n = bought[0];
      const now = Date.now();
      const c = combo.current;
      c.n = now - c.at < 2600 ? c.n + 1 : 0;
      c.at = now;
      setComboN(c.n);
      const big = n.kind === 'keystone' || n.kind === 'mastery';
      sfx(n.kind === 'mastery' ? 'tree-mastery' : n.kind === 'keystone' ? 'tree-key' : n.kind === 'notable' || n.kind === 'bridge' ? 'tree-notable' : 'tree-buy', c.n);
      const hue = hueOf(n, sec);
      const p = pos[n.id];
      add([{ key: ++fxSeq, kind: big ? 'big' : n.kind === 'notable' || n.kind === 'bridge' ? 'mid' : 'buy', x: p.x, y: p.y, hue, label: n.name }], setFx);
      // Pulso de energia: do vizinho comprado (o mais perto do centro) até o nó novo.
      const from = n.links.map((l) => sg.nodes.find((x) => x.id === l)).concat(sg.nodes.filter((x) => x.links.includes(n.id)))
        .filter((x) => x && (x.kind === 'core' || x.rank > 0) && x.id !== n.id).sort((a, b) => a.ring - b.ring)[0];
      if (from) add([{ key: ++fxSeq, x1: pos[from.id].x, y1: pos[from.id].y, x2: p.x, y2: p.y, hue }], setPulses);
      setPop(n.id); later(650, () => setPop((x) => (x === n.id ? null : x)));
      if (big) { setShake(true); later(450, () => setShake(false)); }
      setSpent({ key: ++fxSeq, v: before.insight - sg.insight }); later(FX_MS, () => setSpent(null));
      if (c.n >= 2) later(2600, () => { if (Date.now() - combo.current.at >= 2500) setComboN(0); });
    }
    if (opened.length && bought.length) {
      later(320, () => {
        sfx('tree-unlock', opened.length);
        add(opened.map((n) => ({ key: ++fxSeq, kind: 'unlock', x: pos[n.id].x, y: pos[n.id].y, hue: hueOf(n, sec) })), setFx);
      });
    }
    const done = sg.sectors.find((s) => s.owned > (before.sectors[s.id] || 0) && s.owned >= sg.nodes.filter((n) => n.sector === s.id && !['mastery', 'repeat'].includes(n.kind)).length - 1);
    if (done) later(500, () => { sfx('tree-sector'); setSectorFlash(done.id); later(1600, () => setSectorFlash(null)); });
  }, [sg.nodes]);
  return { fx, pulses, pop, shake, comboN, spent, sectorFlash };
}

/** Detalhes do nó (sob o mouse ou selecionado) com a compra; sem nó, as regras da rede. */
function Inspector({ n, sg, sec, byId, act }) {
  if (!n) {
    return (
      <div className="dc-sg__rules">
        <div className="dc-sg__title">Como a rede funciona</div>
        <ul>
          <li><Icon name="git-commit-horizontal" size={13} /> <span><b>Caminho:</b> só dá para comprar um nó ligado a outro já comprado. Tudo começa no Núcleo.</span></li>
          <li><Icon name="mouse-pointer-click" size={13} /> <span><b>Clique duplo</b> num nó compra direto.</span></li>
          <li><Icon name="split" size={13} /> <span><b>Paradigmas:</b> cada setor tem dois nós-chave fortes, com um preço. Escolher um fecha o outro.</span></li>
          <li><Icon name="link" size={13} /> <span><b>Sinapses:</b> pontes entre setores vizinhos. Pedem um nó comprado dos dois lados.</span></li>
          <li><Icon name="crown" size={13} /> <span><b>Maestria:</b> o último nó de cada setor pede 7 nós do setor.</span></li>
          <li><Icon name="infinity" size={13} /> <span><b>Infinitos:</b> sobem de nível sem limite, cada vez mais caros.</span></li>
          <li><Icon name="atom" size={13} /> <span><b>Singularity:</b> ao vencer o Pico, o Insight dela entra no saldo. Você distribui na rede e confirma; só então a run recomeça.</span></li>
          <li><Icon name="undo-2" size={13} /> <span><b>Desfazer:</b> durante o planejamento, o que você comprar se desfaz de graça.</span></li>
          <li><Icon name="rotate-ccw" size={13} /> <span><b>Reorganizar:</b> durante o planejamento, desmonta a rede inteira. Devolve só {sg.refundPct}% do que já estava nela.</span></li>
        </ul>
        <div className="dc-sg__title">Setores</div>
        <div className="dc-sg__legend">
          {sg.sectors.map((s) => <span key={s.id} style={{ '--hue': s.hue }}><Icon name={s.icon} size={12} /> <b>{s.name}</b> {s.text}</span>)}
        </div>
      </div>
    );
  }
  const hue = hueOf(n, sec);
  const where = n.kind === 'core' ? 'Centro da rede' : n.kind === 'founder' ? 'Presente de quem joga desde o começo' : n.kind === 'bridge' ? `Entre ${sec[n.sectors[0]].name} e ${sec[n.sectors[1]].name}` : sec[n.sector].name;
  const rival = n.excl && sg.nodes.find((x) => x.excl === n.excl && x.id !== n.id);
  const canBuy = n.affordable;
  const buyText = n.kind === 'repeat' && n.rank > 0 ? `Subir para o nível ${n.rank + 1}` : 'Comprar';
  return (
    <div className="dc-sg__inspect" style={{ '--hue': hue }}>
      <div className="dc-sg__inspect-head">
        <span className={'dc-sg__badge is-' + n.kind}><Icon name={n.icon} size={22} /></span>
        <div>
          <div className="dc-sg__title">{n.name}</div>
          <small>{n.kindName} · {where}</small>
        </div>
      </div>
      <p className="dc-sg__desc">{n.description}</p>
      {n.kind === 'repeat' && <div className="dc-sg__fact"><Icon name="layers" size={12} /> Nível atual: <b>{n.rank}</b> (o efeito vale por nível)</div>}
      {rival && <div className="dc-sg__fact"><Icon name="split" size={12} /> Paradigma: exclui <b>{rival.name}</b></div>}
      {n.needs && <div className="dc-sg__fact"><Icon name="crown" size={12} /> Pede {n.needs} nós de {sec[n.sector].name} (tem {sg.sectors.find((s) => s.id === n.sector).owned})</div>}
      {n.kind === 'bridge' && <div className="dc-sg__fact"><Icon name="link" size={12} /> Ligada a <b>{byId[n.links[0]].name}</b> e <b>{byId[n.links[1]].name}</b></div>}
      {n.kind !== 'core' && (n.status !== 'owned' || n.kind === 'repeat') && (
        <div className="dc-sg__buy">
          <span className="dc-sg__price"><Icon name="sparkles" size={13} /> {n.cost} Insight</span>
          {n.reason ? <span className={'dc-sg__why is-' + n.status}>{n.reason}</span>
            : !canBuy ? <span className="dc-sg__why">Faltam {n.cost - sg.insight} Insight</span> : null}
          <Button variant="primary" icon="plus" disabled={!canBuy} onClick={() => act({ type: 'treeBuy', id: n.id })}>{buyText}</Button>
        </div>
      )}
      {n.kind === 'founder' && <div className="dc-sg__fact is-on"><Icon name="star" size={12} /> Sua: não se compra, não sai ao reorganizar.</div>}
      {n.status === 'owned' && n.kind !== 'repeat' && n.kind !== 'core' && n.kind !== 'founder' && <div className="dc-sg__fact is-on"><Icon name="check" size={12} /> {n.fresh ? "Comprado agora: desfaz de graça até confirmar a Singularity." : "Comprado: vale em todas as runs."}</div>}
      {n.rank > 0 && n.kind !== 'core' && n.kind !== 'founder' && (n.undo != null
        ? <Button variant="ghost" icon="undo-2" onClick={() => act({ type: 'treeUndo', id: n.id })}>Desfazer (devolve {n.undo})</Button>
        : n.fresh > 0 ? <div className="dc-sg__fact"><Icon name="lock" size={12} /> Outros nós dependem deste: desfaça-os antes.</div>
          : sg.planning ? <div className="dc-sg__fact"><Icon name="lock" size={12} /> Comprado antes: só sai reorganizando a rede ({sg.refundPct}%).</div> : null)}
    </div>
  );
}

/** Confirmação da Singularity: de onde vem o Insight, o que recomeça, o que fica e como a próxima run começa. */
function SingularityModal({ sg, onClose, onConfirm }) {
  const spentNow = sg.nodes.reduce((n, x) => n + (x.fresh ? 1 : 0), 0);
  const b = sg.breakdown;
  const st = sg.start;
  const rows = [
    ['crown', `Chefes vencidos nesta run (${sg.run.bosses.length}/3)`, b.bosses],
    ['skull', `Elites vencidas (${sg.run.elites})`, b.elites],
    ['timer', `Rapidez (run de ${b.days.toFixed(1).replace(".", ",")} dias)`, b.speed],
    ['trending-up', 'Profundidade (Compute acumulado na run)', b.depth],
  ];
  const starts = [
    st.compute > 50 && `${formatNum(st.compute)} Compute`,
    st.tier > 1 && `Tier ${st.tier}`,
    st.petLevel > 1 && `DevPets no nível ${st.petLevel}`,
    ...st.gens.map((g) => `${g.n} ${g.name}`),
    ...st.items.map((k) => `${k.n} ${k.name}`),
    ...st.patches.map((p) => `${p.n} Patch ${p.rarity}`),
    st.keep.inventory && 'consumíveis em estoque',
    st.keep.scrap && 'sucata',
    st.keep.mk > 1 && `geradores em Mk ${st.keep.mk === 2 ? 'II' : st.keep.mk}`,
  ].filter(Boolean);
  return (
    <Modal open title="SINGULARITY" icon="atom" onClose={onClose} width={720}
      footer={<><Button variant="ghost" onClick={onClose}>Voltar à rede</Button><Button variant="primary" icon="atom" onClick={onConfirm}>Confirmar a Singularity</Button></>}>
      <div className="dc-sgm">
        <p className="dc-sgm__lead">O pipeline inteiro rodou, da floresta ao topo. A infraestrutura se dobra sobre si mesma e recomeça do zero, com a Rede que você montou{spentNow ? ` (${spentNow} nó${spentNow > 1 ? 's' : ''} novo${spentNow > 1 ? 's' : ''})` : ''}. Sobram <b>{sg.insight} Insight</b> para a próxima.</p>
        <div className="dc-sgm__calc">
          {rows.map(([icon, label, v]) => <div key={label} className="dc-sgm__row"><Icon name={icon} size={13} /><span>{label}</span><b>+{v}</b></div>)}
          {b.founder > 0 && <div className="dc-sgm__row"><Icon name="star" size={13} /><span>Estrela do Fundador</span><b>+{b.founder}</b></div>}
          {b.mult !== 1 && <div className="dc-sgm__row"><Icon name="lightbulb" size={13} /><span>Multiplicador da Rede</span><b>×{b.mult.toFixed(2).replace('.', ',')}</b></div>}
          <div className="dc-sgm__row is-total"><Icon name="sparkles" size={14} /><span>Insight</span><b>+{b.total}</b></div>
        </div>
        <div className="dc-sgm__cols">
          <div>
            <div className="dc-sgm__h is-reset"><Icon name="rotate-ccw" size={13} /> Recomeça</div>
            <ul><li>Compute, geradores, upgrades e combos</li><li>Tiers (voltam conforme o Compute)</li><li>Blueprints, consumíveis e Patches</li><li>Níveis dos DevPets</li><li>O mapa: de volta à Floresta, com um mapa novo</li></ul>
          </div>
          <div>
            <div className="dc-sgm__h is-keep"><Icon name="shield-check" size={13} /> Fica</div>
            <ul><li>DevPets encontrados</li><li>Insight e a Rede da Singularity</li><li>Núcleo: +10% de produção por Singularity</li><li>Descobertas, visuais, bestiário e missões</li></ul>
          </div>
        </div>
        <div className="dc-sgm__start">
          <Icon name="rocket" size={13} /> <b>A próxima run começa com:</b> {starts.length ? starts.join(' · ') : 'nada além do básico. Os nós de Arquivo mudam isso.'}
          {st.cleanSlate && <span className="dc-chip">Clean Slate: sem bônus de início</span>}
        </div>
        <p className="dc-sgm__note">Depois de confirmar, as compras na Rede ficam: só a próxima Singularity reabre o planejamento.</p>
      </div>
    </Modal>
  );
}

export function SingularityPanel({ snap, act }) {
  const sg = snap.singularity;
  const sec = Object.fromEntries(sg.sectors.map((s) => [s.id, s]));
  const byId = Object.fromEntries(sg.nodes.map((n) => [n.id, n]));
  const pos = React.useMemo(() => layout(sg.nodes, sg.sectors), [sg.nodes.length]);
  const total = React.useMemo(() => Object.fromEntries(sg.sectors.map((s) => [s.id, sg.nodes.filter((n) => n.sector === s.id && n.kind !== 'mastery' && n.kind !== 'repeat').length - 1])), [sg.nodes.length]);
  const stage = React.useRef(null);
  const pz = usePanZoom(stage);
  const [selected, setSelected] = React.useState(null);
  const [hover, setHover] = React.useState(null);
  const [confirm, setConfirm] = React.useState(false);
  const [phase, setPhase] = React.useState(null); // collapse (a rede cai no Núcleo) → flash (clarão) → null
  const shown = byId[hover] || byId[selected] || null;
  const juice = useTreeFx(sg, pos, sec, !phase);
  const [deny, setDeny] = React.useState(null);
  /** Clique duplo: compra direto (ou balança e avisa, se não dá). */
  const quickBuy = (n) => {
    if (n.affordable) { act({ type: 'treeBuy', id: n.id }); return; }
    if (n.kind === 'core' || (n.status === 'owned' && n.kind !== 'repeat')) return;
    sfx('tree-deny'); setDeny(n.id); setTimeout(() => setDeny(null), 420);
  };
  // Confirmar: a constelação colapsa no Núcleo; no auge, o reset acontece; o clarão revela a run nova.
  const doIt = async () => {
    setConfirm(false);
    setSelected(null); setHover(null);
    setPhase('collapse');
    await new Promise((r) => setTimeout(r, 1400));
    const r = await act({ type: 'singularity' });
    if (r.error) { setPhase(null); return; }
    setPhase('flash');
    pz.fit();
    setTimeout(() => setPhase(null), 2600);
  };
  const bosses = ['localhost', 'staging', 'production'];
  return (
    <div className="dc-sg">
      <header className="dc-sg__head">
        <div className="dc-sg__wallet">
          <span className="dc-sg__insight"><Icon name="sparkles" size={18} /> <AnimatedNumber value={sg.insight} /> Insight
            {juice.spent && juice.spent.v > 0 && <span key={juice.spent.key} className="dc-sg__spent">−{juice.spent.v}</span>}
            {juice.comboN >= 2 && <span key={'c' + juice.comboN} className="dc-sg__combo">COMBO ×{juice.comboN + 1}</span>}
          </span>
          <small>{sg.count ? `${sg.count} Singularit${sg.count > 1 ? 'ies' : 'y'} · Núcleo +${sg.corePct}% de produção · ${sg.earned} ganho no total` : 'Nenhuma Singularity ainda'}</small>
        </div>
        <div className="dc-sg__goal">
          {sg.planning ? (
            <>
              <span>Você venceu o pipeline inteiro: <b>+{sg.breakdown.total} Insight</b> desta Singularity já estão no saldo.</span>
              {sg.nodes.some((n) => n.fresh) && <Button variant="ghost" icon="eraser" onClick={() => act({ type: 'singularityCancel' })}>Limpar escolhas</Button>}
              <Button variant="primary" icon="atom" onClick={() => setConfirm(true)}>Confirmar a Singularity</Button>
            </>
          ) : sg.ready ? (
            <>
              <span>Você venceu o pipeline inteiro. A Singularity renderia <b>+{sg.breakdown.total} Insight</b>.</span>
              <Button variant="primary" icon="atom" onClick={() => act({ type: 'singularityPlan' })}>Preparar a Singularity</Button>
            </>
          ) : (
            <>
              <span className="dc-sg__steps" aria-label="Chefes vencidos nesta run">
                {bosses.map((id, i) => <i key={id} className={sg.run.bosses.includes(id) ? 'is-on' : ''} title={['Floresta Localhost', 'Pântano Staging', 'Pico Production'][i]}><Icon name="crown" size={12} /></i>)}
              </span>
              <span>A Singularity libera ao vencer o chefe de <b>{sg.lastArea.name}</b> ({sg.run.bosses.length}/3 chefes nesta run).</span>
            </>
          )}
          {sg.planning && sg.spent > 0 && <Button variant="secondary" icon="rotate-ccw" onClick={() => act({ type: 'treeRespec' })}
            title={`Desmonta a rede inteira: devolve 100% do que foi comprado nesta janela e ${sg.refundPct}% do resto`}>Reorganizar (devolve {sg.refund} de {sg.spent})</Button>}
        </div>
      </header>
      {sg.planning && <div className="dc-sg__respec"><Icon name="atom" size={13} /> Distribua o Insight na Rede e confirme: a run recomeça já com ela. O que você comprar agora se desfaz de graça; reorganizar devolve {sg.refundPct}% do que já estava. Multiplicadores de Insight comprados agora valem a partir da próxima Singularity.</div>}
      {!snap.map.unlocked && sg.count > 0 && <div className="dc-sg__respec is-map"><Icon name="map" size={13} /> Run nova: o mapa volta no {snap.map.requirement}{snap.tier.next && snap.tier.next.id === 2 ? ` (${formatNum(snap.tier.next.at)} de Compute acumulado)` : ""}, numa Floresta nova. Até lá, cresça a produção nas abas Generators e Upgrades.</div>}
      <div className="dc-sg__body">
        <div className={'dc-sg__stage' + (phase === 'collapse' ? ' is-collapsing' : '') + (juice.shake ? ' is-shake' : '')} ref={stage} {...pz.handlers}>
          <div className="dc-sg__collapse">
          {pz.view && (
            <div className="dc-sg__world" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})` }}>
              <svg className="dc-sg__lines" width={HALF * 2} height={HALF * 2} viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`} aria-hidden="true">
                <Sectors sectors={sg.sectors} flash={juice.sectorFlash} />
                {[1, 2, 3, 4, 5, 6, 7].map((r) => <circle key={r} r={R0 + (r - 1) * STEP} className="dc-sg__orbit" />)}
                <Edges nodes={sg.nodes} pos={pos} sec={sec} byId={byId} />
                {juice.pulses.map((l) => <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="dc-sg__pulse" style={{ '--hue': l.hue, '--len': Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }} />)}
              </svg>
              <SectorLabels sectors={sg.sectors} total={total} />
              {sg.nodes.map((n) => <NodeButton key={n.id} n={n} p={pos[n.id]} sec={sec} selected={selected === n.id} onPick={(id) => setSelected(selected === id ? null : id)} onHover={setHover}
                onBuy={quickBuy} pop={juice.pop === n.id} deny={deny === n.id} />)}
              {juice.fx.map((f) => (
                <span key={f.key} className={'dc-sg__fx is-' + f.kind} style={{ left: HALF + f.x, top: HALF + f.y, '--hue': f.hue }} aria-hidden="true">
                  <i className="dc-sg__ring" /><i className="dc-sg__ring is-2" />
                  {f.kind !== 'unlock' && Array.from({ length: f.kind === 'big' ? 16 : 10 }, (_, i) => <i key={i} className="dc-sg__spark" style={{ '--a': (i * 360) / (f.kind === 'big' ? 16 : 10) + 'deg' }} />)}
                  {f.label && <b className="dc-sg__float">{f.label}</b>}
                </span>
              ))}
            </div>
          )}
          </div>
          <div className="dc-sg__tools">
            <button type="button" onClick={pz.zoomIn} aria-label="Aproximar"><Icon name="zoom-in" size={14} /></button>
            <button type="button" onClick={pz.zoomOut} aria-label="Afastar"><Icon name="zoom-out" size={14} /></button>
            <button type="button" onClick={pz.fit} aria-label="Ver a rede inteira"><Icon name="maximize" size={14} /></button>
          </div>
        </div>
        <aside className="dc-sg__side" aria-live="polite">
          <Inspector n={shown} sg={sg} sec={sec} byId={byId} act={act} />
        </aside>
      </div>
      {confirm && <SingularityModal sg={sg} onClose={() => setConfirm(false)} onConfirm={doIt} />}
      {phase === 'flash' && <div className="dc-sg__flash" aria-hidden="true"><span>SINGULARITY</span></div>}
    </div>
  );
}
