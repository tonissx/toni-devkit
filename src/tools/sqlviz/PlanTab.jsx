import { DS } from '../../lib/ds.js';
import { parsePlan, decodePlan } from '../../db/showplan.js';
import { PlanPanel, planKind } from '../db/PlanView.jsx';

const { CodeEditor, Button, Alert, Badge } = DS;

const MAX_BYTES = 50 * 1024 * 1024;
const errText = (e) => String((e && e.message) || e);

const SAMPLE = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.6" Build="16.0.1000.6">
 <BatchSequence><Batch><Statements>
  <StmtSimple StatementText="SELECT c.Nome, p.Total FROM dbo.Pedido p JOIN dbo.Cliente c ON c.Id = p.ClienteId WHERE p.Total &gt; 1000 ORDER BY p.Total DESC" StatementId="1" StatementType="SELECT" StatementSubTreeCost="12.5" StatementEstRows="120" CardinalityEstimationModelVersion="160">
   <QueryPlan DegreeOfParallelism="1" MemoryGrant="2048">
    <MissingIndexes><MissingIndexGroup Impact="78.4"><MissingIndex Database="[Vendas]" Schema="[dbo]" Table="[Pedido]"><ColumnGroup Usage="INEQUALITY"><Column Name="[Total]" ColumnId="3"/></ColumnGroup><ColumnGroup Usage="INCLUDE"><Column Name="[ClienteId]" ColumnId="2"/></ColumnGroup></MissingIndex></MissingIndexGroup></MissingIndexes>
    <RelOp NodeId="0" PhysicalOp="Sort" LogicalOp="Sort" EstimateRows="120" EstimatedTotalSubtreeCost="12.5" EstimateIO="0.0112" EstimateCPU="0.02">
     <Warnings><SpillToTempDb SpillLevel="1" SpilledThreadCount="1"/></Warnings>
     <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="48000" ActualExecutions="1" ActualElapsedms="410" ActualCPUms="380"/></RunTimeInformation>
     <Sort Distinct="false"><RelOp NodeId="1" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="120" EstimatedTotalSubtreeCost="9.9">
       <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="48000" ActualExecutions="1" ActualElapsedms="300" ActualCPUms="290"/></RunTimeInformation>
       <NestedLoops Optimized="false">
        <RelOp NodeId="2" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="120" EstimatedTotalSubtreeCost="8.7" TableCardinality="2000000">
         <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="48000" ActualRowsRead="2000000" ActualExecutions="1" ActualElapsedms="250" ActualCPUms="240"/></RunTimeInformation>
         <IndexScan Ordered="false"><Object Database="[Vendas]" Schema="[dbo]" Table="[Pedido]" Index="[PK_Pedido]" IndexKind="Clustered"/>
          <Predicate><ScalarOperator ScalarString="[Vendas].[dbo].[Pedido].[Total] as [p].[Total]&gt;(1000.)"/></Predicate></IndexScan>
        </RelOp>
        <RelOp NodeId="3" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimatedTotalSubtreeCost="1.1" TableCardinality="50000">
         <RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="48000" ActualExecutions="48000" ActualElapsedms="40" ActualCPUms="38"/></RunTimeInformation>
         <IndexScan Ordered="true"><Object Database="[Vendas]" Schema="[dbo]" Table="[Cliente]" Index="[PK_Cliente]" IndexKind="Clustered"/></IndexScan>
        </RelOp>
       </NestedLoops></RelOp></Sort>
    </RelOp>
   </QueryPlan>
  </StmtSimple>
 </Statements></Batch></BatchSequence>
</ShowPlanXML>`;

/** Aba "Plano de execução": cola o XML do showplan ou abre/arrasta um .sqlplan. Só lê — nada é executado nem enviado. */
export function PlanTab({ toast }) {
  const [xml, setXml] = React.useState('');
  const [name, setName] = React.useState('');
  const [over, setOver] = React.useState(false);
  const fileRef = React.useRef(null);

  const parsed = React.useMemo(() => (xml.trim() ? parsePlan(xml) : null), [xml]);
  const ok = parsed && parsed.statements;

  const loadFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast('Arquivo grande demais', 'O limite é 50 MB.', 'error'); return; }
    try {
      setXml(decodePlan(new Uint8Array(await file.arrayBuffer())));
      setName(file.name);
    } catch (e) { toast('Não foi possível ler o arquivo', errText(e), 'error'); }
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  };
  const reset = () => { setXml(''); setName(''); };

  const save = async () => {
    const r = await window.devkit.files.saveExport(xml, (name || 'plano').replace(/\.[^.]+$/, '') + '.sqlplan');
    if (r) toast('Plano salvo', r.name);
  };

  return (
    <div
      className={'sqv__plan' + (over ? ' is-over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={onDrop}
    >
      <input ref={fileRef} type="file" accept=".sqlplan,.xml,text/xml" hidden onChange={(e) => { loadFile(e.target.files[0]); e.target.value = ''; }} />
      {ok ? (
        <>
          <div className="sqv__planbar">
            <Badge size="sm" variant="ok" dot>{name || 'Plano colado'}</Badge>
            <span className="sqv__muted">{planKind(parsed)}</span>
            <span className="sqv__grow" />
            <Button variant="ghost" size="sm" icon="download" onClick={save}>Salvar .sqlplan</Button>
            <Button variant="ghost" size="sm" icon="folder-open" onClick={() => fileRef.current.click()}>Abrir outro</Button>
            <Button variant="ghost" size="sm" icon="eraser" onClick={reset}>Limpar</Button>
          </div>
          <div className="sqv__planbody"><PlanPanel xml={xml} parsed={parsed} toast={toast} /></div>
        </>
      ) : (
        <div className="sqv__planin">
          <div className="sqv__planhint">
            <b>Cole o XML do plano ou solte um arquivo .sqlplan aqui.</b>
            <span>No SSMS: Ctrl+M (plano real) ou Ctrl+L (estimado), clique direito no plano → “Show Execution Plan XML” ou “Save Execution Plan As…”. O plano é só lido, no seu computador.</span>
            <div className="sqv__planbtns">
              <Button variant="secondary" size="sm" icon="folder-open" onClick={() => fileRef.current.click()}>Abrir .sqlplan</Button>
              <Button variant="ghost" size="sm" icon="file-code" onClick={() => { setXml(SAMPLE); setName('exemplo.sqlplan'); }}>Exemplo</Button>
            </div>
          </div>
          {parsed && parsed.error && <Alert variant="error" title="Plano inválido">{parsed.error}</Alert>}
          <div className="sqv__planedit">
            <CodeEditor language="xml" editable value={xml} onChange={(v) => { setXml(v); setName(''); }} height="100%" placeholder="Cole aqui o XML do showplan (<ShowPlanXML …>)…" />
          </div>
        </div>
      )}
    </div>
  );
}
