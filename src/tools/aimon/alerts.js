'use strict';
/**
 * Monitor de IA — avisos sobre o Git de uma sessão. Só avisam; nada bloqueia a sessão nem o Git.
 * Puro: recebe a branch, quantos arquivos estão alterados e se a sessão está escrevendo.
 */
const PROTECTED = /^(main|master|develop|development|release([/-].*)?|prod(uction)?([/-].*)?)$/i;
const MANY_FILES = 30;

/** → [{ id, icon, text, title }] */
function gitAlerts({ branch, dirty, active }) {
  const out = [];
  if (active && branch && PROTECTED.test(branch)) {
    out.push({ id: 'protected', icon: 'shield-alert', text: `Escrevendo em ${branch}`, title: 'A sessão está trabalhando direto numa branch protegida (main, master, develop, release*, prod*). Considere uma branch de trabalho.' });
  }
  if (Number.isFinite(dirty) && dirty >= MANY_FILES) {
    out.push({ id: 'many', icon: 'files', text: `${dirty} arquivos alterados`, title: `Há ${dirty} arquivos com alterações não comitadas neste repositório. Vale revisar e comitar em partes.` });
  }
  return out;
}

module.exports = { gitAlerts, PROTECTED, MANY_FILES };
