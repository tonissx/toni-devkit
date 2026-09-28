'use strict';
// Recursos, categorias (estações) e tiers do DevCore.

/** Moedas. Uma nova moeda = nova entrada aqui (a engine trata recursos genericamente). */
const RESOURCES = [
  { id: 'compute', name: 'Compute', icon: 'cpu', unit: '' },
];

/** Categorias de produção — cada uma vira uma "estação" na cena. */
const CATEGORIES = [
  { id: 'shell', name: 'Shell', icon: 'terminal', verb: 'executando comandos' },
  { id: 'automation', name: 'Automation', icon: 'workflow', verb: 'rodando pipelines' },
  { id: 'data', name: 'Data', icon: 'database', verb: 'indexando dados' },
  { id: 'agents', name: 'Agents', icon: 'bot', verb: 'orquestrando tarefas' },
  { id: 'infra', name: 'Infra', icon: 'server', verb: 'escalando nós' },
];

/**
 * Tiers: cada um libera geradores E uma mecânica nova (não só números maiores).
 * O avanço vem das descobertas "Era" (condição: Compute acumulado na vida).
 */
const TIERS = [
  { id: 1, name: 'Manual', mechanic: 'Produção simples e upgrades.' },
  { id: 2, name: 'Automation', mechanic: 'Sinergias entre produtores e habilidades dos DevPets.' },
  { id: 3, name: 'Agents', mechanic: 'Estações: DevPets assumem funções; agentes orquestram as outras categorias.' },
];

module.exports = { RESOURCES, CATEGORIES, TIERS };
