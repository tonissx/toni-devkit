import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { analyze, layoutLineage, upstream, LIMITATIONS } from '../../db/lineage.js';
import { useAiMode, useAiTask, aiOn, AiButton, AiPanel } from '../../ai/ui.jsx';
import { LineageCanvas } from './LineageCanvas.jsx';

const { SplitView, CodeEditor, Button, Alert, EmptyState, Badge, Modal } = DS;

const errText = (e) => String((e && e.message) || e);

const SAMPLE = `WITH ativos AS (
    SELECT c.Id, c.Nome, c.Cidade
    FROM dbo.Cliente c
    WHERE c.Ativo = 1
),
totais AS (
    SELECT p.ClienteId, SUM(p.Total) AS TotalPedidos, COUNT(*) AS Qtd
    FROM dbo.Pedido p
    INNER JOIN dbo.PedidoItem i ON i.PedidoId = p.Id
    WHERE p.CriadoEm >= '2026-01-01'
    GROUP BY p.ClienteId
    HAVING SUM(p.Total) > 1000
)
SELECT a.Nome,
       a.Cidade,
       t.TotalPedidos,
       t.TotalPedidos / NULLIF(t.Qtd, 0) AS Ticket,
       UPPER(a.Nome) AS NomeMaiusc
FROM ativos a
LEFT JOIN totais t ON t.ClienteId = a.Id
ORDER BY t.TotalPedidos DESC;`;

/** Aba "Lineage": cola um SELECT/CTE/script e vê de onde cada coluna vem. Só lê o texto — nada é executado. */
export function LineageTab({ toast, source }) {
  const [draft, setDraft] = usePersisted('sqlviz.lineage', { input: '', useSchema: true });
  const input = draft.input || '';
  const [text, setText] = React.useState(input); // o que foi analisado (com atraso para não travar a digitação)
  const [selected, setSelected] = React.useState(null);
  const [fitSignal, setFitSignal] = React.useState(0);
  const [limits, setLimits] = React.useState(false);
  const schema = source && draft.useSchema ? source.schema : null;

  React.useEffect(() => {
    const t = setTimeout(() => setText(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const result = React.useMemo(() => {
    if (!text.trim()) return { empty: true };
    try { const graph = analyze(text, { schema }); return { graph, layout: layoutLineage(graph) }; }
    catch (e) { return { error: errText(e) }; }
  }, [text, schema]);
  const graph = result.graph;
  React.useEffect(() => { setSelected(null); setFitSignal((n) => n + 1); }, [graph]);

  const up = React.useMemo(() => (graph && selected ? upstream(graph, selected.node, selected.col) : null), [graph, selected]);
  const selInfo = React.useMemo(() => {
    if (!graph || !selected) return null;
    const n = graph.nodes.find((x) => x.id === selected.node);
    const c = n && n.columns[selected.col];
    if (!c) return null;
    const origins = [];
    for (const k of up.cols) {
      const [id, i] = k.split(':');
      const nn = graph.nodes.find((x) => x.id === id);
      if (nn && ['table', 'temp', 'func', 'values'].includes(nn.kind)) origins.push(`${nn.name}.${nn.columns[Number(i)].name}`);
    }
    return { name: c.name, expr: c.expr, from: n.name, origins: [...new Set(origins)].sort() };
  }, [graph, selected, up]);

  let right;
  if (result.empty) right = <EmptyState icon="workflow" title="Cole uma query à esquerda" description="SELECT, CTE, UNION, subconsultas, INSERT … SELECT ou um script com várias instruções. Nada é executado — só lido." />;
  else if (result.error) right = <EmptyState icon="circle-alert" title="Não foi possível montar a linhagem" description={result.error} />;
  else {
    right = (
      <div className="sqv__stage">
        <div className="sqv__bar">
          {selInfo
            ? <span className="sqv__sel"><b>{selInfo.from}.{selInfo.name}</b>{selInfo.expr ? <code> = {selInfo.expr}</code> : null} ← {selInfo.origins.length ? selInfo.origins.join(', ') : 'sem origem em tabela'}</span>
            : <span className="sqv__muted">Clique numa coluna para ver de onde ela vem. J = join · F = filtro · G = group by · O = order by · Σ = agregação · ƒ = expressão.</span>}
        </div>
        <LineageCanvas graph={graph} layout={result.layout} selected={selected} onSelect={setSelected} up={up} fitSignal={fitSignal} />
      </div>
    );
  }

  const msgs = graph ? [...graph.warnings, ...graph.notes] : [];

  const cfg = useAiMode();
  const ai = useAiTask('sqlLineage', cfg);
  React.useEffect(() => { ai.close(); }, [graph]);
  const explain = (onlyColumn) => ai.start(() => ({
    sql: text,
    blocks: graph.nodes.map((n) => ({ kind: n.kind, name: n.name, columns: n.columns.map((c) => c.name) })),
    warnings: msgs,
    column: onlyColumn && selInfo ? selInfo : null,
  }));

  return (
    <div className="sqv__er">
      {msgs.length > 0 && (
        <Alert variant="warn" title={`${msgs.length} aviso(s)`}>{msgs.slice(0, 3).join(' · ')}{msgs.length > 3 ? ` … (+${msgs.length - 3})` : ''}</Alert>
      )}
      {aiOn(cfg) && <AiPanel ai={ai} className="lg-ai" />}
      <SplitView
        leftTitle="Query (T-SQL)"
        leftMeta={graph ? `${graph.nodes.length} bloco(s) · ${graph.colEdges.length} ligação(ões) de coluna` : null}
        leftActions={<>
          <Button variant="ghost" size="sm" icon="file-code" onClick={() => setDraft({ ...draft, input: SAMPLE })}>Exemplo</Button>
          {source && (
            <label className="sqv__check" title="Usa as colunas do schema carregado no Explorador para resolver SELECT * e colunas sem alias">
              <input type="checkbox" checked={!!draft.useSchema} onChange={(e) => setDraft({ ...draft, useSchema: e.target.checked })} /> usar schema ({source.schema.tables.length})
            </label>
          )}
          <Button variant="ghost" size="sm" icon="info" onClick={() => setLimits(true)}>Limitações</Button>
          {aiOn(cfg) && <AiButton ai={ai} label="Explicar a query" onClick={() => explain(false)} disabled={!graph} reason="Cole uma query" />}
          {aiOn(cfg) && selInfo && !ai.busy && <AiButton ai={ai} label="Explicar esta coluna" onClick={() => explain(true)} />}
        </>}
        onClear={() => setDraft({ ...draft, input: '' })}
        rightTitle="Linhagem"
        rightMeta={graph ? <Badge size="sm" variant="ok" dot>{graph.nodes.filter((n) => n.kind === 'table').length} tabela(s)</Badge> : null}
        left={<CodeEditor language="sql" editable value={input} onChange={(v) => setDraft({ ...draft, input: v })} height="100%" placeholder="Cole aqui o SELECT / CTE / script…" />}
        right={right}
      />
      {limits && (
        <Modal title="Limitações do T-SQL" icon="info" width="min(680px, 94vw)" onClose={() => setLimits(false)} footer={<Button variant="primary" onClick={() => setLimits(false)}>Fechar</Button>}>
          <ul className="sqv__limits">{LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Modal>
      )}
    </div>
  );
}
