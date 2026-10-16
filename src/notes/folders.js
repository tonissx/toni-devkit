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

const nameCmp = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
/** Pastas com `order` vêm primeiro (pela posição); as demais, em ordem alfabética. */
const siblingCmp = (a, b) => {
  const ao = a.meta.order, bo = b.meta.order;
  if (ao != null && bo != null) return ao - bo || nameCmp(a, b);
  if (ao != null) return -1;
  if (bo != null) return 1;
  return nameCmp(a, b);
};

/**
 * Árvore para a UI a partir de [{ path, count, ...configuração }] (count = notas diretas da pasta; a
 * configuração é a de foldermeta.js: color, icon, template, tags, sort, pinned, order).
 * Pais implícitos são criados. Nó: { path, name, count, total, meta, children }.
 * Ordem: posição manual (`order`) e depois alfabética.
 */
function buildTree(folders) {
  const nodes = new Map();
  const ensure = (path) => {
    if (nodes.has(path)) return nodes.get(path);
    const node = { path, name: baseName(path), count: 0, total: 0, meta: {}, children: [] };
    nodes.set(path, node);
    const parent = parentOf(path);
    if (parent) ensure(parent).children.push(node); else roots.push(node);
    return node;
  };
  const roots = [];
  for (const f of folders || []) {
    const p = normFolder(f.path);
    if (!p) continue;
    const { path: _p, count, ...meta } = f;
    const node = ensure(p);
    node.count = count || 0;
    node.meta = meta;
  }
  const sort = (list) => {
    list.sort(siblingCmp);
    for (const n of list) { sort(n.children); n.total = n.count + n.children.reduce((s, c) => s + c.total, 0); }
  };
  sort(roots);
  return roots;
}

/** Nó da árvore pelo caminho (ou null). */
function findNode(tree, path) {
  const p = normFolder(path);
  let list = tree, found = null;
  for (let i = 0, segs = p.split('/'), acc = ''; p && i < segs.length; i++) {
    acc = acc ? acc + '/' + segs[i] : segs[i];
    found = (list || []).find((n) => n.path === acc) || null;
    if (!found) return null;
    list = found.children;
  }
  return found;
}

/** Irmãs de `path` na ordem exibida: [{ path, name }] — para reordenar manualmente. */
function siblingsOf(tree, path) {
  const parent = parentOf(normFolder(path));
  const list = parent ? (findNode(tree, parent) || { children: [] }).children : tree;
  return list.map((n) => ({ path: n.path, name: n.name }));
}

/** Pastas cujo nome (ou caminho) contém todas as palavras de `query`, sem acento/maiúscula. */
function matchFolders(folders, query, normalize) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return (folders || []).filter((f) => { const hay = normalize(f.path); return words.every((w) => hay.includes(w)); });
}

/** Nome livre entre `taken` (sem diferenciar maiúsculas): "Docs (cópia)", "Docs (cópia 2)"… */
function copyName(name, taken) {
  const used = new Set((taken || []).map((t) => String(t).toLowerCase()));
  let cand = `${name} (cópia)`;
  for (let n = 2; used.has(cand.toLowerCase()); n++) cand = `${name} (cópia ${n})`;
  return cand;
}

/** Lista plana em ordem de árvore, com profundidade: [{ path, name, depth }] (para seletores). */
function flattenTree(tree, depth = 0, out = []) {
  for (const n of tree) { out.push({ path: n.path, name: n.name, depth }); flattenTree(n.children, depth + 1, out); }
  return out;
}

module.exports = {
  NAME_MAX, validFolderName, validFolderPath, normFolder, folderOf, baseName, parentOf, joinPath,
  isDescendant, buildTree, flattenTree, findNode, siblingsOf, matchFolders, copyName,
};
