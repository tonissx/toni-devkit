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
  { name: 'Agent', hint: 'Delegar para outros agentes' },
  { name: 'TodoWrite', hint: 'Manter uma lista de tarefas' },
  { name: 'NotebookEdit', hint: 'Editar notebooks Jupyter' },
];

const PRESETS = [
  { value: 'read', label: 'Só leitura', tools: READ },
  { value: 'edit', label: 'Lê e edita', tools: EDIT },
  { value: 'all', label: 'Tudo (herda)', tools: null },
  { value: 'custom', label: 'Personalizado', tools: null },
];

/** Valor do select que abre o campo para digitar um ID completo de modelo (ex.: claude-opus-5-5). */
const MODEL_CUSTOM = '__custom';
const MODELS = [
  { value: '', label: 'Herdar da sessão (padrão)' },
  { value: 'inherit', label: 'inherit (explícito)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
  { value: MODEL_CUSTOM, label: 'Outro (digitar o ID)…' },
];
const isStdModel = (v) => MODELS.some((m) => m.value === v && m.value !== MODEL_CUSTOM);

/** Valores aceitos pelo frontmatter (documentação de subagents do Claude Code). */
const PERMISSION_MODES = [
  { value: '', label: 'Padrão (não escrever)', text: 'Usa o modo da sessão que chamou o agente.' },
  { value: 'default', label: 'default', text: 'Pede permissão para cada ação sensível, como no uso normal.' },
  { value: 'acceptEdits', label: 'acceptEdits', text: 'Aceita edições de arquivos sem perguntar; comandos continuam pedindo.' },
  { value: 'auto', label: 'auto', text: 'Um classificador decide o que pode seguir sem perguntar.' },
  { value: 'dontAsk', label: 'dontAsk', text: 'Nega o que não estiver permitido, em vez de perguntar.' },
  { value: 'plan', label: 'plan', text: 'Só planeja e lê: não altera nada.' },
  { value: 'bypassPermissions', label: 'bypassPermissions', text: 'Não pede NENHUMA permissão. Use só em ambiente isolado.' },
  { value: 'manual', label: 'manual', text: 'Apelido de default.' },
];
const MEMORY_SCOPES = [
  { value: '', label: 'Sem memória (não escrever)', text: 'O agente não guarda nada entre execuções.' },
  { value: 'user', label: 'user', text: 'Memória persistente em ~/.claude/agent-memory/<nome>/ (vale em todos os projetos).' },
  { value: 'project', label: 'project', text: 'Memória em .claude/agent-memory/<nome>/ (do projeto; pode ir para o git).' },
  { value: 'local', label: 'local', text: 'Memória em .claude/agent-memory-local/<nome>/ (do projeto, fora do git).' },
];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const COLORS = [
  { value: 'red', hex: '#ef4444' }, { value: 'blue', hex: '#3b82f6' }, { value: 'green', hex: '#22c55e' }, { value: 'yellow', hex: '#eab308' },
  { value: 'purple', hex: '#a855f7' }, { value: 'orange', hex: '#f97316' }, { value: 'pink', hex: '#ec4899' }, { value: 'cyan', hex: '#06b6d4' },
];
const colorHex = (name) => (COLORS.find((c) => c.value === name) || {}).hex || null;

const READ_TOOLS = [...READ, 'TodoWrite', 'NotebookRead', 'Task', 'Agent'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const EXEC_TOOLS = ['Bash', 'PowerShell', 'BashOutput', 'KillShell'];

/**
 * O que o agente pode fazer. Sem `tools` ele herda todas as ferramentas — inclusive editar e rodar comandos.
 * → { level: 'read' | 'edit' | 'exec', all: boolean, edit: string[], exec: string[], other: string[] }
 */
function permissions(tools, disallowed) {
  const base = (t) => String(t).replace(/\(.*$/, '');
  if (!Array.isArray(tools) || !tools.length) {
    // Herda tudo, menos o que estiver em disallowedTools. Bloquear Bash e PowerShell tira o "pode rodar comandos".
    const blocked = (Array.isArray(disallowed) ? disallowed : []).map(base);
    const noExec = blocked.includes('Bash') && blocked.includes('PowerShell');
    return { level: noExec ? 'edit' : 'exec', all: true, noExec, blocked, edit: [], exec: [], other: [] };
  }
  const edit = tools.filter((t) => EDIT_TOOLS.includes(base(t)));
  const exec = tools.filter((t) => EXEC_TOOLS.includes(base(t)));
  const other = tools.filter((t) => ![...READ_TOOLS, ...EDIT_TOOLS, ...EXEC_TOOLS].includes(base(t)));
  return { level: exec.length ? 'exec' : edit.length || other.length ? 'edit' : 'read', all: false, edit, exec, other };
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
  if (p.all && p.noExec) return { tone: 'warn', title: 'Herda tudo, menos comandos', text: `Sem lista de ferramentas ele herda as da sessão (inclusive editar arquivos e tools MCP), mas Bash e PowerShell estão bloqueados${p.blocked.length > 2 ? ` (e também: ${p.blocked.filter((t) => !['Bash', 'PowerShell'].includes(t)).join(', ')})` : ''}.` };
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

const list = (v) => (Array.isArray(v) ? [...v] : []);
const draftOf = (a) => ({
  name: a.name || '', description: a.description || '', model: a.model || '', tools: Array.isArray(a.tools) ? [...a.tools] : null,
  disallowedTools: list(a.disallowedTools), skills: list(a.skills), mcpServers: list(a.mcpServers),
  permissionMode: a.permissionMode || '', maxTurns: a.maxTurns == null ? '' : String(a.maxTurns), memory: a.memory || '', effort: a.effort || '',
  isolation: a.isolation || '', color: a.color || '', background: a.background === true, extra: a.extra || '', prompt: a.prompt || '',
});
const sameDraft = (a, b) => JSON.stringify(draftOf(a)) === JSON.stringify(draftOf(b));

module.exports = { permissions, READ, EDIT, TOOL_CHOICES, PRESETS, MODELS, MODEL_CUSTOM, isStdModel, PERMISSION_MODES, MEMORY_SCOPES, EFFORTS, COLORS, colorHex, TEMPLATES, presetOf, toolsForPreset, describePermissions, draftOf, sameDraft };
