'use strict';
/** Automações — tipos de passo (metadados puros, usados pelo Electron e pela tela). */
const STEP_TYPES = {
  agent: {
    label: 'Agente', icon: 'bot',
    templated: ['prompt'],
    hint: 'Roda um agente do Claude Code com o texto que você montar. Por padrão só lê.',
  },
  notify: {
    label: 'Aviso do sistema', icon: 'bell',
    templated: ['title', 'text'],
    hint: 'Mostra uma notificação do Windows com o texto montado.',
  },
};
const TYPE_LIST = Object.keys(STEP_TYPES);
const RESERVED_IDS = new Set(['trigger', 'secret']);
const ID = /^[a-z][a-z0-9_]{0,15}$/;

/** Risco do passo: 'read' (só lê/avisa), 'write' (altera arquivos) ou 'exec' (executa comandos; ainda sem passo assim). */
function riskOf(step) {
  if (step.type === 'agent') return step.config && step.config.mode === 'agent' ? 'write' : 'read';
  return 'read';
}
const RISK_LABEL = { read: 'Só leitura', write: 'Pode alterar arquivos', exec: 'Executa comandos' };

/** Resumo em palavras do que a automação faz, para mostrar antes de ligar o agendamento. */
function describeAutomation(a) {
  const risks = new Set(a.steps.map(riskOf));
  const parts = a.steps.map((s, i) => `${i + 1}. ${s.name || STEP_TYPES[s.type].label} (${STEP_TYPES[s.type].label.toLowerCase()}${riskOf(s) === 'read' ? '' : ', ' + RISK_LABEL[riskOf(s)].toLowerCase()})`);
  return { risk: risks.has('exec') ? 'exec' : risks.has('write') ? 'write' : 'read', text: parts.join(' → ') };
}

module.exports = { STEP_TYPES, TYPE_LIST, RESERVED_IDS, ID, RISK_LABEL, riskOf, describeAutomation };
