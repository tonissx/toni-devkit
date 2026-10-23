'use strict';
// Lógica pura da tela de Agentes (sem React): presets de permissão, modelos prontos e o texto que explica o que o agente pode fazer.

const READ = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
const EDIT = [...READ, 'Edit', 'Write'];
/** Ferramentas que a pessoa pode marcar uma a uma. */
const TOOL_CHOICES = [
  { name: 'Read', hint: 'Ler arquivos' },
  { name: 'Grep', hint: 'Buscar texto nos arquivos' },
  { name: 'Glob', hint: 'Achar arquivos por nome' },
  { name: 'WebFetch', hint: 'Abrir páginas da internet' },
  { name: 'WebSearch', hint: 'Pesquisar na internet' },
  { name: 'Edit', hint: 'Alterar arquivos existentes' },
  { name: 'Write', hint: 'Criar arquivos' },
  { name: 'Bash', hint: 'Rodar comandos (bash)' },
  { name: 'PowerShell', hint: 'Rodar comandos (PowerShell)' },
];

const PRESETS = [
  { value: 'read', label: 'Só leitura', tools: READ },
  { value: 'edit', label: 'Lê e edita', tools: EDIT },
  { value: 'all', label: 'Tudo (herda)', tools: null },
  { value: 'custom', label: 'Personalizado', tools: null },
];

