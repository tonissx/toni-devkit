'use strict';
/**
 * Batalha (auto-battler com preparação) — números e regras como dados. Ver docs/devcore-mapa-singularity.md.
 * Atributo de um pet = base do papel × (1 + perLevel × (nível − 1)) × estágio × raridade.
 * Velocidade vira energia: a cada rodada a unidade ganha `spd` e age enquanto tiver ≥ energyPerAction.
 */

const ROLES = {
  attacker: { name: 'Atacante', hp: 100, atk: 24, def: 8, spd: 10 },
  tank: { name: 'Tanque', hp: 180, atk: 11, def: 20, spd: 7 },
  support: { name: 'Suporte', hp: 115, atk: 12, def: 12, spd: 9 },   // cura o aliado mais ferido (< 60%) em vez de atacar
  speed: { name: 'Velocidade', hp: 90, atk: 15, def: 8, spd: 15 },
};

/** Papel de cada DevPet (vem da especialização). */
const PET_ROLES = { byte: 'attacker', git: 'attacker', armo: 'tank', query: 'tank', memo: 'support', relay: 'support', noxi: 'speed', lint: 'speed' };

const BATTLE = {
  squadSize: 3,
  maxItems: 2,
  maxRounds: 30,              // sem vencer até aqui = derrota (tempo esgotado)
  energyPerAction: 10,
  perLevel: 0.15,
  stageMult: [1, 1.1, 1.25],  // Base · Veterano · Mestre
  rarityMult: { common: 1, rare: 1.1, epic: 1.2 },
  critChance: 0.1,
  critMult: 1.6,
  supportHeal: 0.15,          // suporte cura 15% da vida máxima do aliado mais ferido
  supportHealBelow: 0.6,
  previewRuns: 20,
  chance: { good: 0.8, risky: 0.4 },  // favorável ≥ 80% · arriscado ≥ 40% · muito arriscado abaixo
  // A vida persiste entre batalhas e se recupera com o tempo (também offline). Pet que cai a 0 fica fora de combate
  // até recuperar koMin. (docs/devcore-mapa-singularity.md §5.5)
  recovery: { perHour: 0.25, koMin: 0.25 },
};

/**
 * Slots do esquadrão (na ordem em que os inimigos atacam: o slot mais à frente que estiver de pé é o alvo).
 * bonus vale para qualquer pet no slot; roles[papel] soma um bônus extra quando o papel combina com o slot.
 * Campos: atk/def/hp (fração), spd (pontos), heal (fração a mais nas curas que o pet faz).
 */
const SLOTS = [
  { id: 'vanguard', name: 'Vanguarda', text: 'Primeiro alvo dos inimigos.', bonus: { def: 0.15 },
    roles: { tank: { def: 0.3, hp: 0.15 } } },
  { id: 'center', name: 'Centro', text: 'Só apanha quando a vanguarda cai.', bonus: { atk: 0.1 },
    roles: { attacker: { atk: 0.25 } } },
  { id: 'rear', name: 'Retaguarda', text: 'Só apanha quando os outros dois caem.', bonus: { spd: 2 },
    roles: { support: { heal: 0.5 }, speed: { spd: 4 } } },
];

/** Gatilho da habilidade de cada pet (uma vez por batalha). */
const TRIGGERS = [
  { id: 'start', name: 'No início' },
  { id: 'round3', name: 'Na rodada 3' },
  { id: 'allyLow', name: 'Aliado abaixo de 50%' },
];

/**
 * Versão de batalha das habilidades dos pets.
 * type: burst (próximo ataque × mult) · decoy (absorve o próximo golpe) · shield (dano recebido × value por N rodadas)
 *       mark (inimigo mais forte recebe +value) · heal (cura value da vida do aliado mais ferido)
 *       atkBuff (+value de ataque no esquadrão por N rodadas) · haste (+1 ação por rodada por N rodadas)
 *       cleanse (remove dreno e cura value de todos)
 */
const BATTLE_ABILITIES = {
  'compile-burst': { type: 'burst', mult: 3, text: 'Próximo ataque ×3' },
  'branch-off': { type: 'decoy', text: 'Um clone absorve o próximo golpe' },
  'scale-out': { type: 'shield', value: 0.5, rounds: 2, text: 'Esquadrão recebe metade do dano por 2 rodadas' },
  index: { type: 'mark', value: 0.3, text: 'Inimigo mais forte recebe +30% de dano' },
  recall: { type: 'heal', value: 0.3, text: 'Cura 30% da vida do aliado mais ferido' },
  orchestrate: { type: 'atkBuff', value: 0.25, rounds: 3, text: 'Esquadrão +25% de ataque por 3 rodadas' },
  parallelize: { type: 'haste', rounds: 2, text: 'Esquadrão age 2× por 2 rodadas' },
  'lint-pass': { type: 'cleanse', value: 0.1, text: 'Remove o dreno e cura 10% de todos' },
};

/**
 * Consumíveis em batalha — usados sozinhos no momento certo.
 * when: start (rodada 1) · firstDown (primeiro pet a cair) · firstAbility (depois da 1ª habilidade usada)
 */
