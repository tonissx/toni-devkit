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

const DIARY_SESSIONS = 12;

/**
 * Entrada do diário de bordo: o que as sessões do dia fizeram (digests de sessionDigest), enxuto, mais os totais do dia.
 * `day`: { date, sessions: [digest + tokens] }; `totals`: { workMs, waitMs, tokens, cost } (qualquer campo pode faltar).
 */
function diaryInput(day, totals) {
  const d = day || {};
  const t = totals || {};
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const sessions = (Array.isArray(d.sessions) ? d.sessions : []).slice(-DIARY_SESSIONS).map((s) => {
    const prompts = Array.isArray(s.prompts) ? s.prompts : [];
    return {
      title: s.title || '', project: s.project || '', branch: s.branch || '',
      prompts: prompts.length > 5 ? [...prompts.slice(0, 2), ...prompts.slice(-3)] : prompts,
      answers: (Array.isArray(s.answers) ? s.answers : []).slice(-1),
      tools: s.tools || {}, files: (Array.isArray(s.files) ? s.files : []).slice(0, 15),
      commits: (Array.isArray(s.commits) ? s.commits : []).slice(0, 10), tokens: num(s.tokens),
    };
  });
  return { date: String(d.date || ''), sessions, totals: { workMs: num(t.workMs), waitMs: num(t.waitMs), tokens: num(t.tokens), cost: num(t.cost) } };
}

module.exports = { sessionDigest, diaryInput };
