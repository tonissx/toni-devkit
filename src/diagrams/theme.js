'use strict';
/**
 * Tema do Mermaid a partir das cores do DS (as mesmas de readColors em json-visualizer/exportImage.js).
 * Puro: recebe { bg, node, border, text, dim, accent, key, font? } e devolve `themeVariables` do tema "base".
 * `font` é a família já resolvida: o Mermaid mede o texto fora da tela, e 'inherit' pode medir com outra fonte
 * (rótulos cortados).
 */
function themeFromColors(c) {
  return {
    darkMode: true,
    background: c.bg,
    fontFamily: c.font || 'inherit',
    primaryColor: c.node,
    primaryBorderColor: c.border,
    primaryTextColor: c.text,
    secondaryColor: c.node,
    tertiaryColor: c.bg,
    lineColor: c.dim,
    textColor: c.text,
    mainBkg: c.node,
    nodeBorder: c.border,
    clusterBkg: c.bg,
    clusterBorder: c.border,
    titleColor: c.text,
    edgeLabelBackground: c.bg,
    noteBkgColor: c.node,
    noteTextColor: c.text,
    noteBorderColor: c.accent,
    actorBkg: c.node,
    actorBorder: c.accent,
    actorTextColor: c.text,
    signalColor: c.dim,
    signalTextColor: c.text,
    attributeBackgroundColorOdd: c.bg,
    attributeBackgroundColorEven: c.node,
  };
}

module.exports = { themeFromColors };
