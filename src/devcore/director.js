'use strict';
/**
 * Diretor da cena do DevCore — só visual. Decide, a partir do tempo e de reações recentes, onde
 * cada DevPet está, o que está fazendo e o que "diz". Determinístico (hash do id + fatia de tempo):
 * a mesma hora sempre mostra a mesma cena, sem estado escondido e sem IA.
 *
 * Atividades: working (na estação) · idle (descansando no canto) · celebrate · found (achou algo) · evolve
 */

/** Hash inteiro estável de uma string. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (list, n) => list[n % list.length];

const REACTION_MS = 3500;
const MAX_PER_SPOT = 2; // mais que isso não cabe (sprites e balões se atropelam)

/**
 * pets: [{ id, category, lines, station? }] (só os que o jogador tem; em estação = fixo no posto)
 * stations: [{ id }] categorias com produção (na ordem da cena)
 * reactions: [{ at, type, pet?, category?, text? }] (mais recentes por último)
 * opts.villain: { spot, name, contained, by } — o vilão ocupa um lugar; quem o conteve fala disso
 * → [{ id, spot: índice da estação | -1 (descanso), activity, line }]
 */
function plan(pets, stations, t, reactions = [], opts = {}) {
  const count = new Map(); // lugar → figuras já posicionadas
  const villain = opts.villain || null;
  if (villain) count.set(villain.spot, 1);
  const free = (spot) => (count.get(spot) || 0) < MAX_PER_SPOT;
  return pets.map((p, i) => {
    const h = hash(p.id);
    const len = 9000 + (h % 7) * 1000;                  // cada pet muda de atividade no seu ritmo
    const seg = Math.floor((t + (h % 5000)) / len);
    const r = hash(p.id + ':' + seg);
    const home = stations.findIndex((s) => s.id === p.category);
    let spot;
    const roll = r % 100;
    if (!stations.length || roll >= 80) spot = -1;       // 20%: descansando
    else if (roll < 55 && home !== -1) spot = home;       // 55%: na própria estação
    else spot = (r >>> 8) % stations.length;              // resto: ajudando em outra
    if (p.station && home !== -1) spot = home;            // em estação: fica no posto
    // Lugar lotado → a própria estação, senão a primeira com vaga (o descanso é o último recurso).
    if (!free(spot) && !(p.station && spot === home)) {
      const options = [...(home >= 0 ? [home] : []), ...stations.map((_, k) => k), -1];
      const alt = options.find(free);
      if (alt !== undefined) spot = alt;
    }
    count.set(spot, (count.get(spot) || 0) + 1);
    let activity = spot === -1 ? 'idle' : 'working';
    let line = spot === -1 ? pick(p.lines.idle, r >>> 4) : pick(p.lines.working, r >>> 4);
    if (villain && villain.contained && villain.by === p.id) { activity = 'working'; line = `segurando ${villain.name}...`; }

    // Reações recentes têm prioridade (compra, upgrade, descoberta, habilidade, retorno).
    for (let k = reactions.length - 1; k >= 0; k--) {
      const e = reactions[k];
      if (t - e.at > REACTION_MS) break;
      const mine = e.pet === p.id;
      if (e.type === 'discovery' && mine) { activity = 'found'; line = 'found something!'; break; }
      if (e.type === 'evolve' && mine) { activity = 'evolve'; line = 'evolved! · ' + e.text; break; }
      if (e.type === 'skin' && mine) { activity = 'celebrate'; line = 'new look!'; break; }
      if (e.type === 'ability' && mine) { activity = 'celebrate'; line = (e.text || 'go!') + '!'; break; }
      if (e.type === 'refactor' && spot !== -1 && stations[spot] && stations[spot].id === e.category) { activity = 'celebrate'; line = 'refactored! Mk ' + (e.mk === 3 ? 'III' : 'II'); break; }
      if (e.type === 'purchase' && spot !== -1 && stations[spot] && stations[spot].id === e.category) { activity = 'celebrate'; line = 'new worker online!'; break; }
      if ((e.type === 'upgrade' || e.type === 'tier') && (i + seg) % 2 === 0) { activity = 'celebrate'; line = e.type === 'tier' ? 'new tier!' : 'upgrade deployed!'; break; }
      if (e.type === 'rebuild') { activity = 'celebrate'; line = 'fresh start!'; break; }
      if (e.type === 'welcome') { activity = 'celebrate'; line = 'welcome back!'; break; }
    }
    return { id: p.id, spot, activity, line };
  });
}

/** Lugar do vilão na cena: a estação atacada, ou o meio (Zero / estação ainda inexistente). */
function villainSpot(category, stations) {
  const i = stations.findIndex((s) => s.id === category);
  return i !== -1 ? i : Math.floor(stations.length / 2);
}

module.exports = { plan, villainSpot, hash, REACTION_MS };
