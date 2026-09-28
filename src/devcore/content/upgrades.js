'use strict';
/**
 * Upgrades. effects: { type:'mul'|'add', target, value } ou { type:'unlock', what }.
 * Alvos: 'global' · 'gen:<id>' · 'cat:<id>' · 'petBonus' · 'petStation' · 'offlineCap' (horas) · 'stationSlots'
 * requires: Condition (ver engine/conditions.js). Aparecem aos poucos conforme requires.
 */

const UPGRADES = [
  // Gerador
  { id: 'terminal-optimization', kind: 'generator', name: 'Terminal Optimization', description: 'Shells reaproveitam sessões abertas.',
    cost: 500, requires: { owned: { gen: 'terminal-worker', n: 10 } }, effects: [{ type: 'mul', target: 'gen:terminal-worker', value: 2 }] },
  { id: 'script-caching', kind: 'generator', name: 'Script Caching', description: 'Resultados de scripts ficam em cache.',
    cost: 5000, requires: { all: [{ owned: { gen: 'script-runner', n: 10 } }, { discovery: 'shortcut-engine' }] }, effects: [{ type: 'mul', target: 'gen:script-runner', value: 2 }] },
  { id: 'index-sharding', kind: 'generator', name: 'Index Sharding', description: 'Índices divididos em partes paralelas.',
    cost: 50000, requires: { owned: { gen: 'index-worker', n: 10 } }, effects: [{ type: 'mul', target: 'gen:index-worker', value: 2 }] },
  { id: 'pipeline-tuning', kind: 'generator', name: 'Pipeline Tuning', description: 'Snippets reaproveitados como etapas de pipeline.',
    cost: 400000, requires: { all: [{ owned: { gen: 'automation-worker', n: 5 } }, { discovery: 'snippet-library' }] }, effects: [{ type: 'mul', target: 'cat:automation', value: 1.5 }] },
  { id: 'agent-memory', kind: 'generator', name: 'Agent Memory', description: 'Agentes lembram de tarefas anteriores.',
    cost: 2e8, requires: { owned: { gen: 'agent', n: 10 } }, effects: [{ type: 'mul', target: 'gen:agent', value: 2 }] },

  // Global
  { id: 'parallel-execution', kind: 'global', name: 'Parallel Execution', description: '+10% em toda a produção.',
    cost: 20000, requires: { tier: 2 }, effects: [{ type: 'add', target: 'global', value: 0.1 }] },
  { id: 'hot-reload', kind: 'global', name: 'Hot Reload', description: '+15% em toda a produção.',
    cost: 5e7, requires: { tier: 3 }, effects: [{ type: 'add', target: 'global', value: 0.15 }] },

  // Mecânica — liberam sistemas, não números
  { id: 'distributed-runtime', kind: 'mechanic', name: 'Distributed Runtime', description: 'Libera as sinergias entre produtores e DevPets.',
    cost: 40000, requires: { tier: 2 }, effects: [{ type: 'unlock', what: 'synergies' }] },
  { id: 'task-scheduler', kind: 'mechanic', name: 'Task Scheduler', description: '+1 estação para DevPets.',
    cost: 3e8, requires: { tier: 3 }, effects: [{ type: 'add', target: 'stationSlots', value: 1 }] },
  { id: 'offline-daemon', kind: 'mechanic', name: 'Offline Daemon', description: 'O DevCore trabalha até 12 h com o app fechado (antes: 8 h).',
    cost: 50000, requires: { discovery: 'night-shift' }, effects: [{ type: 'add', target: 'offlineCap', value: 4 }] },

  // DevPet
  { id: 'specialized-training', kind: 'pet', name: 'Specialized Training', description: '+20% nos bônus de todos os DevPets.',
    cost: 150000, requires: { tier: 2 }, effects: [{ type: 'add', target: 'petBonus', value: 0.2 }] },
  { id: 'pair-programming', kind: 'pet', name: 'Pair Programming', description: 'DevPets em estação rendem +50% a mais.',
    cost: 5e8, requires: { tier: 3 }, effects: [{ type: 'add', target: 'petStation', value: 0.5 }] },
];

module.exports = { UPGRADES };
