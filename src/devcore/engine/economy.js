'use strict';
/**
 * Custos. Gerador: custo do k-ésimo = baseCost × scaling^k, então comprar q a partir de `owned`
 * é uma soma geométrica (forma fechada). "Máximo" também sai em forma fechada.
 */

/** Custo de comprar `qty` unidades tendo `owned`. */
function costOf(g, owned, qty = 1) {
  if (qty <= 0) return 0;
  const r = g.costScaling;
  return g.baseCost * Math.pow(r, owned) * (Math.pow(r, qty) - 1) / (r - 1);
}

/** Quantas unidades dá para comprar com `amount`. */
function maxAffordable(g, owned, amount) {
  const r = g.costScaling;
  const first = g.baseCost * Math.pow(r, owned);
  if (amount < first) return 0;
  let n = Math.floor(Math.log(amount * (r - 1) / first + 1) / Math.log(r));
  // Correções de arredondamento de ponto flutuante nas bordas.
  while (n > 0 && costOf(g, owned, n) > amount) n--;
  while (costOf(g, owned, n + 1) <= amount) n++;
  return n;
}

/** Custo para treinar um DevPet do nível `level` para o próximo. */
const trainCost = (pet, level) => pet.trainCost * Math.pow(pet.trainScaling, level - 1);

module.exports = { costOf, maxAffordable, trainCost };
