'use strict';
/**
 * Monitor de IA — sinais de "vida" de uma sessão para o desenho do card. Puro: só números.
 */

/**
 * Pulso: tokens contáveis por minuto nos últimos `n` minutos (o mais antigo primeiro), suavizados de 3 em 3 para a linha não
 * virar serrote (o consumo vem em rajadas). `minutes`: Map minuto-desde-1970 → tokens. Sem consumo nenhum na janela → null.
 */
function pulse(minutes, now, n = 30) {
  if (!minutes || !minutes.size) return null;
  const end = Math.floor(now / 60000);
  const raw = [];
  let any = false;
  for (let m = end - n + 1; m <= end; m++) { const v = minutes.get(m) || 0; if (v > 0) any = true; raw.push(v); }
  if (!any) return null;
  return raw.map((v, i) => {
    const a = i > 0 ? raw[i - 1] : v;
    const b = i < raw.length - 1 ? raw[i + 1] : v;
    return Math.round((a + 2 * v + b) / 4);
  });
}

module.exports = { pulse };
