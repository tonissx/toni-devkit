import { DS } from '../../lib/ds.js';
import { plan, villainSpot, hash } from '../../devcore/director.js';
import { formatNum } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';

const { Icon } = DS;
const DEFEAT_MS = 2500;

/**
 * Vilão em cena: o incidente ativo (ameaçando ou barrado) ou, por alguns segundos, o que acabou de ser
 * derrotado com Hotfix. → { villain, category, state, line } | null
 */
function villainOnStage(snap, reactions, now) {
  const a = snap.ops.active;
  if (a) {
    const lines = a.villain.lines;
    const state = a.contained ? 'blocked' : 'active';
    const pool = a.contained ? lines.blocked : lines.active;
    return { ...a.villain, category: a.category, state, contained: a.contained, by: a.by, line: pool[Math.floor(now / 7000 + hash(a.villain.id)) % pool.length] };
  }
  const d = [...reactions].reverse().find((e) => e.type === 'defeated' && now - e.at < DEFEAT_MS);
  if (!d) return null;
  const info = snap.bestiary.find((b) => b.id === d.villain);
  return info ? { id: info.id, name: info.name, color: info.color, category: d.category, state: 'defeated', line: d.text } : null;
}

/**
 * Cena viva do DevCore: estações (categorias com produção), DevPets andando entre elas e,
 * quando há incidente, o "pet do mal" invadindo a estação atacada.
 */
export function Scene({ snap, reactions, now }) {
  const stations = snap.categories.filter((c) => c.active);
  const pets = snap.pets.filter((p) => p.owned);
  const spots = stations.length + 1; // + canto de descanso
  const villain = villainOnStage(snap, reactions, now);
  const vSpot = villain ? villainSpot(villain.category, stations) : null;
  const decisions = plan(pets, stations, now, reactions, villain ? { villain: { spot: vSpot, name: villain.name, contained: villain.contained, by: villain.by } } : {});
  const prev = React.useRef({});
  const walking = React.useRef({});

  // Mudou de lugar → anda por 2 s (a transição de `left` leva 1,6 s; a folga cobre o relógio de 500 ms).
  decisions.forEach((d) => {
    if (prev.current[d.id] !== undefined && prev.current[d.id] !== d.spot) walking.current[d.id] = now + 2000;
    prev.current[d.id] = d.spot;
  });

  const centerOf = (spot) => ((spot === -1 ? spots - 1 : spot) + 0.5) / spots * 100;
  const edge = (spot) => (centerOf(spot) < 10 ? ' is-edge-l' : centerOf(spot) > 90 ? ' is-edge-r' : '');
  // Figuras por lugar (o vilão conta como a primeira do lugar dele).
  const bySpot = villain ? { [vSpot]: 1 } : {};
  const stationState = (id, i) => (villain && vSpot === i && villain.state !== 'defeated' ? (villain.contained ? ' is-shielded' : ' is-alert') : '');
  // Refactor recente naquela estação → pulso de alguns segundos.
  const refactored = (id) => reactions.some((e) => e.type === 'refactor' && e.category === id && now - e.at < 4000);
  const mkClass = (s) => (s.mk > 1 ? ' is-mk' + s.mk : '') + (refactored(s.id) ? ' is-refactored' : '');

  return (
    <div className="dc-scene" aria-label="Infraestrutura do DevCore">
      <div className="dc-stations" style={{ gridTemplateColumns: `repeat(${spots}, 1fr)` }}>
        {stations.map((s, i) => (
          <div key={s.id} className={'dc-station' + mkClass(s) + stationState(s.id, i)} title={s.mk > 1 ? `${s.name} · Mk ${s.mk === 3 ? 'III' : 'II'}` : undefined}>
            <div className="dc-station__box">
              <Icon name={s.icon} size={18} />
              <span className="dc-station__leds" aria-hidden="true"><i /><i /><i /></span>
              {s.mk > 1 && <span className="dc-station__leds is-left" aria-hidden="true"><i /><i /><i /></span>}
              {s.mk === 3 && <span className="dc-station__mk">III</span>}
              {stationState(s.id, i) === ' is-shielded' && <span className="dc-station__badge"><Icon name="shield-check" size={11} /></span>}
              {stationState(s.id, i) === ' is-alert' && <span className="dc-station__badge is-alert">!</span>}
            </div>
            <div className="dc-station__name">{s.name}</div>
            <div className="dc-station__rate">+{formatNum(s.rate, { rate: true })}/s</div>
          </div>
        ))}
        <div className="dc-station is-lounge">
          <div className="dc-station__box"><Icon name="coffee" size={18} /></div>
          <div className="dc-station__name">Descanso</div>
        </div>
      </div>

      {villain && (() => {
        const together = 1 + decisions.filter((x) => x.spot === vSpot).length;
        const offset = (0 - (together - 1) / 2) * 56;
        const lift = (vSpot % 2) * 22;
        return (
          <div key={'villain-' + villain.id} className={'dc-villain is-' + villain.state + edge(vSpot)}
            style={{ left: `calc(${centerOf(vSpot)}% + ${offset}px)`, '--bubble-lift': lift + 'px', '--villain': villain.color }}>
            <div className="dc-pet__bubble dc-villain__bubble"><b>{villain.name}</b> · {villain.line}</div>
            <VillainSprite id={villain.id} color={villain.color} state={villain.state} size={52} />
          </div>
        );
      })()}

      {decisions.map((d) => {
        const p = pets.find((x) => x.id === d.id);
        // Vários no mesmo lugar: lado a lado e com os balões em alturas diferentes.
        const k = bySpot[d.spot] = (bySpot[d.spot] || 0) + 1;
        const together = decisions.filter((x) => x.spot === d.spot).length + (villain && d.spot === vSpot ? 1 : 0);
        const offset = (k - 1 - (together - 1) / 2) * 56;
        const moving = (walking.current[d.id] || 0) > now;
        const col = d.spot === -1 ? spots - 1 : d.spot;
        // Linhas de balão distintas: 2ª figura do lugar sobe duas linhas; estações vizinhas alternam uma.
        const lift = ((k - 1) * 2 + (col % 2)) * 22;
        const activity = moving ? 'walking' : d.activity;
        return (
          // Nas pontas da cena o balão se alinha para dentro (não é cortado pela borda).
          <div key={d.id} className={'dc-pet is-' + activity + edge(d.spot)}
            style={{ left: `calc(${centerOf(d.spot)}% + ${offset}px)`, '--bubble-lift': lift + 'px' }}>
            <div className="dc-pet__bubble"><b>{p.name}</b> · {moving ? 'on the way...' : d.line}</div>
            <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={52} />
          </div>
        );
      })}
    </div>
  );
}
