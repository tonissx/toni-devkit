'use strict';
// Metadados das ferramentas (sem componentes). Compartilhado pela janela principal
// (src/tools/registry.js, que associa cada id ao componente) e pela command palette,
// que assim não precisa empacotar as telas das ferramentas.
const TOOL_META = [
  {
    id: 'sql',
    name: 'SQL Formatter',
    icon: 'database',
    group: 'Texto & código',
    desc: 'Formata e indenta SQL no padrão do sqlformat.org',
    shortcutKey: '1',
    keywords: ['query', 'consulta', 'sqlformat', 'sqlparse', 'indentar', 'beautify'],
  },
  {
    id: 'xml',
    name: 'XML Formatter',
    icon: 'code-xml',
    group: 'Texto & código',
    desc: 'Formata e indenta XML nos moldes do vscode-xml (LemMinX)',
    shortcutKey: '2',
    keywords: ['lemminx', 'soap', 'wsdl', 'xsd', 'indentar', 'beautify', 'pretty'],
  },
  {
    id: 'diff',
    name: 'Diff Checker',
    icon: 'git-compare',
    group: 'Texto & código',
    desc: 'Compara dois textos lado a lado, com destaque por caractere e merge',
    shortcutKey: '3',
    keywords: ['comparar', 'compare', 'diferença', 'diffchecker', 'merge', 'mesclar'],
  },
  {
    id: 'notes',
    name: 'Notes',
    icon: 'notebook-pen',
    group: 'Conhecimento',
    desc: 'Memória técnica: notas em Markdown, snippets e busca',
    shortcutKey: '4',
    keywords: ['anotações', 'notas', 'snippets', 'conhecimento', 'markdown', 'wiki'],
  },
  {
    id: 'devcore',
    name: 'DevCore',
    icon: 'cpu',
    group: 'DevCore',
    desc: 'Infraestrutura idle com DevPets — cresce sozinha enquanto você trabalha',
    shortcutKey: '5',
    keywords: ['idle', 'devpets', 'pets', 'jogo', 'incremental', 'compute', 'infraestrutura'],
  },
  {
    id: 'git-pulse',
    name: 'Git Pulse',
    icon: 'git-branch',
    group: 'Git',
    desc: 'Status local do repositório: branch, mudanças e commits recentes — 100% local',
    shortcutKey: '6',
    keywords: ['git', 'repositorio', 'repo', 'status', 'branch', 'commits', 'diff', 'working tree', 'ahead', 'behind'],
  },
];

module.exports = { TOOL_META };
