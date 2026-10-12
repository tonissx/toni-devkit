import { DS } from '../../lib/ds.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { PartIcon } from './PartArt.jsx';
import { UpgradeArt } from './UpgradeArt.jsx';
import { InfoCard } from './InfoCard.jsx';

const { Button, Icon, ProgressBar, Toggle } = DS;

const catIcon = (snap, id) => (snap.categories.find((c) => c.id === id) || { icon: 'cpu' }).icon;
const KIND = { generator: 'Gerador', global: 'Global', mechanic: 'Mecânica', pet: 'DevPet', combo: 'Combo' };
const pctText = (v) => '+' + formatNum(v * 100, { rate: true }) + '%';

/* ─────────────── Generators ─────────────── */
export const MK = { 1: 'I', 2: 'II', 3: 'III' };
const multText = (m) => '×' + (Number.isInteger(m) ? m : m.toFixed(1).replace('.', ','));

/** Barrinha do próximo marco: "×2 em 100 · faltam 15". */
function Milestone({ g }) {
  const m = g.nextMilestone;
  if (!m) return <div className="dc-mile is-done">Todos os marcos atingidos</div>;
  const pct = ((g.owned - m.from) / (m.at - m.from)) * 100;
  return (
    <div className="dc-mile" title={`Ao chegar em ${m.at} unidades, a produção deste gerador ${multText(m.mult)}`}>
      <ProgressBar value={pct} size="sm" />
      <span>{multText(m.mult)} em {m.at} · faltam {m.left}</span>
    </div>
  );
}

/** Conjunto do próximo Mk: peças obtidas/faltantes, Comprar/Trocar e Refactor. */
function BlueprintArea({ g, snap, amount, act }) {
  const bp = g.blueprint;
  if (!bp) return <div className="dc-bp"><div className="dc-bp__head">Mk III · nível máximo</div></div>;
  return (
    <div className="dc-bp">
      <div className="dc-bp__head">
        Blueprint <b>Mk {MK[bp.mk]}</b> · produção {multText(bp.mult)}{bp.costDiv > 1 ? ` · próximas unidades ÷${bp.costDiv}` : ''}
        {bp.mk === 3 && <span className="dc-bp__hint">peças raras: Zero, vilões contidos ou compra</span>}
      </div>
      <div className="dc-bp__parts">
        {bp.parts.map((p) => (
          <div key={p.id} className={'dc-part' + (p.owned ? ' is-owned' : '')}>
            <PartIcon id={p.id} />
            <span className="dc-part__name">{p.name}</span>
            {p.owned && <Icon name="check" size={12} />}
            {!p.owned && (
              <span className="dc-part__actions">
                <Button size="sm" variant="ghost" disabled={amount < bp.buyCost} title="Comprar com Compute" onClick={() => act({ type: 'buyPart', part: p.id })}>
                  {formatNum(bp.buyCost)}
                </Button>
                <Button size="sm" variant="ghost" disabled={snap.scrap < bp.scrapCost} title={`Trocar ${bp.scrapCost} sucatas por esta peça`} onClick={() => act({ type: 'scrapPart', part: p.id })}>
                  {bp.scrapCost} sucata
                </Button>
              </span>
            )}
          </div>
        ))}
      </div>
      {bp.complete && (
        <Button size="sm" variant="primary" onClick={() => act({ type: 'refactor', gen: g.id })}>
          <Icon name="sparkles" size={13} /> Refactor → Mk {MK[bp.mk]}
        </Button>
      )}
    </div>
  );
}

const rateText = (v) => '+' + formatNum(v, { rate: true }) + '/s';

/** Linha "rótulo · valor" dos cartões de detalhes. */
const InfoRow = ({ k, children }) => <div className="dc-info__row"><span>{k}</span><b>{children}</b></div>;

