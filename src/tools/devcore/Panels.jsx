import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';

const { Button, Icon, ProgressBar, Toggle } = DS;

const catIcon = (snap, id) => (snap.categories.find((c) => c.id === id) || { icon: 'cpu' }).icon;
const KIND = { generator: 'Gerador', global: 'Global', mechanic: 'Mecânica', pet: 'DevPet' };

/* ─────────────── Generators ─────────────── */
export function GeneratorsPanel({ snap, amount, act }) {
  return (
    <div className="dc-list">
      {snap.generators.map((g) => (g.unlocked ? (
        <div key={g.id} className="dc-row">
          <span className="dc-row__icon"><Icon name={catIcon(snap, g.category)} size={16} /></span>
          <div className="dc-row__main">
            <div className="dc-row__title">{g.name} <span className="dc-owned">{g.owned}</span></div>
            <div className="dc-row__desc">{g.description}</div>
          </div>
          <div className="dc-row__stat">
            <b>+{formatNum(g.rate, { rate: true })}/s</b>
            <span>{g.each != null ? formatNum(g.each, { rate: true }) + '/s cada' : 'nenhum ainda'}</span>
          </div>
          <div className="dc-buy">
            <Button size="sm" variant={amount >= g.cost1 ? 'primary' : 'secondary'} disabled={amount < g.cost1} onClick={() => act({ type: 'buy', gen: g.id, qty: 1 })}>
              +1 · {formatNum(g.cost1)}
            </Button>
            <Button size="sm" variant="secondary" disabled={amount < g.cost10} onClick={() => act({ type: 'buy', gen: g.id, qty: 10 })}>
              +10 · {formatNum(g.cost10)}
            </Button>
            <Button size="sm" variant="ghost" disabled={!g.max} onClick={() => act({ type: 'buy', gen: g.id, qty: 'max' })}>
              Máx{g.max ? ' (' + g.max + ')' : ''}
            </Button>
          </div>
        </div>
      ) : (
        <div key={g.id} className="dc-row is-locked">
          <span className="dc-row__icon"><Icon name="lock" size={16} /></span>
          <div className="dc-row__main">
            <div className="dc-row__title">???</div>
            <div className="dc-row__desc">Liberado no Tier {g.tier}</div>
          </div>
        </div>
      )))}
    </div>
  );
}

/* ─────────────── Upgrades ─────────────── */
export function UpgradesPanel({ snap, amount, act }) {
  const available = snap.upgrades.filter((u) => u.status === 'available');
  const locked = snap.upgrades.filter((u) => u.status === 'locked').slice(0, 2);
  const owned = snap.upgrades.filter((u) => u.status === 'owned');
  return (
    <div className="dc-upgrades">
      {!available.length && <div className="dc-empty">Nenhum upgrade disponível agora — continue produzindo.</div>}
      <div className="dc-grid">
        {available.map((u) => (
          <div key={u.id} className={'dc-card' + (snap.newUpgrades.includes(u.id) ? ' is-new' : '')}>
            <div className="dc-card__kind">{KIND[u.kind]}</div>
            <div className="dc-card__title">{u.name}</div>
            <div className="dc-card__desc">{u.description}</div>
            <Button size="sm" variant={amount >= u.cost ? 'primary' : 'secondary'} disabled={amount < u.cost} onClick={() => act({ type: 'upgrade', id: u.id })}>
              {formatNum(u.cost)} Compute
            </Button>
          </div>
        ))}
        {locked.map((u) => (
          <div key={u.id} className="dc-card is-locked">
            <div className="dc-card__kind">{KIND[u.kind]}</div>
            <div className="dc-card__title">???</div>
            <div className="dc-card__desc">Requer {u.requirement}</div>
          </div>
        ))}
      </div>
      {owned.length > 0 && (
        <div className="dc-owned-list">
          <div className="tk-menu__heading">Instalados ({owned.length})</div>
          {owned.map((u) => <span key={u.id} className="dc-chip"><Icon name="check" size={12} />{u.name}</span>)}
        </div>
      )}
    </div>
  );
}

/* ─────────────── DevPets ─────────────── */
/** Amostras de visual: desbloqueados clicáveis, bloqueados com o requisito no tooltip. */
function SkinPicker({ pet, skins, act }) {
  return (
    <div className="dc-skins" role="group" aria-label={'Visual de ' + pet.name}>
      <span className="dc-skins__label">Visual</span>
      {skins.map((k) => {
        const body = k.colors.body || pet.baseColor;
        const on = pet.skin === k.id;
        return k.unlocked ? (
          <button key={k.id} type="button" className={'dc-skin' + (on ? ' is-on' : '') + (k.fresh ? ' is-fresh' : '')}
            style={{ '--swatch': body, '--swatch-eye': k.colors.eye || 'var(--dc-eye)' }}
            aria-pressed={on} aria-label={k.name} title={k.name + (k.fresh ? ' (novo)' : '')}
            onClick={() => !on && act({ type: 'skin', pet: pet.id, skin: k.id })} />
        ) : (
          <span key={k.id} className="dc-skin is-locked" title={`${k.name} — requer ${k.requirement}`} aria-label={`${k.name}, bloqueado: requer ${k.requirement}`}>
            <Icon name="lock" size={10} />
          </span>
        );
      })}
    </div>
  );
}

