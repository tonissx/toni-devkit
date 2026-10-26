'use strict';
/**
 * Abas do Notes — lógica pura. Uma aba é `{ id }`; o título vem da nota, então renomear reflete sozinho.
 * Toda nota aberta ganha uma aba (se ainda não tem); abrir uma já aberta só a ativa.
 */

const MAX_TABS = 20;

/** Abre `id`: já aberta → nada muda; senão entra no fim (estourou o limite: descarta a mais antiga). */
function openTab(tabs, id) {
  const list = tabs || [];
  if (list.some((t) => t.id === id)) return list;
  const next = [...list, { id }];
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
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

/** 'others' mantém só `id`; 'right' fecha as que estão à direita dele. */
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
    out.push({ id: t.id });
  }
  return out.slice(0, MAX_TABS);
}

module.exports = { openTab, closeTab, closeMany, cycle, sanitize, MAX_TABS };
