'use strict';
/**
 * Abas do Notes — lógica pura. Uma aba é `{ id, pinned }`; o título vem da nota, então renomear reflete sozinho.
 * Aba de pré-visualização (pinned=false, itálico na UI): no máximo uma; abrir outra nota pela lista a substitui.
 * Ela vira fixa ao editar, com duplo clique ou pelo menu.
 */

const MAX_TABS = 20;

/** Abre `id`: já aberta → só ativa; senão substitui a prévia (ou entra no fim). `pin` abre direto como fixa. */
function openTab(tabs, id, { pin = false } = {}) {
  const list = tabs || [];
  const cur = list.find((t) => t.id === id);
  if (cur) return pin && !cur.pinned ? list.map((t) => (t.id === id ? { ...t, pinned: true } : t)) : list;
  const i = list.findIndex((t) => !t.pinned);
  const tab = { id, pinned: !!pin };
  let next = !pin && i >= 0 ? list.map((t, k) => (k === i ? tab : t)) : [...list, tab];
  if (next.length > MAX_TABS) { // estourou: descarta a fixa mais antiga que não seja a nova
    const drop = next.findIndex((t) => t.id !== id);
    next = next.filter((_, k) => k !== drop);
  }
  return next;
}

function pinTab(tabs, id, pinned = true) {
  return (tabs || []).map((t) => (t.id === id && t.pinned !== pinned ? { ...t, pinned } : t));
}

/** Fecha `id` → { tabs, next } (next = aba a ativar: a da direita, senão a da esquerda; null se não sobrou). */
function closeTab(tabs, id, activeId) {
  const list = tabs || [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return { tabs: list, next: activeId || null };
  const rest = list.filter((t) => t.id !== id);
  if (id !== activeId) return { tabs: rest, next: activeId || null };
  const n = rest[i] || rest[i - 1] || null;
  return { tabs: rest, next: n ? n.id : null };
}

/** Mantém só `id` ('others') ou só até `id` ('right' fecha as da direita). */
function closeMany(tabs, id, how) {
  const list = tabs || [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return list;
  return how === 'right' ? list.slice(0, i + 1) : [list[i]];
}

/** Próxima/anterior em círculo (dir = 1 | -1). */
function cycle(tabs, activeId, dir) {
  const list = tabs || [];
  if (!list.length) return null;
  const i = list.findIndex((t) => t.id === activeId);
  if (i < 0) return list[0].id;
  return list[(i + dir + list.length) % list.length].id;
}

/** Descarta abas de notas que não existem mais (e duplicadas / lixo vindo do disco). */
function sanitize(tabs, exists) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(tabs) ? tabs : []) {
    if (!t || typeof t.id !== 'string' || seen.has(t.id) || !exists(t.id)) continue;
    seen.add(t.id);
    out.push({ id: t.id, pinned: !!t.pinned });
  }
  return out.slice(0, MAX_TABS);
}

module.exports = { openTab, pinTab, closeTab, closeMany, cycle, sanitize, MAX_TABS };
