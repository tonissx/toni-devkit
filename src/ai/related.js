'use strict';
/**
 * Relevância local (sem IA) entre uma pergunta e os comandos do Devkit: as ações prontas que resolvem a pergunta
 * aparecem sempre, mesmo que o modelo não as cite. Também escolhe quais comandos vão no pedido da palette.
 * Testado em scripts/test-ai-tasks.mjs.
 */

const STOP = new Set('a o os as um uma uns umas de do da dos das em no na nos nas por para pra com sem que qual quais quando como onde quem é e ou se meu minha meus minhas eu foi era ser está estão fiz fazer faço posso pode quero queria preciso tem ter isso esse essa este esta the of to in on for and or is are was what how where when which who why my i do can'.split(' '));

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palavras que importam no texto (sem acento, sem palavras vazias). */
function keywords(text) {
  return [...new Set(plain(text).split(/[^\w.-]+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, '')).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}

/** Radical simples: os 5 primeiros caracteres ("desfaço" ≈ "desfazer", "últimos" ≈ "último"). */
const stem = (w) => w.slice(0, 5);
const stems = (text) => new Set(plain(text).split(/[^\w]+/).filter((w) => w.length > 2).map(stem));

/** Receitas do Git e ferramentas primeiro no desempate (são as ações "prontas"). */
const prio = (id) => (/^git:recipe:/.test(id) ? 0 : /^tool:/.test(id) ? 1 : 2);

/**
 * → comandos mais relevantes para a pergunta. min: quantas palavras da pergunta precisam aparecer no comando
 * (padrão: 2, ou 1 se a pergunta só tem uma palavra útil).
 */
function relatedCommands(question, commands, { limit = 3, min } = {}) {
  const q = keywords(question).map(stem);
  if (!q.length) return [];
  const need = min != null ? min : Math.min(2, q.length);
  const out = [];
  for (const c of commands || []) {
    const name = stems(c.name);
    const rest = stems([c.description, ...(c.keywords || [])].join(' '));
    let score = 0, hits = 0;
    for (const s of q) {
      if (name.has(s)) { score += 2; hits++; } else if (rest.has(s)) { score += 1; hits++; }
    }
    if (hits >= need) out.push({ c, score });
  }
  return out.sort((a, b) => b.score - a.score || prio(a.c.id) - prio(b.c.id)).slice(0, limit).map((x) => x.c);
}

/** Comandos que apagam trabalho, quando aparecem numa resposta: o aviso vem do Devkit, não do modelo. */
const RISKY = [
  [/git\s+reset\s+--hard/i, 'git reset --hard apaga as mudanças que não foram commitadas (e os commits desfeitos) — para manter as mudanças, use --soft'],
  [/git\s+push\s+(?:\S+\s+)*(?:--force(?![\w-])|-f\b)/i, 'git push --force reescreve a branch no servidor e pode apagar commits de outras pessoas — prefira --force-with-lease'],
  [/git\s+clean\s+(?:\S+\s+)*-\w*f/i, 'git clean -f apaga de vez os arquivos não versionados'],
  [/git\s+checkout\s+(?:--\s+)?\.(?:\s|$)|git\s+restore\s+(?:--\S+\s+)*\.(?:\s|$)/i, 'descarta todas as mudanças não commitadas dos arquivos'],
  [/git\s+branch\s+-D\b/, 'git branch -D exclui a branch mesmo que ela não tenha sido mesclada'],
  [/\bdrop\s+(table|database)\b/i, 'DROP remove a tabela/banco inteiro'],
  [/\bdelete\s+from\s+\w+\s*;?\s*$/im, 'DELETE sem WHERE apaga todas as linhas'],
];
function riskyCommands(text) {
  return RISKY.filter(([re]) => re.test(String(text || ''))).map(([, msg]) => msg);
}

module.exports = { keywords, relatedCommands, riskyCommands };
