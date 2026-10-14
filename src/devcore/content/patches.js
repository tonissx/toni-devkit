'use strict';
/**
 * Patches — as "relíquias" da run, recompensa principal do mapa. Valem até a Singularity.
 * effects: Effect[] no sistema de modificadores (como os upgrades) — a maioria alimenta a produção.
 * battle: { atk, hp, def } (+fração nos atributos do esquadrão) · firstCrit: o 1º ataque de cada pet é crítico
 * mods: multiplicadores de regra — abilityDuration (habilidades de produção), trainCost (treino dos pets).
 */

const PATCHES = [
  // Comuns
  { id: 'hotpatch-shell', name: 'Hotpatch: Shell', rarity: 'common', icon: 'terminal', description: '+15% em Shell.',
    effects: [{ type: 'add', target: 'cat:shell', value: 0.15 }] },
  { id: 'hotpatch-data', name: 'Hotpatch: Data', rarity: 'common', icon: 'database', description: '+15% em Data.',
    effects: [{ type: 'add', target: 'cat:data', value: 0.15 }] },
  { id: 'hotpatch-automation', name: 'Hotpatch: Automation', rarity: 'common', icon: 'workflow', description: '+15% em Automation.',
    effects: [{ type: 'add', target: 'cat:automation', value: 0.15 }] },
  { id: 'warm-cache', name: 'Warm Cache', rarity: 'common', icon: 'flame', description: 'Habilidades dos DevPets duram 25% mais.',
    mods: { abilityDuration: 1.25 } },
  { id: 'pair-review', name: 'Pair Review', rarity: 'common', icon: 'users', description: 'Esquadrão +10% de ataque nas batalhas.',
    battle: { atk: 0.1 } },
  { id: 'retry-policy', name: 'Retry Policy', rarity: 'common', icon: 'rotate-ccw', description: 'Esquadrão +15% de vida nas batalhas.',
    battle: { hp: 0.15 } },

  // Raros
  { id: 'build-cache', name: 'Build Cache', rarity: 'rare', icon: 'package', description: '+10% em toda a produção.',
    effects: [{ type: 'add', target: 'global', value: 0.1 }] },
  { id: 'autoscaling-group', name: 'Autoscaling Group', rarity: 'rare', icon: 'server', description: '+25% em Agents e Infra.',
    effects: [{ type: 'add', target: 'cat:agents', value: 0.25 }, { type: 'add', target: 'cat:infra', value: 0.25 }] },
  { id: 'mentoring', name: 'Mentoring', rarity: 'rare', icon: 'graduation-cap', description: 'Treinar DevPets custa 25% menos.',
    mods: { trainCost: 0.75 } },
  { id: 'type-safety', name: 'Type Safety', rarity: 'rare', icon: 'shield', description: 'Esquadrão +25% de defesa nas batalhas.',
    battle: { def: 0.25 } },

  // Épicos
  { id: 'monolith-split', name: 'Monolith Split', rarity: 'epic', icon: 'boxes', description: 'Produção ×1,5.',
    effects: [{ type: 'mul', target: 'global', value: 1.5 }] },
  { id: 'zero-downtime', name: 'Zero Downtime', rarity: 'epic', icon: 'zap', description: 'O 1º ataque de cada pet é crítico e o esquadrão tem +20% de vida.',
    battle: { hp: 0.2 }, firstCrit: true },
];

const RARITIES = {
  common: { name: 'Comum' },
  rare: { name: 'Raro' },
  epic: { name: 'Épico' },
};

module.exports = { PATCHES, RARITIES };
