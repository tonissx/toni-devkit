import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { ErDiagram } from './ErDiagram.jsx';
import { Explorer } from './Explorer.jsx';
import { PlanTab } from './PlanTab.jsx';
import { LineageTab } from './LineageTab.jsx';

const { PageHeader, SegmentedControl } = DS;

const TABS = [
  { value: 'er', label: 'Diagrama ER' },
  { value: 'explorer', label: 'Explorador' },
  { value: 'lineage', label: 'Lineage' },
  { value: 'plan', label: 'Plano de execução' },
];

/**
 * SQL Visualizer — transforma SQL em grafos interativos. Roda 100% local e nunca executa o SQL colado.
 * As abas ficam montadas (só escondidas) para o que foi colado/carregado sobreviver à troca de aba.
 */
export function SqlViz({ toast, request }) {
  const [ui, setUi] = usePersisted('sqlviz.ui', { tab: 'er' });
  const [source, setSource] = React.useState(null); // schema do Explorador: { schema, label }
  const tab = TABS.some((t) => t.value === ui.tab) ? ui.tab : 'er';
  React.useEffect(() => { if (request && request.tab && TABS.some((t) => t.value === request.tab)) setUi({ tab: request.tab }); }, [request && request.nonce]);
  const pane = (v, node) => <div className="sqv__pane" hidden={tab !== v}>{node}</div>;
  return (
    <div className="sqlf">
      <PageHeader
        icon="network"
        title="SQL Visualizer"
        subtitle="Diagramas e planos a partir de texto colado ou do catálogo do servidor — nada é executado"
        actions={<SegmentedControl size="sm" options={TABS} value={tab} onChange={(v) => setUi({ tab: v })} />}
      />
      {pane('er', <ErDiagram toast={toast} />)}
      {pane('explorer', <Explorer toast={toast} source={source} setSource={setSource} />)}
      {pane('lineage', <LineageTab toast={toast} source={source} />)}
      {pane('plan', <PlanTab toast={toast} />)}
    </div>
  );
}
