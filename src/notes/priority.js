'use strict';
/**
 * Prioridade de uma tarefa. No markdown vale a marca "!1" (alta) · "!2" (média) · "!3" (baixa);
 * sem marca a tarefa fica "sem prioridade" (nível 0). Rótulos e dicas num lugar só, para o painel
 * de Tarefas, a Home e o preview mostrarem a mesma coisa.
 */
const LEVELS = {
  1: { label: 'Alta', title: 'Prioridade alta (!1)' },
  2: { label: 'Média', title: 'Prioridade média (!2)' },
  3: { label: 'Baixa', title: 'Prioridade baixa (!3)' },
  0: { label: 'Sem prioridade', title: 'Sem prioridade — use !1 (alta), !2 (média) ou !3 (baixa) no texto da tarefa' },
};

/** priority: 1..3 | null → { level: 0..3, label, title } */
function priorityInfo(priority) {
  const level = LEVELS[priority] ? Number(priority) : 0;
  return { level, ...LEVELS[level] };
}

module.exports = { priorityInfo };
