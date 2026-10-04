'use strict';
/**
 * Legado — o prestige do DevCore.
 * Rebuild: reescreve a infraestrutura do zero (zera `run`) e converte o Compute acumulado em
 * Fragmentos. Fragmentos ganhos na vida = nível de Legado (produção ×(1 + perLevel × nível), para
 * sempre); os não gastos compram perks na Árvore de Legado, que também são permanentes.
 *
 * Fragmentos (total na vida) = floor(cbrt(Compute de todas as runs / divisor)) — cada Rebuild rende
 * a diferença para o que já foi ganho, então esperar mais rende mais, com retorno decrescente.
 *
 * PERKS: { id, branch, name, description, cost, requires?: [ids] (todos) | requiresAny?: [ids],
 *   effects?: Effect[]   (mesmo sistema dos upgrades: global, cat:, gen:, petBonus, offlineCap, stationSlots…)
 *   mods?: { abilityCooldown, abilityDuration, genCost, petFindEvery, legacyPerLevel } (multiplicadores)
 *   start?: { compute, gens:{id:n}, tier, petLevel, items:{id:n}, shields }  (como cada Rebuild começa)
 *   keep?: { inventory, scrap, mk }  (o que atravessa o Rebuild) }
 */

const LEGACY = {
  divisor: 1e9,        // 1 B de Compute (somado entre runs) = 1 fragmento; 1 T = 10; 1 Qa = 100
  perLevel: 0.01,      // +1% de produção por fragmento ganho na vida (gasto ou não)
  minTier: 3,          // Rebuild só a partir da Agent Era
};

const BRANCHES = [
  { id: 'core', name: 'Núcleo', icon: 'gem' },
  { id: 'infra', name: 'Infra', icon: 'server' },
  { id: 'pets', name: 'DevPets', icon: 'paw-print' },
  { id: 'ops', name: 'Ops', icon: 'shield' },
  { id: 'archive', name: 'Arquivo', icon: 'package' },
];

const PERKS = [
  { id: 'legacy-core', branch: 'core', name: 'Legacy Core', cost: 1,
    description: 'O que você aprendeu fica no código. Produção ×1,2.',
    effects: [{ type: 'mul', target: 'global', value: 1.2 }] },

  // Infra — começar mais rápido e crescer mais barato
  { id: 'bootstrap', branch: 'infra', name: 'Bootstrap Script', cost: 2, requires: ['legacy-core'],
    description: 'Cada Rebuild começa com 5.000 Compute e 10 Terminal Workers.',
    start: { compute: 5000, gens: { 'terminal-worker': 10 } } },
  { id: 'warm-start', branch: 'infra', name: 'Warm Start', cost: 5, requires: ['bootstrap'],
    description: 'Cada Rebuild começa no Tier 2 (Automation Era) com 200.000 Compute.',
    start: { tier: 2, compute: 2e5 } },
  { id: 'economies-of-scale', branch: 'infra', name: 'Economies of Scale', cost: 10, requires: ['warm-start'],
    description: 'Geradores custam 25% menos.', mods: { genCost: 0.75 } },
  { id: 'monorepo', branch: 'infra', name: 'Monorepo', cost: 25, requires: ['economies-of-scale'],
    description: 'Tudo num lugar só. Produção ×1,5.', effects: [{ type: 'mul', target: 'global', value: 1.5 }] },

  // DevPets — a equipe volta mais experiente
  { id: 'muscle-memory', branch: 'pets', name: 'Muscle Memory', cost: 2, requires: ['legacy-core'],
    description: 'DevPets voltam do Rebuild no nível 3.', start: { petLevel: 3 } },
  { id: 'mentorship', branch: 'pets', name: 'Mentorship', cost: 5, requires: ['muscle-memory'],
    description: '+25% nos bônus de todos os DevPets.', effects: [{ type: 'add', target: 'petBonus', value: 0.25 }] },
  { id: 'extra-desk', branch: 'pets', name: 'Extra Desk', cost: 12, requires: ['mentorship'],
    description: '+1 estação para DevPets.', effects: [{ type: 'add', target: 'stationSlots', value: 1 }] },
  { id: 'pack-leader', branch: 'pets', name: 'Pack Leader', cost: 25, requires: ['extra-desk'],
    description: 'DevPets voltam no nível 5 (Veterano) e rendem +50% em estação.',
    start: { petLevel: 5 }, effects: [{ type: 'add', target: 'petStation', value: 0.5 }] },

  // Ops — habilidades e incidentes
  { id: 'runbook', branch: 'ops', name: 'Runbook', cost: 2, requires: ['legacy-core'],
    description: 'Recarga das habilidades 20% mais curta.', mods: { abilityCooldown: 0.8 } },
  { id: 'incident-playbook', branch: 'ops', name: 'Incident Playbook', cost: 4, requires: ['runbook'],
    description: 'Cada Rebuild começa com 1 Rollback armado, 2 Hotfix e 2 Coffee.',
    start: { shields: 1, items: { hotfix: 2, coffee: 2 } } },
  { id: 'sustained-load', branch: 'ops', name: 'Sustained Load', cost: 10, requires: ['incident-playbook'],
    description: 'Habilidades de burst duram 50% mais.', mods: { abilityDuration: 1.5 } },
  { id: 'supply-chain', branch: 'ops', name: 'Supply Chain', cost: 20, requires: ['sustained-load'],
    description: 'Consumíveis em estoque atravessam o Rebuild.', keep: { inventory: true } },

  // Arquivo — offline e Blueprints
  { id: 'nightly-build', branch: 'archive', name: 'Nightly Build', cost: 3, requires: ['legacy-core'],
    description: '+4 h de trabalho com o app fechado.', effects: [{ type: 'add', target: 'offlineCap', value: 4 }] },
  { id: 'scavenger', branch: 'archive', name: 'Scavenger', cost: 6, requires: ['nightly-build'],
    description: 'Achados dos DevPets offline com o dobro da frequência.', mods: { petFindEvery: 0.5 } },
  { id: 'blueprint-archive', branch: 'archive', name: 'Blueprint Archive', cost: 15, requires: ['scavenger'],
    description: 'Sucata e peças soltas atravessam o Rebuild (peças sem uso viram sucata).', keep: { scrap: true } },
  { id: 'design-docs', branch: 'archive', name: 'Design Docs', cost: 25, requires: ['blueprint-archive'],
    description: 'Geradores que chegaram ao Mk II voltam do Rebuild já em Mk II.', keep: { mk: 2 } },

  // Capstone: qualquer ramo completo
  { id: 'hall-of-fame', branch: 'core', name: 'Hall of Fame', cost: 50,
    requiresAny: ['monorepo', 'pack-leader', 'supply-chain', 'design-docs'],
    description: 'Cada nível de Legado vale o dobro (+2% de produção em vez de +1%).', mods: { legacyPerLevel: 2 } },
];

module.exports = { LEGACY, BRANCHES, PERKS };
