'use strict';
/**
 * Áreas do mapa (tema: pipeline de deploy). MVP: só Localhost. Ver docs/devcore-mapa-singularity.md.
 *
 * Mapa: `lanes` trilhas × `columns` colunas + o chefe; gerado pela semente da run ao abrir a área.
 * costs: custo-base (Compute) de cada coluna — FIXO (não acompanha a produção: é o que cria a escolha entre investir
 *   em produção ou avançar). Cada tipo de ponto multiplica o custo da coluna (NODE_TYPES.costMult).
 * scale: atributos dos inimigos × (1 + linear × coluna + quad × coluna²); elites: vida e ataque × eliteMult;
 *   o chefe usa a escala da última coluna.
 * groups: grupos de inimigos por tipo de ponto (sorteados com a semente).
 */

/** Tipos de ponto do mapa. weight: chance relativa nas colunas livres. */
const NODE_TYPES = {
  battle: { name: 'Batalha', icon: 'swords', costMult: 1, weight: 45 },
  elite: { name: 'Elite', icon: 'skull', costMult: 3, weight: 15 },
  express: { name: 'Deploy expresso', icon: 'rocket', costMult: 5, weight: 12 },
  event: { name: 'Evento', icon: 'circle-help', costMult: 0, weight: 20 },
  shop: { name: 'Loja', icon: 'store', costMult: 0, weight: 8 },
  rest: { name: 'Descanso', icon: 'coffee', costMult: 0, weight: 0 },
  boss: { name: 'Chefe', icon: 'crown', costMult: 1, weight: 0 },   // o preço do chefe é o último valor de `costs`
};

const AREAS = [
  {
    id: 'localhost', name: 'Floresta Localhost', arena: 'localhost', unlock: { tier: 2 },
    description: 'Onde todo deploy nasce: uma floresta de circuitos crescendo dentro da sua máquina.',
    lanes: 3, columns: 9,
    // Coluna 4: loja, evento e descanso; coluna 8: descanso; o resto é sorteado.
    fixed: { 0: ['battle', 'battle', 'battle'], 4: ['shop', 'event', 'rest'], 8: ['rest', 'rest', 'rest'] },
    shortcutChance: 0.5,   // elite nas colunas 1–6: chance de ganhar um atalho para a coluna +2
    crossChance: 0.4,      // chance de ligação diagonal entre trilhas vizinhas
    costs: [2e7, 1e8, 4e8, 1.5e9, 6e9, 1.5e10, 3e10, 5e10, 8e10, 1.2e11],  // colunas 0–8 e o chefe (índice 9)
    scale: { linear: 0.35, quad: 0.12, eliteMult: 1.2 },
    groups: {
      battle: [['bug', 'bug', 'typo'], ['typo', 'typo', 'typo'], ['broken-dep', 'bug'], ['leaky', 'bug'], ['flicker', 'typo'], ['swarm-bot', 'swarm-bot', 'swarm-bot', 'swarm-bot']],
      elite: [['forky'], ['zero'], ['leaky', 'flicker', 'broken-dep']],
      boss: [['legacy-monolith']],
    },
    boss: 'legacy-monolith',
  },
];

module.exports = { AREAS, NODE_TYPES };
