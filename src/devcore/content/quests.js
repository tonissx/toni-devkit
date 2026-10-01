'use strict';
/**
 * Missões diárias. Sorteadas por dia local (balance.quests.perDay) a partir deste pool.
 * Prêmio só cosmético/tático — nunca produção: contam para os visuais (Condition { questsDone }
 * e { petQuests }) e podem render um consumível (balance.quests.itemChance). Sem streak, sem
 * expiração com perda: ignorar um dia não custa nada.
 *
 * when.event: evento do DevKit (ver electron/events.js), com a chave opcional "evento:chave".
 * when.distinct: nº de chaves distintas no dia (padrão 1). pet: o DevPet que "pede" a missão.
 */

const QUESTS = [
  { id: 'palette', title: 'Atalhos', text: 'Abra a command palette.', when: { event: 'palette.opened' } },
  { id: 'explorer', title: 'Explorador', text: 'Use 2 ferramentas diferentes.', when: { event: 'tool.used', distinct: 2 } },
  { id: 'wanderer', title: 'Visitante', text: 'Abra 3 ferramentas diferentes.', when: { event: 'tool.opened', distinct: 3 } },
  { id: 'commander', title: 'Comandante', text: 'Execute 2 comandos diferentes na palette.', when: { event: 'command.executed', distinct: 2 } },
  { id: 'note', title: 'Anotador', text: 'Crie uma nota.', when: { event: 'note.created' }, pet: 'memo' },
  { id: 'snippet', title: 'Colecionador', text: 'Crie um snippet.', when: { event: 'snippet.created' }, pet: 'noxi' },
  { id: 'sql', title: 'Consultor', text: 'Formate um SQL.', when: { event: 'tool.used:sql' }, pet: 'query' },
  { id: 'diff', title: 'Revisor de diffs', text: 'Compare dois textos no Diff.', when: { event: 'tool.used:diff' }, pet: 'git' },
  { id: 'json', title: 'Analista de JSON', text: 'Use o JSON Visualizer.', when: { event: 'tool.used:json' }, pet: 'lint' },
];

module.exports = { QUESTS };
