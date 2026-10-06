import { DS } from '../../lib/ds.js';
import { formatNum } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';
import { InfoCard } from './InfoCard.jsx';
import { Arena } from './Arena.jsx';

const { Button, Icon } = DS;
const COMBAT = ['battle', 'elite', 'boss'];
const CHANCE_CLASS = { 'favorável': 'is-good', 'arriscado': 'is-risky', 'muito arriscado': 'is-bad' };

/** Sprite de um pet do jogador (cores do visual escolhido). */
function Pet({ snap, id, size = 40 }) {
  const p = snap.pets.find((x) => x.id === id);
  return p ? <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={size} className="is-static" /> : null;
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

/** O mapa: pontos e ligações (SVG por cima, em % da área). */
function MapGrid({ map, onNode }) {
  const cols = map.area.columns + 1;
  const x = (n) => ((n.col + 0.5) / cols) * 100;
  const y = (n) => ((n.lane + 0.5) / map.area.lanes) * 100;
  const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const n of map.nodes) {
    for (const id of [...n.next, ...(n.shortcut ? [n.shortcut] : [])]) {
      const t = byId[id];
      const walked = (n.status === 'visited' || n.status === 'current') && (t.status === 'visited' || t.status === 'current');
      const open = n.status === 'current' && t.status === 'reachable';
      edges.push({ key: n.id + '>' + id, x1: x(n), y1: y(n), x2: x(t), y2: y(t), cls: (walked ? ' is-walked' : open ? ' is-open' : '') + (id === n.shortcut ? ' is-shortcut' : '') });
    }
  }
  return (
    <div className="dc-map" role="group" aria-label={'Mapa ' + map.area.name}>
      <svg className="dc-map__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {edges.map((e) => <line key={e.key} className={'dc-map__edge' + e.cls} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {map.nodes.map((n) => (
        <span key={n.id} className="dc-map__slot" style={{ left: x(n) + '%', top: y(n) + '%' }}>
          <InfoCard content={<NodeDetails n={n} />} focusable={false}>
            <button type="button" className={'dc-node is-' + n.type + ' is-' + n.status + (n.status === 'reachable' && !n.affordable ? ' is-poor' : '')}
              aria-disabled={n.status !== 'reachable'} onClick={() => n.status === 'reachable' && onNode(n)} aria-label={`${n.typeName}, coluna ${n.col + 1}${n.cost ? ', ' + formatNum(n.cost) + ' Compute' : ''}`}>
              <Icon name={n.icon} size={n.type === 'boss' ? 20 : 15} />
            </button>
          </InfoCard>
        </span>
      ))}
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

