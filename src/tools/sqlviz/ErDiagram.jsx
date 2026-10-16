import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { parseSchemaInput, expand } from '../../db/schema.js';
import { layoutEr, toDbml } from '../../db/erlayout.js';
import { SCHEMA_QUERY } from '../../db/queries.js';
import { svgToPng } from '../json-visualizer/exportImage.js';
import { ErCanvas } from './ErCanvas.jsx';
import { erToSvg, themeColors } from './erExport.js';
import { ServerLoader, errText } from './ServerLoader.jsx';

const { SplitView, CodeEditor, Button, Alert, EmptyState, Input, Badge } = DS;

const SAMPLE = `CREATE TABLE dbo.Cliente (
  Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  Nome nvarchar(100) NOT NULL,
  Email varchar(200) NULL
);
CREATE TABLE dbo.Produto (
  Id int NOT NULL PRIMARY KEY,
  Descricao varchar(80) NOT NULL,
  Preco decimal(18,2) NOT NULL
);
CREATE TABLE dbo.Pedido (
  Id int NOT NULL PRIMARY KEY,
  ClienteId int NOT NULL,
  CriadoEm datetime2 NOT NULL,
  CONSTRAINT FK_Pedido_Cliente FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente (Id)
);
CREATE TABLE dbo.PedidoItem (
  PedidoId int NOT NULL,
  Linha int NOT NULL,
  ProdutoId int NOT NULL,
  Quantidade int NOT NULL,
  CONSTRAINT PK_PedidoItem PRIMARY KEY (PedidoId, Linha),
  CONSTRAINT FK_Item_Pedido FOREIGN KEY (PedidoId) REFERENCES dbo.Pedido (Id),
  CONSTRAINT FK_Item_Produto FOREIGN KEY (ProdutoId) REFERENCES dbo.Produto (Id)
);
`;

