'use strict';
/**
 * Pastas das Notes — helpers puros. Uma pasta é um caminho relativo com "/" ("Trabalho/Fluig");
 * a raiz é ''. Cada pasta é um diretório real dentro da pasta das notas, então os nomes
 * precisam ser válidos no Windows. Usado pelo processo principal (serviço/store) e pela UI.
 */

const NAME_MAX = 80;
const INVALID_RE = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Mensagem de erro (pt-BR) para o nome de UMA pasta, ou null se for válido. */
function validFolderName(name) {
  const n = String(name == null ? '' : name);
  if (!n.trim()) return 'Digite um nome para a pasta.';
  if (n !== n.trim()) return 'O nome não pode começar nem terminar com espaço.';
  if (n.length > NAME_MAX) return `O nome pode ter no máximo ${NAME_MAX} caracteres.`;
  if (INVALID_RE.test(n)) return 'O nome não pode ter os caracteres  < > : " / \\ | ? *';
  if (n.startsWith('.')) return 'O nome não pode começar com ponto (pastas assim ficam ocultas).';
  if (n.endsWith('.')) return 'O nome não pode terminar com ponto.';
  if (RESERVED_RE.test(n)) return `“${n}” é um nome reservado do Windows.`;
  return null;
}

/** Normaliza um caminho de pasta: barras invertidas viram "/", sem barras nas pontas nem repetidas. */
const normFolder = (p) => String(p == null ? '' : p).replace(/\\/g, '/').split('/').filter((s) => s !== '').join('/');

/** Erro de um caminho de pasta inteiro (cada segmento precisa ser válido; '' = raiz é válido). */
function validFolderPath(p) {
  const segs = normFolder(p).split('/').filter(Boolean);
  for (const s of segs) { const e = validFolderName(s); if (e) return e; }
  return null;
}

/** Pasta de um arquivo relativo: 'a/b/x.md' → 'a/b' · 'x.md' → ''. */
const folderOf = (file) => { const s = normFolder(file); const i = s.lastIndexOf('/'); return i === -1 ? '' : s.slice(0, i); };
/** Nome do arquivo/pasta: 'a/b/x.md' → 'x.md'. */
const baseName = (p) => { const s = normFolder(p); return s.slice(s.lastIndexOf('/') + 1); };
/** Pai de uma pasta: 'a/b' → 'a' · 'a' → ''. */
const parentOf = folderOf;
const joinPath = (...parts) => parts.map(normFolder).filter(Boolean).join('/');
/** `p` está dentro de `ancestor` (estritamente)? '' é ancestral de tudo que não é raiz. */
const isDescendant = (p, ancestor) => {
  const a = normFolder(ancestor), c = normFolder(p);
  return a === '' ? c !== '' : c.startsWith(a + '/');
};

/**
 * Árvore para a UI a partir de [{ path, count }] (count = notas diretas da pasta).
 * Pais implícitos são criados. Nó: { path, name, count, total, children }. Ordem alfabética.
 */
function buildTree(folders) {
  const nodes = new Map();
  const ensure = (path) => {
    if (nodes.has(path)) return nodes.get(path);
    const node = { path, name: baseName(path), count: 0, total: 0, children: [] };
    nodes.set(path, node);
    const parent = parentOf(path);
    if (parent) ensure(parent).children.push(node); else roots.push(node);
    return node;
  };
  const roots = [];
  for (const f of folders || []) {
    const p = normFolder(f.path);
    if (p) ensure(p).count = f.count || 0;
  }
  const sort = (list) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    for (const n of list) { sort(n.children); n.total = n.count + n.children.reduce((s, c) => s + c.total, 0); }
  };
  sort(roots);
  return roots;
}

/** Lista plana em ordem de árvore, com profundidade: [{ path, name, depth }] (para seletores). */
function flattenTree(tree, depth = 0, out = []) {
  for (const n of tree) { out.push({ path: n.path, name: n.name, depth }); flattenTree(n.children, depth + 1, out); }
  return out;
}

module.exports = {
  NAME_MAX, validFolderName, validFolderPath, normFolder, folderOf, baseName, parentOf, joinPath,
  isDescendant, buildTree, flattenTree,
};
