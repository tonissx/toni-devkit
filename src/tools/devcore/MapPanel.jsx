import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';
import { Campfire, ShopStall } from './ForestArt.jsx';
import { InfoCard } from './InfoCard.jsx';
import { Arena, SoundToggle } from './Arena.jsx';
import { ForestProps } from './ForestArt.jsx';

const { Button, Icon, ProgressBar, Modal } = DS;
const pct = (v) => Math.round(v * 100) + '%';
const COMBAT = ['battle', 'elite', 'boss'];
const CHANCE_CLASS = { 'favorável': 'is-good', 'arriscado': 'is-risky', 'muito arriscado': 'is-bad' };
/** Presságio da luta: a chance de vitória (prevista pelo engine) vira uma frase vaga — o número fica escondido. */
const OMENS = [
  [0.9, 'eye', 'Os bugs hesitam. A floresta parece estar do seu lado.'],
  [0.7, 'wind', 'Os ventos do deploy sopram a seu favor.'],
  [0.5, 'scroll-text', 'Os logs não dizem nada com certeza.'],
  [0.3, 'triangle-alert', 'Um aviso amarelo pisca entre as árvores.'],
  [0.1, 'skull', 'O stack trace já sussurra o nome do seu esquadrão.'],
  [0, 'flame', 'Nenhum teste passaria nesta build.'],
];
const omenOf = (chance) => OMENS.find(([min]) => chance >= min);

/** Sprite de um pet (cores do visual escolhido); pet que o jogador ainda não tem aparece como silhueta. */
function Pet({ snap, id, size = 40 }) {
  const p = snap.pets.find((x) => x.id === id);
  if (!p) return null;
  if (!p.owned) return <PetSprite id={p.id} size={size} locked className="is-static" />;
  return <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={size} className="is-static" />;
}

