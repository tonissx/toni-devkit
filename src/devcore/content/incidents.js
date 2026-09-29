'use strict';
/**
 * Incidentes — cada um encarnado por um "pet do mal" (vilão original) que invade uma estação.
 * Nunca tiram progresso: só reduzem a produção por um tempo (piso: balance.incidents.lossFloor) e acabam sozinhos.
 * Contidos no instante em que começam se `counters` passar (Condition: ex. pet certo em estação);
 * Rollback (escudo) contém qualquer um. Sem counters (Zero) = só Rollback/Hotfix.
 *
 * category: estação onde o vilão aparece na cena · weight: chance relativa no sorteio · minTier: a partir de qual tier
 * effects: Effect[] (mul < 1) ou lockAbilities: true
 */

const INCIDENTS = [
  {
    id: 'memory-leak', name: 'Memory Leak', category: 'data', weight: 3, minTier: 2, durationMin: [45, 90],
    description: 'Memória vazando: Data rende 20% menos.',
    effects: [{ type: 'mul', target: 'cat:data', value: 0.8 }],
    counters: { stationed: ['query', 'memo'] }, counterText: 'Query ou Memo em estação',
    villain: {
      id: 'leaky', name: 'Leaky', species: 'gosma-vazamento', color: '#D94BA0',
      lines: { active: ['drip... drip...', 'leaking memory...', 'hehe, heap cheio!'], blocked: ['argh, fui pego!', 'sem vazamento hoje...'], defeated: ['nããão, meu heap!'] },
    },
  },
  {
    id: 'flaky-pipeline', name: 'Flaky Pipeline', category: 'automation', weight: 3, minTier: 2, durationMin: [45, 90],
    description: 'Pipeline instável: Automation rende 20% menos.',
    effects: [{ type: 'mul', target: 'cat:automation', value: 0.8 }],
    counters: { stationed: ['noxi'] }, counterText: 'Noxi em estação',
    villain: {
      id: 'flicker', name: 'Flicker', species: 'glitch-instável', color: '#9B5CFF',
      lines: { active: ['passa... falha... passa...', 'retry? retry? retry?', 'teste verde, teste vermelho!'], blocked: ['ei, para de me estabilizar!', 'bzzt... ok, passou.'], defeated: ['*glitch final*'] },
    },
  },
  {
    id: 'traffic-spike', name: 'Traffic Spike', category: 'infra', weight: 2, minTier: 3, durationMin: [45, 75],
    description: 'Pico de tráfego: Shell e Agents rendem 20% menos.',
    effects: [{ type: 'mul', target: 'cat:shell', value: 0.8 }, { type: 'mul', target: 'cat:agents', value: 0.8 }],
    counters: { any: [{ stationed: ['armo'] }, { owned: { gen: 'local-cluster', n: 10 } }] }, counterText: 'Armo em estação ou 10 Local Clusters',
    villain: {
      id: 'swarm', name: 'Swarm', species: 'enxame-de-bots', color: '#FF4D4D',
      lines: { active: ['req req req req req', 'somos muitos!', '429? nunca ouvimos falar'], blocked: ['rate limited...', 'recuar! recuar!'], defeated: ['*dispersa*'] },
    },
  },
  {
    id: 'merge-conflict', name: 'Merge Conflict', category: 'agents', weight: 2, minTier: 3, durationMin: [45, 75],
    description: 'Conflito de merge: habilidades dos DevPets travadas.',
    lockAbilities: true, effects: [],
    counters: { stationed: ['relay'] }, counterText: 'Relay em estação',
    villain: {
      id: 'forky', name: 'Forky', species: 'bicho-bifurcado', color: '#FF7A1A',
      lines: { active: ['<<<<<<< HEAD', 'minha versão! não, a minha!', '>>>>>>> feature'], blocked: ['tá bom, rebase...', 'resolvido. droga.'], defeated: ['*squash*'] },
    },
  },
  {
    id: 'zero-day', name: 'Zero-day', category: null, weight: 1, minTier: 3, durationMin: [60, 90],
    description: 'Vulnerabilidade desconhecida: toda a produção rende 10% menos. Estações não seguram — só Rollback ou Hotfix.',
    effects: [{ type: 'mul', target: 'global', value: 0.9 }],
    counters: null, counterText: 'só Rollback (antes) ou Hotfix (durante)',
    villain: {
      id: 'zero', name: 'Zero', species: 'sombra-encapuzada', color: '#2A2340', boss: true,
      lines: { active: ['ninguém me viu chegar...', 'CVE? ainda não.', 'sua infraestrutura é minha.'], blocked: ['um rollback? esperto...'], defeated: ['patch aplicado... por enquanto.'] },
    },
  },
];

module.exports = { INCIDENTS };
