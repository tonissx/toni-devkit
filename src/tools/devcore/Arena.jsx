import { DS } from '../../lib/ds.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';

const { Modal, Button, Icon, ProgressBar } = DS;
const STEP_MS = 420;

/** Texto curto de um evento do log (balão sobre a unidade). */
function bubble(e, abilityName, itemName) {
  if (e.k === 'atk') return (e.c ? 'crítico! ' : '') + '−' + e.v;
  if (e.k === 'miss') return 'errou!';
  if (e.k === 'heal') return '+' + e.v;
  if (e.k === 'ab') return abilityName(e.v) + '!';
  if (e.k === 'item') return itemName(e.v) + '!';
  if (e.k === 'decoy') return 'clone!';
  if (e.k === 'revive') return 'rollback!';
  if (e.k === 'split') return 'dividiu!';
  if (e.k === 'fortify') return 'fortificou';
  return '';
}

/**
 * Arena temática da área: reproduz o log da batalha calculada pelo engine (não decide nada).
 * Pets à esquerda (frente mais perto do centro), inimigos à direita. Dá para pular.
 */
export function Arena({ battle, snap, area, onClose }) {
  const [i, setI] = React.useState(0);
  const log = battle.log;
  const done = i >= log.length;
  React.useEffect(() => {
    if (done) return undefined;
    const t = setTimeout(() => setI((x) => x + 1), log[i] && (log[i].k === 'fortify' || log[i].k === 'down') ? STEP_MS / 2 : STEP_MS);
    return () => clearTimeout(t);
  }, [i, done]);

  // Estado das unidades até o evento i.
  const hp = {};
  const alive = {};
  const visible = {};
  for (const u of battle.units) { hp[u.uid] = u.hp != null ? u.hp : u.maxHp; alive[u.uid] = true; visible[u.uid] = !u.child; }  // começa da vida atual
  for (const e of log.slice(0, i)) {
    if (e.k === 'atk' && e.t) hp[e.t] = Math.max(0, hp[e.t] - e.v);
    if (e.k === 'heal') hp[e.t] = Math.min(battle.units.find((u) => u.uid === e.t).maxHp, hp[e.t] + e.v);
    if (e.k === 'down') alive[e.t] = false;
    if (e.k === 'revive') { alive[e.t] = true; hp[e.t] = e.v; }
    if (e.k === 'split') visible[e.t] = true;
  }
  const cur = !done ? log[i] : null;
  const pet = (id) => snap.pets.find((p) => p.id === id);
  const abilityName = (id) => (snap.pets.find((p) => p.ability.id === id) || { ability: { name: id } }).ability.name;
  const itemName = (id) => (snap.inventory.find((k) => k.id === id) || { name: id }).name;
  const round = cur ? cur.r : log[log.length - 1].r;

  const Unit = ({ u }) => {
    if (!visible[u.uid]) return null;
    const p = u.side === 'pet' ? pet(u.id) : null;
    const acting = cur && cur.a === u.uid;
    const hit = cur && cur.t === u.uid && (cur.k === 'atk' || cur.k === 'miss');
    // O balão vai em quem recebe (dano, cura, revive, fortificação, clone novo) ou, senão, em quem age.
    const popAt = cur && (['atk', 'miss', 'heal', 'revive', 'fortify', 'split'].includes(cur.k) ? cur.t : cur.a);
    const say = popAt === u.uid ? bubble(cur, abilityName, itemName) : '';
    return (
      <div className={'dc-arena__unit is-' + u.side + (alive[u.uid] ? '' : ' is-down') + (acting ? ' is-acting' : '') + (hit ? ' is-hit' : '') + (u.front ? ' is-front' : '') + (u.boss ? ' is-boss' : '')}>
        {say && <span className={'dc-arena__pop' + (cur.k === 'heal' || cur.k === 'revive' ? ' is-heal' : '') + (cur.c ? ' is-crit' : '')}>{say}</span>}
        {u.side === 'pet'
          ? <PetSprite id={u.id} color={p ? p.color : undefined} eye={p ? p.eye : undefined} stage={p ? p.stage.id : 0} aura={p ? auraOf(p) : undefined} size={56} className="is-static" />
          : <VillainSprite id={u.sprite} color={u.color} state={alive[u.uid] ? 'active' : 'defeated'} size={u.boss ? 84 : 56} />}
        <span className="dc-arena__name">{u.name}</span>
        <ProgressBar value={(hp[u.uid] / u.maxHp) * 100} size="sm" />
      </div>
    );
  };

  const pets = battle.units.filter((u) => u.side === 'pet');
  const enemies = battle.units.filter((u) => u.side === 'enemy');
  return (
    <Modal open title={'ARENA · ' + area.name.toUpperCase()} icon="swords" onClose={onClose} width={760}
      description={done ? (battle.win ? 'Vitória!' : 'Derrota — nada foi perdido além da entrada. Ajuste o esquadrão e tente de novo.') : `Rodada ${round}`}
      footer={done
        ? <Button variant="primary" onClick={onClose}>Continuar</Button>
        : <Button variant="ghost" icon="fast-forward" onClick={() => setI(log.length)}>Pular</Button>}>
      <div className={'dc-arena dc-arena--' + area.arena} aria-label={'Arena ' + area.name}>
        <div className="dc-arena__side is-pets">{[...pets].sort((a, b) => a.front - b.front).map((u) => <Unit key={u.uid} u={u} />)}</div>
        <div className="dc-arena__vs">VS</div>
        <div className="dc-arena__side is-enemies">{enemies.map((u) => <Unit key={u.uid} u={u} />)}</div>
        {done && (
          <div className={'dc-arena__result' + (battle.win ? ' is-win' : ' is-loss')}>
            <b>{battle.win ? 'Vitória' : 'Derrota'}</b>
            {battle.win && battle.rewards.length > 0 && <span>{battle.rewards.map((r) => r.text).join(' · ')}</span>}
            {battle.usedItems.length > 0 && <span className="dc-arena__used"><Icon name="package" size={12} /> usados: {battle.usedItems.map(itemName).join(', ')}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
