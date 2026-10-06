'use strict';
/**
 * Upgrades. effects: { type:'mul'|'add', target, value } ou { type:'unlock', what }
 *   ou { type:'per', gen, per, target, value } (combo: +value no alvo a cada `per` unidades do gerador `gen`).
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

  // Combo — um gerador mais barato fortalece um mais caro (+value no alvo a cada `per` unidades de `gen`), como as
  // grandmas do Cookie Clicker: os geradores antigos continuam valendo a compra até o fim da run.
  { id: 'shell-pipes', kind: 'combo', name: 'Shell Pipes', description: 'Scripts encadeiam a saída dos terminais.',
    cost: 8000, requires: { all: [{ owned: { gen: 'terminal-worker', n: 25 } }, { owned: { gen: 'script-runner', n: 5 } }] },
    effects: [{ type: 'per', gen: 'terminal-worker', per: 3, target: 'gen:script-runner', value: 0.01 }] },
  { id: 'cron-reindex', kind: 'combo', name: 'Cron Reindex', description: 'Scripts agendados mantêm os índices em dia.',
    cost: 90000, requires: { all: [{ owned: { gen: 'script-runner', n: 25 } }, { owned: { gen: 'index-worker', n: 5 } }] },
    effects: [{ type: 'per', gen: 'script-runner', per: 4, target: 'gen:index-worker', value: 0.01 }] },
  { id: 'indexed-artifacts', kind: 'combo', name: 'Indexed Artifacts', description: 'Pipelines acham artefatos prontos nos índices.',
    cost: 1e6, requires: { all: [{ owned: { gen: 'index-worker', n: 25 } }, { owned: { gen: 'automation-worker', n: 5 } }] },
    effects: [{ type: 'per', gen: 'index-worker', per: 4, target: 'gen:automation-worker', value: 0.01 }] },
  { id: 'agentic-pipelines', kind: 'combo', name: 'Agentic Pipelines', description: 'Agentes disparam pipelines em vez de fazer tudo à mão.',
    cost: 3e8, requires: { all: [{ owned: { gen: 'automation-worker', n: 25 } }, { owned: { gen: 'agent', n: 5 } }] },
    effects: [{ type: 'per', gen: 'automation-worker', per: 4, target: 'gen:agent', value: 0.01 }] },
  { id: 'autoscaler-agents', kind: 'combo', name: 'Autoscaler Agents', description: 'Agentes decidem quando o cluster cresce.',
    cost: 3e9, requires: { all: [{ owned: { gen: 'agent', n: 15 } }, { owned: { gen: 'local-cluster', n: 5 } }] },
    effects: [{ type: 'per', gen: 'agent', per: 4, target: 'gen:local-cluster', value: 0.01 }] },
  { id: 'edge-shells', kind: 'combo', name: 'Edge Shells', description: 'Cada terminal vira um nó de borda do cluster.',
    cost: 5e9, requires: { all: [{ owned: { gen: 'terminal-worker', n: 100 } }, { owned: { gen: 'local-cluster', n: 10 } }] },
    effects: [{ type: 'per', gen: 'terminal-worker', per: 10, target: 'gen:local-cluster', value: 0.01 }] },

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
