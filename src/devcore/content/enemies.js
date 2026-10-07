'use strict';
/**
 * Inimigos das batalhas do mapa. Os vilões dos incidentes viram inimigos com o mesmo sprite e um traço (TRAITS em
 * battle.js), e cada área traz os seus. Atributos na coluna 0; a área escala por coluna (areas.js: scalePerCol).
 * sprite: id do desenho em VillainSprite.jsx · boss: chefe da área (fases/traço próprio).
 * timeout: a desculpa de "lore" de quando o tempo acaba com ele de pé (sem ela, vale BATTLE_TIMEOUT_LORE).
 */

const ENEMIES = [
  // Área 1 — Localhost
  { id: 'bug', name: 'Bug', sprite: 'bug', color: '#7BC043', hp: 60, atk: 9, def: 4, spd: 9, traits: [],
    lines: ['works on my machine', 'undefined is not a function'] },
  { id: 'typo', name: 'Typo', sprite: 'typo', color: '#F2C14E', hp: 36, atk: 7, def: 2, spd: 16, traits: [],
    lines: ['teh', 'recieve', 'lenght'] },
  { id: 'broken-dep', name: 'Dependência quebrada', sprite: 'dep', color: '#8C6BB1', hp: 110, atk: 8, def: 14, spd: 6, traits: [],
    lines: ['peer dep conflict', 'npm ERR!'] },
  // Vilões dos incidentes
  { id: 'leaky', name: 'Leaky', sprite: 'leaky', color: '#D94BA0', hp: 80, atk: 9, def: 6, spd: 8, traits: ['drain'],
    lines: ['drip... drip...', 'hehe, heap cheio!'] },
  { id: 'flicker', name: 'Flicker', sprite: 'flicker', color: '#9B5CFF', hp: 55, atk: 11, def: 4, spd: 13, traits: ['evade'],
    lines: ['passa... falha...', 'retry? retry?'] },
  { id: 'swarm-bot', name: 'Bot do Swarm', sprite: 'swarm', color: '#FF4D4D', hp: 26, atk: 6, def: 2, spd: 12, traits: ['swarm'],
    lines: ['req req req', '429?'] },
  { id: 'forky', name: 'Forky', sprite: 'forky', color: '#FF7A1A', hp: 150, atk: 13, def: 10, spd: 9, traits: ['split'],
    lines: ['<<<<<<< HEAD', 'minha versão!'],
    timeout: 'Enquanto vocês discutiam qual versão manter, o Forky abriu mais três branches e sumiu num rebase. Ninguém sabe em qual delas ele está agora.' },
  { id: 'zero', name: 'Zero', sprite: 'zero', color: '#2A2340', hp: 140, atk: 8, def: 10, spd: 11, traits: ['pierce'],
    lines: ['ninguém me viu chegar...', 'CVE? ainda não.'],
    timeout: 'O Zero apagou os próprios logs e saiu pela porta dos fundos. Oficialmente, ele nunca esteve aqui — e o incidente foi fechado como "não reproduzível".' },
  // Chefe da Área 1
  { id: 'legacy-monolith', name: 'Legacy Monolith', sprite: 'monolith', color: '#2E3440', hp: 280, atk: 10, def: 8, spd: 6, traits: ['fortify'], boss: true,
    lines: ['eu funciono desde 2009', 'não mexa no que funciona', 'refatorar? nunca.'],
    timeout: 'Faltando um commit para derrubá-lo, o Legacy Monolith foi declarado "crítico para o negócio" pela diretoria. O refactor foi congelado até o próximo trimestre, o time voltou para o backlog e o monólito segue de pé — mais rachado, mais teimoso e esperando a próxima tentativa.' },
];

module.exports = { ENEMIES };
