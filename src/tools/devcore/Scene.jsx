import { DS } from '../../lib/ds.js';
import { plan } from '../../devcore/director.js';
import { formatNum } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';

const { Icon } = DS;

/**
 * Cena viva do DevCore: estações (categorias com produção) e DevPets andando entre elas.
 * Posição/atividade vêm do diretor (tempo + reações); a caminhada é uma transição CSS.
 */
export function Scene({ snap, reactions, now }) {
  const stations = snap.categories.filter((c) => c.active);
  const pets = snap.pets.filter((p) => p.owned);
  const spots = stations.length + 1; // + canto de descanso
  const decisions = plan(pets, stations, now, reactions);
  const prev = React.useRef({});
  const walking = React.useRef({});

  // Mudou de lugar → anda por ~1,6 s (a transição de `left` faz o resto).
  decisions.forEach((d) => {
    if (prev.current[d.id] !== undefined && prev.current[d.id] !== d.spot) walking.current[d.id] = now + 1600;
    prev.current[d.id] = d.spot;
  });

  const centerOf = (spot) => ((spot === -1 ? spots - 1 : spot) + 0.5) / spots * 100;
  const bySpot = {};

  return (
    <div className="dc-scene" aria-label="Infraestrutura do DevCore">
      <div className="dc-stations" style={{ gridTemplateColumns: `repeat(${spots}, 1fr)` }}>
        {stations.map((s) => (
          <div key={s.id} className="dc-station">
            <div className="dc-station__box">
              <Icon name={s.icon} size={18} />
              <span className="dc-station__leds" aria-hidden="true"><i /><i /><i /></span>
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
      {decisions.map((d) => {
        const p = pets.find((x) => x.id === d.id);
        // Vários pets no mesmo lugar: lado a lado e com os balões em alturas diferentes.
        const k = bySpot[d.spot] = (bySpot[d.spot] || 0) + 1;
        const together = decisions.filter((x) => x.spot === d.spot).length;
        const offset = (k - 1 - (together - 1) / 2) * 56;
        const moving = (walking.current[d.id] || 0) > now;
        const col = d.spot === -1 ? spots - 1 : d.spot;
        const lift = (k - 1) * 22 + (col % 2 ? 20 : 0); // estações vizinhas: balões em alturas alternadas
        const activity = moving ? 'walking' : d.activity;
        return (
          // Nas pontas da cena o balão se alinha para dentro (não é cortado pela borda).
          <div key={d.id} className={'dc-pet is-' + activity + (centerOf(d.spot) < 10 ? ' is-edge-l' : centerOf(d.spot) > 90 ? ' is-edge-r' : '')}
            style={{ left: `calc(${centerOf(d.spot)}% + ${offset}px)`, '--bubble-lift': lift + 'px' }}>
            <div className="dc-pet__bubble"><b>{p.name}</b> · {moving ? 'on the way...' : d.line}</div>
            <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={52} />
          </div>
        );
      })}
    </div>
  );
}
