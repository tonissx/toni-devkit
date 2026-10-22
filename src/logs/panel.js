'use strict';
/** Logs — tamanho das bandejas (Detalhe à direita, Achados/Fixados embaixo): limites e arredondamento, sem DOM. */
const DETAIL_MIN = 300, DETAIL_MAX = 900, DETAIL_DEFAULT = 440, DETAIL_WIDE = 720;
const HITS_MIN = 80, HITS_MAX = 640, HITS_DEFAULT = 190, HITS_TALL = 380;
const HITS_SNAP = 48; // arrastar abaixo disto deixa só o cabeçalho (altura 0)

/** Largura válida do Detalhe (`max` = espaço disponível, opcional). */
function detailWidth(raw, max) {
  const top = Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, Number.isFinite(max) ? max : DETAIL_MAX));
  const n = Number.isFinite(raw) ? Math.round(raw) : DETAIL_DEFAULT;
  return Math.min(top, Math.max(DETAIL_MIN, n));
}

/** Altura válida do corpo do painel de baixo; 0 = recolhido (só o cabeçalho). */
function hitsHeight(raw, max) {
  if (!Number.isFinite(raw)) return HITS_DEFAULT;
  if (raw < HITS_SNAP) return 0;
  const top = Math.max(HITS_MIN, Math.min(HITS_MAX, Number.isFinite(max) ? max : HITS_MAX));
  return Math.min(top, Math.max(HITS_MIN, Math.round(raw)));
}

module.exports = { detailWidth, hitsHeight, DETAIL_MIN, DETAIL_MAX, DETAIL_DEFAULT, DETAIL_WIDE, HITS_MIN, HITS_MAX, HITS_DEFAULT, HITS_TALL, HITS_SNAP };
