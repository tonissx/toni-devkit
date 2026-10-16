'use strict';
/**
 * Configurações por pasta das Notes — helpers puros. Ficam em `.folder.json` dentro da própria pasta
 * (acompanha a pasta ao renomear/mover; arquivos com "." no começo nunca são lidos como nota).
 *
 *   color    — chave de FOLDER_COLORS (também colore a pasta no Grafo)
 *   icon     — nome de um ícone de FOLDER_ICONS
 *   template — id de uma nota da pasta Templates (nota nova nasce dela)
 *   tags     — tags aplicadas a toda nota nova da pasta
 *   sort     — ordem das notas da pasta: 'updated' (padrão) | 'created' | 'title'
 *   pinned   — fixada no topo do explorador
 *   order    — posição entre as pastas irmãs (reordenação manual); sem valor = alfabética depois das ordenadas
 */

const META_FILE = '.folder.json';

const FOLDER_COLORS = {
  blue: '#5B8CFF', teal: '#22B8A8', green: '#3DB26B', amber: '#E0A21B',
  orange: '#E57A2E', red: '#E5484D', pink: '#D6409F', purple: '#9A6BFF', gray: '#8A8F98',
};
const FOLDER_ICONS = [
  'folder', 'briefcase', 'book-open', 'code', 'database', 'server', 'bug', 'rocket', 'star', 'lightbulb',
  'file-text', 'archive', 'users', 'calendar', 'home', 'wrench', 'shield', 'globe',
];
const SORTS = ['updated', 'created', 'title'];
const SORT_LABELS = { updated: 'Editadas recentemente', created: 'Criadas recentemente', title: 'Título (A–Z)' };

const TAG_RE = /^[\p{L}\p{N}_/-]+$/u;

/** Normaliza uma tag digitada: sem "#", minúscula, sem espaços nas pontas. */
const cleanTag = (t) => String(t == null ? '' : t).trim().replace(/^#+/, '').toLowerCase();

/**
 * Metadados válidos a partir de qualquer coisa (JSON lido do disco ou vindo da UI). Campos desconhecidos ou
 * inválidos somem; objeto vazio = pasta sem configuração.
 */
function sanitizeMeta(raw) {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (typeof m.color === 'string' && FOLDER_COLORS[m.color]) out.color = m.color;
  if (typeof m.icon === 'string' && FOLDER_ICONS.includes(m.icon)) out.icon = m.icon;
  if (typeof m.template === 'string' && m.template.trim()) out.template = m.template.trim();
  if (Array.isArray(m.tags)) {
    const tags = [...new Set(m.tags.map(cleanTag).filter((t) => t && TAG_RE.test(t)))].slice(0, 20);
    if (tags.length) out.tags = tags;
  }
  if (typeof m.sort === 'string' && SORTS.includes(m.sort) && m.sort !== 'updated') out.sort = m.sort;
  if (m.pinned === true) out.pinned = true;
  if (Number.isFinite(m.order) && m.order >= 0) out.order = Math.floor(m.order);
  return out;
}

/** Aplica um patch ({ campo: valor | null }) sobre os metadados atuais; `null`/vazio remove o campo. */
function mergeMeta(current, patch) {
  const next = { ...sanitizeMeta(current) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete next[k];
    else next[k] = v;
  }
  return sanitizeMeta(next);
}

/** Ordena notas de uma pasta conforme `sort` (a lista já vem por "updated" desc.; devolve cópia). */
function sortNotes(list, sort) {
  const out = [...list];
  if (sort === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'pt-BR', { sensitivity: 'base' }));
  else if (sort === 'created') out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return out;
}

module.exports = { META_FILE, FOLDER_COLORS, FOLDER_ICONS, SORTS, SORT_LABELS, cleanTag, sanitizeMeta, mergeMeta, sortNotes };
