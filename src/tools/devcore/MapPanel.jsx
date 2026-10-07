import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';
import { InfoCard } from './InfoCard.jsx';
import { Arena, SoundToggle } from './Arena.jsx';

const { Button, Icon, ProgressBar } = DS;
const pct = (v) => Math.round(v * 100) + '%';
const COMBAT = ['battle', 'elite', 'boss'];
const CHANCE_CLASS = { 'favorável': 'is-good', 'arriscado': 'is-risky', 'muito arriscado': 'is-bad' };

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

const BOARD_H = 400;   // altura do tabuleiro (px, antes da inclinação)
const PAD_X = 46;
const PAD_Y = 48;

/** Objetos 3D da área espalhados pelo tabuleiro (decoração; ver docs §4.5). upright: em pé, de frente para a câmera. */
function AreaProps({ arena, w }) {
  if (arena !== 'localhost') return null;
  return (
    <>
      {/* Monitor ao fundo, em pé, com código na tela */}
      <svg className="dc-prop is-upright" style={{ left: w * 0.62, top: -118 }} width="230" height="150" viewBox="0 0 230 150" aria-hidden="true">
        <rect x="5" y="5" width="220" height="118" rx="8" fill="#232A36" stroke="#3A4354" strokeWidth="3" />
        <rect x="15" y="15" width="200" height="98" rx="3" fill="#121823" />
        <rect x="26" y="26" width="70" height="6" rx="3" fill="#4FC3C8" opacity=".8" />
        <rect x="38" y="40" width="40" height="6" rx="3" fill="#C792EA" opacity=".8" /><rect x="84" y="40" width="70" height="6" rx="3" fill="#E8E8F0" opacity=".55" />
        <rect x="38" y="54" width="96" height="6" rx="3" fill="#E8E8F0" opacity=".55" />
        <rect x="38" y="68" width="54" height="6" rx="3" fill="#F78C6C" opacity=".8" />
        <rect x="26" y="82" width="22" height="6" rx="3" fill="#4FC3C8" opacity=".8" />
        <rect x="100" y="123" width="30" height="18" fill="#2A303C" /><rect x="80" y="139" width="70" height="8" rx="3" fill="#2A303C" />
      </svg>
      {/* Caneca, em pé, com vapor */}
      <svg className="dc-prop is-upright" style={{ left: 6, top: BOARD_H - 92 }} width="62" height="74" viewBox="0 0 62 74" aria-hidden="true">
        <path className="dc-prop__steam" d="M20 16 q-6 -8 0 -14 M32 16 q-6 -8 0 -14" stroke="#C9C9D2" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".5" />
        <rect x="8" y="22" width="38" height="46" rx="6" fill="#C0392B" />
        <path d="M46 32 h6 a8 8 0 0 1 0 18 h-6" stroke="#C0392B" strokeWidth="5" fill="none" />
        <rect x="14" y="34" width="26" height="6" rx="3" fill="#F5E6C8" opacity=".85" />
      </svg>
      {/* Post-its, deitados no canto de cima à direita (livre: o chefe fica só na trilha do meio) */}
      <div className="dc-prop is-flat dc-postit" style={{ left: w - 128, top: 34, transform: 'rotate(-7deg)' }}>TODO: fix</div>
      <div className="dc-prop is-flat dc-postit is-blue" style={{ left: w - 74, top: 46, transform: 'rotate(6deg)' }}>git push</div>
      {/* Teclado, deitado na borda da frente */}
      <svg className="dc-prop is-flat" style={{ left: w * 0.36, top: BOARD_H - 26 }} width="260" height="56" viewBox="0 0 260 56" aria-hidden="true">
        <rect width="260" height="56" rx="8" fill="#20252F" stroke="#323A48" />
        {Array.from({ length: 3 }, (_, r) => Array.from({ length: 14 }, (__, k) => <rect key={r + '-' + k} x={8 + k * 17.5} y={8 + r * 15} width="14" height="11" rx="2" fill="#2E3542" />))}
      </svg>
      {/* Cabo enrolado */}
      <svg className="dc-prop is-flat" style={{ left: w - 150, top: BOARD_H - 40 }} width="150" height="44" viewBox="0 0 150 44" aria-hidden="true">
        <path d="M0 30 C 30 4, 50 44, 80 22 S 130 6, 150 28" stroke="#1A1D24" strokeWidth="5" fill="none" strokeLinecap="round" />
      </svg>
    </>
  );
}

