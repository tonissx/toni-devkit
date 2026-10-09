// Notes — largura da bandeja lateral (pastas e notas): limites e arredondamento, sem dependência de DOM.
const SIDE_MIN = 240, SIDE_MAX = 640, SIDE_DEFAULT = 300, SIDE_WIDE = 460;

/** Largura válida para a bandeja: arredonda e respeita o mínimo e o máximo (`max` = espaço disponível, opcional). */
function sideWidth(raw, max) {
  const top = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Number.isFinite(max) ? max : SIDE_MAX));
  const n = Number.isFinite(raw) ? Math.round(raw) : SIDE_DEFAULT;
  return Math.min(top, Math.max(SIDE_MIN, n));
}

module.exports = { sideWidth, SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_WIDE };
