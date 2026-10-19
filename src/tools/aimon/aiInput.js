'use strict';
/**
 * Monitor de IA — o que se entrega às tarefas de IA a partir de uma sessão. Puro: recebe a linha da sessão e a timeline
 * já carregada na tela (eventos normalizados) e devolve só o essencial. Resultados de ferramentas nunca entram; o texto
 * ainda passa por `redact` dentro de cada tarefa (src/ai/tasks-aimon.js).
 */
const MAX_PROMPTS = 12;
const MAX_ANSWERS = 3;
const MAX_FILES = 40;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

// Avisos do próprio Claude Code (notificação de tarefa, lembretes, comandos) chegam como mensagens de usuário: não são pedidos.
const HARNESS = /^\s*<(task-notification|system-reminder|command-name|command-message|command-args|local-command|user-prompt-submit-hook)\b/i;

const base = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || '';

function sessionDigest(session, events) {
  const s = session || {};
  const prompts = [];
  const answers = [];
  const tools = {};
  const files = [];
  const commits = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.kind === 'prompt' && e.summary) { if (!HARNESS.test(e.summary)) prompts.push(e.summary); }
    else if (e.kind === 'text' && e.summary) answers.push(e.summary);
    else if (e.kind === 'tool_use' && e.tool) {
      tools[e.tool] = (tools[e.tool] || 0) + 1;
      if (EDIT_TOOLS.has(e.tool) && e.summary && !files.includes(e.summary) && files.length < MAX_FILES) files.push(e.summary);
    } else if (e.kind === 'commit' && e.hash) commits.push({ hash: e.hash, branch: e.branch || null, subject: e.summary || '' });
  }
  // Sessão longa: os primeiros pedidos dizem o objetivo, os últimos dizem onde parou.
  const picked = prompts.length > MAX_PROMPTS ? [...prompts.slice(0, 3), ...prompts.slice(-(MAX_PROMPTS - 3))] : prompts;
  return {
    title: s.label || s.title || '',
    project: (s.repo && s.repo.name) || base(s.cwd),
    branch: (s.repo && s.repo.branch) || s.branch || '',
    status: s.status || '',
    partial: !!s.partial, // arquivo muito grande: só o final foi lido
    prompts: picked,
    answers: answers.slice(-MAX_ANSWERS),
    tools,
    files,
    commits,
  };
}

module.exports = { sessionDigest };
