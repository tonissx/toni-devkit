import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';
import { InfoCard } from './InfoCard.jsx';

const { Icon } = DS;

const signed = (v) => (v >= 0 ? '+' : '−') + formatNum(Math.abs(v), { rate: true }) + '/s';

/** Ícone de um bônus temporário: o pet dono da habilidade, o item do consumível ou o vilão do incidente. */
function SourceIcon({ item, snap }) {
  if (item.kind === 'ability') {
    const p = snap.pets.find((x) => x.id === item.pet);
    return p ? <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={22} className="is-static" /> : <Icon name="zap" size={14} />;
  }
  if (item.kind === 'boost') return <Icon name={item.icon} size={14} />;
  return <VillainSprite id={item.villain.id} color={item.villain.color} size={22} className="is-static" />;
}

/** Conteúdo do cartão: base, cada bônus temporário (ícone, efeito, tempo restante, quanto mexe) e o total. */
function RateBreakdown({ info, snap, now }) {
  const who = (x) => (x.kind === 'ability' ? (snap.pets.find((p) => p.id === x.pet) || { name: '' }).name : x.kind === 'incident' ? x.villain.name : 'consumível');
  return (
    <>
      <div className="dc-info__title"><Icon name="cpu" size={12} /> Produção por segundo</div>
      <div className="dc-rate">
        <span className="dc-rate__icon"><Icon name="server" size={14} /></span>
        <span className="dc-rate__name"><span>Base</span><small>sem bônus temporários</small></span>
        <b>{'+' + formatNum(info.base, { rate: true }) + '/s'}</b>
      </div>
      {info.items.map((x) => (
        <div key={x.kind + x.id} className={'dc-rate' + (x.delta < 0 ? ' is-down' : '')}>
          <span className="dc-rate__icon">{<SourceIcon item={x} snap={snap} />}</span>
          <span className="dc-rate__name"><span>{x.name} <em>· {who(x)}</em></span>
            <small>{x.effects.join(' · ')} · {formatDuration(Math.max(0, x.until - now))}</small>
          </span>
          <b>{signed(x.delta)}</b>
        </div>
      ))}
      {!info.items.length && <p className="dc-info__text">Nenhum bônus temporário agora. Habilidades dos DevPets e consumíveis (como o Coffee) aparecem aqui enquanto valem.</p>}
      <div className="dc-rate is-total">
        <span className="dc-rate__icon"><Icon name="sigma" size={14} /></span>
        <span className="dc-rate__name">Total</span>
        <b>{'+' + formatNum(info.total, { rate: true }) + '/s'}</b>
      </div>
    </>
  );
}

/** Taxa do cabeçalho: um sinal quando há bônus (raio) ou incidente (alerta) e os detalhes no hover. */
export function RateWithDetails({ snap, now }) {
  const info = snap.rateInfo;
  const down = info.items.some((x) => x.delta < 0);
  const up = info.items.some((x) => x.delta > 0);
  return (
    <InfoCard content={<RateBreakdown info={info} snap={snap} now={now} />} label="Detalhes da produção por segundo">
      <span className={'dc-amount__rate' + (up ? ' is-boosted' : '') + (down && !up ? ' is-down' : '')}>
        +{formatNum(snap.rate, { rate: true })}/s
        {up && <Icon name="zap" size={12} />}
        {down && <span className="dc-amount__down"><Icon name="triangle-alert" size={12} /></span>}
      </span>
    </InfoCard>
  );
}
