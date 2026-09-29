'use strict';
/**
 * Habilidades dos DevPets (liberadas no tier 2). Decisões pontuais, não spam: cooldowns de minutos.
 * effect.type: 'burst' (multiplica um alvo por um tempo) · 'instant' (ganha N segundos de produção)
 *              · 'recall' (reduz os cooldowns das outras habilidades)
 */

const ABILITIES = [
  { id: 'compile-burst', name: 'Compile Burst', description: 'Toda a produção ×3 por 30 s.',
    effect: { type: 'burst', target: 'global', mult: 3, durationSec: 30 }, cooldownSec: 5 * 60 },
  { id: 'parallelize', name: 'Parallelize', description: 'Automation ×2 por 45 s.',
    effect: { type: 'burst', target: 'cat:automation', mult: 2, durationSec: 45 }, cooldownSec: 8 * 60 },
  { id: 'index', name: 'Index', description: 'Gera na hora 10 min da produção atual.',
    effect: { type: 'instant', seconds: 600 }, cooldownSec: 10 * 60 },
  { id: 'recall', name: 'Recall', description: 'Reduz pela metade os cooldowns das outras habilidades.',
    effect: { type: 'recall', factor: 0.5 }, cooldownSec: 15 * 60 },
  { id: 'orchestrate', name: 'Orchestrate', description: 'Agents ×4 por 40 s.',
    effect: { type: 'burst', target: 'cat:agents', mult: 4, durationSec: 40 }, cooldownSec: 10 * 60 },
  { id: 'scale-out', name: 'Scale Out', description: 'Infra ×3 por 60 s.',
    effect: { type: 'burst', target: 'cat:infra', mult: 3, durationSec: 60 }, cooldownSec: 12 * 60 },
];

module.exports = { ABILITIES };
