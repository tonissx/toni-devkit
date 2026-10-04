'use strict';
/**
 * Git — operações tipadas. A tela nunca monta linha de comando: manda { op, ...params } e este módulo devolve
 * os argumentos do git (sempre depois de validar), o risco, a explicação em português e o comando para exibir/copiar.
 *
 * risk: 'safe' (não perde nada) · 'rewrite' (reescreve histórico; dá para voltar pelo ponto de volta) ·
 *       'discard' (descarta trabalho; o Devkit guarda um ponto de volta antes e a tela pede confirmação).
 * backup: o serviço cria um ponto de volta (refs/devkit/backup/…) antes de rodar.
 */

/* ─────────────── Validação ─────────────── */

/** Nome de branch aceitável (as regras do git check-ref-format, de forma conservadora). */
function validBranchName(name) {
  const s = String(name || '');
  return s.length > 0 && s.length <= 200 && !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(s) && !s.startsWith('-') && !s.startsWith('/')
    && !s.endsWith('/') && !s.endsWith('.') && !s.endsWith('.lock') && !s.includes('..') && !s.includes('@{') && !s.includes('//')
    && s !== '@' && !s.split('/').some((p) => p.startsWith('.'));
}

/** Revisão (hash, branch, HEAD~1, stash@{0}…) segura para virar argumento. */
const validRev = (r) => typeof r === 'string' && /^[A-Za-z0-9._/@{}~^-]{1,250}$/.test(r) && !r.startsWith('-');

/** Caminho relativo à raiz do repositório (vai depois de `--`). */
const validPath = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.includes('\0')
  && !/^([a-zA-Z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..');

const STASH_RE = /^stash@\{\d{1,4}\}$/;

function need(cond, msg) { if (!cond) throw new Error(msg); }
const paths = (list) => {
  need(Array.isArray(list) && list.length > 0, 'Nenhum arquivo escolhido');
  need(list.every(validPath), 'Caminho de arquivo inválido');
  return list;
};
const branch = (n) => { need(validBranchName(n), `Nome de branch inválido: “${n}”`); return n; };
const rev = (r, what = 'Revisão') => { need(validRev(r), `${what} inválida`); return r; };
const patch = (p) => { need(typeof p === 'string' && /^diff --git /.test(p) && p.length < 20e6, 'Trecho inválido'); return p; };

/* ─────────────── Exibição do comando ─────────────── */

const quote = (a) => (/^[\p{L}\p{N}_./@{}~^:=+-]+$/u.test(a) ? a : `"${String(a).replace(/(["\\$`])/g, '\\$1')}"`);
const show = (args) => 'git ' + args.map(quote).join(' ');
const firstLine = (s) => { const l = String(s || '').split('\n')[0]; return l.length > 60 ? l.slice(0, 59) + '…' : l; };

/* ─────────────── Catálogo ─────────────── */

