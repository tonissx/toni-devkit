import { DS } from '../../lib/ds.js';
import { PartIcon } from './PartArt.jsx';
import { sfx } from './audio.js';

const { Icon } = DS;
const SHOW_MS = 3200;

/**
 * Itens ganhos/comprados (log da engine) → popups { key, label, icon|part, name, description, rarity, afterBattle }.
 * Fontes: recompensas de batalha (esperam a arena fechar), loja, eventos/descanso, fabricação, missões.
 * Ver docs/devcore-mapa-singularity.md §6.2.
 */
export function gainsFrom(log, snap) {
  const out = [];
  const gen = (id) => (snap.generators.find((g) => g.id === id) || { name: id }).name;
  const add = (r, afterBattle = false) => {
    if (!r) return;
    const key = Math.random().toString(36).slice(2);
    if (r.type === 'item') {
      const k = snap.inventory.find((x) => x.id === r.id);
      if (k) out.push({ key, label: 'Consumível', icon: k.icon, name: k.name, description: k.description, rarity: 'item', afterBattle });
    } else if (r.type === 'patch' || (r.type === 'swap' && r.id)) {
      const p = snap.map.patches.find((x) => x.id === r.id);
      if (p) out.push({ key, label: 'Patch ' + p.rarityName.toLowerCase(), icon: p.icon, name: p.name, description: p.description, rarity: p.rarity, afterBattle });
    } else if (r.type === 'part') {
      out.push({ key, label: 'Peça de Blueprint', part: r.part, icon: 'package', name: r.name, description: `Peça do ${gen(r.gen)} — junte 4 para o Refactor.`, rarity: 'part', afterBattle });
    }
  };
  for (const e of log || []) {
    if (e.type === 'battle' && e.win) for (const r of e.rewards) add(r, true);
    if (e.type === 'mapBuy') add(e.reward);
    if (e.type === 'mapChoice') for (const r of e.rewards) add(r);
    if (e.type === 'craft') add({ type: 'item', id: e.id });
    if (e.type === 'quest' && e.item) add({ type: 'item', id: e.item });
  }
  return out;
}

/** Um popup por vez, com som de "ganho"; some sozinho ou com um clique. `held`: segura os que vieram de batalha. */
export function ItemPopups({ queue, held, onDone }) {
  const cur = queue.find((g) => !(held && g.afterBattle));
  React.useEffect(() => {
    if (!cur) return undefined;
    sfx('gain');
    const t = setTimeout(() => onDone(cur.key), SHOW_MS);
    return () => clearTimeout(t);
  }, [cur && cur.key]);
  if (!cur) return null;
  const more = queue.filter((g) => !(held && g.afterBattle)).length - 1;
  return (
    <div className={'dc-gain is-' + cur.rarity} role="status" aria-live="polite">
      <button type="button" className="dc-gain__card" onClick={() => onDone(cur.key)} title="Fechar">
        <span className="dc-gain__icon">{cur.part ? <PartIcon id={cur.part} size={26} /> : <Icon name={cur.icon} size={26} />}</span>
        <span className="dc-gain__text">
          <small>{cur.label}</small>
          <b>{cur.name}</b>
          <span>{cur.description}</span>
        </span>
        {more > 0 && <span className="dc-gain__more">+{more}</span>}
      </button>
    </div>
  );
}
