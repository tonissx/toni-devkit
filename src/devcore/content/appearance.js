'use strict';
/**
 * Aparência dos DevPets.
 * - STAGES: evolução automática pelo nível (acessórios e aura desenhados no PetSprite).
 * - SKINS: paletas escolhíveis, iguais para todos os pets. Desbloqueiam por marcos/descobertas
 *   (Condition, ver engine/conditions.js) — nunca por compra ou sorteio — e ficam para sempre.
 *   pet: visual exclusivo de um DevPet (só ele pode usar).
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
  // Missões diárias: marcos fixos (contador vitalício, sem streak, sem sorteio).
  { id: 'dracula', name: 'Dracula', colors: { body: '#BD93F9', eye: '#FF79C6' }, unlock: { questsDone: 10 } },
  { id: 'nord', name: 'Nord', colors: { body: '#88C0D0', eye: '#EBCB8B' }, unlock: { questsDone: 25 } },
  { id: 'gruvbox', name: 'Gruvbox', colors: { body: '#FE8019', eye: '#B8BB26' }, unlock: { questsDone: 50 } },
  { id: 'synthwave', name: 'Synthwave', colors: { body: '#FF00A0', eye: '#00F0FF' }, unlock: { questsDone: 100 } },
  { id: 'matrix', name: 'Matrix', colors: { body: '#12662A', eye: '#00FF41' }, unlock: { questsDone: 200 } },
  { id: 'cyberpunk', name: 'Cyberpunk', colors: { body: '#FCEE0A', eye: '#00F0FF' }, unlock: { discovery: 'always-on' } },
  // Exclusivos de um DevPet: cada missão do tema dele conta (pet = só ele pode usar).
  { id: 'pergaminho', name: 'Pergaminho', pet: 'memo', colors: { body: '#D9B77E', eye: '#5B3A1E' }, unlock: { petQuests: { pet: 'memo', n: 5 } } },
  { id: 'tablespace', name: 'Tablespace', pet: 'query', colors: { body: '#2FB8A6', eye: '#E8FF6B' }, unlock: { petQuests: { pet: 'query', n: 5 } } },
  { id: 'circuito', name: 'Circuito', pet: 'noxi', colors: { body: '#1F9D6B', eye: '#B6FF5C' }, unlock: { petQuests: { pet: 'noxi', n: 5 } } },
  { id: 'detached', name: 'Detached HEAD', pet: 'git', colors: { body: '#7C5CFF', eye: '#FFD84D' }, unlock: { petQuests: { pet: 'git', n: 5 } } },
  { id: 'strict', name: 'Strict Mode', pet: 'lint', colors: { body: '#E8E8F0', eye: '#E5484D' }, unlock: { petQuests: { pet: 'lint', n: 5 } } },
];

module.exports = { STAGES, SKINS };