const OPS = {
  stage: ({ paths: p }) => ({
    args: ['add', '--', ...paths(p)], risk: 'safe', title: 'Preparar para o commit',
    explain: 'Coloca as mudanças desses arquivos na área de preparação (stage): é o que vai entrar no próximo commit.',
  }),
  unstage: ({ paths: p }, ctx) => ({
    args: ctx.unborn ? ['rm', '--cached', '-r', '-q', '--', ...paths(p)] : ['restore', '--staged', '--', ...paths(p)],
    risk: 'safe', title: 'Tirar do stage',
    explain: 'Tira os arquivos da área de preparação. As mudanças continuam no arquivo, só não entram no próximo commit.',
  }),
  stageAll: () => ({
    args: ['add', '-A'], risk: 'safe', title: 'Preparar tudo',
    explain: 'Coloca todas as mudanças (inclusive arquivos novos e excluídos) na área de preparação.',
  }),
  unstageAll: (_p, ctx) => ({
    args: ctx.unborn ? ['rm', '--cached', '-r', '-q', '.'] : ['reset', '-q'], risk: 'safe', title: 'Tirar tudo do stage',
    explain: 'Esvazia a área de preparação. Nenhuma mudança nos arquivos é perdida.',
  }),
  stageHunk: ({ patch: pt }) => ({
    args: ['apply', '--cached', '--whitespace=nowarn', '-'], stdin: patch(pt), risk: 'safe', title: 'Preparar este trecho',
    explain: 'Prepara só este trecho do arquivo (o resto continua fora do stage). Equivale a escolher o trecho no `git add -p`.',
    display: 'git add -p  (escolhendo este trecho)',
  }),
  unstageHunk: ({ patch: pt }) => ({
    args: ['apply', '--cached', '-R', '--whitespace=nowarn', '-'], stdin: patch(pt), risk: 'safe', title: 'Tirar este trecho do stage',
    explain: 'Tira só este trecho da área de preparação; a mudança continua no arquivo.',
    display: 'git restore --staged -p  (escolhendo este trecho)',
  }),
  discardHunk: ({ patch: pt }) => ({
    args: ['apply', '-R', '--whitespace=nowarn', '-'], stdin: patch(pt), risk: 'discard', backup: true, title: 'Descartar este trecho',
    explain: 'Desfaz esta mudança no arquivo, voltando ao que está no stage/último commit. O Devkit guarda um ponto de volta antes.',
    display: 'git restore -p  (escolhendo este trecho)',
  }),
  discard: ({ paths: p }) => ({
    args: ['restore', '--worktree', '--', ...paths(p)], risk: 'discard', backup: true, title: 'Descartar mudanças',
    explain: 'Volta os arquivos ao que está no stage/último commit, jogando fora as mudanças não preparadas. O Devkit guarda um ponto de volta antes.',
  }),
  removeUntracked: ({ paths: p }) => ({
    args: ['clean', '-f', '-q', '--', ...paths(p)], risk: 'discard', backup: true, backupFiles: p, title: 'Excluir arquivos novos',
    explain: 'Apaga arquivos que o git ainda não acompanha. O Devkit guarda uma cópia em .git/devkit antes.',
  }),
  commit: ({ message, amend }) => {
    need(typeof message === 'string' && message.trim(), 'Escreva a mensagem do commit');
    const args = ['commit', ...(amend ? ['--amend'] : []), '-F', '-'];
    return {
      args, stdin: message.replace(/\r\n/g, '\n'), risk: amend ? 'rewrite' : 'safe', backup: !!amend,
      title: amend ? 'Corrigir o último commit' : 'Fazer commit',
      explain: amend
        ? 'Substitui o último commit por um novo, com o que está no stage e esta mensagem. Se ele já foi enviado (push), evite: reescreve o histórico.'
        : 'Grava o que está na área de preparação como um novo commit na branch atual.',
      display: show(['commit', ...(amend ? ['--amend'] : []), '-m', firstLine(message)]),
    };
  },
  'branch.create': ({ name, from, checkout }) => {
    const args = checkout ? ['switch', '-c', branch(name)] : ['branch', branch(name)];
    if (from) args.push(rev(from, 'Ponto de partida'));
    return {
      args, risk: 'safe', title: checkout ? 'Criar branch e trocar para ela' : 'Criar branch',
      explain: `Cria a branch “${name}” ${from ? `a partir de ${from}` : 'a partir de onde você está'}${checkout ? ' e passa a trabalhar nela' : ''}. Nada muda nas outras branches.`,
    };
  },
  'branch.switch': ({ name }) => ({
    args: ['switch', branch(name)], risk: 'safe', title: 'Trocar de branch',
    explain: `Passa a trabalhar na branch “${name}”: os arquivos ficam como estão nela.`,
  }),
  'branch.rename': ({ from, to }) => ({
    args: ['branch', '-m', branch(from), branch(to)], risk: 'safe', title: 'Renomear branch',
    explain: `Renomeia “${from}” para “${to}”. Os commits não mudam.`,
  }),
  'branch.delete': ({ name, force }) => ({
    args: ['branch', force ? '-D' : '-d', branch(name)], risk: force ? 'discard' : 'safe', backup: true, backupRef: name,
    title: force ? 'Excluir branch (mesmo sem merge)' : 'Excluir branch',
    explain: force
      ? `Exclui “${name}” mesmo com commits que não estão em outra branch. O Devkit guarda a ponta dela num ponto de volta.`
      : `Exclui “${name}”. O git só deixa se os commits dela já estiverem em outra branch.`,
  }),
  'stash.push': ({ message, untracked, paths: p }) => {
    const args = ['stash', 'push', ...(untracked ? ['-u'] : [])];
    if (message) args.push('-m', String(message).slice(0, 200));
    if (p && p.length) args.push('--', ...paths(p));
    return {
      args, risk: 'safe', title: 'Guardar mudanças (stash)',
      explain: 'Guarda as mudanças numa gaveta (stash) e deixa os arquivos limpos. Dá para aplicar de volta quando quiser.',
    };
  },
  'stash.apply': ({ ref }) => { need(STASH_RE.test(ref), 'Stash inválido'); return { args: ['stash', 'apply', ref], risk: 'safe', title: 'Aplicar stash', explain: 'Traz as mudanças guardadas de volta para os arquivos e mantém o stash na lista.' }; },
  'stash.pop': ({ ref }) => { need(STASH_RE.test(ref), 'Stash inválido'); return { args: ['stash', 'pop', ref], risk: 'safe', title: 'Aplicar e remover stash', explain: 'Traz as mudanças guardadas de volta e tira o stash da lista (se não houver conflito).' }; },
  'stash.drop': ({ ref }) => {
    need(STASH_RE.test(ref), 'Stash inválido');
    return { args: ['stash', 'drop', ref], risk: 'discard', backup: true, backupStash: ref, title: 'Descartar stash', explain: 'Remove o stash da lista. O Devkit guarda o conteúdo num ponto de volta antes.' };
  },
  'undo.commit': () => ({
    args: ['reset', '--soft', 'HEAD~1'], risk: 'rewrite', backup: true, title: 'Desfazer o último commit',
    explain: 'Tira o último commit da branch, mas mantém as mudanças dele no stage — prontas para ajustar e commitar de novo.',
  }),
  /* ─────────────── Fase 2: merge, cherry-pick, conflitos, rebase, receitas ─────────────── */

  merge: ({ branch: b, mode = 'auto' }) => {
    need(['auto', 'noff', 'ffonly'].includes(mode), 'Modo de merge inválido');
    return {
      args: ['merge', '--no-edit', ...(mode === 'noff' ? ['--no-ff'] : mode === 'ffonly' ? ['--ff-only'] : []), rev(b, 'Branch')],
      risk: 'safe', backup: true, mayConflict: true, title: `Mesclar ${b} na branch atual`,
      explain: `Traz para a branch atual tudo o que ${b} tem e ela não tem.${mode === 'noff' ? ' Sempre cria um commit de merge, mesmo quando daria para só avançar.' : mode === 'ffonly' ? ' Só se der para só avançar (sem commit de merge).' : ' Se der, só avança a branch; senão, cria um commit de merge.'} Se houver conflito, o git para e você resolve arquivo por arquivo.`,
    };
  },
  'cherry-pick': ({ hashes }) => {
    need(Array.isArray(hashes) && hashes.length > 0 && hashes.length <= 100, 'Escolha os commits');
    return {
      args: ['cherry-pick', ...hashes.map((h) => rev(h, 'Commit'))], risk: 'safe', backup: true, mayConflict: true,
      title: hashes.length === 1 ? 'Trazer este commit (cherry-pick)' : `Trazer ${hashes.length} commits (cherry-pick)`,
      explain: 'Copia as mudanças desse(s) commit(s) para a branch atual, como commit(s) novo(s). A branch de origem não muda.',
    };
  },
  continue: ({ operation }) => {
    need(['merge', 'rebase', 'cherry-pick', 'revert'].includes(operation), 'Nada para continuar');
    return {
      args: [operation, '--continue'], risk: 'safe', mayConflict: true, title: `Continuar o ${operation}`,
      explain: operation === 'merge' ? 'Cria o commit de merge com os conflitos já resolvidos.' : `Grava o passo atual com os conflitos resolvidos e segue o ${operation} — pode parar de novo se o próximo passo também conflitar.`,
    };
  },
  abort: ({ operation }) => {
    need(['merge', 'rebase', 'cherry-pick', 'revert'].includes(operation), 'Nada para cancelar');
    return {
      args: [operation, '--abort'], risk: 'discard', title: `Cancelar o ${operation}`,
      explain: `Desiste do ${operation} e volta o repositório exatamente ao estado de antes de ele começar. O que você já resolveu nos conflitos é perdido.`,
    };
  },
  'conflict.take': ({ path: p, side }) => {
    need(side === 'ours' || side === 'theirs', 'Lado inválido');
    return {
      args: ['checkout', '--' + side, '--', ...paths([p])], then: [['add', '--', p]], risk: 'safe',
      title: side === 'ours' ? 'Ficar com a minha versão' : 'Ficar com a versão deles',
      explain: `Resolve o conflito usando o arquivo inteiro ${side === 'ours' ? 'da branch em que você está' : 'que está entrando'} e marca como resolvido.`,
      display: `git checkout --${side} -- ${p} && git add -- ${p}`,
    };
  },
  'conflict.save': ({ path: p, content }) => {
    need(typeof content === 'string' && content.length < 50e6, 'Conteúdo inválido');
    return {
      args: ['add', '--', ...paths([p])], writeFile: { path: p, content }, risk: 'safe', title: 'Marcar como resolvido',
      explain: 'Grava o arquivo como ficou na tela e marca o conflito como resolvido (git add).',
    };
  },
  'conflict.delete': ({ path: p }) => ({
    args: ['rm', '-q', '--', ...paths([p])], risk: 'safe', title: 'Resolver excluindo o arquivo',
    explain: 'Um lado excluiu o arquivo e o outro mudou. Isto aceita a exclusão.',
  }),
  'rebase.plan': ({ onto, plan }) => {
    need(Array.isArray(plan) && plan.length > 0 && plan.length <= 200, 'Plano vazio');
    return {
      args: ['rebase', '-i', '--autostash', rev(onto, 'Base')], plan, risk: 'rewrite', backup: true, mayConflict: true,
      title: 'Reorganizar commits (rebase interativo)',
      explain: 'Refaz os commits na ordem e do jeito que você montou (juntando, removendo, mudando mensagens). Os commits viram outros (hashes novos) — se já foram enviados (push), evite.',
      display: `git rebase -i ${onto}  (com o plano montado na tela)`,
    };
  },
  moveToNewBranch: ({ name, count }) => {
    need(Number.isInteger(count) && count > 0 && count <= 100, 'Quantidade inválida');
    return {
      args: ['branch', branch(name)], then: [['reset', '--keep', `HEAD~${count}`]], risk: 'rewrite', backup: true,
      title: `Mover ${count} commit${count === 1 ? '' : 's'} para a branch ${name}`,
      explain: `Cria a branch “${name}” com os últimos ${count} commit(s) e tira esses commits da branch atual. As mudanças não commitadas ficam onde estão.`,
      display: `git branch ${name} && git reset --keep HEAD~${count}`,
    };
  },
  'file.fromBranch': ({ branch: b, path: p }) => ({
    args: ['restore', '--source', rev(b, 'Branch'), '--staged', '--worktree', '--', ...paths([p])], risk: 'discard', backup: true,
    title: `Trazer ${p} de ${b}`,
    explain: `Substitui o arquivo pela versão que está em ${b} (já preparado para o commit). O Devkit guarda um ponto de volta antes.`,
  }),
  discardAll: () => ({
    args: ['reset', '--hard', 'HEAD'], risk: 'discard', backup: true, title: 'Descartar tudo e voltar ao último commit',
    explain: 'Joga fora todas as mudanças dos arquivos acompanhados pelo git (arquivos novos ficam). O Devkit guarda um ponto de volta antes.',
  }),

  /* ─────────────── Fase 3: tags, bisect, limpeza, .gitignore ─────────────── */

  'tag.create': ({ name, at, message }) => {
    need(validBranchName(name), `Nome de tag inválido: “${name}”`);
    const msg = String(message || '').trim();
    return {
      args: msg ? ['tag', '-a', name, '-m', msg.slice(0, 2000), rev(at || 'HEAD')] : ['tag', name, rev(at || 'HEAD')],
      risk: 'safe', title: `Criar a tag ${name}`,
      explain: `Marca ${at ? 'o commit ' + String(at).slice(0, 7) : 'o commit atual'} com o nome “${name}” (ex.: uma versão). ${msg ? 'Tag anotada, com a mensagem.' : 'Tag simples.'}`,
    };
  },
  'tag.delete': ({ name }) => {
    need(validBranchName(name), 'Tag inválida');
    return {
      args: ['tag', '-d', name], risk: 'safe', backup: true, backupTag: name, title: `Excluir a tag ${name}`,
      explain: `Remove a tag “${name}” deste repositório (o commit continua). O Devkit guarda um ponto de volta.`,
    };
  },
  'branch.deleteMany': ({ names }) => {
    need(Array.isArray(names) && names.length > 0 && names.length <= 200, 'Escolha as branches');
    names.forEach(branch);
    return {
      // Uma por vez: se o git recusar alguma (em uso num worktree, por exemplo), as outras ainda saem e o resultado diz quais.
      args: ['branch', '-d', ...names], each: names.map((n) => ['branch', '-d', n]), eachLabel: names,
      risk: 'safe', backup: true, backupRef: names,
      title: names.length === 1 ? `Excluir a branch ${names[0]}` : `Excluir ${names.length} branches já mescladas`,
      explain: 'Exclui branches cujos commits já estão em outra branch (o git confere). O Devkit guarda a ponta de cada uma num ponto de volta.',
    };
  },
  cleanFiles: ({ paths: p }) => ({
    args: ['clean', '-f', '-d', '-q', '--', ...paths(p)], risk: 'discard', backup: true, backupFiles: p,
    title: p.length === 1 ? `Apagar ${p[0]}` : `Apagar ${p.length} itens não versionados`,
    explain: 'Apaga arquivos e pastas que o git não acompanha (não os ignorados). O Devkit guarda uma cópia em .git/devkit antes.',
  }),
  'ignore.add': ({ pattern }) => {
    need(typeof pattern === 'string' && pattern.trim() && !/[\r\n\0]/.test(pattern) && !pattern.trim().startsWith('#'), 'Padrão inválido para o .gitignore');
    return {
      args: [], appendIgnore: pattern.trim(), risk: 'safe', title: `Ignorar ${pattern.trim()}`,
      explain: 'Acrescenta o padrão ao .gitignore da raiz: o git deixa de listar o que casar com ele. O que já está versionado continua.',
      display: `echo "${pattern.trim()}" >> .gitignore`,
    };
  },
  'worktree.remove': ({ path: p }) => {
    need(typeof p === 'string' && p.length > 0 && p.length < 1024 && !p.startsWith('-') && !/[\0\r\n]/.test(p), 'Worktree inválido');
    return {
      args: ['worktree', 'remove', p], risk: 'safe', worktreePath: p, title: 'Remover o worktree',
      explain: 'Apaga a pasta desse worktree (uma segunda cópia de trabalho do repositório). Os commits e a branch continuam; depois a branch pode ser excluída. O git recusa se a pasta tiver mudanças não commitadas.',
    };
  },
  'worktree.prune': () => ({
    args: ['worktree', 'prune'], risk: 'safe', title: 'Esquecer worktrees apagados',
    explain: 'Remove do registro do git os worktrees cuja pasta não existe mais.',
  }),
  'bisect.start': ({ bad, good }) => ({
    args: ['bisect', 'start', rev(bad || 'HEAD', 'Versão quebrada'), rev(good, 'Versão boa')], risk: 'safe', title: 'Começar a caçar o commit do bug (bisect)',
    explain: 'O git vai pulando para commits no meio do caminho entre a versão boa e a quebrada; você testa cada um e diz se funciona. Em poucos passos ele aponta o commit que introduziu o problema.',
  }),
  'bisect.mark': ({ verdict }) => {
    need(['good', 'bad', 'skip'].includes(verdict), 'Resposta inválida');
    return {
      args: ['bisect', verdict], risk: 'safe', title: verdict === 'good' ? 'Este funciona' : verdict === 'bad' ? 'Este está quebrado' : 'Pular este commit',
      explain: verdict === 'skip' ? 'Não dá para testar este commit (não compila, por exemplo): o git escolhe outro perto.' : 'O git anota a resposta e pula para o próximo commit a testar.',
    };
  },
  'bisect.reset': () => ({
    args: ['bisect', 'reset'], risk: 'safe', title: 'Encerrar o bisect',
    explain: 'Termina a caça e volta para a branch em que você estava.',
  }),

  reset: ({ to, mode }) => {
    need(['soft', 'mixed', 'hard'].includes(mode), 'Modo inválido');
    return {
      args: ['reset', '--' + mode, rev(to)], risk: mode === 'hard' ? 'discard' : 'rewrite', backup: true,
      title: mode === 'hard' ? 'Voltar a branch e os arquivos para este ponto' : 'Voltar a branch para este ponto',
      explain: mode === 'hard'
        ? 'Move a branch para este commit e deixa os arquivos exatamente como nele (mudanças não commitadas somem). O Devkit guarda um ponto de volta antes.'
        : mode === 'soft'
          ? 'Move a branch para este commit; o que veio depois fica no stage.'
          : 'Move a branch para este commit; o que veio depois fica nos arquivos, fora do stage.',
    };
  },
};

/**
 * Operação → { op, args, stdin?, risk, title, explain, display, backup, backupFiles?, backupRef?, backupStash? }.
 * ctx: { unborn } (repositório sem nenhum commit ainda). Lança erro com mensagem em português se algo for inválido.
 */
function buildOp(input, ctx = {}) {
  need(input && typeof input.op === 'string' && Object.prototype.hasOwnProperty.call(OPS, input.op), 'Operação desconhecida');
  const r = OPS[input.op](input, ctx);
  return { op: input.op, backup: false, ...r, display: r.display || show(r.args) };
}

const RISK_LABEL = { safe: 'Seguro', rewrite: 'Reescreve o histórico', discard: 'Descarta trabalho' };

module.exports = { buildOp, validBranchName, validRev, validPath, RISK_LABEL, OP_NAMES: Object.keys(OPS), show };
