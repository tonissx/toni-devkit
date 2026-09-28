'use strict';
/**
 * DevPets — criaturas originais do DevKit. Cada um tem especialização (categoria), bônus que escalam
 * com o nível, uma habilidade ativável e falas para a cena (só visual).
 * bonus: efeitos no nível 1; cada nível acima soma perLevel × o valor base (ex.: +10% do bônus).
 */

const RARITY = {
  common: { name: 'Comum', maxLevel: 10 },
  rare: { name: 'Raro', maxLevel: 10 },
  epic: { name: 'Épico', maxLevel: 12 },
};

const PETS = [
  {
    id: 'byte', name: 'Byte', species: 'lobo-terminal', rarity: 'common',
    specialization: 'Backend', category: 'shell', color: '#3DDC84',
    bonus: [{ type: 'add', target: 'cat:shell', value: 0.15 }, { type: 'add', target: 'global', value: 0.05 }],
    perLevel: 0.1, trainCost: 100, trainScaling: 2.2,
    ability: 'compile-burst',
    lines: {
      working: ['compiling...', 'tailing logs...', 'rebuilding cache...', 'running tests...'],
      idle: ['stretching...', 'reading man pages...', 'sniffing packets...'],
    },
  },
  {
    id: 'noxi', name: 'Noxi', species: 'robô-cápsula', rarity: 'rare',
    specialization: 'Automation', category: 'automation', color: '#6E8BFF',
    bonus: [{ type: 'add', target: 'cat:automation', value: 0.1 }],
    perLevel: 0.1, trainCost: 2000, trainScaling: 2.2,
    ability: 'parallelize',
    lines: {
      working: ['optimizing automation...', 'wiring pipelines...', 'scheduling jobs...'],
      idle: ['recalibrating...', 'humming quietly...', 'counting cron ticks...'],
    },
  },
  {
    id: 'query', name: 'Query', species: 'polvo-índice', rarity: 'rare',
    specialization: 'Database', category: 'data', color: '#9B7BFF',
    bonus: [{ type: 'add', target: 'cat:data', value: 0.25 }],
    perLevel: 0.1, trainCost: 20000, trainScaling: 2.2,
    ability: 'index',
    lines: {
      working: ['indexing knowledge...', 'joining tables...', 'vacuuming...'],
      idle: ['sorting shells...', 'reading an execution plan...', 'blowing bubbles...'],
    },
  },
  {
    id: 'memo', name: 'Memo', species: 'coruja-caderno', rarity: 'epic',
    specialization: 'Knowledge', category: 'data', color: '#F5C542',
    bonus: [{ type: 'add', target: 'global', value: 0.08 }],
    perLevel: 0.1, trainCost: 200000, trainScaling: 2.2,
    ability: 'recall',
    lines: {
      working: ['writing notes...', 'linking ideas...', 'cataloguing snippets...'],
      idle: ['re-reading old notes...', 'sharpening a pencil...', 'hooting softly...'],
    },
  },
];

module.exports = { PETS, RARITY };
