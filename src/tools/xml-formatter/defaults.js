'use strict';
// Opções padrão do XML Formatter (tela e command palette).
/** Padrões iguais aos do LemMinX (motor de formatação do vscode-xml). */
const DEFAULT_XML_OPTIONS = {
  indent: 4,
  maxLineWidth: 80,
  emptyElements: 'ignore',
  quoteStyle: 'ignore',
  splitAttributes: false,
  closingBracketNewLine: false,
  spaceBeforeEmptyCloseTag: true,
  joinLines: false,
  autoFormat: true,
};

module.exports = { DEFAULT_XML_OPTIONS };
