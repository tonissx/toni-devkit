// Registro de ferramentas do Toni Devkit.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx, descreva-a em src/tools/meta.js
// e associe o componente em COMPONENTS. Ela aparece na sidebar, no Início e na command palette.
import { TOOL_META } from './meta.js';
import { SqlFormatter } from './sql-formatter/SqlFormatter.jsx';
import { XmlFormatter } from './xml-formatter/XmlFormatter.jsx';
import { DiffChecker } from './diff-checker/DiffChecker.jsx';
import { JsonVisualizer } from './json-visualizer/JsonVisualizer.jsx';
import { NotesScreen } from './notes/NotesScreen.jsx';
import { DevCoreScreen } from './devcore/DevCoreScreen.jsx';

const COMPONENTS = { sql: SqlFormatter, xml: XmlFormatter, diff: DiffChecker, json: JsonVisualizer, notes: NotesScreen, devcore: DevCoreScreen };

export const TOOLS = TOOL_META.map((t) => ({ ...t, component: COMPONENTS[t.id] }));

export const findTool = (id) => TOOLS.find((t) => t.id === id);
