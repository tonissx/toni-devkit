'use strict';
// Números globais do DevCore. Todo o balanceamento fica em src/devcore/content (dados, sem lógica).

module.exports = {
  start: { compute: 50, generators: { 'terminal-worker': 1 }, pets: ['byte'] },

  // Tempo
  offlineCapHours: 8,          // teto do progresso com o app fechado (upgrades somam horas)
  offlineThresholdMin: 5,      // abaixo disso, um intervalo não conta como "offline"
  welcomeThresholdMin: 15,     // resumo de retorno só a partir disso
  heartbeatSec: 60,            // relógio central do processo principal

  // Pets
  petFindEveryHours: 2,        // offline: a cada N horas um pet "encontra" algo
  petFindMinutes: [1, 3],      // cache = de 1 a 3 min de produção
  findConsumableChance: 0.4,   // chance de um achado ser um consumível em vez de Compute
  stationSlots: { 2: 1, 3: 2 },// vagas de estação por tier (upgrades somam)
  stationMultiplier: 2,        // pet na estação da própria categoria: bônus ×2

  // Incidentes ("pets do mal"): nunca tiram progresso — só reduzem a produção por um tempo.
  incidents: {
    minTier: 2,
    everyHours: [3, 6],        // intervalo entre um incidente e o próximo
    forecastHours: 2,          // o próximo fica visível com esta antecedência
    blockedSec: 60,            // contido: o vilão aparece, é barrado e some
    hotfixPartChance: 0.3,     // Hotfix em vilão comum: +1 sucata garantida e esta chance de uma peça (conter rende item + peça)
    lossFloor: 0.8,            // nenhum alvo cai abaixo de ×0,8 por incidentes
  },

  // Marcos por quantidade: ao chegar em cada valor de `at`, a produção daquele gerador × mult.
  // (os dois primeiros ×1,5 para não acelerar demais o começo)
  milestones: { at: [25, 50, 100, 150, 200, 250, 300], mult: [1.5, 1.5, 2, 2, 2, 2, 2] },

  // Blueprints (peças → Mk II/III). Compra = N minutos da produção atual.
  blueprints: {
    partChanceFind: 0.3,           // achado de pet que vira peça Mk II
    mk3ChanceContained: 0.4,       // vilão contido com o Mk II já feito: chance de peça Mk III (senão sucata)
    scrapPerPart: { 2: 5, 3: 8 }, // sucata para trocar por uma peça faltante
    buyMinutes: { 2: 120, 3: 360 }, // cabe no que acumula numa noite offline (teto 8 h)
  },

  // Missões diárias: só cosméticos e consumíveis, nunca produção.
  quests: {
    perDay: 3,
    itemChance: 0.5,           // chance de uma missão concluída render um consumível (estoque cheio → nada)
  },

  // Anti-abuso: soma máxima dos bônus que vêm de uso do DevKit (descobertas)
  usageBonusCap: 0.05,
};
