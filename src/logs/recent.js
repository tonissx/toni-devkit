'use strict';
/** Logs — filtros recentes da caixa de busca. Puro. */

/** Põe q no começo da lista (sem repetir, sem vazio), no máximo `max`. Devolve a mesma lista se nada mudou. */
function pushRecent(list, q, max = 10) {
  const v = String(q || '').trim();
  const cur = Array.isArray(list) ? list : [];
  if (!v) return cur;
  if (cur[0] === v) return cur;
  return [v, ...cur.filter((x) => x !== v)].slice(0, max);
}

module.exports = { pushRecent };
