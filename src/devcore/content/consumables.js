'use strict';
/**
 * Consumíveis — o recurso tático do DevCore. Nunca vendidos, sem sorteio pago.
 * Ganhos: incidente contido (+1), achados dos pets offline e fabricação com Compute
 * (custo = craftMinutes × produção atual — continua relevante em qualquer fase).
 * effect.type: 'boost' (multiplica um alvo por um tempo) · 'hotfix' (encerra o incidente ativo)
 *              · 'shield' (o próximo incidente nasce contido) · 'resetCooldown' (zera a recarga de uma habilidade)
 *              · 'heal' (cura `value` da vida de um DevPet no mapa; sem pet indicado, o mais machucado)
 */

const CONSUMABLES = [
  { id: 'coffee', name: 'Coffee', icon: 'coffee', cap: 5, craftMinutes: 20,
    description: 'Produção ×1,5 por 10 min.', effect: { type: 'boost', target: 'global', mult: 1.5, durationSec: 600 } },
  { id: 'hotfix', name: 'Hotfix', icon: 'bandage', cap: 3, craftMinutes: 45,
    description: 'Derrota o vilão do incidente ativo na hora.', effect: { type: 'hotfix' } },
  { id: 'rollback', name: 'Rollback', icon: 'shield', cap: 2, craftMinutes: 60,
    description: 'O próximo incidente já nasce contido.', effect: { type: 'shield' } },
  { id: 'cache-warmer', name: 'Cache Warmer', icon: 'flame', cap: 3, craftMinutes: 30,
    description: 'Zera a recarga de uma habilidade.', effect: { type: 'resetCooldown' } },
  { id: 'health-check', name: 'Health Check', icon: 'heart-pulse', cap: 3, craftMinutes: 30,
    description: 'Cura 50% da vida de um DevPet e o tira do fora de combate.', effect: { type: 'heal', value: 0.5 } },
];

module.exports = { CONSUMABLES };