/**
 * O mapa como tabuleiro em perspectiva (estilo Inscryption): mesa inclinada, pontos em pé como fichas, objetos da área
 * e trilhas pontilhadas e curvas (SVG em pixels — os pontos do tracejado não distorcem).
 */
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
        <span key={p.id} className="dc-party__pet" style={{ '--i': i, left: (i - (party.length - 1) / 2) * 34 }}>
          <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={44} className="is-static" />
        </span>
      ))}
    </div>
  );
}

function MapGrid({ map, onNode, party = [], hold = false }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(900);
  React.useLayoutEffect(() => {
    if (!ref.current) return undefined;
    setW(ref.current.offsetWidth);
    const ro = new ResizeObserver(() => ref.current && setW(ref.current.offsetWidth));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const cols = map.area.columns + 1;
  const x = (n) => PAD_X + ((n.col + 0.5) / cols) * (w - 2 * PAD_X);
  const y = (n) => PAD_Y + ((n.lane + 0.5) / map.area.lanes) * (BOARD_H - 2 * PAD_Y);
  const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
  // Onde o esquadrão fica: um pouco à frente do ponto (para não cobrir a ficha); antes de começar, à esquerda da coluna 0.
  const start = { x: PAD_X * 0.45, y: BOARD_H / 2 };
  const nodeAt = (id) => (id == null ? null : byId[id]);
  const place = React.useCallback((id) => { const n = nodeAt(id); return n ? { x: x(n), y: y(n) + 34 } : { ...start, y: start.y + 34 }; }, [w, map.at]);
  const geom = (from, to) => {
    const a = nodeAt(from);
    const b = nodeAt(to);
    const p0 = a ? { x: x(a), y: y(a) } : start;
    const k = trailCurve(p0.x, p0.y, x(b), y(b), (a ? a.id : 'start') + '>' + b.id, a && a.shortcut === b.id);
    return { ...k, y1: k.y1 + 34, cy: k.cy + 34, y2: k.y2 + 34 };
  };
  const paths = [];
  for (const n of map.nodes) {
    for (const id of [...n.next, ...(n.shortcut ? [n.shortcut] : [])]) {
      const t = byId[id];
      const walked = (n.status === 'visited' || n.status === 'current') && (t.status === 'visited' || t.status === 'current');
      const open = n.status === 'current' && t.status === 'reachable';
      // Curva: ponto de controle no meio, deslocado na perpendicular (sinal e tamanho estáveis por trilha).
      const k = trailCurve(x(n), y(n), x(t), y(t), n.id + '>' + id, id === n.shortcut);
      paths.push({ key: n.id + '>' + id, d: `M${k.x1} ${k.y1} Q${k.cx} ${k.cy} ${k.x2} ${k.y2}`, cls: (walked ? ' is-walked' : open ? ' is-open' : '') + (id === n.shortcut ? ' is-shortcut' : '') });
    }
  }
  return (
    <div className="dc-board" role="group" aria-label={'Mapa ' + map.area.name}>
      <div ref={ref} className={'dc-board__table dc-board--' + map.area.arena} style={{ height: BOARD_H }}>
        <div className="dc-board__mat" />
        <AreaProps arena={map.area.arena} w={w} />
        <Party map={map} party={party} hold={hold} place={place} geom={geom} />
        <svg className="dc-board__paths" width={w} height={BOARD_H} aria-hidden="true">
          {paths.map((p) => <path key={p.key} className={'dc-trail' + p.cls} d={p.d} />)}
        </svg>
        {map.nodes.map((n) => (
          <React.Fragment key={n.id}>
            <span className="dc-token-shadow" style={{ left: x(n), top: y(n) }} />
            <span className={'dc-map__slot' + (n.type === 'boss' ? ' is-boss' : '')} style={{ left: x(n), top: y(n) }}>
              <InfoCard content={<NodeDetails n={n} />} focusable={false}>
                <button type="button" className={'dc-node is-' + n.type + ' is-' + n.status + (n.status === 'reachable' && !n.affordable ? ' is-poor' : '')}
                  aria-disabled={n.status !== 'reachable'} onClick={() => n.status === 'reachable' && onNode(n)}
                  aria-label={`${n.typeName}, coluna ${n.col + 1}${n.cost ? ', ' + formatNum(n.cost) + ' Compute' : ''}`}>
                  <Icon name={n.icon} size={n.type === 'boss' ? 24 : 17} />
                </button>
              </InfoCard>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** Evento, descanso ou loja em que o jogador está. */
function PendingPanel({ map, snap, act }) {
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
  return (
    <section className="dc-mapbox">
      <div className="dc-mapbox__head">
        {p.finder ? <Pet snap={snap} id={p.finder} size={34} /> : <Icon name={p.kind === 'rest' ? 'coffee' : 'circle-help'} size={14} />}
        <b>{p.title}</b>
      </div>
      {p.text && <p className="dc-mapbox__text">{p.text}</p>}
      <div className="dc-choices">
        {p.choices.map((ch) => (
          <Button key={ch.index} variant="secondary" disabled={ch.disabled} onClick={() => act({ type: 'mapChoose', index: ch.index })}>
            {ch.text}{ch.cost > 0 ? ` · ${formatNum(ch.cost)}` : ''}
          </Button>
        ))}
      </div>
    </section>
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

/** Preparação da batalha: slots do esquadrão (arrastar e soltar), gatilhos, consumíveis; inimigos, previsão e custo. */
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
  return (
    <section className="dc-mapbox dc-prep">
      <div className="dc-mapbox__head"><Icon name={node.icon} size={14} /> <b>{node.typeName}</b><span>Monte o esquadrão: a luta se resolve sozinha.</span></div>
      <div className="dc-prep__cols">
        <div>
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
                    <span className={'dc-life' + (p.life < 0.5 ? ' is-low' : '')} title={'Vida ' + pct(p.life)}><ProgressBar value={p.life * 100} size="sm" /></span>
                  </button>
                </InfoCard>
              );
            })}
          </div>
          <div className="dc-slots" role="group" aria-label="Slots do esquadrão">
            {SLOT_ORDER.map((sid) => {
              const sl = map.slots.find((x) => x.id === sid);
              const id = sq.slots[sid];
              const p = id && roster.find((x) => x.id === id);
              const extra = Object.entries(sl.roles || {});
              const match = p && sl.roles && sl.roles[p.role];
              return (
                <div key={sid} className={'dc-slotbox is-' + sid + (picked === sid ? ' is-picked' : '') + (over === sid ? ' is-over' : '') + (match ? ' is-match' : '') + (p ? ' is-filled' : '')}
                  onDragOver={(e) => { e.preventDefault(); setOver(sid); }} onDragLeave={() => setOver((o) => (o === sid ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); place(e.dataTransfer.getData('text/plain'), sid); }}>
                  <button type="button" className="dc-slotbox__head" aria-pressed={picked === sid} onClick={() => setPicked(picked === sid ? null : sid)}
                    title="Selecionar este slot (depois clique num DevPet)">
                    <b>{sl.name}</b><small>{sl.text}</small>
                  </button>
                  <div className="dc-slotbox__bonus">
                    <span>{bonusText(sl.bonus)}</span>
                    {extra.map(([r, bb]) => <span key={r} className={match && p.role === r ? 'is-on' : ''}>{ROLE_NAMES[r]}: {bonusText(bb)}</span>)}
                  </div>
                  {p ? (
                    <div className="dc-slotbox__pet" draggable onDragStart={drag(id)}>
                      <Pet snap={snap} id={id} size={40} />
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
            <div className="dc-slots__foe" aria-hidden="true"><Icon name="swords" size={14} /> inimigos</div>
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
        </div>
        <div>
          <div className="tk-menu__heading">Inimigos</div>
          {node.enemies.map((e, i) => <EnemyRow key={i} e={e} />)}
        </div>
      </div>
      <div className="dc-prep__foot">
        {f ? <span className={'dc-forecast ' + CHANCE_CLASS[f.label]}><Icon name="activity" size={13} /> {Math.round(f.chance * 100)}% · {f.label}</span>
          : <span className="dc-forecast">Escolha ao menos um DevPet</span>}
        {f && f.timeouts >= 0.25 && <span className="dc-trait"><Icon name="timer" size={12} /> {Math.round(f.timeouts * 100)}% das simulações perdem por tempo: falta dano</span>}
        <span className="dc-prep__rounds" title="Sem derrubar os inimigos até aqui, a luta conta como derrota">Limite: {map.maxRounds} rodadas</span>
        {map.battleBuff && <span className="dc-chip is-ok">+{Math.round(map.battleBuff.atk * 100)}% de ataque nesta batalha</span>}
        <span className="dc-prep__cost">Entrada: <b>{formatNum(node.cost)}</b> Compute</span>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" icon="swords" disabled={!placed.length || !node.affordable} onClick={() => act({ type: 'mapFight', node: node.id, squad: sq })}>Lutar</Button>
      </div>
    </section>
  );
}

export function MapPanel({ snap, act, audio = { on: false, volume: 0 }, setAudio = () => {}, onArena = () => {} }) {
  const live = snap.map;
  const [prep, setPrep] = React.useState(null);
  const [seen, setSeen] = React.useState(live.lastBattle ? live.lastBattle.id : 0);
  const battle = live.lastBattle && live.lastBattle.id > seen ? live.lastBattle : null;
  // Sem spoiler: enquanto a arena mostra a luta, o painel fica como estava antes dela (placar, Patches, posição,
  // preparação). A luta já vem calculada do engine; o resultado só aparece depois de "Continuar".
  const frozen = React.useRef(live);
  if (!battle) frozen.current = live;
  const map = battle ? frozen.current : live;
  const prepNode = prep && map.nodes.find((n) => n.id === prep && n.status === 'reachable');
  React.useEffect(() => { onArena(!!battle); return () => onArena(false); }, [!!battle]);
  const setSound = (on) => setAudio((a) => ({ ...a, on }));
  const closeArena = () => { if (battle.win) setPrep(null); setSeen(battle.id); };

  if (!map.unlocked) return <div className="dc-empty">O mapa de {map.area.name} abre com {map.requirement}.</div>;

  const onNode = (n) => {
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
      {map.cleared && <div className="dc-mapbox is-cleared"><Icon name="crown" size={16} /> <b>{map.area.name} concluída!</b> O Legacy Monolith caiu. A próxima área (Staging) chega em breve.</div>}
      <MapGrid map={map} onNode={onNode} hold={!!battle}
        party={(map.squad.pets.length ? map.squad.pets : [...map.roster].sort((a, b) => b.level - a.level).slice(0, 3).map((p) => p.id))
          .map((id) => snap.pets.find((p) => p.id === id && p.owned)).filter(Boolean)} />
      {!map.at && !map.cleared && <div className="dc-row__desc">Escolha um ponto da primeira coluna para começar. Passe o mouse num ponto para ver custo, inimigos e recompensa.</div>}
      {map.pending && <PendingPanel map={map} snap={snap} act={act} />}
      {prepNode && <PrepPanel key={prepNode.id} map={map} snap={snap} node={prepNode} act={act} onCancel={() => setPrep(null)} />}
      {battle && <Arena battle={battle} snap={snap} area={map.area} onClose={closeArena} sound={audio.on} onSound={setSound} />}
    </div>
  );
}
