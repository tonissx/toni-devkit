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
  stationSlots: 1,             // estações (tier 3) — upgrades somam
  stationMultiplier: 2,        // pet na estação da própria categoria: bônus ×2

  // Anti-abuso: soma máxima dos bônus que vêm de uso do DevKit (descobertas)
  usageBonusCap: 0.05,
};