/** Nome de um gerador com o ícone dele (o mesmo da linha na aba Generators). */
const GenLabel = ({ snap, id, name }) => {
  const g = snap.generators.find((x) => x.id === id);
  return <span className="dc-info__gen"><Icon name={catIcon(snap, g ? g.category : null)} size={12} />{name}</span>;
};

/** Detalhes de um gerador (hover no nome): descrição, cada um, multiplicador, próximo marco, participação. */
function GenDetails({ g }) {
  const m = g.nextMilestone;
  return (
    <>
      <div className="dc-info__title">{g.name}</div>
      <p className="dc-info__text">{g.description}</p>
      <InfoRow k="Cada um">{g.each != null ? rateText(g.each) : 'nenhum ainda'}</InfoRow>
      {g.mult > 1 && <InfoRow k="Multiplicador (marcos × Mk)">{multText(g.mult)}</InfoRow>}
      <InfoRow k="Próximo marco">{m ? `${multText(m.mult)} em ${m.at} (faltam ${m.left})` : 'todos atingidos'}</InfoRow>
      {g.owned > 0 && <InfoRow k="Participação">{formatNum(g.share * 100, { rate: true })}% do total</InfoRow>}
    </>
  );
}

/** Detalhes dos combos de um gerador (hover no selo): quem ele impulsiona, quanto rende e quem impulsiona ele. */
function ComboDetails({ g, snap }) {
  return (
    <>
      {g.boosts.length > 0 && <>
        <div className="dc-info__title"><Icon name="git-merge" size={12} /> Também impulsiona</div>
        {g.boosts.map((b) => <InfoRow key={b.id} k={<GenLabel snap={snap} id={b.id} name={b.name} />}>{pctText(b.pct)}</InfoRow>)}
        {g.boostRate > 0 && <p className="dc-info__text">Rende {rateText(g.boostRate)} ({formatNum(g.boostShare * 100, { rate: true })}% do total).</p>}
      </>}
      {g.boostedBy.length > 0 && <>
        <div className="dc-info__title"><Icon name="arrow-down-right" size={12} /> Impulsionado por</div>
        {g.boostedBy.map((b) => <InfoRow key={b.id} k={<GenLabel snap={snap} id={b.id} name={b.name} />}>{pctText(b.pct)}</InfoRow>)}
      </>}
    </>
  );
}

/** Selo de combo na linha do gerador: nº de ligações; os detalhes ficam no hover. */
function ComboBadge({ g, snap }) {
  const n = g.boosts.length + g.boostedBy.length;
  if (!n) return null;
  return (
    <InfoCard content={<ComboDetails g={g} snap={snap} />} label={`Combos de ${g.name}: ${n}`}>
      <span className="dc-combo-badge"><Icon name="git-merge" size={11} />{n}</span>
    </InfoCard>
  );
}

