import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { parseSchemaInput, expand, subset } from '../../db/schema.js';
import { searchSchema, stepIndex } from '../../db/ersearch.js';
import { useAiMode, useAiTask, aiOn, AiButton, AiPanel } from '../../ai/ui.jsx';
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
  const [cursor, setCursor] = React.useState(-1); // posição na lista de tabelas achadas (-1 = ainda não navegou)

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

  const found = React.useMemo(() => searchSchema(schema, search), [search, schema]);
  const matches = React.useMemo(() => (found ? new Set(found.tables) : null), [found]);
  const matchCols = found ? found.columns : null;

  const related = React.useMemo(() => (schema && selected ? expand(schema, selected, 1) : null), [schema, selected]);

  const cfg = useAiMode();
  const ai = useAiTask('erDescribe', cfg);
  React.useEffect(() => { ai.close(); }, [schema]);
  // Com uma tabela selecionada, só ela e as vizinhas diretas vão para a IA; sem seleção, o schema todo (cortado no limite).
  const describe = () => ai.start(() => (selected && related
    ? { schema: subset(schema, related), partial: `${selected} e as tabelas ligadas a ela por FK` }
    : { schema }));

  // Enter = próxima tabela achada, Shift+Enter = anterior (em círculo); o diagrama centraliza nela.
  const goToMatch = (dir = 1) => {
    if (!found || !found.tables.length) return;
    const n = found.tables.length;
    const next = cursor < 0 ? (dir < 0 ? n - 1 : 0) : stepIndex(cursor, n, dir);
    const id = found.tables[next];
    setCursor(next);
    setSelected(id);
    setFocusReq({ id, nonce: Date.now() });
  };

  // Ctrl+F foca a busca do diagrama (só quando ele está visível; nas outras abas/ferramentas o evento passa direto).
  const rootRef = React.useRef(null);
  const barRef = React.useRef(null);
  const hasSchema = !!schema;
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      const root = rootRef.current;
      if (!root || !root.offsetParent || !hasSchema) return; // escondido (outra aba/ferramenta) ou sem diagrama
      if (e.target.closest && e.target.closest('.cm-editor, textarea')) return; // o editor do schema tem a busca dele
      const input = barRef.current && barRef.current.querySelector('input');
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [hasSchema]);
  const onSearchKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { if (search) setSearch(''); e.currentTarget.blur(); }
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
        <div className="sqv__bar" ref={barRef}>
          <Input
            size="sm"
            icon="search"
            placeholder="Buscar tabela ou coluna…"
            kbd={mod('F')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCursor(-1); }}
            onKeyDown={onSearchKey}
          />
          {found && <Badge size="sm" variant={found.tables.length ? 'ok' : 'warn'}>
            {cursor >= 0 ? `${cursor + 1}/` : ''}{found.tables.length} tabela(s){found.columns.size ? ` · ${found.columns.size} coluna(s)` : ''}
          </Badge>}
        </div>
        <ErCanvas
          schema={schema}
          nodes={nodes}
          selectedId={selected}
          onSelect={setSelected}
          matches={matches}
          matchCols={matchCols}
          related={related}
          fitSignal={fitSignal}
          focusReq={focusReq}
          onMoveNode={(id, x, y) => setMoved((m) => ({ ...m, [id]: { x, y } }))}
        />
      </div>
    );
  }

  return (
    <div className="sqv__er" ref={rootRef}>
      <ServerLoader toast={toast} onLoaded={(schema, label) => setLoaded({ schema, label })} extra={loaded && <Button variant="ghost" size="sm" icon="x" onClick={() => setLoaded(null)}>Voltar ao texto</Button>} />
      {schema && schema.warnings.length > 0 && (
        <Alert variant="warn" title={`${schema.warnings.length} aviso(s)`}>{schema.warnings.slice(0, 3).join(' · ')}{schema.warnings.length > 3 ? ' …' : ''}</Alert>
      )}
      {aiOn(cfg) && <AiPanel ai={ai} className="lg-ai" />}
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
          {aiOn(cfg) && <AiButton ai={ai} label={selected ? 'Documentar a tabela' : 'Documentar o schema'} onClick={describe} />}
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
