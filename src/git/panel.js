// Git — largura da bandeja de detalhes do commit (aba Histórico): limites e arredondamento, sem dependência de DOM.
const SIDE_MIN = 320, SIDE_MAX = 900, SIDE_DEFAULT = 380, SIDE_WIDE = 720;

/** Largura válida para a bandeja: arredonda e respeita o mínimo e o máximo (`max` = espaço disponível, opcional). */
function sideWidth(raw, max) {
  const top = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Number.isFinite(max) ? max : SIDE_MAX));
  const n = Number.isFinite(raw) ? Math.round(raw) : SIDE_DEFAULT;
  return Math.min(top, Math.max(SIDE_MIN, n));
}

module.exports = { sideWidth, SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_WIDE };