export function GeneratorsPanel({ snap, amount, act }) {
  const [open, setOpen] = React.useState(null);
  const unlocked = snap.generators.filter((g) => g.unlocked);
  const ready = unlocked.filter((g) => g.blueprint && g.blueprint.complete).length;
  return (
    <div className="dc-list">
      <div className="dc-bp-bar">
        <span><Icon name="package" size={13} /> Blueprints: junte 4 peças para dar Refactor num gerador (Mk II ×3, Mk III ×5).</span>
        {ready > 0 && <span className="dc-chip is-ok">{ready} pronto{ready > 1 ? 's' : ''} para Refactor</span>}
        <span className="dc-chip" title="Peças repetidas viram sucata; troque sucata por uma peça que falta">Sucata {snap.scrap}</span>
      </div>
      {snap.generators.map((g) => (g.unlocked ? (
        <div key={g.id} className={'dc-gen' + (g.mk > 1 ? ' is-mk' + g.mk : '')}>
        <div className="dc-row">
          <span className="dc-row__icon"><Icon name={catIcon(snap, g.category)} size={16} /></span>
          <div className="dc-row__main">
            <div className="dc-row__title">
              <InfoCard content={<GenDetails g={g} />}><span className="dc-info-label">{g.name}</span></InfoCard>
              <span className="dc-owned">{g.owned}</span>
              {g.mk > 1 && <span className={'dc-mk is-mk' + g.mk}>Mk {MK[g.mk]}</span>}
              <button type="button" className={'dc-bp-toggle' + (g.blueprint && g.blueprint.complete ? ' is-ready' : '')} aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                <Icon name="package" size={11} />{g.blueprint ? `${g.blueprint.owned}/4` : 'máx'}
              </button>
              <ComboBadge g={g} snap={snap} />
            </div>
            <Milestone g={g} />
          </div>
          <div className="dc-row__stat">
            <b>{rateText(g.rate)}</b>
            {g.owned > 0 && <span>{formatNum(g.share * 100, { rate: true })}% do total</span>}
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
        {open === g.id && <BlueprintArea g={g} snap={snap} amount={amount} act={act} />}
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
/** Resumo de uma linha: o par do combo, o efeito numérico (gerador/global) ou a descrição curta. */
function upgradeSummary(u) {
  if (u.combo) return `${u.combo.fromName} → ${u.combo.toName}`;
  if ((u.kind === 'generator' || u.kind === 'global') && u.effects.length) return u.effects.join(' · ');
  return u.description;
}

/** Detalhes de um upgrade (hover): categoria, descrição, efeitos, quanto o combo rende e o requisito. */
function UpgradeDetails({ u }) {
  const showEffects = u.combo || u.kind === 'generator' || u.kind === 'global';
  return (
    <>
      <div className="dc-info__title">{u.name} <span className="dc-chip">{KIND[u.kind]}</span></div>
      <p className="dc-info__text">{u.description}</p>
      {showEffects && u.effects.map((e) => <InfoRow key={e} k="Efeito">{e}</InfoRow>)}
      {u.comboNow.length > 0 && <InfoRow k={u.status === 'owned' ? 'Ativo' : 'Se comprar agora'}>{u.comboNow.join(' · ')}</InfoRow>}
      {u.status === 'locked' && <InfoRow k="Requer">{u.requirement}</InfoRow>}
    </>
  );
}

/** Card compacto: ilustração, nome, resumo e custo. O resto no hover. */
function UpgradeCard({ u, snap, amount, act }) {
  const locked = u.status === 'locked';
  const secret = locked && !(u.combo && u.combo.visible); // upgrade comum bloqueado: ainda um mistério
  const head = (
    <>
      <UpgradeArt u={u} locked={secret} size={36} />
      <div className="dc-upg__text">
        <div className="dc-card__title">{secret ? '???' : u.name}</div>
        {!secret && <div className="dc-upg__summary">{upgradeSummary(u)}</div>}
      </div>
    </>
  );
  return (
    <div className={'dc-card dc-upg' + (snap.newUpgrades.includes(u.id) ? ' is-new' : '') + (locked ? ' is-locked' : '')}>
      {secret ? <div className="dc-upg__head">{head}</div> : <InfoCard className="dc-upg__head" content={<UpgradeDetails u={u} />}>{head}</InfoCard>}
      {locked && <div className="dc-card__desc">Requer {u.requirement}</div>}
      {u.status === 'available' && (
        <Button size="sm" variant={amount >= u.cost ? 'primary' : 'secondary'} disabled={amount < u.cost} onClick={() => act({ type: 'upgrade', id: u.id })}>
          {formatNum(u.cost)} Compute
        </Button>
      )}
    </div>
  );
}

/** Upgrades instalados: chips com ilustração; os detalhes (e quanto um combo rende) ficam no hover. */
function InstalledChips({ title, list }) {
  if (!list.length) return null;
  return (
    <div className="dc-owned-list">
      <div className="tk-menu__heading">{title} ({list.length})</div>
      {list.map((u) => (
        <InfoCard key={u.id} content={<UpgradeDetails u={u} />}>
          <span className="dc-chip dc-chip--art"><UpgradeArt u={u} size={18} />{u.name}</span>
        </InfoCard>
      ))}
    </div>
  );
}

export function UpgradesPanel({ snap, amount, act }) {
  const regular = snap.upgrades.filter((u) => u.kind !== 'combo');
  const available = regular.filter((u) => u.status === 'available');
  const locked = regular.filter((u) => u.status === 'locked').slice(0, 2);
  // Combos: em cards os disponíveis e os próximos já revelados (com o requisito); os ativos viram chips.
  const combos = snap.upgrades.filter((u) => u.kind === 'combo');
  const shown = combos.filter((u) => u.combo.visible);
  const pending = [...shown.filter((u) => u.status === 'available'), ...shown.filter((u) => u.status === 'locked')];
  const active = shown.filter((u) => u.status === 'owned');
  return (
    <div className="dc-upgrades">
      <section>
        <div className="tk-menu__heading">Upgrades</div>
        {!available.length && <div className="dc-empty">Nenhum upgrade disponível agora — continue produzindo.</div>}
        <div className="dc-grid">
          {[...available, ...locked].map((u) => <UpgradeCard key={u.id} u={u} snap={snap} amount={amount} act={act} />)}
        </div>
        <InstalledChips title="Instalados" list={regular.filter((u) => u.status === 'owned')} />
      </section>

      <section>
        <div className="dc-upgrades__head">
          <span className="tk-menu__heading"><Icon name="git-merge" size={12} /> Combos</span>
          <span className="dc-chip">{active.length}/{combos.length} ativos</span>
          <span className="dc-upgrades__hint">Um gerador mais barato fortalece um mais caro.</span>
        </div>
        {pending.length > 0 && <div className="dc-grid">{pending.map((u) => <UpgradeCard key={u.id} u={u} snap={snap} amount={amount} act={act} />)}</div>}
        <InstalledChips title="Ativos" list={active} />
        {shown.length < combos.length && <div className="dc-empty">{combos.length - shown.length} combo(s) aparecem com os próximos tiers.</div>}
      </section>
    </div>
  );
}

/* ─────────────── DevPets ─────────────── */
/** Amostras de visual: desbloqueados clicáveis, bloqueados com o requisito no tooltip. */
function SkinPicker({ pet, skins, act }) {
  return (
    <div className="dc-skins" role="group" aria-label={'Visual de ' + pet.name}>
      <span className="dc-skins__label">Visual</span>
      {skins.filter((k) => !k.pet || k.pet === pet.id).map((k) => {
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

/** Missões do dia: só cosméticos e consumíveis (nada de produção); ignorar um dia não custa nada. */
function QuestsCard({ quests }) {
  const done = quests.items.filter((q) => q.done).length;
  return (
    <section className="dc-quests" aria-label="Missões do dia">
      <div className="dc-quests__head">
        <span className="tk-menu__heading">Missões do dia</span>
        <span className="dc-chip" title="Missões concluídas na vida (sem streak)">{quests.total} concluídas</span>
        {quests.nextSkin && <span className="dc-chip is-muted" title="Próximo visual por missões">{quests.nextSkin.name} em {quests.nextSkin.left}</span>}
        <span className="dc-quests__hint">Opcional · rende visuais e, às vezes, um consumível · {done}/{quests.items.length}</span>
      </div>
      <div className="dc-quests__list">
        {quests.items.map((q) => (
          <div key={q.id} className={'dc-quest' + (q.done ? ' is-done' : '')}>
            <Icon name={q.done ? 'check' : 'circle'} size={13} />
            <div className="dc-row__main">
              <div className="dc-row__title">{q.title}{q.pet && <span className="dc-chip is-muted">{q.pet}</span>}</div>
              <div className="dc-row__desc">{q.text}{q.need > 1 && !q.done ? ` (${q.progress}/${q.need})` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PetsPanel({ snap, amount, act, now }) {
  return (
    <div>
    <QuestsCard quests={snap.quests} />
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