const MODELS = [
  { value: '', label: 'Herdar da sessão' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

const READ_TOOLS = [...READ, 'TodoWrite', 'NotebookRead', 'Task', 'Agent'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const EXEC_TOOLS = ['Bash', 'PowerShell', 'BashOutput', 'KillShell'];

/**
 * O que o agente pode fazer. Sem `tools` ele herda todas as ferramentas — inclusive editar e rodar comandos.
 * → { level: 'read' | 'edit' | 'exec', all: boolean, edit: string[], exec: string[], other: string[] }
 */
function permissions(tools) {
  if (!Array.isArray(tools) || !tools.length) return { level: 'exec', all: true, edit: [], exec: [], other: [] };
  const base = (t) => String(t).replace(/\(.*$/, '');
  const edit = tools.filter((t) => EDIT_TOOLS.includes(base(t)));
  const exec = tools.filter((t) => EXEC_TOOLS.includes(base(t)));
  const other = tools.filter((t) => ![...READ_TOOLS, ...EDIT_TOOLS, ...EXEC_TOOLS].includes(base(t)));
  return { level: exec.length ? 'exec' : edit.length || other.length ? 'edit' : 'read', all: false, edit, exec, other };
}

const RUN_MODES = [
  { value: 'read', label: 'Só leitura', hint: 'Mesmo que o agente possa mais, esta rotina só lê, busca e pesquisa. Recomendado.' },
  { value: 'agent', label: 'Como o agente', hint: 'Usa as ferramentas que o agente declara (editar arquivos, rodar comandos). Sem ninguém olhando.' },
];

/**
 * O que uma rotina pode fazer sem ninguém olhando. Nada é perguntado em segundo plano: o que não está liberado aqui é negado.
 * `agent`: { tools } do agente. → { ok, problem?, tools, permissionMode, perms }
 */
function runPolicy(agent, mode) {
  const own = agent && Array.isArray(agent.tools) && agent.tools.length ? agent.tools : null;
  if (mode === 'agent') {
    if (!own) return { ok: false, problem: 'Este agente herda todas as ferramentas. Para agendá-lo “como o agente”, defina na aba Agentes quais ferramentas ele pode usar.' };
    const perms = permissions(own);
    return { ok: true, tools: own, permissionMode: perms.edit.length ? 'acceptEdits' : 'dontAsk', perms };
  }
  const tools = own ? own.filter((t) => READ.includes(t)) : [...READ];
  if (!tools.length) return { ok: false, problem: 'O agente não tem nenhuma ferramenta de leitura, então não há o que rodar em modo “Só leitura”.' };
  return { ok: true, tools, permissionMode: 'dontAsk', perms: permissions(tools) };
}

const same = (a, b) => a.length === b.length && a.every((t) => b.includes(t));

/** Qual preset descreve esta lista de ferramentas (null = herda tudo). */
function presetOf(tools) {
  if (!Array.isArray(tools) || !tools.length) return 'all';
  if (same(tools, READ)) return 'read';
  if (same(tools, EDIT)) return 'edit';
  return 'custom';
}

/** Ferramentas ao trocar de preset; 'custom' começa do que já estava marcado (ou de só leitura). */
function toolsForPreset(value, current) {
  if (value === 'all') return null;
  if (value === 'custom') return Array.isArray(current) && current.length ? [...current] : [...READ];
  return [...PRESETS.find((p) => p.value === value).tools];
}

/** Explicação do que o agente pode fazer → { tone: 'ok' | 'warn' | 'danger', title, text } — mostrada antes de agendar ou chamar. */
function describePermissions(p) {
  if (!p) return null;
  if (p.all) return { tone: 'danger', title: 'Pode tudo', text: 'Sem lista de ferramentas, o agente herda todas as da sessão: ler, editar arquivos e rodar comandos.' };
  if (p.level === 'exec') return { tone: 'danger', title: 'Pode rodar comandos', text: `Além de ler${p.edit.length ? ' e editar' : ''}, executa comandos (${p.exec.join(', ')}). Use só em pastas em que você confia.` };
  if (p.level === 'edit') return { tone: 'warn', title: 'Pode alterar arquivos', text: `Pode usar ${[...p.edit, ...p.other].join(', ')}. Não roda comandos.` };
  return { tone: 'ok', title: 'Só leitura', text: 'Lê, busca e pesquisa. Não altera arquivos nem roda comandos.' };
}

const TEMPLATES = [
  {
    id: 'blank', label: 'Em branco', icon: 'file',
    agent: { name: '', description: '', model: '', tools: [...READ], prompt: '' },
  },
  {
    id: 'reviewer', label: 'Revisor de código', icon: 'shield-check',
    agent: {
      name: 'revisor-de-codigo', model: 'sonnet', tools: [...READ],
      description: 'Revisa o código alterado procurando bugs, riscos e inconsistências. Use depois de mudanças relevantes, antes do commit ou da PR.',
      prompt: 'Você revisa código. Olhe as alterações recentes (git diff) e aponte, em ordem de gravidade:\n\n1. Bugs e casos que quebram (com o arquivo e a linha).\n2. Riscos de segurança e de perda de dados.\n3. Inconsistências com o código ao redor.\n\nSeja específico e curto. Não reescreva o código; diga o que está errado e por quê. Se não achar nada relevante, diga isso.\n',
    },
  },
  {
    id: 'domain', label: 'Especialista de domínio', icon: 'graduation-cap',
    agent: {
      name: 'especialista-fluig', model: '', tools: [...EDIT],
      description: 'Especialista em Fluig e TOTVS RM. Use para escrever ou revisar datasets, eventos de formulário, widgets e consultas SQL do RM.',
      prompt: 'Você é especialista na plataforma TOTVS Fluig e no ERP TOTVS RM.\n\nAntes de escrever código, consulte as skills disponíveis (fluig, totvs-rm, navship-domaincore) e siga as convenções do repositório.\n\nCuidados fixos:\n- No RM, sempre filtre por CODCOLIGADA (e filial quando existir).\n- Nunca invente nomes de tabelas ou colunas: confirme no código ou nas skills.\n- Explique em uma frase o que mudou e por quê.\n',
    },
  },
];

const draftOf = (a) => ({ name: a.name || '', description: a.description || '', model: a.model || '', tools: Array.isArray(a.tools) ? [...a.tools] : null, extra: a.extra || '', prompt: a.prompt || '' });
const sameDraft = (a, b) => JSON.stringify(draftOf(a)) === JSON.stringify(draftOf(b));

module.exports = { permissions, runPolicy, RUN_MODES, READ, EDIT, TOOL_CHOICES, PRESETS, MODELS, TEMPLATES, presetOf, toolsForPreset, describePermissions, draftOf, sameDraft };