/** Preparação da batalha: esquadrão, formação, gatilhos, consumíveis; inimigos, previsão e custo. */
function PrepPanel({ map, snap, node, act, onCancel }) {
  const saved = map.squad;
  const initial = () => {
    if (saved.valid && saved.pets.length) return { pets: saved.pets, front: saved.front, triggers: saved.triggers, items: saved.items.filter((id) => (map.items.find((k) => k.id === id) || {}).n > 0) };
    const best = [...map.roster].sort((a, b) => b.level - a.level || b.atk - a.atk).slice(0, 3).map((p) => p.id);
    return { pets: best, front: best.slice(0, 2), triggers: {}, items: [] };
  };
  const [sq, setSq] = React.useState(initial);
  // Cada mudança salva a preparação: a view devolve a previsão e quais traços o esquadrão anula.
  React.useEffect(() => { if (sq.pets.length) act({ type: 'mapSquad', squad: sq, node: node.id }); }, [JSON.stringify(sq), node.id]);
  const set = (patch) => setSq((s) => ({ ...s, ...patch }));
  const togglePet = (id) => set(sq.pets.includes(id)
    ? { pets: sq.pets.filter((x) => x !== id), front: sq.front.filter((x) => x !== id) }
    : sq.pets.length < 3 ? { pets: [...sq.pets, id], front: sq.front.length < 2 ? [...sq.front, id] : sq.front } : {});
  const toggleItem = (id) => set({ items: sq.items.includes(id) ? sq.items.filter((x) => x !== id) : sq.items.length < 2 ? [...sq.items, id] : sq.items });
  const f = map.forecast && map.forecast.node === node.id ? map.forecast : null;
  const roster = map.roster;
  return (
    <section className="dc-mapbox dc-prep">
      <div className="dc-mapbox__head"><Icon name={node.icon} size={14} /> <b>{node.typeName}</b><span>Monte o esquadrão: a luta se resolve sozinha.</span></div>
      <div className="dc-prep__cols">
        <div>
          <div className="tk-menu__heading">Esquadrão ({sq.pets.length}/3)</div>
          <div className="dc-roster">
            {roster.map((p) => {
              const on = sq.pets.includes(p.id);
              return (
                <InfoCard key={p.id} content={<><div className="dc-info__title">{p.name} · {p.roleName}</div>
                  <div className="dc-info__row"><span>Nível</span><b>{p.level}</b></div>
                  <div className="dc-info__row"><span>Vida · Ataque · Defesa</span><b>{p.hp} · {p.atk} · {p.def}</b></div>
                  <div className="dc-info__row"><span>{p.ability.name}</span><b>{p.ability.text}</b></div></>} focusable={false}>
                  <button type="button" className={'dc-roster__pet' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => togglePet(p.id)}>
                    <Pet snap={snap} id={p.id} size={34} />
                    <span>{p.name}</span><small>{p.roleName} · nv {p.level}</small>
                  </button>
                </InfoCard>
              );
            })}
          </div>
          {sq.pets.map((id) => {
            const p = roster.find((x) => x.id === id);
            return (
              <div key={id} className="dc-slot">
                <Pet snap={snap} id={id} size={26} />
                <b>{p.name}</b>
                <button type="button" className={'dc-slot__pos' + (sq.front.includes(id) ? ' is-front' : '')} onClick={() => set({ front: sq.front.includes(id) ? sq.front.filter((x) => x !== id) : [...sq.front, id] })}>
                  {sq.front.includes(id) ? 'Frente' : 'Trás'}
                </button>
                <select className="dc-slot__trigger" value={sq.triggers[id] || 'start'} aria-label={'Gatilho de ' + p.ability.name}
                  onChange={(e) => set({ triggers: { ...sq.triggers, [id]: e.target.value } })}>
                  {map.triggers.map((t) => <option key={t.id} value={t.id}>{p.ability.name}: {t.name.toLowerCase()}</option>)}
                </select>
              </div>
            );
          })}
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
        {map.battleBuff && <span className="dc-chip is-ok">+{Math.round(map.battleBuff.atk * 100)}% de ataque nesta batalha</span>}
        <span className="dc-prep__cost">Entrada: <b>{formatNum(node.cost)}</b> Compute</span>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" icon="swords" disabled={!sq.pets.length || !node.affordable} onClick={() => act({ type: 'mapFight', node: node.id, squad: sq })}>Lutar</Button>
      </div>
    </section>
  );
}

export function MapPanel({ snap, act }) {
  const map = snap.map;
  const [prep, setPrep] = React.useState(null);
  const [seen, setSeen] = React.useState(map.lastBattle ? map.lastBattle.id : 0);
  const battle = map.lastBattle && map.lastBattle.id > seen ? map.lastBattle : null;
  const prepNode = prep && map.nodes.find((n) => n.id === prep && n.status === 'reachable');
  React.useEffect(() => { if (battle && battle.win) setPrep(null); }, [battle && battle.id]);

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
        <span className="dc-chip" title="Batalhas na vida">{map.stats.wins} vitórias · {map.stats.losses} derrotas</span>
        {map.battleBuff && <span className="dc-chip is-ok">Próxima batalha +{Math.round(map.battleBuff.atk * 100)}% de ataque</span>}
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
      <MapGrid map={map} onNode={onNode} />
      {!map.at && !map.cleared && <div className="dc-row__desc">Escolha um ponto da primeira coluna para começar. Passe o mouse num ponto para ver custo, inimigos e recompensa.</div>}
      {map.pending && <PendingPanel map={map} snap={snap} act={act} />}
      {prepNode && <PrepPanel key={prepNode.id} map={map} snap={snap} node={prepNode} act={act} onCancel={() => setPrep(null)} />}
      {battle && <Arena battle={battle} snap={snap} area={map.area} onClose={() => setSeen(battle.id)} />}
    </div>
  );
}
