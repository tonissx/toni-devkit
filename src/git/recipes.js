'use strict';
/**
 * Git — receitas "Quero…": situações comuns descritas como a pessoa pensa, cada uma levando ao fluxo certo da
 * ferramenta (uma aba, um assistente ou uma operação direta). Só dados; a tela (src/tools/git/Recipes.jsx) executa.
 *
 * action:
 *   { tab }                       abre uma aba
 *   { op }                        roda uma operação de src/git/ops.js (com a confirmação de sempre)
 *   { wizard: 'moveToBranch' | 'fileFromBranch' | 'updateFromBase' | 'squashLast' | 'amendMessage' }
 */
const RECIPES = [
  {
    id: 'undo-commit', icon: 'undo-2', title: 'Desfazer o último commit',
    when: 'Commitei cedo demais, faltou um arquivo ou errei a mensagem.',
    how: 'Tira o commit da branch e deixa as mudanças dele preparadas, prontas para ajustar e commitar de novo.',
    cmd: 'git reset --soft HEAD~1', action: { op: { op: 'undo.commit' } }, keywords: ['reverter', 'voltar', 'commit errado', 'reset'],
  },
  {
    id: 'amend-message', icon: 'pencil', title: 'Mudar a mensagem do último commit',
    when: 'A mensagem do commit saiu errada ou incompleta.',
    how: 'Abre a caixa de commit em "corrigir o último commit" já com a mensagem atual para editar.',
    cmd: 'git commit --amend', action: { wizard: 'amendMessage' }, keywords: ['amend', 'mensagem', 'corrigir', 'renomear commit'],
  },
  {
    id: 'move-to-branch', icon: 'git-branch-plus', title: 'Commitei na branch errada',
    when: 'Fiz commits na main (ou em outra branch) que deviam estar numa branch nova.',
    how: 'Cria uma branch nova com os últimos commits e tira esses commits da branch atual. Nada se perde.',
    cmd: 'git branch nova && git reset --keep HEAD~N', action: { wizard: 'moveToBranch' }, keywords: ['branch errada', 'mover commits', 'main', 'separar'],
  },
  {
    id: 'squash-last', icon: 'combine', title: 'Juntar meus últimos commits',
    when: 'Tenho vários commits pequenos ("ajuste", "agora vai") e quero um só antes de mandar.',
    how: 'Abre a reorganização de commits com os últimos já marcados para juntar; você confere a prévia e confirma.',
    cmd: 'git rebase -i HEAD~N  (squash)', action: { wizard: 'squashLast' }, keywords: ['squash', 'juntar', 'unir', 'limpar historico', 'rebase'],
  },
  {
    id: 'reorder', icon: 'list-ordered', title: 'Reorganizar, renomear ou remover commits',
    when: 'Quero mudar a ordem, editar mensagens antigas ou tirar um commit do meio.',
    how: 'Abre a reorganização de commits: arraste, escolha a ação de cada um e veja a prévia.',
    cmd: 'git rebase -i', action: { tab: 'rebase' }, keywords: ['rebase', 'interativo', 'ordem', 'reword', 'drop', 'remover commit'],
  },
  {
    id: 'cherry-pick', icon: 'cherry', title: 'Trazer um commit de outra branch',
    when: 'Preciso só de uma correção que está em outra branch, sem trazer o resto.',
    how: 'No Histórico, escolha o commit e use "Trazer para a branch atual" (cherry-pick).',
    cmd: 'git cherry-pick <commit>', action: { tab: 'history' }, keywords: ['cherry', 'pick', 'copiar commit', 'correção', 'hotfix'],
  },
  {
    id: 'update-from-base', icon: 'git-merge', title: 'Atualizar minha branch com a main',
    when: 'A main andou e quero trazer as novidades para a minha branch.',
    how: 'Abre o merge da main na branch atual com a prévia dos conflitos antes de mexer em qualquer coisa.',
    cmd: 'git merge main', action: { wizard: 'updateFromBase' }, keywords: ['atualizar', 'sincronizar', 'merge', 'main', 'develop'],
  },
  {
    id: 'merge', icon: 'git-merge', title: 'Mesclar uma branch na atual',
    when: 'Terminei uma branch e quero juntar o trabalho dela aqui.',
    how: 'Na aba Branches, use "Mesclar na atual": mostra o que entra e se vai dar conflito antes de mesclar.',
    cmd: 'git merge <branch>', action: { tab: 'branches' }, keywords: ['merge', 'juntar branch', 'integrar'],
  },
  {
    id: 'file-from-branch', icon: 'file-input', title: 'Trazer um arquivo de outra branch',
    when: 'Quero a versão de um arquivo que está em outra branch (ou desfazer um arquivo inteiro).',
    how: 'Escolha a branch e o arquivo; ele fica como lá, já preparado para o commit.',
    cmd: 'git restore --source <branch> -- <arquivo>', action: { wizard: 'fileFromBranch' }, keywords: ['arquivo', 'checkout', 'restore', 'versão'],
  },
  {
    id: 'discard-all', icon: 'eraser', title: 'Descartar tudo e voltar ao último commit',
    when: 'Fiz uma bagunça nos arquivos e quero recomeçar do último commit.',
    how: 'Joga fora as mudanças dos arquivos acompanhados (os novos ficam). O Devkit guarda um ponto de volta antes.',
    cmd: 'git reset --hard HEAD', action: { op: { op: 'discardAll' } }, keywords: ['descartar', 'limpar', 'recomeçar', 'reset hard'],
  },
  {
    id: 'stash', icon: 'archive', title: 'Guardar o que estou fazendo para trocar de assunto',
    when: 'Surgiu algo urgente e não quero commitar o trabalho pela metade.',
    how: 'Na aba Stash, guarde as mudanças com um nome; depois é só aplicar de volta.',
    cmd: 'git stash push -u -m "…"', action: { tab: 'stash' }, keywords: ['stash', 'guardar', 'pausar', 'urgente'],
  },
  {
    id: 'partial', icon: 'split', title: 'Commitar só parte das mudanças',
    when: 'Mexi em várias coisas e quero separar em commits diferentes.',
    how: 'Em Mudanças, prepare só os trechos que entram neste commit (botão em cada trecho do diff).',
    cmd: 'git add -p', action: { tab: 'changes' }, keywords: ['parcial', 'trecho', 'hunk', 'add -p', 'separar'],
  },
  {
    id: 'compare', icon: 'arrow-left-right', title: 'Ver o que mudou entre duas branches',
    when: 'Quero saber o que uma branch tem que a outra não tem.',
    how: 'Na aba Branches, use "Comparar": commits de cada lado, ancestral comum e arquivos.',
    cmd: 'git log a..b · git diff a...b', action: { tab: 'branches' }, keywords: ['comparar', 'diferença', 'diff', 'branches'],
  },
  {
    id: 'recover', icon: 'life-buoy', title: 'Recuperar algo que apaguei ou perdi',
    when: 'Excluí uma branch, desfiz um commit ou fiz um reset e me arrependi.',
    how: 'A Máquina do tempo mostra os pontos de volta do Devkit e tudo o que aconteceu (reflog), com recuperar.',
    cmd: 'git reflog', action: { tab: 'time' }, keywords: ['recuperar', 'perdi', 'apaguei', 'reflog', 'desfazer'],
  },
  {
    id: 'conflicts', icon: 'triangle-alert', title: 'Resolver conflitos',
    when: 'O git parou no meio de um merge, rebase ou cherry-pick com conflito.',
    how: 'Em Mudanças, cada arquivo em conflito abre um editor com a sua versão, a deles e o resultado; depois, Continuar.',
    cmd: 'git add <arquivo> && git merge --continue', action: { tab: 'changes' }, keywords: ['conflito', 'merge conflict', 'resolver'],
  },
];

module.exports = { RECIPES };
