import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { VillainSprite } from './VillainSprite.jsx';

const { Button, Icon, Toggle } = DS;

const OUTCOME = { contained: 'contido', escaped: 'escapou', hotfixed: 'derrotado (Hotfix)', cancelled: 'cancelado' };
const byName = (snap, by) => (by === 'rollback' ? 'Rollback' : by === 'infra' ? 'seus Local Clusters' : (snap.pets.find((p) => p.id === by) || { name: by }).name);

/** Quem contém o incidente previsto, com atalho para colocar o pet na estação. */
function Counters({ info, snap, act }) {
  const free = snap.stations.used < snap.stations.slots;
  return (
    <div className="dc-counters">
      <span className="dc-counters__label">Contém:</span>
      {info.counters.length === 0 && <span className="dc-chip">{info.counterText}</span>}
      {info.counters.map((p) => (
        !p.owned
          ? <span key={p.id} className="dc-chip is-muted" title="Ainda não descoberto">{p.name} (não descoberto)</span>
          : p.station
            ? <span key={p.id} className="dc-chip is-ok"><Icon name="shield-check" size={11} /> {p.name} em estação</span>
            : <Button key={p.id} size="sm" variant="secondary" icon="shield" disabled={!free}
                title={free ? '' : 'Libere uma vaga de estação na aba DevPets'}
                onClick={() => act({ type: 'station', pet: p.id, on: true })}>Colocar {p.name} na estação</Button>
      ))}
    </div>
  );
}

export function OpsPanel({ snap, amount, act, now }) {
  const ops = snap.ops;
  const f = ops.forecast;
  const a = ops.active;
  const lockedAbilities = snap.pets.filter((p) => p.owned && p.ability.readyAt > now).map((p) => p.ability);

  if (!ops.unlocked) {
    return <div className="dc-empty">Incidentes começam no <b>Tier 2</b>: "pets do mal" que atrapalham uma estação por um tempo. Prepare-se com estações e consumíveis.</div>;
  }

  return (
    <div className="dc-ops">
      <section className="dc-ops__top">
        <div className="dc-ops__status">
          <Toggle size="sm" label="Modo tranquilo (sem incidentes nem recompensas deles)" checked={ops.quiet} onChange={(on) => act({ type: 'quiet', on })} />
          {ops.shields > 0 && <span className="dc-chip is-ok"><Icon name="shield" size={11} /> Rollback armado ×{ops.shields}</span>}
        </div>
      </section>

      {a && (
        <section className={'dc-incident' + (a.contained ? ' is-contained' : ' is-active')} style={{ '--villain': a.villain.color }}>
          <VillainSprite id={a.villain.id} color={a.villain.color} state={a.contained ? 'blocked' : 'active'} size={64} />
          <div className="dc-incident__main">
            <div className="dc-incident__kicker">{a.contained ? 'CONTIDO' : 'INCIDENTE ATIVO'} · {formatDuration(a.remainingMs)}</div>
            <div className="dc-card__title">{a.villain.name} <span className="dc-chip">{a.name}</span></div>
            <div className="dc-card__desc">{a.contained ? `${byName(snap, a.by)} barrou ${a.villain.name}.` : a.description}</div>
          </div>
          {!a.contained && (
            <Button variant="primary" icon="bandage" disabled={!(snap.inventory.find((k) => k.id === 'hotfix') || {}).n}
              onClick={() => act({ type: 'use', item: 'hotfix' })}>Hotfix</Button>
          )}
        </section>
      )}

      <section>
        <div className="tk-menu__heading">Previsão</div>
        {!f && <div className="dc-empty">{ops.quiet ? 'Modo tranquilo: nenhum incidente vai acontecer.' : 'Nenhum incidente agendado.'}</div>}
        {f && f.hidden && <div className="dc-empty">Próximo incidente ainda desconhecido — a previsão aparece 2 h antes (em ~{formatDuration(f.inMs)}).</div>}
        {f && !f.hidden && (
          <div className={'dc-forecast' + (f.covered ? ' is-covered' : '')} style={{ '--villain': f.villain.color }}>
            <VillainSprite id={f.villain.id} color={f.villain.color} size={48} />
            <div className="dc-incident__main">
              <div className="dc-incident__kicker">EM {formatDuration(f.inMs)} · {f.covered ? 'DEFESA ARMADA' : 'SEM DEFESA'}</div>
              <div className="dc-card__title">{f.villain.name} <span className="dc-chip">{f.name}</span></div>
              <div className="dc-card__desc">{f.description}</div>
              <Counters info={f} snap={snap} act={act} />
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="tk-menu__heading">Consumíveis</div>
        <div className="dc-list">
          {snap.inventory.map((k) => {
            const usable = k.n > 0 && (k.id !== 'hotfix' || (a && !a.contained)) && (k.id !== 'cache-warmer' || lockedAbilities.length > 0);
            return (
              <div key={k.id} className="dc-row">
                <span className="dc-row__icon"><Icon name={k.icon} size={16} /></span>
                <div className="dc-row__main">
                  <div className="dc-row__title">{k.name} <span className="dc-owned">{k.n}/{k.cap}</span></div>
                  <div className="dc-row__desc">{k.description}</div>
                </div>
                <div className="dc-buy">
                  <Button size="sm" variant={usable ? 'primary' : 'secondary'} disabled={!usable} onClick={() => act({ type: 'use', item: k.id })}>Usar</Button>
                  <Button size="sm" variant="ghost" disabled={k.n >= k.cap || amount < k.craftCost} onClick={() => act({ type: 'craft', item: k.id })}>
                    Fabricar · {formatNum(k.craftCost)}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="tk-menu__heading">Bestiário</div>
        <div className="dc-grid is-bestiary">
          {snap.bestiary.map((b) => (
            <div key={b.id} className={'dc-villain-card' + (b.stats ? '' : ' is-locked') + (b.boss ? ' is-boss' : '')} style={{ '--villain': b.color }}>
              <VillainSprite id={b.id} color={b.color} size={52} locked={!b.stats} className="is-static" />
              <div>
                <div className="dc-card__title">{b.stats ? b.name : '???'} {b.boss && b.stats && <span className="dc-chip is-boss">chefe</span>}</div>
                <div className="dc-card__desc">{b.stats ? b.description : 'Ainda não apareceu.'}</div>
                {b.stats && <div className="dc-villain-card__stats">visto {b.stats.seen} · contido {b.stats.contained} · escapou {b.stats.escaped} · derrotado {b.stats.defeated}</div>}
                {b.stats && <div className="dc-card__desc">Contém: {b.counterText}</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {ops.history.length > 0 && (
        <section>
          <div className="tk-menu__heading">Histórico</div>
          {ops.history.map((h, i) => (
            <div key={i} className="dc-history">
              <span className={'dc-history__dot is-' + h.outcome} />
              <b>{h.villainName}</b> <span>{h.name}</span> · {OUTCOME[h.outcome]}{h.by ? ' por ' + byName(snap, h.by) : ''} · {formatDuration(h.end - h.start)}{h.partText ? <span className="dc-history__part"> · {h.partText}</span> : ''}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
