'use strict';
/**
 * Descobertas. when: Condition (engine/conditions.js). rewards:
 *   { pet:id } · { tier:n } · { effect: Effect }   (efeitos de USO têm teto: balance.usageBonusCap)
 * Condições de uso contam DIAS distintos / ids distintos — repetir no mesmo dia não acelera nada.
 * finder: pet que "achou" (fala na cena); texto no estilo de log do sistema.
 */

const DISCOVERIES = [
  { id: 'boot-sequence', title: 'Boot Sequence', finder: 'byte',
    text: 'Seu DevCore ligou. Byte assumiu o primeiro terminal.',
    when: { always: true }, rewards: [] },
  { id: 'automation-era', title: 'Automation Era', finder: 'byte',
    text: 'A infraestrutura aprendeu a encadear tarefas. Novos produtores, sinergias e habilidades.',
    when: { lifetime: 10000 }, rewards: [{ tier: 2 }] },
  { id: 'agent-era', title: 'Agent Era', finder: 'byte',
    text: 'Agentes começaram a coordenar o trabalho. Estações liberadas para os DevPets.',
    when: { lifetime: 6e8 }, rewards: [{ tier: 3 }] },
  { id: 'shortcut-engine', title: 'Shortcut Engine', finder: 'byte',
    text: 'Seu jeito de navegar pelo teclado virou um motor de atalhos. Noxi apareceu para ajudar.',
    when: { usage: { event: 'palette.opened', days: 2 } }, rewards: [{ pet: 'noxi' }] },
  { id: 'toolsmith', title: 'Toolsmith', finder: 'byte',
    text: 'Você explorou ferramentas diferentes. O DevCore passou a reaproveitá-las.',
    when: { distinct: { event: 'tool.used', n: 3 } }, rewards: [{ effect: { type: 'add', target: 'global', value: 0.02 } }] },
  { id: 'data-layer', title: 'Data Layer', finder: 'noxi',
    text: 'Consultas frequentes criaram uma camada de dados. Query chegou para cuidar dela.',
    when: { any: [{ usage: { event: 'tool.used:sql', days: 2 } }, { usage: { event: 'tool.opened:notes', days: 2 } }] },
    rewards: [{ pet: 'query' }] },
  { id: 'knowledge-engine', title: 'Knowledge Engine', finder: 'query',
    text: 'Suas notas viraram uma base de conhecimento. Memo passou a organizá-la.',
    when: { usage: { event: 'note.created', days: 3 } }, rewards: [{ pet: 'memo' }] },
  { id: 'snippet-library', title: 'Snippet Library', finder: 'noxi',
    text: 'Um snippet reutilizável virou peça de pipeline.',
    when: { first: 'snippet.created' }, rewards: [{ effect: { type: 'add', target: 'cat:automation', value: 0.03 } }] },
  { id: 'command-center', title: 'Command Center', finder: 'noxi',
    text: 'Você já comanda o DevKit por vários caminhos. Relay chegou para orquestrar os agentes.',
    when: { all: [{ tier: 3 }, { distinct: { event: 'command.executed', n: 5 } }] }, rewards: [{ pet: 'relay' }] },
  { id: 'always-on', title: 'Always On', finder: 'byte',
    text: 'Seu DevKit virou parte da rotina. Armo passou a cuidar da infraestrutura.',
    when: { all: [{ tier: 3 }, { usage: { event: 'tool.opened', days: 5 } }] }, rewards: [{ pet: 'armo' }] },
  { id: 'night-shift', title: 'Night Shift', finder: 'byte',
    text: 'O DevCore trabalhou horas sozinho e aprendeu a se manter de pé sem você.',
    when: { offlineHours: 4 }, rewards: [] },
];

module.exports = { DISCOVERIES };
