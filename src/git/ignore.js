'use strict';
/**
 * Git — ajudante do .gitignore: sugere padrões a partir de um caminho (o arquivo, a pasta, a extensão…) e acrescenta
 * um padrão ao arquivo sem duplicar nem bagunçar as quebras de linha. JS puro, testado em scripts/test-git.mjs.
 */

/** Padrão aceitável: uma linha, sem NUL, não vazio, não comentário. */
const validPattern = (p) => typeof p === 'string' && p.trim().length > 0 && p.length < 500 && !/[\r\n\0]/.test(p) && !p.trim().startsWith('#');

/**
 * Sugestões para um caminho (relativo à raiz, "/" como separador; pasta termina em "/"):
 * [{ pattern, label }] — do mais específico ao mais amplo.
 */
function suggestions(path) {
  const p = String(path || '').replace(/\\/g, '/');
  const isDir = p.endsWith('/');
  const clean = p.replace(/\/$/, '');
  const parts = clean.split('/');
  const name = parts[parts.length - 1];
  const out = [];
  if (isDir) {
    out.push({ pattern: '/' + clean + '/', label: `Só esta pasta (${clean}/)` });
    out.push({ pattern: name + '/', label: `Qualquer pasta chamada “${name}”` });
  } else {
    out.push({ pattern: '/' + clean, label: `Só este arquivo` });
    const ext = /\.([A-Za-z0-9_-]{1,12})$/.exec(name);
    if (ext && !name.startsWith('.')) out.push({ pattern: '*.' + ext[1], label: `Todos os arquivos .${ext[1]}` });
    out.push({ pattern: name, label: `Qualquer arquivo chamado “${name}”` });
  }
  // Pastas acima (a mais próxima primeiro): ignorar a pasta-mãe inteira.
  for (let i = parts.length - 1; i > 0; i--) {
    const dir = parts.slice(0, i).join('/');
    out.push({ pattern: '/' + dir + '/', label: `A pasta ${dir}/ inteira` });
  }
  const seen = new Set();
  return out.filter((s) => !seen.has(s.pattern) && seen.add(s.pattern));
}

/** Conteúdo do .gitignore com o padrão no fim (se ainda não estiver). → { content, added } */
function appendPattern(content, pattern) {
  if (!validPattern(pattern)) throw new Error('Padrão inválido para o .gitignore');
  const text = String(content || '');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(pattern.trim())) return { content: text, added: false };
  const sep = !text || text.endsWith('\n') ? '' : eol;
  return { content: text + sep + pattern.trim() + eol, added: true };
}

module.exports = { suggestions, appendPattern, validPattern };
