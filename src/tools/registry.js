// Registro de ferramentas do Toni Devkit.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx, descreva-a em src/tools/meta.js
// e associe o componente em COMPONENTS. Ela aparece na sidebar, no Início e na command palette.
import { TOOL_META } from './meta.js';
import { SqlFormatter } from './sql-formatter/SqlFormatter.jsx';
import { XmlFormatter } from './xml-formatter/XmlFormatter.jsx';
import { DiffChecker } from './diff-checker/DiffChecker.jsx';
import { JsonVisualizer } from './json-visualizer/JsonVisualizer.jsx';
import { NotesScreen } from './notes/NotesScreen.jsx';
import { DiagramsScreen } from './diagrams/DiagramsScreen.jsx';
import { DevCoreScreen } from './devcore/DevCoreScreen.jsx';
import { VaultScreen } from './vault/VaultScreen.jsx';
import { GitScreen } from './git/GitScreen.jsx';
import { LogsScreen } from './logs/LogsScreen.jsx';
import { DbScreen } from './db/DbScreen.jsx';
import { SqlViz } from './sqlviz/SqlViz.jsx';
import { AIMonitor } from './aimon/AIMonitor.jsx';

const COMPONENTS = { sql: SqlFormatter, xml: XmlFormatter, diff: DiffChecker, json: JsonVisualizer, git: GitScreen, logs: LogsScreen, db: DbScreen, sqlviz: SqlViz, notes: NotesScreen, diagrams: DiagramsScreen, vault: VaultScreen, devcore: DevCoreScreen, aimon: AIMonitor };

export const TOOLS = TOOL_META.map((t) => ({ ...t, component: COMPONENTS[t.id] }));

/** Ferramentas na ordem em que aparecem na sidebar (agrupadas por `group`) — base do Ctrl+Tab. */
export const SIDEBAR_ORDER = [...new Set(TOOLS.map((t) => t.group))].flatMap((g) => TOOLS.filter((t) => t.group === g));

export const findTool = (id) => TOOLS.find((t) => t.id === id);
