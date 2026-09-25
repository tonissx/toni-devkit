// Registro de ferramentas do Toni Devkit.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx e inclua uma entrada aqui.
// Ela aparece automaticamente na sidebar, no Início e na command palette.
import { SqlFormatter } from './sql-formatter/SqlFormatter.jsx';
import { XmlFormatter } from './xml-formatter/XmlFormatter.jsx';

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
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
