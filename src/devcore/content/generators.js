'use strict';
// Geradores (produtores passivos). custo(n) = baseCost × costScaling^owned.

const GENERATORS = [
  {
    id: 'terminal-worker', name: 'Terminal Worker', tier: 1, category: 'shell', resource: 'compute',
    description: 'Um shell dedicado executando tarefas pequenas sem parar.',
    baseCost: 15, costScaling: 1.15, baseProduction: 0.1,
  },
  {
    id: 'script-runner', name: 'Script Runner', tier: 1, category: 'automation', resource: 'compute',
    description: 'Roda scripts agendados e reaproveita resultados.',
    baseCost: 100, costScaling: 1.15, baseProduction: 1,
  },
  {
    id: 'index-worker', name: 'Index Worker', tier: 2, category: 'data', resource: 'compute',
    description: 'Mantém índices quentes para consultas instantâneas.',
    baseCost: 1100, costScaling: 1.15, baseProduction: 8,
  },
  {
    id: 'automation-worker', name: 'Automation Worker', tier: 2, category: 'automation', resource: 'compute',
    description: 'Encadeia ferramentas em pipelines que se executam sozinhos.',
    baseCost: 12000, costScaling: 1.15, baseProduction: 47,
  },
  {
    id: 'agent', name: 'Agent', tier: 3, category: 'agents', resource: 'compute',
    description: 'Planeja e distribui trabalho entre as outras estações.',
    baseCost: 5e6, costScaling: 1.15, baseProduction: 5000,
  },
  {
    id: 'local-cluster', name: 'Local Cluster', tier: 3, category: 'infra', resource: 'compute',
    description: 'Vários nós trabalhando juntos. Rende mais quanto mais diversa a infraestrutura.',
    baseCost: 6e7, costScaling: 1.15, baseProduction: 30000,
    perActiveCategory: 0.1, // +10% por categoria com produção
  },
];

module.exports = { GENERATORS };