function AbilityButton({ a, act, now }) {
  if (a.locked) return <span className="dc-ability__lock">Habilidades liberam no Tier 2</span>;
  const activeMs = a.activeUntil - now;
  const waitMs = a.readyAt - now;
  if (activeMs > 0) return <span className="dc-ability__on"><Icon name="zap" size={12} /> ativa · {formatDuration(activeMs)}</span>;
  if (waitMs > 0) {
    const pct = 100 - (waitMs / (a.cooldownSec * 1000)) * 100;
    return <span className="dc-ability__cd"><ProgressBar value={pct} size="sm" /> {formatDuration(waitMs)}</span>;
  }
  return <Button size="sm" variant="primary" icon="zap" onClick={() => act({ type: 'ability', id: a.id })}>Ativar</Button>;
}

export function PetsPanel({ snap, amount, act, now }) {
  return (
    <div className="dc-grid is-pets">
      {snap.pets.map((p) => (p.owned ? (
        <div key={p.id} className="dc-pet-card" style={{ '--pet': p.color }}>
          <div className="dc-pet-card__head">
            <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} aura={auraOf(p)} size={56} className="is-static" />
            <div>
              <div className="dc-card__title">{p.name} <span className={'dc-rarity is-' + p.rarity}>{p.rarityName}</span></div>
              <div className="dc-card__desc">{p.specialization} · {p.species}</div>
              <div className="dc-stage">Estágio: <b>{p.stage.name}</b>{p.stage.next ? ` · ${p.stage.next.name} no nível ${p.stage.next.level}` : ''}</div>
            </div>
          </div>
          <SkinPicker pet={p} skins={snap.skins} act={act} />
          <div className="dc-pet-card__level">
            <span>Nível {p.level}/{p.maxLevel}</span>
            <ProgressBar value={(p.level / p.maxLevel) * 100} size="sm" />
          </div>
          <div className="dc-pet-card__bonus">{p.bonus.map((b) => <span key={b} className="dc-chip">{b}</span>)}</div>
          <div className="dc-pet-card__actions">
            {p.trainCost != null
              ? <Button size="sm" variant="secondary" icon="dumbbell" disabled={amount < p.trainCost} onClick={() => act({ type: 'train', pet: p.id })}>Treinar · {formatNum(p.trainCost)}</Button>
              : <span className="dc-chip">Nível máximo</span>}
            {snap.tier.id >= 3 && (
              <Toggle size="sm" label={'Estação ' + (p.station ? '(×2)' : '')} checked={p.station} disabled={!p.canStation && !p.station}
                onChange={(on) => act({ type: 'station', pet: p.id, on })} />
            )}
          </div>
          <div className="dc-ability">
            <div><b>{p.ability.name}</b> <span>{p.ability.description}</span></div>
            <AbilityButton a={p.ability} act={act} now={now} />
          </div>
        </div>
      ) : (
        <div key={p.id} className="dc-pet-card is-locked">
          <div className="dc-pet-card__head">
            <PetSprite id={p.id} size={48} locked className="is-static" />
            <div>
              <div className="dc-card__title">???</div>
              <div className="dc-card__desc">Aparece com a descoberta <b>{p.hint}</b></div>
            </div>
          </div>
        </div>
      )))}
    </div>
  );
}

/* ─────────────── Tech (tiers, sinergias, descobertas) ─────────────── */
export function TechPanel({ snap, freshUnseen }) {
  const found = snap.discoveries.filter((d) => d.found).sort((a, b) => b.at - a.at);
  const hidden = snap.discoveries.length - found.length;
  return (
    <div className="dc-tech">
      <section>
        <div className="tk-menu__heading">Evolução</div>
        <div className="dc-tiers">
          {snap.tiers.map((t) => {
            const on = snap.tier.id >= t.id;
            const cur = snap.tier.id === t.id;
            const visible = on || t.id === snap.tier.id + 1; // mais adiante: ainda um mistério
            return (
              <div key={t.id} className={'dc-tier' + (on ? ' is-on' : '') + (cur ? ' is-cur' : '')}>
                <div className="dc-tier__id">Tier {t.id}{on && !cur ? ' ✓' : ''}</div>
                <div className="dc-tier__name">{visible ? t.name : '???'}</div>
                {visible && <div className="dc-tier__mech">{t.mechanic}</div>}
                {!on && visible && t.at > 0 && <div className="dc-tier__req">{formatNum(t.at)} Compute acumulado</div>}
              </div>
            );
          })}
        </div>
      </section>
      {snap.synergies.length > 0 && (
        <section>
          <div className="tk-menu__heading">Sinergias</div>
          {snap.synergies.map((s) => (
            <div key={s.id} className={'dc-synergy' + (s.active ? ' is-on' : '')}>
              <span className="dc-synergy__led" />
              <div className="dc-row__main">
                <div className="dc-row__title">{s.name} <span className="dc-chip">{s.effects.join(' · ')}</span></div>
                <div className="dc-row__desc">{s.active ? s.description : 'Falta: ' + s.missing.join(', ')}</div>
              </div>
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="tk-menu__heading">Descobertas</div>
        {found.map((d) => (
          <div key={d.id} className={'dc-discovery' + (freshUnseen.includes(d.id) ? ' is-new' : '')}>
            <div className="dc-discovery__title">{freshUnseen.includes(d.id) && <span className="dc-new">NOVO</span>}{d.title}</div>
            <div className="dc-row__desc">{d.text}</div>
          </div>
        ))}
        {hidden > 0 && <div className="dc-empty">{hidden} descoberta(s) ainda escondida(s) — explore o DevKit.</div>}
      </section>
    </div>
  );
}
