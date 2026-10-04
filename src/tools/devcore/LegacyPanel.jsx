import { DS } from '../../lib/ds.js';
import { formatNum } from '../../devcore/engine/format.js';

const { Button, Icon, ProgressBar, Modal } = DS;

const pct = (v) => '+' + formatNum(v * 100, { rate: true }) + '%';

/** O que o Rebuild zera e o que fica — derivado dos perks (keep/start). */
function RebuildConfirm({ L, onCancel, onConfirm }) {
  const st = L.start;
  const resets = ['Compute e geradores', 'Upgrades e tiers', 'Níveis dos DevPets' + (st.petLevel > 1 ? ` (voltam no nível ${st.petLevel})` : ''),
    st.keep.mk > 1 ? 'Blueprints acima do Mk II' : 'Blueprints (Mk e peças)',
    ...(st.keep.inventory ? [] : ['Consumíveis em estoque']), ...(st.keep.scrap ? [] : ['Sucata'])];
  const keeps = ['Legado, fragmentos e perks', 'Descobertas — DevPets e tiers voltam conforme elas', 'Visuais, bestiário e missões',
    ...(st.keep.inventory ? ['Consumíveis em estoque'] : []), ...(st.keep.scrap ? ['Sucata e peças soltas'] : []), ...(st.keep.mk > 1 ? ['Mk II dos geradores'] : [])];
  const start = [st.tier > 1 && `Tier ${st.tier}`, st.compute > 0 && `${formatNum(st.compute)} Compute`,
    ...st.gens.map((g) => `${g.n} ${g.name}`), st.shields > 0 && `${st.shields} Rollback armado`, ...st.items.map((k) => `${k.n} ${k.name}`)].filter(Boolean);
  return (
    <Modal open title="REBUILD" icon="refresh-ccw" onClose={onCancel} width={460}
      description="Reescrever a infraestrutura do zero com o que você aprendeu."
      footer={<>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" icon="refresh-ccw" onClick={onConfirm}>Rebuild · +{L.pending} fragmento{L.pending > 1 ? 's' : ''}</Button>
      </>}>
      <div className="dc-welcome">
        <div className="dc-welcome__big">+{L.pending} <span>fragmentos · nível {L.level} → {L.level + L.pending}</span></div>
        <div className="dc-welcome__note">Produção permanente {pct(L.bonus)} → {pct((L.level + L.pending) * L.perLevel)}</div>
        <div className="dc-legacy__cols">
          <div><div className="tk-menu__heading">Volta ao zero</div>{resets.map((x) => <div key={x} className="dc-welcome__line is-warn"><Icon name="rotate-ccw" size={12} /> {x}</div>)}</div>
          <div><div className="tk-menu__heading">Fica para sempre</div>{keeps.map((x) => <div key={x} className="dc-welcome__line"><Icon name="check" size={12} /> {x}</div>)}</div>
        </div>
        {start.length > 0 && <div className="dc-welcome__line"><Icon name="rocket" size={12} /> A nova run começa com: {start.join(' · ')}</div>}
      </div>
    </Modal>
  );
}

function PerkNode({ k, act }) {
  const cls = 'dc-perk is-' + k.status + (k.affordable ? ' is-affordable' : '');
  const req = k.status === 'locked' ? `Requer ${k.requires.join(k.any ? ' ou ' : ' + ')}` : '';
  return (
    <button type="button" className={cls} disabled={!k.affordable} title={req || k.description}
      aria-label={`${k.name}, ${k.status === 'owned' ? 'adquirido' : k.cost + ' fragmentos'}. ${k.description}${req ? '. ' + req : ''}`}
      onClick={() => act({ type: 'perk', id: k.id })}>
      <span className="dc-perk__head">
        <span className="dc-perk__name">{k.name}</span>
        {k.status === 'owned' ? <Icon name="check" size={12} /> : <span className="dc-perk__cost"><Icon name="gem" size={11} />{k.cost}</span>}
      </span>
      <span className="dc-perk__desc">{k.status === 'locked' ? req : k.description}</span>
    </button>
  );
}

export function LegacyPanel({ snap, act }) {
  const L = snap.legacy;
  const [confirm, setConfirm] = React.useState(false);
  const byBranch = (id) => L.perks.filter((k) => k.branch === id);
  const core = byBranch('core');
  const root = core.filter((k) => !k.requires.length);
  const capstone = core.filter((k) => k.requires.length);
  const owned = L.perks.filter((k) => k.status === 'owned').length;

  return (
    <div className="dc-legacy">
      <section className="dc-legacy__top">
        <div className="dc-legacy__stat">
          <span className="dc-amount__label">Nível de Legado</span>
          <b>{L.level}</b>
          <span>produção ×{formatNum(1 + L.bonus, { rate: true })} para sempre</span>
        </div>
        <div className="dc-legacy__stat">
          <span className="dc-amount__label">Fragmentos</span>
          <b><Icon name="gem" size={16} /> {L.fragments}</b>
          <span>{owned}/{L.perks.length} perks · {L.rebuilds} rebuild{L.rebuilds === 1 ? '' : 's'}</span>
        </div>
        <div className="dc-legacy__rebuild">
          {L.canRebuild
            ? <div className="dc-legacy__pending">Rebuild agora: <b>+{L.pending}</b> fragmento{L.pending > 1 ? 's' : ''}</div>
            : <div className="dc-legacy__pending">{L.reason}</div>}
          <ProgressBar value={L.nextPct} size="sm" />
          <span className="dc-legacy__next">Próximo fragmento em {formatNum(L.nextLeft)} Compute</span>
          <Button size="sm" variant={L.canRebuild ? 'primary' : 'secondary'} icon="refresh-ccw" disabled={!L.canRebuild} onClick={() => setConfirm(true)}>Rebuild…</Button>
        </div>
      </section>

      <div className="dc-empty">
        Rebuild converte o Compute acumulado em <b>fragmentos</b>: cada um é +{formatNum(L.perLevel * 100, { rate: true })}% de produção permanente
        e compra perks da árvore. Quanto mais você produz antes, mais rende (com retorno decrescente).
      </div>

      <section className="dc-tree" aria-label="Árvore de Legado">
        <div className="dc-tree__row">{root.map((k) => <PerkNode key={k.id} k={k} act={act} />)}</div>
        <div className="dc-tree__branches">
          {L.branches.filter((b) => b.id !== 'core').map((b) => (
            <div key={b.id} className="dc-tree__branch">
              <div className="dc-tree__label"><Icon name={b.icon} size={12} /> {b.name}</div>
              {byBranch(b.id).map((k) => <PerkNode key={k.id} k={k} act={act} />)}
            </div>
          ))}
        </div>
        <div className="dc-tree__row is-capstone">{capstone.map((k) => <PerkNode key={k.id} k={k} act={act} />)}</div>
      </section>

      {confirm && <RebuildConfirm L={L} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); act({ type: 'rebuild' }); }} />}
    </div>
  );
}
