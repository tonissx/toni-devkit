'use strict';
/**
 * Blueprints: conjuntos de 4 peças por gerador. Conjunto completo → Refactor para o próximo Mk:
 * produção do gerador inteiro × mult, próximas unidades custam ÷ costDiv (o gerador antigo volta a valer
 * a pena) e visual novo da estação. Mk II primeiro, Mk III depois.
 * Peças vêm de vilões contidos (categoria atacada), do Zero (Mk III), de achados dos pets,
 * ou são compradas com Compute (caro, proporcional à produção). Repetidas viram sucata.
 */

const BLUEPRINTS = [
  { gen: 'terminal-worker', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Mechanical Keyboard', 'Dotfiles', 'Tmux Session', 'Shell Aliases'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Custom Kernel', 'Zero-latency TTY', 'Neural Autocomplete', 'Quantum Prompt'] },
  ] },
  { gen: 'script-runner', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Cron Schedule', 'Retry Policy', 'Lockfile', 'Idempotent Script'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Self-healing Job', 'Distributed Lock', 'Hot Cache', 'Event Trigger'] },
  ] },
  { gen: 'index-worker', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Sharded Index', 'B-Tree Upgrade', 'Query Planner', 'Warm Cache'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Columnar Store', 'Vector Index', 'Adaptive Planner', 'Zero-copy Reader'] },
  ] },
  { gen: 'automation-worker', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Pipeline YAML', 'Artifact Cache', 'Parallel Runner', 'Matrix Build'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Autoscaling Runners', 'Remote Cache', 'Flaky Detector', 'Merge Queue'] },
  ] },
  { gen: 'agent', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Long Context', 'Tool Use', 'Task Planner', 'Memory Store'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Multi-agent Protocol', 'Self-review Loop', 'Skill Library', 'Reasoning Engine'] },
  ] },
  { gen: 'local-cluster', levels: [
    { mk: 2, mult: 3, costDiv: 4, parts: ['Load Balancer', 'Health Checks', 'Service Mesh', 'Rolling Deploy'] },
    { mk: 3, mult: 5, costDiv: 10, parts: ['Auto-healing Nodes', 'Global Anycast', 'Chaos Monkey', 'Zero-downtime Migration'] },
  ] },
];

module.exports = { BLUEPRINTS };
