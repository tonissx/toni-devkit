'use strict';
/**
 * Grade de notas do Notes — lógica pura. A visão mostra de 1 a 4 notas (uma por painel) numa grade FIXA que só
 * depende de quantas são: 1 = tela cheia · 2 = lado a lado · 3 = uma grande + duas empilhadas · 4 = 2×2.
 * A ordem da lista é a ordem dos painéis (esquerda→direita, cima→baixo).
 */

const MAX_PANES = 4;

/** Nome da grade para N notas (vira classe CSS `n1`…`n4`). */
const gridClass = (n) => 'n' + Math.max(1, Math.min(MAX_PANES, n));

/**
 * Solta `id` sobre o painel de `targetId`. `zone`: 'center' | 'left' | 'right' | 'top' | 'bottom'.
 *   centro, nota ainda fora da visão → entra depois do alvo (a grade se ajusta); com a grade cheia, ocupa o lugar do alvo
 *   centro, nota já visível           → troca de lugar com o alvo
 *   borda esquerda/cima               → entra antes do alvo; direita/baixo → depois
 * Devolve a nova lista de ids (sem mexer na original).
 */
function place(list, id, targetId, zone) {
  const ids = [...list];
  const at = ids.indexOf(targetId);
  if (at < 0 || id === targetId) return ids;
  const from = ids.indexOf(id);
  if (zone === 'center') {
    if (from >= 0) { ids[from] = targetId; ids[at] = id; return ids; }
    if (ids.length >= MAX_PANES) { ids[at] = id; return ids; }
    zone = 'right';
  }
  if (from < 0 && ids.length >= MAX_PANES) { ids[at] = id; return ids; } // cheia: ocupa o lugar
  if (from >= 0) ids.splice(from, 1);
  const to = ids.indexOf(targetId) + (zone === 'right' || zone === 'bottom' ? 1 : 0);
  ids.splice(to, 0, id);
  return ids;
}

/** Abre `id` sem painel de destino: entra depois do ativo (grade cheia: ocupa o lugar do próximo). */
function addBeside(list, id, focusId) {
  if (list.includes(id)) return [...list];
  if (!list.length) return [id];
  const at = Math.max(0, list.indexOf(focusId));
  if (list.length < MAX_PANES) return place(list, id, list[at], 'right');
  return place(list, id, list[(at + 1) % list.length], 'center');
}

/** Zona do painel sob o ponteiro (x, y em 0..1 dentro do painel): borda a 28% ou centro. */
function zoneAt(x, y, edge = 0.28) {
  const [k, v] = Object.entries({ left: x, right: 1 - x, top: y, bottom: 1 - y }).sort((a, b) => a[1] - b[1])[0];
  return v < edge ? k : 'center';
}

module.exports = { MAX_PANES, gridClass, place, addBeside, zoneAt };
