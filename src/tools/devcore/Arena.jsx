import { DS } from '../../lib/ds.js';
import { PetSprite, auraOf } from './PetSprite.jsx';
import { VillainSprite } from './VillainSprite.jsx';
import { PartIcon } from './PartArt.jsx';
import { ForestBackdrop } from './ForestArt.jsx';
import { startMusic, stopMusic, sfx } from './audio.js';

const { Modal, Button, Icon, ProgressBar } = DS;
const STEP_MS = 420;

/**
 * Desempenho de cada pet na luta (do log): dano causado e recebido, cura, abates (último golpe), habilidades.
 * → [{ uid, id, name, dealt, taken, healed, kos, abilities, end, maxHp, mvp }]
 */
function petPerformance(battle) {
  const pets = battle.units.filter((u) => u.side === 'pet');
  const st = Object.fromEntries(pets.map((u) => [u.uid, { dealt: 0, taken: 0, healed: 0, kos: 0, abilities: 0 }]));
  const lastHit = {};
  for (const e of battle.log) {
    if (e.k === 'atk') { if (st[e.a]) st[e.a].dealt += e.v; if (st[e.t]) st[e.t].taken += e.v; if (e.t) lastHit[e.t] = e.a; }
    if (e.k === 'heal' && st[e.a]) st[e.a].healed += e.v;
    if (e.k === 'ab' && st[e.a]) st[e.a].abilities += 1;
    if (e.k === 'down' && e.t && e.t[0] === 'e' && st[lastHit[e.t]]) st[lastHit[e.t]].kos += 1;
  }
  const rows = pets.map((u) => ({ uid: u.uid, id: u.id, name: u.name, end: u.end, maxHp: u.maxHp, ...st[u.uid] }));
  const best = [...rows].sort((a, b) => b.dealt - a.dealt || b.healed - a.healed)[0];
  return rows.map((r) => ({ ...r, mvp: !!best && r.uid === best.uid && (best.dealt > 0 || best.healed > 0) }));
}

/** Ícone de uma recompensa (Patch, consumível, peça, sucata). */
function RewardIcon({ r, snap }) {
  if (r.type === 'part' && r.part) return <PartIcon id={r.part} size={18} />;
  if (r.type === 'patch' || r.type === 'swap') { const p = snap.map.patches.find((x) => x.id === r.id); return <Icon name={p ? p.icon : 'sparkles'} size={16} />; }
  if (r.type === 'item') { const k = snap.inventory.find((x) => x.id === r.id); return <Icon name={k ? k.icon : 'package'} size={16} />; }
  return <Icon name="package" size={16} />;
}