/** Aba "Diagrama ER": cola DDL ou JSON de metadados e explora o schema como grafo. Tudo local; nada é executado. */
export function ErDiagram({ toast }) {
  const [draft, setDraft] = usePersisted('sqlviz.er', { input: '' });
  const input = draft.input || '';
  const setInput = (v) => { setLoaded(null); setDraft({ ...draft, input: v }); };
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [moved, setMoved] = React.useState({});
  const [fitSignal, setFitSignal] = React.useState(0);
  const [focusReq, setFocusReq] = React.useState(null);
  const [cursor, setCursor] = React.useState(0);

  const [loaded, setLoaded] = React.useState(null); // { label, schema } — substitui o texto colado

  const parsed = React.useMemo(() => {
    if (loaded) return { schema: loaded.schema };
    if (!input.trim()) return { empty: true };
    try { return { schema: parseSchemaInput(input) }; } catch (e) { return { error: errText(e) }; }
  }, [input, loaded]);
  const schema = parsed.schema;

  const base = React.useMemo(() => (schema ? layoutEr(schema) : null), [schema]);
  // Ao trocar o schema, reinicia posições arrastadas, seleção e enquadramento.
  React.useEffect(() => { setMoved({}); setSelected(null); setFitSignal((n) => n + 1); }, [schema]);

  const nodes = React.useMemo(() => {
    if (!base) return {};
    const out = {};
    for (const [id, n] of Object.entries(base.nodes)) out[id] = moved[id] ? { ...n, ...moved[id] } : n;
    return out;
  }, [base, moved]);

  const matches = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !schema) return null;
    return new Set(schema.tables.filter((t) => t.id.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))).map((t) => t.id));
  }, [search, schema]);

  const related = React.useMemo(() => (schema && selected ? expand(schema, selected, 1) : null), [schema, selected]);

  const goToMatch = () => {
    if (!matches || !matches.size) return;
    const list = [...matches];
    const id = list[cursor % list.length];
    setCursor((c) => c + 1);
    setSelected(id);
    setFocusReq({ id, nonce: Date.now() });
  };

  const copyQuery = async () => {
    await window.devkit.clipboard.write(SCHEMA_QUERY);
    toast('Query copiada', 'Rode no banco desejado e cole o resultado (JSON) aqui.');
  };

  const baseName = () => 'diagrama-er';
  const save = async (content, name) => {
    const r = await window.devkit.files.saveExport(content, name);
    if (r) toast('Arquivo salvo', r.name);
  };
  const exportImage = async (kind) => {
    if (!schema) return;
    try {
      const { svg, width, height } = erToSvg(schema, nodes, themeColors());
      if (kind === 'svg') await save(svg, baseName() + '.svg');
      else await save(await svgToPng(svg, width, height), baseName() + '.png');
    } catch (e) { toast('Erro ao exportar', errText(e), 'error'); }
  };

  let right;
  if (parsed.empty) {
    right = <EmptyState icon="network" title="Cole o schema à esquerda" description="DDL (CREATE TABLE / ALTER TABLE) ou o JSON da query de metadados. Nada é executado — só lido." />;
  } else if (parsed.error) {
    right = <EmptyState icon="circle-alert" title="Não foi possível montar o diagrama" description={parsed.error} />;
  } else {
    right = (
      <div className="sqv__stage">
        <div className="sqv__bar">
          <Input
            size="sm"
            icon="search"
            placeholder="Buscar tabela ou coluna…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCursor(0); }}
            onKeyDown={(e) => { if (e.key === 'Enter') goToMatch(); }}
          />
          {matches && <Badge size="sm" variant={matches.size ? 'ok' : 'warn'}>{matches.size} achada(s)</Badge>}
        </div>
        <ErCanvas
          schema={schema}
          nodes={nodes}
          selectedId={selected}
          onSelect={setSelected}
          matches={matches}
          related={related}
          fitSignal={fitSignal}
          focusReq={focusReq}
          onMoveNode={(id, x, y) => setMoved((m) => ({ ...m, [id]: { x, y } }))}
        />
      </div>
    );
  }

  return (
    <div className="sqv__er">
      <ServerLoader toast={toast} onLoaded={(schema, label) => setLoaded({ schema, label })} extra={loaded && <Button variant="ghost" size="sm" icon="x" onClick={() => setLoaded(null)}>Voltar ao texto</Button>} />
      {schema && schema.warnings.length > 0 && (
        <Alert variant="warn" title={`${schema.warnings.length} aviso(s)`}>{schema.warnings.slice(0, 3).join(' · ')}{schema.warnings.length > 3 ? ' …' : ''}</Alert>
      )}
      <SplitView
        leftTitle="Schema"
        leftMeta={schema ? `${schema.tables.length} tabela(s) · ${schema.fks.length} FK(s)` : null}
        leftActions={<>
          <Button variant="ghost" size="sm" icon="file-code" onClick={() => setInput(SAMPLE)}>Exemplo</Button>
          <Button variant="ghost" size="sm" icon="database" onClick={copyQuery}>Query de metadados</Button>
        </>}
        onClear={() => setInput('')}
        rightTitle="Diagrama"
        rightActions={schema ? <>
          <Button variant="ghost" size="sm" icon="image" onClick={() => exportImage('png')}>PNG</Button>
          <Button variant="ghost" size="sm" icon="file-image" onClick={() => exportImage('svg')}>SVG</Button>
          <Button variant="ghost" size="sm" icon="file-text" onClick={() => save(toDbml(schema), baseName() + '.dbml')}>DBML</Button>
        </> : null}
        left={loaded
          ? <EmptyState icon="database" title={loaded.label} description="Schema lido do servidor. Para colar DDL ou JSON, use “Voltar ao texto”." />
          : <CodeEditor language="sql" editable value={input} onChange={setInput} height="100%" placeholder="Cole o DDL ou o JSON de metadados aqui…" />}
        right={right}
      />
    </div>
  );
}
