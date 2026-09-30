import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { emit } from '../../lib/events.js';
import { parseJson, formatJson, minifyJson, buildGraph, layoutTree, query, toYaml, toCsv } from './engine.js';
import { graphToSvg, svgToPng } from './exportImage.js';
import { DEFAULT_JSON_OPTIONS } from './defaults.js';
import { GraphView } from './GraphView.jsx';

const {
  PageHeader, SplitView, CodeEditor, SegmentedControl, Select, Toggle, Button,
  Alert, EmptyState, Input, Badge, TreeView,
} = DS;

const INDENT_OPTIONS = [
  { value: 2, label: '2 espaços' },
  { value: 4, label: '4 espaços' },
  { value: 'tab', label: 'Tab' },
];
const VIEW_OPTIONS = [
  { value: 'graph', label: 'Grafo' },
  { value: 'tree', label: 'Árvore' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
];

const SAMPLE = JSON.stringify({
  empresa: 'Toni Devkit',
  versao: 1.4,
  ativo: true,
  responsavel: { nome: 'Antonio', contato: { email: 'antonio@exemplo.com', telefones: ['+55 11 99999-0000', '+55 11 3333-0000'] } },
  ferramentas: [
    { id: 'sql', nome: 'SQL Formatter', atalho: 1, tags: ['sql', 'formatar'] },
    { id: 'xml', nome: 'XML Formatter', atalho: 2, tags: ['xml'] },
    { id: 'json', nome: 'JSON Visualizer', atalho: 6, tags: [] },
  ],
  configuracao: { tema: 'escuro', recentes: null, limites: { arquivoMB: 20, nos: 5000 } },
}, null, 2);

const AUTO_COLLAPSE_ABOVE = 2500; // nós; acima disso recolhe da profundidade 3 em diante
const MAX_MATCHES = 2000;
const PARENT_PATH = /(\[\d+\]|\['(?:[^'\\]|\\.)*'\]|\.[^.[]+)$/;

const bytes = (s) => new Blob([s]).size;
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const errText = (e) => String((e && e.message) || e);

const Opt = ({ label, children }) => (
  <div className="sqlf__opt">
    <span className="sqlf__opt-label">{label}</span>
    {children}
  </div>
);

/** Busca por texto (chaves/valores) ou, se começar com "$", por JSONPath → ids dos nós visíveis a destacar. */
function computeMatches(search, good, graph) {
  const s = search.trim();
  if (!s || !good) return null;
  const ids = new Set();
  if (s[0] === '$') {
    let results;
    try { results = query(good.value, s); } catch (e) { return { ids, count: 0, error: errText(e) }; }
    const byPath = new Map(graph.nodes.map((n) => [n.path, n.id]));
    for (const r of results.slice(0, MAX_MATCHES)) {
      let p = r.path;
      // Valores primitivos vivem na linha do pai; matches em áreas recolhidas caem no ancestral visível.
      while (p && !byPath.has(p)) { const up = p.replace(PARENT_PATH, ''); p = up === p ? '' : up; }
      if (byPath.has(p)) ids.add(byPath.get(p));
    }
    return { ids, count: results.length, error: null };
  }
  const q = s.toLowerCase();
  let count = 0;
  for (const n of graph.nodes) {
    const last = n.segs.length ? String(n.segs[n.segs.length - 1]) : '';
    if (last.toLowerCase().includes(q) || n.rows.some((r) => r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q))) {
      ids.add(n.id); count++;
    }
  }
  return { ids, count, error: null };
}

