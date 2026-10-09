// Notes — largura da bandeja lateral (pastas e notas): limites e arredondamento, sem dependência de DOM.
// Abaixo de SIDE_SNAP a bandeja não espreme o conteúdo: ela recolhe numa faixa fina (SIDE_COLLAPSED).
const SIDE_COLLAPSED = 16, SIDE_SNAP = 160, SIDE_MIN = 240, SIDE_MAX = 640, SIDE_DEFAULT = 300, SIDE_WIDE = 460;

/** Largura válida para a bandeja: arredonda, recolhe abaixo de SIDE_SNAP e respeita o máximo (`max` = espaço disponível, opcional). */
function sideWidth(raw, max) {
  const top = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Number.isFinite(max) ? max : SIDE_MAX));
  const n = Number.isFinite(raw) ? Math.round(raw) : SIDE_DEFAULT;
  if (n < SIDE_SNAP) return SIDE_COLLAPSED;
  return Math.min(top, Math.max(SIDE_MIN, n));
}

module.exports = { sideWidth, SIDE_COLLAPSED, SIDE_SNAP, SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_WIDE };