const BATTLE_ITEMS = {
  coffee: { when: 'start', type: 'atkBuff', value: 0.3, rounds: 3, text: '+30% de ataque por 3 rodadas (rodada 1)' },
  hotfix: { when: 'start', type: 'nuke', mult: 2.5, text: 'Dano 2,5× o maior ataque do esquadrão no inimigo mais forte (rodada 1)' },
  rollback: { when: 'firstDown', type: 'revive', value: 0.3, text: 'Revive o primeiro pet a cair com 30% da vida' },
  'cache-warmer': { when: 'firstAbility', type: 'recharge', text: 'A primeira habilidade usada fica pronta de novo' },
};

/**
 * Traços dos inimigos e o counter de cada um (pet no esquadrão / na frente que anula o traço).
 */
const TRAITS = {
  drain: { name: 'Dreno', text: 'Quem acerta perde 10% de ataque (até −50%)', counter: { anyOf: ['query', 'memo'] }, counterText: 'Query ou Memo no esquadrão anulam' },
  evade: { name: 'Esquiva', text: 'Desvia de 30% dos ataques', value: 0.3, counter: { anyOf: ['noxi'] }, counterText: 'Noxi no esquadrão faz todos acertarem' },
  swarm: { name: 'Enxame', text: 'Vários inimigos fracos', counter: { front: ['armo'] }, value: 0.6, counterText: 'Armo na vanguarda: o enxame causa 40% menos dano' },
  split: { name: 'Divisão', text: 'Ao cair, vira dois com 40% da vida', value: 0.4, counter: { anyOf: ['relay'] }, counterText: 'Relay no esquadrão impede a divisão' },
  fortify: { name: 'Fortificação', text: '+6% de defesa a cada rodada', value: 0.06, counter: null, counterText: 'Sem counter: vença rápido (habilidades no início)' },
  pierce: { name: 'Perfuração', text: 'Ignora a defesa', counter: { anyOf: ['armo'] }, counterText: 'Armo no esquadrão devolve a defesa' },
  // Área 2 — Pântano Staging
  flaky: { name: 'Instável', text: 'Cada golpe tem 30% de chance de falhar e 30% de acertar em dobro', value: 0.3, counter: { anyOf: ['lint'] }, counterText: 'Lint no esquadrão estabiliza os golpes' },
  race: { name: 'Corrida', text: '35% de chance de agir duas vezes seguidas', value: 0.35, counter: { anyOf: ['memo'] }, counterText: 'Memo no esquadrão trava a corrida' },
  drift: { name: 'Deriva', text: 'O ataque muda a cada rodada (de 70% a 150%)', min: 0.7, max: 1.5, counter: { anyOf: ['git'] }, counterText: 'Git no esquadrão fixa a configuração' },
  // Área 3 — Pico Production
  coldstart: { name: 'Partida a frio', text: 'Lento nas 3 primeiras rodadas; depois aquece: +60% de ataque', rounds: 3, slow: 0.5, value: 0.6, counter: { anyOf: ['relay'] }, counterText: 'Relay no esquadrão pré-aquece (sem o bônus)' },
  flood: { name: 'Inundação', text: 'A cada 3 rodadas chama mais um igual com 40% da vida (até 6 inimigos)', every: 3, value: 0.4, max: 6, counter: { anyOf: ['lint'] }, counterText: 'Lint no esquadrão faz o rate limiting' },
  grow: { name: 'Vazamento', text: 'Cresce 12% em ataque e vida a cada rodada', value: 0.12, counter: { anyOf: ['query'] }, counterText: 'Query no esquadrão libera a memória' },
  blackout: { name: 'Apagão', text: 'A cada 5 rodadas um raio: o esquadrão perde a vez e leva 8% da vida', every: 5, value: 0.08, counter: null, counterText: 'Sem counter: leve vida sobrando e cura (suporte, Rollback)' },
  merge: { name: 'Merge', text: 'Se uma cabeça cair e a outra seguir de pé, ela volta 2 rodadas depois com 35% da vida (uma vez por cabeça)', value: 0.35, rounds: 2, counter: null, counterText: 'Sem counter: derrube as duas cabeças perto uma da outra' },
};

/** Desculpas de "lore" para o tempo esgotado em batalhas comuns (escolhida pela batalha; ver enemies.js `timeout`). */
const BATTLE_TIMEOUT_LORE = [
  'O expediente acabou. Os bugs que sobraram foram para o backlog com a etiqueta "depois a gente vê" — e vão estar esperando amanhã.',
  'A sprint fechou antes da luta. O que restou virou débito técnico e ganhou um ticket que ninguém vai abrir.',
  'O build quebrou no meio da batalha e todo mundo foi ver o CI. Quando voltaram, os inimigos tinham fugido para outro branch.',
  'A reunião das 17h chamou o esquadrão. Os inimigos aproveitaram para fazer merge na main sem review.',
];

module.exports = { SLOTS, BATTLE_TIMEOUT_LORE, ROLES, PET_ROLES, BATTLE, TRIGGERS, BATTLE_ABILITIES, BATTLE_ITEMS, TRAITS };
