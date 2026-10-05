'use strict';
/**
 * IA — prompts e preparo do que é enviado ao modelo. JS puro (testado em scripts/test-ai.mjs).
 * O serviço (electron/ai/service.js) só manda o que sai daqui, e a tela mostra exatamente este texto antes.
 */

/** Arquivos que não ajudam a escrever a mensagem: entram só pelo nome. */
const NOISY = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|go\.sum)$|\.(min\.js|min\.css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i;

/**
 * Diff (unificado, vários arquivos) → texto para o modelo, com teto de caracteres. Arquivos ruidosos ou binários
 * entram só pelo nome; o que passar do teto é cortado por arquivo, e o corte é anotado (nada some em silêncio).
 * → { text, files, omitted: [caminho], truncated }
 */
function prepareDiff(patch, { maxChars = 12000, perFile = 4000 } = {}) {
  const chunks = String(patch || '').split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '));
  const files = [];
  const omitted = [];
  let text = '';
  let truncated = false;
  for (const c of chunks) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(c);
    const name = m ? m[2] : '?';
    files.push(name);
    if (NOISY.test(name) || /^Binary files /m.test(c)) { omitted.push(name); continue; }
    let body = c.length > perFile ? c.slice(0, perFile) + `\n… (${c.length - perFile} caracteres deste arquivo cortados)\n` : c;
    if (c.length > perFile) truncated = true;
    if (text.length + body.length > maxChars) {
      const left = maxChars - text.length;
      if (left > 400) text += body.slice(0, left) + '\n… (diff cortado: limite de tamanho)\n';
      truncated = true;
      omitted.push(...chunks.slice(chunks.indexOf(c) + 1).map((x) => (/^diff --git a\/.+? b\/(.+)$/m.exec(x) || [])[1]).filter(Boolean));
      break;
    }
    text += body;
  }
  if (omitted.length) text += `\nArquivos também alterados (conteúdo não enviado): ${[...new Set(omitted)].join(', ')}\n`;
  return { text, files, omitted: [...new Set(omitted)], truncated };
}

/**
 * Pedido de mensagem de commit. recent: assuntos dos últimos commits do repositório (para seguir o estilo e o idioma).
 * → { system, user } — o mesmo texto vai para o modo Local e para a Nuvem.
 */
function commitMessagePrompt({ diff, recent = [], branch }) {
  const system = [
    'Você escreve mensagens de commit do git.',
    'Responda SOMENTE com a mensagem, sem comentários, sem aspas e sem bloco de código.',
    'Formato: uma primeira linha curta (até 72 caracteres, idealmente 50) dizendo o que mudou e, se ajudar, uma linha em branco e um parágrafo curto explicando o porquê.',
    'Siga o estilo e o idioma dos commits recentes do repositório. Se não houver exemplos, escreva em português do Brasil, no infinitivo ou no presente, sem ponto final no título.',
    'Descreva a intenção da mudança, não liste cada arquivo. Não invente nada que não esteja no diff.',
  ].join('\n');
  const examples = recent.filter(Boolean).slice(0, 10);
  const user = [
    branch ? `Branch: ${branch}` : null,
    examples.length ? `Commits recentes deste repositório (para o estilo):\n${examples.map((s) => '- ' + s).join('\n')}` : null,
    `Mudanças preparadas para este commit (diff):\n${diff}`,
    'Escreva a mensagem de commit.',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/** Limpa o que modelos pequenos às vezes devolvem em volta da mensagem (aspas, cercas de código, "Mensagem:"). */
function cleanCommitMessage(text) {
  let t = String(text || '').replace(/\r\n/g, '\n').trim();
  t = t.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
  t = t.replace(/^(mensagem( de commit)?|commit message|commit)\s*:\s*/i, '');
  if (/^["'“].*["'”]$/s.test(t) && !t.slice(1, -1).includes('\n\n')) t = t.slice(1, -1).trim();
  return t.replace(/\n{3,}/g, '\n\n');
}

/**
 * Modelos sugeridos para o modo Local (Ollama), do mais leve ao melhor.
 * O primeiro é o padrão: roda bem só na CPU (testado num Ryzen 5 5600G sem placa de vídeo, ~1-2 s por sugestão).
 */
const LOCAL_MODELS = [
  { id: 'qwen2.5-coder:3b', label: 'Leve — Qwen2.5 Coder 3B', size: '~1,9 GB', note: 'rápido mesmo sem placa de vídeo' },
  { id: 'qwen2.5-coder:7b', label: 'Melhor — Qwen2.5 Coder 7B', size: '~4,7 GB', note: 'mais preciso, mais lento na CPU' },
  { id: 'llama3.2:3b', label: 'Alternativa — Llama 3.2 3B', size: '~2,0 GB', note: 'uso geral' },
];

/** Modelos do modo Nuvem (API do Claude). O primeiro é o padrão. */
const CLOUD_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

/** Nome de modelo do Ollama aceitável (ex.: qwen2.5-coder:3b, usuario/modelo:tag). */
const validModelName = (s) => typeof s === 'string' && /^[a-z0-9][\w.\-/]{0,120}(:[\w.\-]{1,64})?$/i.test(s);

/** Linhas NDJSON do `ollama pull` → { status, percent|null } (o último estado). */
function pullProgress(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (o.error) return { error: String(o.error) };
  const percent = o.total ? Math.floor((o.completed || 0) / o.total * 100) : null;
  return { status: String(o.status || ''), percent, done: o.status === 'success' };
}

module.exports = { prepareDiff, commitMessagePrompt, cleanCommitMessage, LOCAL_MODELS, CLOUD_MODELS, validModelName, pullProgress };
