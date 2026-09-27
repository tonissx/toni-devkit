'use strict';
// Opções padrão do SQL Formatter (tela e command palette).
/** Padrões idênticos ao sqlformat.org (keywords em UPPER, identificadores inalterados, 2 espaços). */
const DEFAULT_SQL_OPTIONS = {
  keywordCase: 'upper',
  identifierCase: 'unchanged',
  indent: 2,
  stripComments: false,
  compact: false,
  outputFormat: 'sql',
  autoFormat: true,
};

module.exports = { DEFAULT_SQL_OPTIONS };
