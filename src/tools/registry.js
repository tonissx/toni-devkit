// Registro de ferramentas do Toni Devkit.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx e inclua uma entrada aqui.
// Ela aparece automaticamente na sidebar, no Início e na command palette.
import { SqlFormatter } from './sql-formatter/SqlFormatter.jsx';
import { XmlFormatter } from './xml-formatter/XmlFormatter.jsx';
import { DiffChecker } from './diff-checker/DiffChecker.jsx';

export const TOOLS = [
  {
    id: 'sql',
    name: 'SQL Formatter',
    icon: 'database',
    group: 'Texto & código',
    desc: 'Formata e indenta SQL no padrão do sqlformat.org',
    shortcutKey: '1',
    component: SqlFormatter,
  },
  {
    id: 'xml',
    name: 'XML Formatter',
    icon: 'code-xml',
    group: 'Texto & código',
    desc: 'Formata e indenta XML nos moldes do vscode-xml (LemMinX)',
    shortcutKey: '2',
    component: XmlFormatter,
  },
  {
    id: 'diff',
    name: 'Diff Checker',
    icon: 'git-compare',
    group: 'Texto & código',
    desc: 'Compara dois textos lado a lado, com destaque por caractere e merge',
    shortcutKey: '3',
    component: DiffChecker,
  },
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
