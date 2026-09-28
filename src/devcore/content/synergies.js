'use strict';
/**
 * Sinergias: combinações de produtores + DevPets (+ descobertas) que ligam um bônus.
 * needsMechanic: 'synergies' → exige o upgrade Distributed Runtime.
 * perActiveCategory: o valor é multiplicado pelo nº de categorias com produção (Orchestration).
 */

const SYNERGIES = [
  {
    id: 'pipeline', name: 'Pipeline Synergy', description: 'Scripts + workers de automação + Noxi formam um pipeline.',
    needsMechanic: 'synergies',
    requires: { gens: ['script-runner', 'automation-worker'], pets: ['noxi'] },
    effects: [{ type: 'add', target: 'cat:automation', value: 0.3 }],
  },
  {
    id: 'knowledge-engine', name: 'Knowledge Engine', description: 'Memo transforma suas notas em índices vivos.',
    requires: { gens: ['index-worker'], pets: ['memo'], discoveries: ['knowledge-engine'] },
    effects: [{ type: 'add', target: 'global', value: 0.15 }],
  },
  {
    id: 'orchestration', name: 'Orchestration', description: 'Agentes coordenando ≥ 3 categorias ativas.',
    needsMechanic: 'synergies',
    requires: { gens: ['agent'], minActiveCategories: 3 },
    effects: [{ type: 'add', target: 'global', value: 0.05, perActiveCategory: true }],
  },
];

module.exports = { SYNERGIES };