/** Resumo depois da luta: recompensas e o desempenho de cada pet (MVP = quem mais causou dano). */
function BattleSummary({ battle, snap, itemName }) {
  const perf = petPerformance(battle);
  const pet = (id) => snap.pets.find((p) => p.id === id && p.owned);
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  return (
    <div className="dc-arena-summary">
      {battle.win && (
        <section>
          <div className="tk-menu__heading">Recompensas</div>
          <div className="dc-arena-summary__rewards">
            {battle.rewards.length
              ? battle.rewards.map((r, i) => <span key={i} className={'dc-reward is-' + r.type}><RewardIcon r={r} snap={snap} />{r.text}</span>)
              : <span className="dc-row__desc">Nada desta vez.</span>}
          </div>
        </section>
      )}
      <section>
        <div className="tk-menu__heading">Desempenho do esquadrão · {battle.rounds} rodada{battle.rounds === 1 ? '' : 's'}</div>
        <table className="dc-perf">
          <thead><tr><th>DevPet</th><th>Dano</th><th>Recebido</th><th>Cura</th><th>Abates</th><th>Habilidade</th><th>Vida final</th></tr></thead>
          <tbody>
            {perf.map((r) => {
              const p = pet(r.id);
              return (
                <tr key={r.uid} className={r.mvp ? 'is-mvp' : ''}>
                  <td className="dc-perf__pet">
                    {p && <PetSprite id={p.id} color={p.color} eye={p.eye} stage={p.stage.id} size={26} className="is-static" />}
                    {r.name}{r.mvp && <span className="dc-chip is-ok">MVP</span>}
                  </td>
                  <td>{fmt(r.dealt)}</td>
                  <td>{fmt(r.taken)}</td>
                  <td>{r.healed ? fmt(r.healed) : '—'}</td>
                  <td>{r.kos || '—'}</td>
                  <td>{r.abilities ? '✓' : '—'}</td>
                  <td className={r.end <= 0 ? 'is-down' : r.end < r.maxHp * 0.5 ? 'is-low' : ''}>{r.end <= 0 ? 'caiu' : Math.round((r.end / r.maxHp) * 100) + '%'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {battle.usedItems.length > 0 && <div className="dc-arena__used is-summary"><Icon name="package" size={12} /> Consumíveis usados: {battle.usedItems.map(itemName).join(', ')}</div>}
    </div>
  );
}

/** Efeito sonoro de um evento do log. */
function sound(e) {
  if (e.k === 'atk') return e.a && e.a[0] === 'e' ? 'enemyHit' : e.c ? 'crit' : 'hit';
  return { miss: 'miss', heal: 'heal', revive: 'heal', ab: 'ability', item: 'item', down: 'down', decoy: 'miss', split: 'down' }[e.k] || null;
}

/** Botão de som (liga/desliga) — o estado fica nas preferências do DevCore. */
export function SoundToggle({ sound: on, onSound }) {
  return (
    <Button size="sm" variant="ghost" icon={on ? 'volume-2' : 'volume-x'} title={on ? 'Som ligado' : 'Som desligado'} aria-pressed={on} onClick={() => onSound(!on)}>
      {on ? 'Som' : 'Mudo'}
    </Button>
  );
}

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
export function Arena({ battle, snap, area, onClose, sound: soundOn, onSound }) {
  const [i, setI] = React.useState(0);
  const log = battle.log;
  const done = i >= log.length;
  // Música: tema da área (ou do chefe) enquanto a luta passa; fanfarra de vitória/derrota no fim.
  React.useEffect(() => { startMusic(battle.kind === 'boss' ? 'boss' : area.id); return () => stopMusic(); }, []);
  React.useEffect(() => {
    if (done) { stopMusic(); sfx(battle.win ? 'victory' : 'defeat'); return; }
    if (i > 0) { const s = sound(log[i - 1]); if (s) sfx(s); }
  }, [i, done]);
  React.useEffect(() => {
    if (done) return undefined;
    // Habilidades ficam mais tempo na tela (faixa com o nome + efeito); quedas e fortificação passam rápido.
    const k = log[i] && log[i].k;
    const t = setTimeout(() => setI((x) => x + 1), k === 'ab' ? STEP_MS * 2.2 : k === 'fortify' || k === 'down' ? STEP_MS / 2 : STEP_MS);
    return () => clearTimeout(t);
  }, [i, done]);

  // Estado das unidades até o evento i.
  const hp = {};
  const alive = {};
  const visible = {};
  for (const u of battle.units) { hp[u.uid] = u.hp != null ? u.hp : u.maxHp; alive[u.uid] = true; visible[u.uid] = !u.child; }  // começa da vida atual
  // Estados ativos das habilidades (para os efeitos visuais): escudo, buff de ataque, aceleração, marcados, carregados, clones.
  const fx = battle.abilityFx || {};
  const st = { shieldUntil: 0, buffUntil: 0, hasteUntil: 0, marked: new Set(), charged: new Set(), decoys: 0 };
  for (const e of log.slice(0, i)) {
    if (e.k === 'ab') {
      const f = fx[e.v] || {};
      if (f.type === 'shield') st.shieldUntil = e.r + f.rounds - 1;
      if (f.type === 'atkBuff') st.buffUntil = Math.max(st.buffUntil, e.r + f.rounds - 1);
      if (f.type === 'haste') st.hasteUntil = e.r + f.rounds - 1;
      if (f.type === 'burst') st.charged.add(e.a);
      if (f.type === 'decoy') st.decoys += 1;
      if (f.type === 'mark') { // o engine marca o inimigo de mais vida naquele instante
        const t = battle.units.filter((u) => u.side === 'enemy' && alive[u.uid] && visible[u.uid]).sort((a, b) => hp[b.uid] - hp[a.uid])[0];
        if (t) st.marked.add(t.uid);
      }
    }
    if (e.k === 'item' && e.v === 'coffee') st.buffUntil = Math.max(st.buffUntil, e.r + 2);
    if (e.k === 'atk' && st.charged.has(e.a)) st.charged.delete(e.a);
    if (e.k === 'decoy') st.decoys = Math.max(0, st.decoys - 1);
    if (e.k === 'atk' && e.t) hp[e.t] = Math.max(0, hp[e.t] - e.v);
    if (e.k === 'heal') hp[e.t] = Math.min(battle.units.find((u) => u.uid === e.t).maxHp, hp[e.t] + e.v);
    if (e.k === 'down') alive[e.t] = false;
    if (e.k === 'revive') { alive[e.t] = true; hp[e.t] = e.v; }
    if (e.k === 'split') visible[e.t] = true;
  }
  const cur = !done ? log[i] : null;
  const pet = (id) => snap.pets.find((p) => p.id === id);
  const abilityName = (id) => (snap.pets.find((p) => p.owned && p.ability.id === id) || { ability: { name: id } }).ability.name; // pets não encontrados não têm `ability`
  const itemName = (id) => (snap.inventory.find((k) => k.id === id) || { name: id }).name;
  const round = cur ? cur.r : log[log.length - 1].r;
  const on = { shield: st.shieldUntil >= round, buff: st.buffUntil >= round, haste: st.hasteUntil >= round };
  // Efeitos do evento atual: faixa da habilidade, golpe carregado (Compile Burst), onda de limpeza.
  const curFx = cur && cur.k === 'ab' ? (fx[cur.v] || {}) : null;
  const caster = curFx ? battle.units.find((u) => u.uid === cur.a) : null;
  const casterPet = caster ? pet(caster.id) : null;
  const burstHit = cur && cur.k === 'atk' && st.charged.has(cur.a);
  const max = battle.maxRounds || 30;
  const timeout = !battle.win && (battle.reason === 'timeout' || (log[log.length - 1].why === 'timeout'));
  // Inimigos ainda de pé no fim (para explicar o tempo esgotado).
  const standing = battle.units.filter((u) => u.side === 'enemy' && u.end > 0);

  const Unit = ({ u }) => {
    if (!visible[u.uid]) return null;
    const p = u.side === 'pet' ? pet(u.id) : null;
    const acting = cur && cur.a === u.uid;
    const hit = cur && cur.t === u.uid && (cur.k === 'atk' || cur.k === 'miss');
    // O balão vai em quem recebe (dano, cura, revive, fortificação, clone novo) ou, senão, em quem age.
    const popAt = cur && (['atk', 'miss', 'heal', 'revive', 'fortify', 'split'].includes(cur.k) ? cur.t : cur.a);
    const say = popAt === u.uid ? bubble(cur, abilityName, itemName) : '';
    return (
      <div className={'dc-arena__unit is-' + u.side + (alive[u.uid] ? '' : ' is-down') + (acting ? ' is-acting' : '') + (hit ? ' is-hit' : '') + (u.front ? ' is-front' : '') + (u.boss ? ' is-boss' : '')
        + (st.charged.has(u.uid) ? ' is-charged' : '') + (st.marked.has(u.uid) && alive[u.uid] ? ' is-marked' : '') + (burstHit && cur.t === u.uid ? ' is-burst-hit' : '')
        + (acting && curFx ? ' is-casting' : '')} style={p ? { '--pet': p.color } : undefined}>
        {st.marked.has(u.uid) && alive[u.uid] && <span className="dc-fx-reticle" aria-hidden="true" />}
        {cur && cur.k === 'heal' && cur.t === u.uid && <span className="dc-fx-sparkles" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
        {burstHit && cur.t === u.uid && <span className="dc-fx-burst" aria-hidden="true" />}
        {say && <span className={'dc-arena__pop' + (cur.k === 'heal' || cur.k === 'revive' ? ' is-heal' : '') + (cur.c ? ' is-crit' : '')}>{say}</span>}
        {u.side === 'pet'
          ? <PetSprite id={u.id} color={p ? p.color : undefined} eye={p ? p.eye : undefined} stage={p ? p.stage.id : 0} aura={p ? auraOf(p) : undefined} size={56} className="is-static" />
          : <VillainSprite id={u.sprite} color={u.color} state={alive[u.uid] ? 'active' : 'defeated'} size={u.boss ? 92 : 56} />}
        <span className="dc-arena__name">{u.name}</span>
        <ProgressBar value={(hp[u.uid] / u.maxHp) * 100} size="sm" />
      </div>
    );
  };

  const pets = battle.units.filter((u) => u.side === 'pet');
  const enemies = battle.units.filter((u) => u.side === 'enemy');
  return (
    <Modal open title={'ARENA · ' + area.name.toUpperCase()} icon="swords" onClose={onClose} width={760}
      description={done
        ? (battle.win ? 'Vitória!' : timeout ? `Tempo esgotado (${max} rodadas). Nada foi perdido além da entrada.` : 'Derrota — o esquadrão caiu. Nada foi perdido além da entrada.')
        : `Rodada ${round} de ${max}`}
      footer={<>
        {onSound && <SoundToggle sound={soundOn} onSound={onSound} />}
        {done
          ? <Button variant="primary" onClick={onClose}>Continuar</Button>
          : <Button variant="ghost" icon="fast-forward" onClick={() => setI(log.length)}>Pular</Button>}
      </>}>
      <div className={'dc-arena dc-arena--' + area.arena + (burstHit ? ' is-shake' : '') + (done ? ' is-done' : '')} aria-label={'Arena ' + area.name}>
        {area.arena === 'localhost' && <ForestBackdrop />}
        <div className={'dc-arena__side is-pets' + (on.shield ? ' is-shielded' : '') + (on.buff ? ' is-buffed' : '') + (on.haste ? ' is-hasted' : '')}>
          {on.shield && <span className="dc-fx-shield" aria-hidden="true" />}
          {curFx && curFx.type === 'cleanse' && <span className="dc-fx-wave" aria-hidden="true" />}
          {Array.from({ length: st.decoys }, (_, k) => (
            <span key={'decoy' + k} className="dc-fx-decoy" aria-hidden="true"><PetSprite id="git" color={(pet('git') || {}).color || '#F05133'} eye={(pet('git') || {}).eye} size={48} className="is-static" /></span>
          ))}
          {[...pets].sort((a, b) => (b.rank != null ? b.rank : -b.front) - (a.rank != null ? a.rank : -a.front)).map((u) => <Unit key={u.uid} u={u} />)}
        </div>
        {curFx && caster && (
          <div key={'banner' + i} className={'dc-fx-banner is-' + curFx.type} style={{ '--pet': casterPet ? casterPet.color : '#fff' }} aria-live="polite">
            <small>{caster.name}</small>{abilityName(cur.v)}
          </div>
        )}
        <div className="dc-arena__vs">VS</div>
        <div className="dc-arena__side is-enemies">{enemies.map((u) => <Unit key={u.uid} u={u} />)}</div>
        {done && (
          <div className={'dc-arena__result' + (battle.win ? ' is-win' : ' is-loss')}>
            <b>{battle.win ? 'Vitória' : timeout ? 'Tempo esgotado' : 'Derrota'}</b>
            {timeout && battle.timeoutLore && <span className="dc-arena__lore">{battle.timeoutLore}</span>}
            {timeout && <span className="dc-arena__hint">{standing.map((u) => `${u.name}: ${u.end} de vida`).join(' · ')} · dica: mais dano — habilidades no início, Coffee e Hotfix, mais atacantes.</span>}
          </div>
        )}
      </div>
      {done && <BattleSummary battle={battle} snap={snap} itemName={itemName} />}
    </Modal>
  );
}
