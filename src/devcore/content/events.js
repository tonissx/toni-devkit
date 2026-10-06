'use strict';
/**
 * Eventos do mapa e opções do descanso. Nunca tiram progresso: toda perda é uma troca que o jogador escolhe.
 * choice: { text, cost?: n (× custo-base da coluna), needs?: 'commonPatch', rewards: Reward[] }
 * Reward: { patch: 'common'|'rare'|'epic' } · { item: true } · { part: true } · { petLevel: 1 } (pet de menor nível do
 *         esquadrão salvo) · { battleBuff: { atk } } (próxima batalha) · { swapPatch: 'rare' } (troca um comum) · { restock: true }
 */

const EVENTS = [
  { id: 'legacy-code', title: 'Código legado encontrado', finder: 'byte',
    text: 'Um arquivo de 4.000 linhas sem testes. Dá para refatorar agora — ou fingir que não viu.',
    choices: [
      { text: 'Refatorar', cost: 2, rewards: [{ patch: 'common' }] },
      { text: 'Deixar para depois', rewards: [] },
    ] },
  { id: 'hackathon', title: 'Hackathon', finder: 'noxi',
    text: 'Um fim de semana de código e pizza. O que o esquadrão leva disso?',
    choices: [
      { text: 'Um pet do esquadrão sobe 1 nível', rewards: [{ petLevel: 1 }] },
      { text: 'Esquadrão +20% de ataque na próxima batalha', rewards: [{ battleBuff: { atk: 0.2 } }] },
    ] },
  { id: 'so-down', title: 'Stack Overflow fora do ar', finder: 'query',
    text: 'Sem respostas prontas hoje. Dá para comprar uma solução ou seguir sozinho.',
    choices: [
      { text: 'Comprar um consumível', cost: 1, rewards: [{ item: true }] },
      { text: 'Seguir em frente', rewards: [] },
    ] },
  { id: 'spontaneous-refactor', title: 'Refactor espontâneo', finder: 'memo',
    text: 'Alguém limpou um módulo inteiro durante a madrugada e deixou uma peça sobrando.',
    choices: [
      { text: 'Pegar a peça', rewards: [{ part: true }] },
    ] },
  { id: 'lint-review', title: 'Code review do Lint', finder: 'lint',
    text: 'O Lint promete transformar um patch comum em algo melhor, se você aceitar as sugestões.',
    choices: [
      { text: 'Trocar um Patch comum por um raro', needs: 'commonPatch', rewards: [{ swapPatch: 'rare' }] },
      { text: 'Dispensar', rewards: [] },
    ] },
];

/** Opções do descanso (escolhe uma). */
const REST_OPTIONS = [
  { id: 'train', text: 'Treino: o pet de menor nível do esquadrão sobe 1 nível', rewards: [{ petLevel: 1 }] },
  { id: 'restock', text: 'Reabastecer: +1 de cada consumível (até o teto)', rewards: [{ restock: true }] },
  { id: 'focus', text: 'Foco: esquadrão +20% de ataque na próxima batalha', rewards: [{ battleBuff: { atk: 0.2 } }] },
];

/** Loja: ofertas por ponto (preço × custo-base da coluna). */
const SHOP = {
  items: 2, itemPrice: 0.5,
  partPrice: 1,
  patches: [{ rarity: 'common', price: 1.5 }, { rarity: 'rare', price: 3 }],
};

/** Recompensas das batalhas. */
const BATTLE_REWARDS = {
  battle: { patchChance: 0.35, patch: 'common' },  // + sempre um consumível ou peça
  elite: { patch: 'rare' },                        // + um consumível
  boss: { patch: 'epic' },
};

module.exports = { EVENTS, REST_OPTIONS, SHOP, BATTLE_REWARDS };