export function JsonVisualizer({ toast }) {
  const [opts, setOpts] = usePersisted('json.options', DEFAULT_JSON_OPTIONS);
  const [draft, setDraft] = usePersisted('json.draft', { text: SAMPLE, file: null });
  const input = draft.text;
  const setInput = (text) => setDraft((d) => ({ ...d, text }));
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const [selectedPath, setSelectedPath] = React.useState(null);
  const [fitSignal, setFitSignal] = React.useState(0);
  const touched = React.useRef(false); // o usuário mexeu no colapso deste documento grande

  // Parse (adiado, para digitar em JSON grande não travar) e último JSON válido: o grafo não some enquanto há erro de sintaxe.
  const deferred = React.useDeferredValue(input);
  const parsed = React.useMemo(() => parseJson(deferred), [deferred]);
  const goodRef = React.useRef(null);
  if (parsed.ok) { if (!goodRef.current || goodRef.current.value !== parsed.value) goodRef.current = { value: parsed.value }; }
  else if (!deferred.trim()) goodRef.current = null;
  const good = goodRef.current;

  // Documento grande: recolhe da profundidade 3 em diante (até o usuário expandir/recolher por conta própria).
  React.useEffect(() => {
    if (!good) return;
    const full = buildGraph(good.value);
    const big = full.nodes.length > AUTO_COLLAPSE_ABOVE;
    if (!big) { touched.current = false; return; }
    if (!touched.current) setCollapsed(new Set(full.nodes.filter((n) => n.depth >= 3 && n.childCount > 0).map((n) => n.path)));
  }, [good]);

  const model = React.useMemo(() => {
    if (!good) return null;
    const g = buildGraph(good.value, { collapsed });
    return { g, size: layoutTree(g) };
  }, [good, collapsed]);

  const matches = React.useMemo(() => computeMatches(search, good, model && model.g), [search, good, model]);
  const selected = model && selectedPath != null ? model.g.nodes.find((n) => n.path === selectedPath) : null;

  const toggleNode = (n) => {
    touched.current = true;
    setCollapsed((c) => { const s = new Set(c); if (s.has(n.path)) s.delete(n.path); else s.add(n.path); return s; });
  };
  const expandAll = () => { touched.current = true; setCollapsed(new Set()); };
  const collapseAll = () => {
    touched.current = true;
    if (!good) return;
    const full = buildGraph(good.value);
    setCollapsed(new Set(full.nodes.filter((n) => n.depth >= 1 && n.childCount > 0).map((n) => n.path)));
  };

  // Texto da visão atual (copiar / salvar).
  const view = opts.view;
  const viewText = React.useMemo(() => {
    if (!good) return { text: '', error: null };
    if (view === 'yaml') return { text: toYaml(good.value), error: null };
    if (view === 'csv') { try { return { text: toCsv(good.value), error: null }; } catch (e) { return { text: '', error: errText(e) }; } }
    return { text: formatJson(good.value, opts.indent, opts.sortKeys), error: null };
  }, [good, view, opts.indent, opts.sortKeys]);
  const EXT = { graph: 'json', tree: 'json', yaml: 'yaml', csv: 'csv' }[view];

  const format = () => {
    if (!parsed.ok) { toast('JSON inválido', `Linha ${parsed.line}, coluna ${parsed.col}: ${parsed.error}`, 'error'); return; }
    setInput(formatJson(parsed.value, opts.indent, opts.sortKeys));
    emit('tool.used', { tool: 'json' });
  };
  const minify = () => {
    if (!parsed.ok) { toast('JSON inválido', `Linha ${parsed.line}, coluna ${parsed.col}: ${parsed.error}`, 'error'); return; }
    setInput(minifyJson(parsed.value));
    emit('tool.used', { tool: 'json' });
  };
  const copyOut = async () => {
    if (!viewText.text) return;
    await window.devkit.clipboard.write(viewText.text);
    toast('Copiado', view === 'yaml' ? 'YAML na área de transferência' : view === 'csv' ? 'CSV na área de transferência' : 'JSON na área de transferência');
  };
  const replaceInput = (text, file) => { setDraft({ text, file }); setSelectedPath(null); setCollapsed(new Set()); touched.current = false; setFitSignal((n) => n + 1); };
  const openFile = async () => {
    try {
      const f = await window.devkit.files.openJson();
      if (f) { replaceInput(f.content, f.name); toast('Arquivo aberto', f.name + ' · ' + fmtBytes(bytes(f.content))); }
    } catch (e) { toast('Erro ao abrir', errText(e), 'error'); }
  };
  const baseName = () => (draft.file ? draft.file.replace(/\.[^.]+$/, '') : 'dados');
  const saveFile = async () => {
    if (!viewText.text) return;
    const r = await window.devkit.files.saveExport(viewText.text, baseName() + '.' + EXT);
    if (r) toast('Salvo', r.name);
  };
  const exportImage = async (kind) => {
    if (!model) return;
    try {
      const svg = graphToSvg(model.g, model.size);
      const name = baseName() + '.' + kind;
      let r;
      if (kind === 'svg') r = await window.devkit.files.saveExport(svg, name);
      else {
        const pad = 48;
        r = await window.devkit.files.saveExport(await svgToPng(svg, model.size.width + pad, model.size.height + pad), name);
      }
      if (r) toast('Imagem salva', r.name);
    } catch (e) { toast('Erro ao exportar', errText(e), 'error'); }
  };
  const copySelectedPath = async () => {
    if (!selected) return;
    await window.devkit.clipboard.write(selected.path);
    toast('Caminho copiado', selected.path);
  };
  const copySelectedValue = async () => {
    if (!selected || !good) return;
    const v = selected.segs.reduce((acc, k) => acc[k], good.value);
    await window.devkit.clipboard.write(JSON.stringify(v, null, 2));
    toast('Valor copiado', selected.path);
  };

  // Atalhos: Ctrl/⌘+Enter formatar · Ctrl/⌘+Shift+C copiar · Ctrl/⌘+O abrir · Ctrl/⌘+S salvar
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'enter') { e.preventDefault(); format(); }
      else if (k === 'c' && e.shiftKey) { e.preventDefault(); copyOut(); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const empty = (title, description) => (
    <div className="tk-code" style={{ height: '100%', justifyContent: 'center' }}>
      <EmptyState title={title} description={description} />
    </div>
  );

  let right;
  if (!input.trim()) right = empty('Cole um JSON para começar', 'Ou abra um arquivo .json (' + mod('O') + ').');
  else if (!good) right = empty('JSON inválido', `Linha ${parsed.line}, coluna ${parsed.col}: ${parsed.error}`);
  else if (view === 'graph') {
    right = (
      <div className="jsv__pane">
        <GraphView
          graph={model.g}
          size={model.size}
          matches={matches && matches.ids}
          selectedId={selected ? selected.id : null}
          onSelect={(n) => setSelectedPath(n ? n.path : null)}
          onToggle={toggleNode}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          fitSignal={fitSignal}
        />
        {selected && (
          <div className="jsv__sel">
            <code className="jsv__sel-path" title={selected.path}>{selected.path}</code>
            <Button variant="ghost" size="sm" icon="copy" onClick={copySelectedPath}>Caminho</Button>
            <Button variant="ghost" size="sm" icon="braces" onClick={copySelectedValue}>Valor</Button>
          </div>
        )}
      </div>
    );
  } else if (view === 'tree') {
    right = (
      <div className="jsv__scroll">
        <TreeView key={fitSignal} json={good.value} defaultExpandDepth={2} />
      </div>
    );
  } else if (viewText.error) right = empty('Não foi possível converter', viewText.error);
  else right = <CodeEditor language="text" value={viewText.text} height="100%" minimap />;

  const nodeCount = model ? model.g.nodes.length : 0;

  return (
    <div className="sqlf">
      <PageHeader
        icon="braces"
        title="JSON Visualizer"
        subtitle="Edite o JSON e explore como grafo, árvore, YAML ou CSV — roda 100% local"
        actions={<>
          <Button variant="secondary" icon="folder-open" kbd={mod('O')} onClick={openFile}>Abrir</Button>
          <Button variant="secondary" icon="minimize-2" disabled={!parsed.ok} onClick={minify}>Minificar</Button>
          <Button variant="primary" icon="wand-sparkles" kbd={mod('↵')} disabled={!input.trim()} onClick={format}>Formatar</Button>
        </>}
      />

      <div className="sqlf__opts">
        <Opt label="Visualização">
          <SegmentedControl size="sm" options={VIEW_OPTIONS} value={view} onChange={set('view')} />
        </Opt>
        <Opt label="Indentação">
          <Select options={INDENT_OPTIONS} value={opts.indent} onChange={set('indent')} style={{ width: 128 }} />
        </Opt>
        <Opt label="Opções">
          <div className="sqlf__toggles">
            <Toggle size="sm" label="Ordenar chaves" checked={opts.sortKeys} onChange={set('sortKeys')} />
          </div>
        </Opt>
        <Opt label="Buscar / JSONPath">
          <div className="jsv__search">
            <Input size="sm" type="search" mono placeholder="texto ou $.lista[*].nome" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
            {matches && (matches.error
              ? <Badge size="sm" variant="error">{matches.error}</Badge>
              : <Badge size="sm" variant={matches.count ? 'ok' : 'neutral'}>{matches.count} resultado(s)</Badge>)}
          </div>
        </Opt>
        <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => setOpts(DEFAULT_JSON_OPTIONS)} style={{ marginLeft: 'auto' }}>Padrão</Button>
      </div>

      <div className="sqlf__body">
        {!parsed.ok && input.trim() && (
          <Alert variant="error" title={`JSON inválido · linha ${parsed.line}, coluna ${parsed.col}`} mono>{parsed.error}</Alert>
        )}
        <div className="sqlf__split">
          <SplitView
            leftTitle={draft.file ? 'Entrada · ' + draft.file : 'Entrada'}
            leftMeta={fmtBytes(bytes(input))}
            leftActions={<Button variant="ghost" size="sm" icon="file-code" onClick={() => replaceInput(SAMPLE, null)}>Exemplo</Button>}
            onClear={() => replaceInput('', null)}
            rightTitle={{ graph: 'Grafo', tree: 'Árvore', yaml: 'YAML', csv: 'CSV' }[view]}
            rightMeta={good ? <Badge size="sm" variant="ok" dot>{view === 'graph' ? nodeCount + ' nós' : fmtBytes(bytes(viewText.text))}</Badge> : null}
            rightActions={<>
              {view === 'graph' && good && <>
                <Button variant="ghost" size="sm" icon="image" onClick={() => exportImage('png')}>PNG</Button>
                <Button variant="ghost" size="sm" icon="file-image" onClick={() => exportImage('svg')}>SVG</Button>
              </>}
              <Button variant="ghost" size="sm" icon="download" disabled={!viewText.text} onClick={saveFile}>Salvar</Button>
            </>}
            onCopy={copyOut}
            left={<CodeEditor
              language="json"
              editable
              value={input}
              onChange={setInput}
              height="100%"
              placeholder="Cole ou digite o JSON aqui…"
              errorLine={parsed.ok ? undefined : parsed.line}
              errorMessage={parsed.ok ? undefined : parsed.error}
            />}
            right={right}
          />
        </div>
      </div>
    </div>
  );
}
