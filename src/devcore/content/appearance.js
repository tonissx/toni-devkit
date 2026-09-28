'use strict';
/**
 * Aparência dos DevPets.
 * - STAGES: evolução automática pelo nível (acessórios e aura desenhados no PetSprite).
 * - SKINS: paletas escolhíveis, iguais para todos os pets. Desbloqueiam por marcos/descobertas
 *   (Condition, ver engine/conditions.js) — nunca por compra ou sorteio — e ficam para sempre.
 *   colors.body ausente = cor original do pet; colors.eye ausente = olhos padrão do tema.
 */

const STAGES = [
  { id: 0, name: 'Base', minLevel: 1 },
  { id: 1, name: 'Veterano', minLevel: 5 },
  { id: 2, name: 'Mestre', minLevel: 10 },
];

const SKINS = [
  { id: 'default', name: 'Original', colors: {}, unlock: { always: true } },
  { id: 'monokai', name: 'Monokai', colors: { body: '#F92672', eye: '#E6DB74' }, unlock: { maxPetLevel: 3 } },
  { id: 'neon', name: 'Neon', colors: { body: '#00E5FF', eye: '#FF2BD6' }, unlock: { discovery: 'toolsmith' } },
  { id: 'midnight', name: 'Midnight', colors: { body: '#3B4A6B', eye: '#7CF5B0' }, unlock: { discovery: 'night-shift' } },
  { id: 'solarized', name: 'Solarized', colors: { body: '#B58900', eye: '#FDF6E3' }, unlock: { tier: 3 } },
  { id: 'gold', name: 'Gold', colors: { body: '#F5C542', eye: '#FFF6D6' }, unlock: { anyPetMaxed: true } },
];

module.exports = { STAGES, SKINS };