/** Linha de inimigo: sprite, nome, atributos e traços (com o counter e se o esquadrão salvo anula). */
function EnemyRow({ e, compact = false }) {
  return (
    <div className="dc-enemy">
      <VillainSprite id={e.sprite} color={e.color} size={compact ? 26 : 40} />
      <div className="dc-row__main">
        <div className="dc-enemy__name">{e.name}{e.boss && <span className="dc-chip is-boss">chefe</span>}</div>
        {!compact && <div className="dc-enemy__stats">♥ {formatNum(e.hp)} · ⚔ {formatNum(e.atk)} · ⛨ {formatNum(e.def)}</div>}
        {e.traits.map((t) => (
          <div key={t.id} className={'dc-trait' + (t.countered ? ' is-countered' : '')}>
            <Icon name={t.countered ? 'shield-check' : 'triangle-alert'} size={11} /> <b>{t.name}</b>: {t.text}
            {!compact && <span className="dc-trait__counter"> — {t.countered ? 'anulado pelo esquadrão' : t.counterText}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cartão de detalhes de um ponto do mapa (hover). */
function NodeDetails({ n }) {
  return (
    <>
      <div className="dc-info__title"><Icon name={n.icon} size={12} /> {n.typeName}{n.shortcut ? ' · atalho' : ''}</div>
      {n.cost > 0 && <div className="dc-info__row"><span>Custo</span><b>{formatNum(n.cost)} Compute</b></div>}
      {n.attempts > 0 && <div className="dc-info__row"><span>Tentativas</span><b>{n.attempts}</b></div>}
      {n.enemies && n.enemies.map((e, i) => <EnemyRow key={i} e={e} compact />)}
      <p className="dc-info__text">{n.reward}{n.shortcut ? '. Vencendo, dá para pular uma coluna.' : ''}</p>
    </>
  );
}

/** Hash inteiro estável (curvatura de cada trilha). */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Tabuleiro vertical (estilo Inscryption): começo perto da câmera (embaixo), chefe ao fundo (em cima).
const ROW_H = 82;       // distância entre colunas do mapa (que viram linhas, de baixo para cima)
const LANE_W = 150;     // distância entre trilhas (lado a lado, centralizadas)
const PAD_TOP = 70;
const PAD_BOTTOM = 110; // espaço do esquadrão antes da primeira linha
const PAD_TEASE = 270;  // com uma próxima área: faixa extra no topo, atrás do chefe, onde ela começa a aparecer
const padTop = (map) => (map.next ? PAD_TEASE : PAD_TOP);
const boardH = (map) => padTop(map) + (map.area.columns + 1) * ROW_H + PAD_BOTTOM;
const BOARD_H = 400;    // altura de referência para decorações antigas (não usada no tabuleiro vertical)

/**
 * A próxima área espiando atrás do chefe: uma cortina de névoa sombria, em pé, logo atrás do chefe (no 3D, tudo o que
 * fica atrás dela some). A silhueta do próximo chefe fica no horizonte (ver TeaseBeast).
 */
function BoardTease({ map, w, line }) {
  return (
    <>
      <div className={'dc-board__tease is-' + map.next.arena} style={{ height: line + 60 }} aria-hidden="true" />
      <span className="dc-prop is-upright is-anchored dc-tease__fog" style={{ left: w / 2, top: line, width: w + 80, zIndex: Math.round(line) }} aria-hidden="true" />
    </>
  );
}

/**
 * Silhueta do próximo chefe no horizonte: centralizada, no limite do fundo do tabuleiro, saindo da névoa. Fica fora da
 * mesa 3D (senão a cortina de névoa a esconderia). As duas cabeças lado a lado, voltadas para fora, mexendo só um pouco.
 */
function TeaseBeast({ next, edge, cx }) {
  if (next.arena !== 'staging') return null;
  return (
    <div className="dc-tease__horizon" style={{ top: edge + 30, left: cx }} aria-hidden="true" title={'Algo espreita além do chefe: ' + next.name}>
      <span className="dc-tease__head is-left"><VillainSprite id="hydra-feature" color="#07060B" size={128} /></span>
      <span className="dc-tease__head is-right"><VillainSprite id="hydra-main" color="#07060B" size={136} /></span>
    </div>
  );
}

/** Objetos 3D da área espalhados pelo tabuleiro (decoração; ver docs §4.5). spots: lugares livres entre as trilhas. */
function AreaProps({ arena, w, h, spots, tease = 0 }) {
  if (arena === 'localhost') return <ForestProps w={w} h={h} spots={spots} />;
  if (arena === 'staging') return <ForestProps w={w} h={h} spots={spots} fireflies={false} wisps="all" />;
  return null;
}

/** Curva de uma trilha a→b: ponto de controle no meio, deslocado na perpendicular (estável por trilha). */
function trailCurve(x1, y1, x2, y2, key, shortcut) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const bend = ((hashStr(key) % 7) - 3) * 7 + (shortcut ? 26 : 0);
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2 - ((y2 - y1) / len) * bend, cy: (y1 + y2) / 2 + ((x2 - x1) / len) * bend };
}
/** Ponto da curva em t (Bézier quadrática). */
const onCurve = (k, t) => ({ x: (1 - t) ** 2 * k.x1 + 2 * (1 - t) * t * k.cx + t * t * k.x2, y: (1 - t) ** 2 * k.y1 + 2 * (1 - t) * t * k.cy + t * t * k.y2 });
const WALK_MS = 1500;

/**
 * Esquadrão no tabuleiro: em pé ao lado do ponto atual; ao avançar, anda pela trilha curva até o ponto novo.
 * hold: segura a caminhada (a arena está aberta) — ela acontece quando a arena fecha.
 */
function Party({ map, party, hold, place, geom }) {
  const [shown, setShown] = React.useState(map.at);   // ponto onde o esquadrão está desenhado
  const [pos, setPos] = React.useState(() => place(map.at));
  const [walking, setWalking] = React.useState(false);
  React.useEffect(() => {
    if (hold) return undefined;
    if (shown === map.at) { setPos(place(map.at)); return undefined; }
    const k = geom(shown, map.at);
    const t0 = performance.now();
    let raf = 0;
    setWalking(true);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / WALK_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out
      setPos(onCurve(k, e));
      if (t < 1) raf = requestAnimationFrame(frame);
      else { setWalking(false); setShown(map.at); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [map.at, hold, shown, place]);
  if (!party.length) return null;
  return (
    <div className={'dc-party' + (walking ? ' is-walking' : '')} style={{ left: pos.x, top: pos.y }} aria-hidden="true">
      {party.map((p, i) => (
        <React.Fragment key={p.id}>
        <span className="dc-party__shadow" style={{ left: (i - (party.length - 1) / 2) * 34 }} />
        <span className="dc-party__pet" style={{ '--i': i, left: (i - (party.length - 1) / 2) * 34 }}>
          <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={44} className="is-static" />
        </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Miniaturas dos inimigos em pé atrás do ponto (como as dos pets): só nos pontos alcançáveis (a próxima escolha) e no
 * chefe, sempre visível no topo até ser derrotado. O resto do mapa fica só com o ícone; o detalhe segue no cartão.
 */
function Foes({ n, x, y, target = false }) {
  const boss = n.type === 'boss';
  const size = boss ? 106 : n.type === 'elite' ? 47 : 32; // elite 30% maior que antes (36)
  const gap = boss ? 40 : n.type === 'elite' ? 31 : 24;
  return (
    <div className={'dc-foes' + (boss ? ' is-boss' : '') + (target ? ' is-target' : '')} style={{ left: x, top: y - (boss ? 34 : 24) }}>
      {n.enemies.map((e, i) => {
        const dx = (i - (n.enemies.length - 1) / 2) * gap;
        return (
          <React.Fragment key={i}>
            <span className="dc-foes__shadow" style={{ left: dx, width: size * 0.8 }} />
            <span className="dc-foes__foe" style={{ left: dx, '--i': i }}>
              <InfoCard content={<EnemyRow e={e} />} label={e.name} focusable={false} className="dc-foes__hit"><VillainSprite id={e.sprite} color={e.color} size={size} /></InfoCard>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** Marcos do mapa em pé atrás do ponto: fogueira com café no descanso, barraca na loja (sempre visíveis). */
function Landmark({ n, x, y }) {
  const fire = n.type === 'rest';
  return (
    <div className={'dc-landmark' + (fire ? ' is-fire' : '') + (n.status === 'visited' ? ' is-visited' : '')} style={{ left: x, top: y - 24 }} aria-hidden="true">
      <span className="dc-landmark__shadow" />
      <span className="dc-landmark__art">{fire ? <Campfire s={0.8} /> : <ShopStall s={0.68} />}</span>
    </div>
  );
}

function MapGrid({ map, onNode, party = [], hold = false, selected = null }) {
  const waiting = !!(map.pending && map.pending.kind !== 'shop'); // escolha pendente no ponto atual
  const ref = React.useRef(null);
  const boxRef = React.useRef(null);
  const [w, setW] = React.useState(900);
  const [lift, setLift] = React.useState(0); // vazio que a inclinação deixa no topo (o tabuleiro sobe essa medida)
  const [edge, setEdge] = React.useState(0); // topo visível da mesa inclinada, no contêiner (o horizonte do tabuleiro)
  const [cx, setCx] = React.useState(0);     // centro da mesa, no contêiner
  const HEADROOM = map.next ? 110 : 0;       // com a próxima área espiando: espaço acima da borda para a silhueta
  React.useLayoutEffect(() => {
    if (!ref.current) return undefined;
    setW(ref.current.offsetWidth);
    const ro = new ResizeObserver(() => ref.current && setW(ref.current.offsetWidth));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  React.useLayoutEffect(() => {
    if (!ref.current || !boxRef.current) return;
    // Distância do topo do contêiner até o topo visível da mesa inclinada (não muda quando o contêiner sobe).
    const gap = Math.max(0, Math.round(ref.current.getBoundingClientRect().top - boxRef.current.getBoundingClientRect().top) - 8);
    const want = Math.max(0, gap - HEADROOM);
    if (Math.abs(want - lift) > 2) setLift(want);
    if (Math.abs(gap + 8 - edge) > 2) setEdge(gap + 8);
    const t = ref.current.getBoundingClientRect();
    const mid = Math.round(t.left + t.width / 2 - boxRef.current.getBoundingClientRect().left);
    if (Math.abs(mid - cx) > 2) setCx(mid);
  }, [w, HEADROOM]);
  const H = boardH(map);
  // Onde a próxima área começa (topo do tabuleiro, atrás do chefe): abaixo desta linha é a área atual.
  const teaseLine = map.next ? padTop(map) - 20 : 0;
  const lanes = map.area.lanes;
  // Coluna do mapa → altura no tabuleiro (de baixo para cima); trilha → posição lateral, centralizada.
  const x = (n) => w / 2 + (n.lane - (lanes - 1) / 2) * LANE_W;
  const y = (n) => H - PAD_BOTTOM - (n.col + 0.5) * ROW_H;
  const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
  // O esquadrão fica um pouco à frente do ponto (mais perto da câmera); antes de começar, embaixo, no centro.
  const start = { x: w / 2, y: H - PAD_BOTTOM + ROW_H * 0.45 };
  const nodeAt = (id) => (id == null ? null : byId[id]);
  const place = React.useCallback((id) => { const n = nodeAt(id); return n ? { x: x(n), y: y(n) + 30 } : start; }, [w, map.at]);
  const geom = (from, to) => {
    const a = nodeAt(from);
    const b = nodeAt(to);
    const p0 = a ? { x: x(a), y: y(a) + 30 } : start;
    const k = trailCurve(p0.x, p0.y, x(b), y(b) + 30, (a ? a.id : 'start') + '>' + b.id, a && a.shortcut === b.id);
    return k;
  };
  const paths = [];
  for (const n of map.nodes) {
    for (const id of [...n.next, ...(n.shortcut ? [n.shortcut] : [])]) {
      const t = byId[id];
      const walked = (n.status === 'visited' || n.status === 'current') && (t.status === 'visited' || t.status === 'current');
      const open = n.status === 'current' && t.status === 'reachable';
      // Curva: ponto de controle no meio, deslocado na perpendicular (sinal e tamanho estáveis por trilha).
      const k = trailCurve(x(n), y(n), x(t), y(t), n.id + '>' + id, id === n.shortcut);
      paths.push({ key: n.id + '>' + id, k, d: `M${k.x1} ${k.y1} Q${k.cx} ${k.cy} ${k.x2} ${k.y2}`, cls: (walked ? ' is-walked' : open ? ' is-open' : '') + (id === n.shortcut ? ' is-shortcut' : '') });
    }
  }
  // Floresta densa: uma árvore em cada ponto de uma grade (com variação) longe dos pontos e das trilhas.
  // Calculada uma vez por largura e traçado (o painel redesenha a cada meio segundo).
  const layoutKey = w + ':' + map.area.id + ':' + map.nodes.map((n) => n.id + n.next.join(',')).join('|');
  const spots = React.useMemo(() => {
    const avoid = [];
    for (const n of map.nodes) avoid.push({ x: x(n), y: y(n) + 18, r: n.type === 'boss' ? 70 : 54 });
    for (const p of paths) for (let i = 0; i <= 12; i++) { const q = onCurve(p.k, i / 12); avoid.push({ x: q.x, y: q.y, r: 26 }); }
    avoid.push({ x: start.x, y: start.y, r: 60 });
    const out = [];
    const step = 50;
    for (let gy = 18; gy < H - 4; gy += step * 0.8) {
      for (let gx = 10; gx < w - 4; gx += step) {
        const id = gx + ':' + gy;
        const h = hashStr(id);
        const px = gx + ((h % 17) - 8) + ((Math.floor(gy / (step * 0.8)) % 2) * step) / 2;
        const py = gy + (((h >>> 5) % 13) - 6);
        if (avoid.some((a) => (a.x - px) ** 2 + (a.y - py) ** 2 < a.r * a.r)) continue;
        // Mais rala nos cantos: a chance de pular cresce com a distância do centro (cantos ~ metade).
        const e = Math.hypot((px - w / 2) / (w / 2), (py - H / 2) / (H / 2));
        if (((h >>> 12) % 100) / 100 < Math.min(0.55, Math.max(0, (e - 0.7) * 0.8))) continue;
        // Zona: o Pântano inteiro; na Floresta, a faixa do topo vai virando pântano (transição suave).
        const swampOdds = map.area.arena === 'staging' ? 1 : map.next ? Math.min(1, Math.max(0, (teaseLine - py) / 110 + 0.5)) : 0;
        const zone = ((h >>> 9) % 100) / 100 < swampOdds ? 'swamp' : 'forest';
        if (zone === 'swamp' && ((h >>> 14) % 100) < 30) continue; // pântano: mais água aberta, menos mato
        out.push({ id, x: px, y: py, h, zone });
      }
    }
    return out;
  }, [layoutKey]);
  return (
    <div ref={boxRef} className="dc-board" role="group" aria-label={'Mapa ' + map.area.name} style={{ marginTop: -lift }}>
      {map.next && edge > 0 && <TeaseBeast next={map.next} edge={edge} cx={cx} />}
      <div ref={ref} className={'dc-board__table dc-board--' + map.area.arena} style={{ height: H }}>
        <div className="dc-board__mat" />
        {map.next && <BoardTease map={map} w={w} line={teaseLine} />}
        <svg className="dc-board__paths" width={w} height={H} aria-hidden="true">
          {paths.map((p) => <path key={p.key} className={'dc-trail' + p.cls} d={p.d} />)}
        </svg>
        {map.nodes.map((n) => (
          <span key={n.id} className={'dc-map__slot' + (n.type === 'boss' ? ' is-boss' : '')} style={{ left: x(n), top: y(n) }}>
            <InfoCard content={<NodeDetails n={n} />} focusable={false}>
              <button type="button" className={'dc-node is-' + n.type + ' is-' + n.status + (n.status === 'reachable' && !n.affordable ? ' is-poor' : '') + (n.id === selected ? ' is-selected' : '') + (waiting && n.status === 'current' ? ' is-waiting' : '')}
                aria-disabled={n.status !== 'reachable' && !(waiting && n.status === 'current')} onClick={() => (n.status === 'reachable' || (waiting && n.status === 'current')) && onNode(n)}
                aria-label={`${n.typeName}, coluna ${n.col + 1}${n.cost ? ', ' + formatNum(n.cost) + ' Compute' : ''}`}>
                <Icon name={n.icon} size={n.type === 'boss' ? 30 : 22} />
              </button>
            </InfoCard>
          </span>
        ))}
        <AreaProps arena={map.area.arena} w={w} h={H} spots={spots} tease={teaseLine} />
        {map.nodes.filter((n) => n.type === 'rest' || n.type === 'shop').map((n) => <Landmark key={n.id} n={n} x={x(n)} y={y(n)} />)}
        {map.nodes.filter((n) => n.enemies && (n.type === 'boss' ? !map.cleared && n.status !== 'visited' : n.status === 'reachable')).map((n) => <Foes key={n.id} n={n} x={x(n)} y={y(n)} target={n.id === selected} />)}
        <Party map={map} party={party} hold={hold} place={place} geom={geom} />
      </div>
    </div>
  );
}

/** Evento, descanso ou loja em que o jogador está. */
function PendingPanel({ map, snap, act, open = true, setOpen = () => {} }) {
  const p = map.pending;
  if (p.kind === 'shop') {
    return (
      <section className="dc-mapbox">
        <div className="dc-mapbox__head"><Icon name="store" size={14} /> <b>Loja</b><span>Compre o que quiser e siga pelo mapa quando terminar.</span></div>
        <div className="dc-shop">
          {p.offers.map((o) => (
            <div key={o.index} className={'dc-shop__item' + (o.bought ? ' is-bought' : '')}>
              <Icon name={o.icon} size={16} />
              <span>{o.name}</span>
              {o.bought ? <span className="dc-chip is-ok"><Icon name="check" size={11} />comprado</span>
                : <Button size="sm" variant={o.affordable && !o.full ? 'primary' : 'secondary'} disabled={!o.affordable || o.full} onClick={() => act({ type: 'mapBuy', offer: o.index })}>{o.full ? 'Estoque cheio' : formatNum(o.price)}</Button>}
            </div>
          ))}
        </div>
      </section>
    );
  }
  return <DecisionModal p={p} snap={snap} act={act} open={open} setOpen={setOpen} />;
}

/** Ilustração de cada tipo de recompensa (cena em gradiente com um ícone grande). */
const CHOICE_ART = {
  patch: { icon: 'puzzle', hue: '#7CF5B0', deco: 'sparkles' },
  swapPatch: { icon: 'repeat', hue: '#8EC5FF', deco: 'sparkles' },
  item: { icon: 'flask-conical', hue: '#FFD27A', deco: 'package' },
  part: { icon: 'cog', hue: '#C9A227', deco: 'wrench' },
  petLevel: { icon: 'trending-up', hue: '#B98CFF', deco: 'star' },
  battleBuff: { icon: 'swords', hue: '#FF9F7A', deco: 'flame' },
  restock: { icon: 'package-plus', hue: '#FFD27A', deco: 'boxes' },
  healAll: { icon: 'heart-pulse', hue: '#FF7B9C', deco: 'sparkles' },
  skip: { icon: 'footprints', hue: '#9AA3B2', deco: 'trees' },
};
const RARITY_NAME = { common: 'comum', rare: 'raro', epic: 'épico' };
/** Tipo e frase curta do que a escolha dá. */
function choiceInfo(ch) {
  const r = ch.reward;
  if (!r) return { art: 'skip', gives: 'Nada muda. O caminho segue pela floresta.' };
  if (r.patch) return { art: 'patch', gives: `Ganha um Patch ${RARITY_NAME[r.patch] || r.patch}.` };
  if (r.swapPatch) return { art: 'swapPatch', gives: `Um Patch comum vira ${RARITY_NAME[r.swapPatch] || r.swapPatch}.` };
  if (r.item) return { art: 'item', gives: 'Ganha um consumível.' };
  if (r.part) return { art: 'part', gives: 'Ganha uma peça de gerador.' };
  if (r.petLevel) return { art: 'petLevel', gives: 'O DevPet de menor nível do esquadrão sobe 1 nível.' };
  if (r.battleBuff) return { art: 'battleBuff', gives: `Esquadrão +${Math.round(r.battleBuff.atk * 100)}% de ataque na próxima batalha.` };
  if (r.restock) return { art: 'restock', gives: '+1 de cada consumível (até o teto).' };
  if (r.healAll) return { art: 'healAll', gives: 'Todo o time volta com a vida cheia.' };
  return { art: 'skip', gives: '' };
}

/** Ponto de decisão (evento ou descanso): modal com um card ilustrado por escolha. Fechar só adia — a escolha espera no mapa. */
function DecisionModal({ p, snap, act, open, setOpen }) {
  const finder = p.finder && snap.pets.find((x) => x.id === p.finder);
  if (!open) {
    return (
      <div className="dc-mapbox dc-decision__later">
        <Icon name={p.kind === 'rest' ? 'coffee' : 'circle-help'} size={14} /> <b>{p.title}</b><span>Uma escolha espera por você.</span>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Decidir</Button>
      </div>
    );
  }
  return (
    <Modal open title={p.title.toUpperCase()} icon={p.kind === 'rest' ? 'coffee' : 'circle-help'} onClose={() => setOpen(false)} width={p.choices.length > 2 ? 760 : 620}>
      <div className="dc-decision">
        {(p.text || finder) && (
          <div className="dc-decision__story">
            {finder && <Pet snap={snap} id={p.finder} size={44} />}
            <p>{finder && <b>{finder.name} encontrou algo. </b>}{p.text || 'Uma pausa ao lado da fogueira. Escolha como o esquadrão aproveita.'}</p>
          </div>
        )}
        {!p.text && !finder && <p className="dc-decision__story">Uma pausa ao lado da fogueira. Escolha como o esquadrão aproveita.</p>}
        <div className={'dc-decision__cards' + (p.choices.length > 2 ? ' is-many' : '')}>
          {p.choices.map((ch) => {
            const info = choiceInfo(ch);
            const art = CHOICE_ART[info.art];
            const [title, rest] = ch.text.includes(':') ? ch.text.split(/:\s*/, 2) : [ch.text, null];
            return (
              <button key={ch.index} type="button" className={'dc-choice is-' + info.art} disabled={ch.disabled} style={{ '--hue': art.hue }}
                onClick={() => act({ type: 'mapChoose', index: ch.index })}>
                <span className="dc-choice__art" aria-hidden="true">
                  <Icon name={art.deco} size={18} className="dc-choice__deco is-a" />
                  <Icon name={art.deco} size={13} className="dc-choice__deco is-b" />
                  <Icon name={art.icon} size={44} className="dc-choice__icon" />
                </span>
                <span className="dc-choice__body">
                  <b>{title}</b>
                  <span>{rest ? rest.charAt(0).toUpperCase() + rest.slice(1) + '.' : info.gives}</span>
                  {ch.cost > 0 && <small className="dc-choice__cost"><Icon name="cpu" size={11} /> {formatNum(ch.cost)} Compute</small>}
                  {ch.disabled && <small className="dc-choice__why">{ch.cost > 0 ? 'Compute insuficiente' : 'Requisito não atendido'}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/** Texto de um bônus de slot: "+15% defesa · +2 velocidade". */
function bonusText(b) {
  const parts = [];
  if (b.atk) parts.push(`+${Math.round(b.atk * 100)}% ataque`);
  if (b.def) parts.push(`+${Math.round(b.def * 100)}% defesa`);
  if (b.hp) parts.push(`+${Math.round(b.hp * 100)}% vida`);
  if (b.spd) parts.push(`+${b.spd} velocidade`);
  if (b.heal) parts.push(`cura +${Math.round(b.heal * 100)}%`);
  return parts.join(' · ');
}
const ROLE_NAMES = { tank: 'Tanque', attacker: 'Atacante', support: 'Suporte', speed: 'Velocidade' };
const SLOT_ORDER = ['rear', 'center', 'vanguard'];   // na tela, como na arena: retaguarda → vanguarda → inimigos
const SLOT_PREF = { vanguard: ['tank', 'attacker', 'speed', 'support'], center: ['attacker', 'speed', 'tank', 'support'], rear: ['support', 'speed', 'attacker', 'tank'] };

/** Preparação da batalha nas laterais do mapa: elenco (esquerda); slots, gatilhos, consumíveis, previsão e custo (direita). */
function PrepPanel({ map, snap, node, act, onCancel }) {
  const saved = map.squad;
  const roster = map.roster;
  const role = (id) => (roster.find((p) => p.id === id) || {}).role;
  const isDown = (id) => (roster.find((p) => p.id === id) || {}).down;
  const initial = () => {
    const items = saved.items.filter((id) => (map.items.find((k) => k.id === id) || {}).n > 0);
    if (saved.valid && saved.pets.length) return { slots: { ...saved.slots }, triggers: saved.triggers, items };
    // Sugestão inicial: os melhores disponíveis, cada um no slot do seu papel.
    const best = roster.filter((p) => !p.down).sort((x, y) => y.level * y.life - x.level * x.life || y.atk - x.atk).slice(0, 3).map((p) => p.id);
    const slots = { vanguard: null, center: null, rear: null };
    for (const sl of ['vanguard', 'center', 'rear']) {
      const pick = SLOT_PREF[sl].map((r) => best.find((id) => role(id) === r && !Object.values(slots).includes(id))).find(Boolean);
      slots[sl] = pick || null;
    }
    for (const id of best) if (!Object.values(slots).includes(id)) { const free = ['vanguard', 'center', 'rear'].find((x) => !slots[x]); if (free) slots[free] = id; }
    return { slots, triggers: {}, items: [] };
  };
  const [sq, setSq] = React.useState(initial);
  const [picked, setPicked] = React.useState(null);  // slot selecionado (alternativa ao arrastar: clique no slot e depois no pet)
  const [over, setOver] = React.useState(null);      // slot sob o arraste
  const placed = Object.values(sq.slots).filter(Boolean);
  // Cada mudança salva a preparação: a view devolve a previsão e quais traços o esquadrão anula.
  React.useEffect(() => { if (placed.length) act({ type: 'mapSquad', squad: sq, node: node.id }); }, [JSON.stringify(sq), node.id]);
  const set = (patch) => setSq((s) => ({ ...s, ...patch }));
  const slotOf = (id) => Object.keys(sq.slots).find((k) => sq.slots[k] === id) || null;

  /** Põe um pet num slot: sai do slot antigo; quem estava no destino troca de lugar (ou volta ao elenco). */
  const place = (id, target) => {
    if (!id || isDown(id)) return;
    const slots = { ...sq.slots };
    const from = slotOf(id);
    const occupant = slots[target];
    if (from) slots[from] = from !== target && occupant ? occupant : null;
    slots[target] = id;
    set({ slots });
    setPicked(null);
  };
  const remove = (id) => { const from = slotOf(id); if (from) set({ slots: { ...sq.slots, [from]: null } }); };
  /** Clique num pet do elenco: vai para o slot selecionado, senão para o primeiro vazio do papel dele (ou qualquer vazio). */
  const clickPet = (id) => {
    if (isDown(id)) return;
    if (picked) return place(id, picked);
    if (slotOf(id)) return remove(id);
    const free = ['vanguard', 'center', 'rear'].filter((k) => !sq.slots[k]);
    const best = free.sort((x, y) => SLOT_PREF[x].indexOf(role(id)) - SLOT_PREF[y].indexOf(role(id)))[0];
    if (best) place(id, best);
  };
  const toggleItem = (id) => set({ items: sq.items.includes(id) ? sq.items.filter((x) => x !== id) : sq.items.length < 2 ? [...sq.items, id] : sq.items });
  const f = map.forecast && map.forecast.node === node.id ? map.forecast : null;
  const drag = (id) => (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; };
  const lifeBar = (p) => <span className={'dc-life' + (p.life < 0.5 ? ' is-low' : '')} title={'Vida ' + pct(p.life)}><ProgressBar value={p.life * 100} size="sm" /></span>;
  // Duas colunas nas laterais do mapa (posicionadas pelo grid de .dc-stage): elenco à esquerda; slots, consumíveis e
  // a luta à direita. Os inimigos ficam no próprio mapa (atributos ao passar o mouse).
  return (
    <>
      <aside className="dc-prep__side is-left" aria-label="DevPets disponíveis">
        <div className="tk-menu__heading">DevPets · arraste para um slot</div>
        <div className="dc-roster" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); remove(e.dataTransfer.getData('text/plain')); }}>
          {roster.map((p) => {
            const on = !!slotOf(p.id);
            return (
              <InfoCard key={p.id} content={<><div className="dc-info__title">{p.name} · {p.roleName}</div>
                <div className="dc-info__row"><span>Nível</span><b>{p.level}</b></div>
                <div className="dc-info__row"><span>Vida · Ataque · Defesa</span><b>{p.hp} · {p.atk} · {p.def}</b></div>
                <div className="dc-info__row"><span>{p.ability.name}</span><b>{p.ability.text}</b></div>
                <div className="dc-info__row"><span>Vida</span><b>{pct(p.life)}{p.life < 1 ? ` · cheia em ${formatDuration(p.fullInMs)}` : ''}</b></div></>} focusable={false}>
                <button type="button" className={'dc-roster__pet' + (on ? ' is-on' : '') + (p.down ? ' is-down' : '')} aria-pressed={on} aria-disabled={p.down}
                  draggable={!p.down} onDragStart={drag(p.id)} onClick={() => clickPet(p.id)}
                  title={picked ? 'Colocar no slot selecionado' : on ? 'Tirar do esquadrão' : 'Colocar no esquadrão'}>
                  <Pet snap={snap} id={p.id} size={34} />
                  <span>{p.name}</span>
                  <small>{p.down ? `fora de combate · volta em ${formatDuration(p.backInMs)}` : `${p.roleName} · nv ${p.level}`}</small>
                  {lifeBar(p)}
                </button>
              </InfoCard>
            );
          })}
        </div>
      </aside>
      <aside className="dc-prep__side is-right" aria-label="Preparação da batalha">
        <div className="dc-prep__head"><Icon name={node.icon} size={14} /> <b>{node.typeName}</b></div>
        <div className="dc-slots" role="group" aria-label="Slots do esquadrão">
          {[...SLOT_ORDER].reverse().map((sid) => {
            const sl = map.slots.find((x) => x.id === sid);
            const id = sq.slots[sid];
            const p = id && roster.find((x) => x.id === id);
            const extra = Object.entries(sl.roles || {});
            const match = p && sl.roles && sl.roles[p.role];
            return (
              <div key={sid} className={'dc-slotbox is-' + sid + (picked === sid ? ' is-picked' : '') + (over === sid ? ' is-over' : '') + (match ? ' is-match' : '') + (p ? ' is-filled' : '')}
                onDragOver={(e) => { e.preventDefault(); setOver(sid); }} onDragLeave={() => setOver((o) => (o === sid ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); place(e.dataTransfer.getData('text/plain'), sid); }}>
                <InfoCard content={<><div className="dc-info__title">{sl.name}</div><p className="dc-info__text">{sl.text}</p>
                  <div className="dc-slotbox__bonus"><span>{bonusText(sl.bonus)}</span>
                    {extra.map(([r, bb]) => <span key={r} className={match && p.role === r ? 'is-on' : ''}>{ROLE_NAMES[r]}: {bonusText(bb)}</span>)}</div></>} focusable={false}>
                  <button type="button" className="dc-slotbox__head" aria-pressed={picked === sid} onClick={() => setPicked(picked === sid ? null : sid)}
                    title="Selecionar este slot (depois clique num DevPet)">
                    <b>{sl.name}</b><small>{match ? 'bônus de ' + ROLE_NAMES[p.role].toLowerCase() + ' ativo' : bonusText(sl.bonus)}</small>
                  </button>
                </InfoCard>
                {p ? (
                  <div className="dc-slotbox__pet" draggable onDragStart={drag(id)}>
                    <Pet snap={snap} id={id} size={36} />
                    <div className="dc-slotbox__info">
                      <b>{p.name}</b>
                      <span className={'dc-slot__life' + (p.life < 0.5 ? ' is-low' : '')}>{pct(p.life)} de vida</span>
                    </div>
                    <button type="button" className="dc-slotbox__remove" aria-label={'Tirar ' + p.name + ' do slot'} onClick={() => remove(id)}><Icon name="x" size={12} /></button>
                    <select className="dc-slot__trigger" value={sq.triggers[id] || 'start'} aria-label={'Gatilho de ' + p.ability.name}
                      onChange={(e) => set({ triggers: { ...sq.triggers, [id]: e.target.value } })}>
                      {map.triggers.map((t) => <option key={t.id} value={t.id}>{p.ability.name}: {t.name.toLowerCase()}</option>)}
                    </select>
                  </div>
                ) : <div className="dc-slotbox__empty">{picked === sid ? 'Clique num DevPet' : 'Arraste um DevPet'}</div>}
              </div>
            );
          })}
        </div>
        {roster.some((p) => p.life < 1) && (
          <div className="dc-heal">
            <Icon name="heart-pulse" size={13} />
            <span>Health Check ×{map.healItems}: cura 50% de um pet{map.healItems ? '' : ' (fabrique na aba Ops)'}</span>
            {roster.filter((p) => p.life < 1).map((p) => (
              <Button key={p.id} size="sm" variant="ghost" disabled={!map.healItems} onClick={() => act({ type: 'use', item: 'health-check', pet: p.id })}>
                {p.name} {pct(p.life)}
              </Button>
            ))}
          </div>
        )}
        <div className="tk-menu__heading">Consumíveis ({sq.items.length}/2)</div>
        <div className="dc-prep__items">
          {map.items.map((k) => (
            <InfoCard key={k.id} content={<><div className="dc-info__title">{k.name}</div><p className="dc-info__text">{k.text}</p></>} focusable={false}>
              <button type="button" className={'dc-prep__item' + (sq.items.includes(k.id) ? ' is-on' : '')} disabled={!k.n} aria-pressed={sq.items.includes(k.id)} onClick={() => toggleItem(k.id)}>
                <Icon name={k.icon} size={14} /> {k.name} <small>×{k.n}</small>
              </button>
            </InfoCard>
          ))}
        </div>
        <div className="dc-prep__foot">
          {f ? <span className={'dc-forecast is-omen ' + CHANCE_CLASS[f.label]}><Icon name={omenOf(f.chance)[1]} size={13} /> {omenOf(f.chance)[2]}</span>
            : <span className="dc-forecast">Escolha ao menos um DevPet</span>}
          {f && f.timeouts >= 0.25 && <span className="dc-trait"><Icon name="timer" size={12} /> O relógio corre contra vocês: falta dano para terminar a tempo.</span>}
          {map.battleBuff && <span className="dc-chip is-ok">+{Math.round(map.battleBuff.atk * 100)}% de ataque nesta batalha</span>}
          <span className="dc-prep__rounds" title="Sem derrubar os inimigos até aqui, a luta conta como derrota">Limite: {map.maxRounds} rodadas</span>
          <span className="dc-prep__cost">Entrada: <b>{formatNum(node.cost)}</b> Compute</span>
          <div className="dc-prep__actions">
            <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
            <Button variant="primary" icon="swords" disabled={!placed.length || !node.affordable} onClick={() => act({ type: 'mapFight', node: node.id, squad: sq })}>Lutar</Button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function MapPanel({ snap, act, audio = { on: false, volume: 0 }, setAudio = () => {}, onArena = () => {} }) {
  const live = snap.map;
  const [prep, setPrep] = React.useState(null);
  const [decision, setDecision] = React.useState(true); // modal da escolha pendente aberto (fechar no X só adia)
  const [seen, setSeen] = React.useState(live.lastBattle ? live.lastBattle.id : 0);
  const battle = live.lastBattle && live.lastBattle.id > seen ? live.lastBattle : null;
  // Sem spoiler: enquanto a arena mostra a luta, o painel fica como estava antes dela (placar, Patches, posição,
  // preparação). A luta já vem calculada do engine; o resultado só aparece depois de "Continuar".
  React.useEffect(() => { setDecision(true); }, [live.pending ? live.pending.node : null]);
  const frozen = React.useRef(live);
  if (!battle) frozen.current = live;
  const map = battle ? frozen.current : live;
  const prepNode = prep && map.nodes.find((n) => n.id === prep && n.status === 'reachable');
  React.useEffect(() => { onArena(!!battle); return () => onArena(false); }, [!!battle]);
  const setSound = (on) => setAudio((a) => ({ ...a, on }));
  const closeArena = () => { if (battle.win) setPrep(null); setSeen(battle.id); };

  if (!map.unlocked) return <div className="dc-empty">O mapa de {map.area.name} abre com {map.requirement}.</div>;

  const onNode = (n) => {
    if (map.pending && n.id === map.pending.node) return setDecision(true);
    if (COMBAT.includes(n.type)) setPrep(n.id);
    else { setPrep(null); act({ type: 'mapMove', node: n.id }); }
  };
  return (
    <div className="dc-mapview">
      <div className="dc-mapview__head">
        <div>
          <div className="dc-card__title">{map.area.name}</div>
          <div className="dc-row__desc">{map.area.description}</div>
        </div>
        <span className="dc-chip" title="Batalhas na vida">{map.stats.wins} vitória{map.stats.wins === 1 ? '' : 's'} · {map.stats.losses} derrota{map.stats.losses === 1 ? '' : 's'}</span>
        {map.battleBuff && <span className="dc-chip is-ok">Próxima batalha +{Math.round(map.battleBuff.atk * 100)}% de ataque</span>}
        <span className="dc-sound">
          <SoundToggle sound={audio.on} onSound={setSound} />
          <input type="range" min="0" max="1" step="0.05" value={audio.volume} disabled={!audio.on} aria-label="Volume do som"
            onChange={(e) => setAudio((a) => ({ ...a, volume: Number(e.target.value) }))} />
        </span>
      </div>
      <div className="dc-patches">
        <span className="tk-menu__heading">Patches da run</span>
        {!map.patches.length && <span className="dc-row__desc">Nenhum ainda — vencem-se no mapa e valem até a Singularity.</span>}
        {map.patches.map((p) => (
          <InfoCard key={p.id} content={<><div className="dc-info__title">{p.name} <span className="dc-chip">{p.rarityName}</span></div><p className="dc-info__text">{p.description}</p></>}>
            <span className={'dc-chip dc-patch is-' + p.rarity}><Icon name={p.icon} size={12} />{p.name}</span>
          </InfoCard>
        ))}
      </div>
      {map.cleared && (
        <div className={'dc-mapbox is-cleared' + (map.next ? ' is-' + map.next.arena : '')}>
          <Icon name="crown" size={16} />
          <span><b>{map.area.name} concluída!</b> {map.boss.name} caiu.{' '}
            {map.next ? <>Além dele começa o <b>{map.next.name}</b>. {map.next.description} Os Patches da run seguem com você.</> : 'A próxima área chega em breve.'}</span>
          {map.next && <Button variant="primary" icon="footprints" onClick={() => act({ type: 'mapAdvance' })}>Atravessar para {map.next.name}</Button>}
        </div>
      )}
      <div className={'dc-stage' + (prepNode ? ' is-prep' : '')}>
        <div className="dc-stage__map">
          <MapGrid map={map} onNode={onNode} hold={!!battle} selected={prepNode ? prepNode.id : null}
            party={(map.squad.pets.length ? map.squad.pets : [...map.roster].sort((a, b) => b.level - a.level).slice(0, 3).map((p) => p.id))
              .map((id) => snap.pets.find((p) => p.id === id && p.owned)).filter(Boolean)} />
        </div>
        {prepNode && <PrepPanel key={prepNode.id} map={map} snap={snap} node={prepNode} act={act} onCancel={() => setPrep(null)} />}
      </div>
      {!map.at && !map.cleared && <div className="dc-row__desc">Escolha um ponto da primeira coluna para começar. Passe o mouse num ponto para ver custo, inimigos e recompensa.</div>}
      {map.pending && <PendingPanel key={map.pending.node} map={map} snap={snap} act={act} open={decision} setOpen={setDecision} />}
      {battle && <Arena battle={battle} snap={snap} area={map.area} onClose={closeArena} sound={audio.on} onSound={setSound} />}
    </div>
  );
}
