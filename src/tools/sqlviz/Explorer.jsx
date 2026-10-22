import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { VirtualList } from '../../lib/VirtualList.jsx';
import { parseSchemaInput, neighbors, expand, subset, fkPath, mentionedTables } from '../../db/schema.js';
import { useAiMode, useAiTask, aiOn, AiPanel } from '../../ai/ui.jsx';
import { ER, heightOf } from '../../db/erlayout.js';
import * as X from '../../db/explorer.js';
import { ErCanvas } from './ErCanvas.jsx';
import { ServerLoader, errText } from './ServerLoader.jsx';

const { Button, Alert, Input, Select, Modal, CodeEditor, Badge, Icon } = DS;

const MAX_ADD = 150; // teto por ação em lote (adicionar todas / expandir) para não encher o canvas sem querer
const GROUPS = [
  { value: 'none', label: 'Sem grupos' },
  { value: 'schema', label: 'Por schema' },
  { value: 'prefix', label: 'Por prefixo (antes de _)' },
  { value: 'letters', label: 'Primeiras letras' },
];
const DEPTHS = [{ value: 1, label: '1 nível' }, { value: 2, label: '2 níveis' }];
const AI_MAX_TABLES = 40; // teto de tabelas no contexto da pergunta (o resto não cabe no modelo local)
const title = (t) => (t.schema && t.schema !== 'dbo' ? `${t.schema}.${t.name}` : t.name);

/**
 * Aba "Explorador": para schemas grandes. O canvas começa vazio; você busca uma tabela e a adiciona, expande as vizinhas
 * por FK (1 ou 2 níveis), agrupa por módulo e guarda "layouts" nomeados. Só as tabelas adicionadas são desenhadas.
 * `source` e `setSource` vivem no pai para o schema sobreviver à troca de aba.
 */
export function Explorer({ toast, source, setSource }) {
  const schema = source ? source.schema : null;
  const [q, setQ] = React.useState('');
  const [schemaSel, setSchemaSel] = React.useState('');
  const [prefixText, setPrefixText] = React.useState('');
  const [ids, setIds] = React.useState([]);
  const [pos, setPos] = React.useState({});
  const [selected, setSelected] = React.useState(null);
  const [group, setGroup] = React.useState({ mode: 'none', n: 2 });
  const [fitSignal, setFitSignal] = React.useState(0);
  const [focusReq, setFocusReq] = React.useState(null);
  const [depth, setDepth] = React.useState(1);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = usePersisted('sqlviz.exp.paste', { text: '' });
  const [pasteErr, setPasteErr] = React.useState('');
  const [store, setStore] = usePersisted('sqlviz.layouts', {});
  const [layoutName, setLayoutName] = React.useState('');
  const [saveName, setSaveName] = React.useState('');
  const [question, setQuestion] = React.useState('');
  const cfg = useAiMode();
  const ask = useAiTask('erAsk', cfg);
  React.useEffect(() => { ask.close(); }, [schema]);

  const byId = React.useMemo(() => new Map((schema ? schema.tables : []).map((t) => [t.id, t])), [schema]);
  const key = schema ? X.schemaKey(source.label, schema) : '';
  const saved = (key && store[key]) || {};

  // Trocou o schema: canvas vazio de novo.
  React.useEffect(() => { setIds([]); setPos({}); setSelected(null); setLayoutName(''); setGroup({ mode: 'none', n: 2 }); }, [schema]);

  const prefixes = React.useMemo(() => X.parsePrefixes(prefixText), [prefixText]);
  const results = React.useMemo(
    () => (schema ? X.filterTables(schema, { q, schemas: schemaSel ? new Set([schemaSel]) : null, prefixes }) : []),
    [schema, q, schemaSel, prefixes],
  );
  const schemaOpts = React.useMemo(() => {
    if (!schema) return [];
    const c = new Map();
    for (const t of schema.tables) c.set(t.schema, (c.get(t.schema) || 0) + 1);
    return [{ value: '', label: `Todos os schemas (${schema.tables.length})` }, ...[...c].sort().map(([s, n]) => ({ value: s, label: `${s} (${n})` }))];
  }, [schema]);

  const onCanvas = React.useMemo(() => new Set(ids), [ids]);
  const sub = React.useMemo(() => (schema ? subset(schema, onCanvas) : { tables: [], fks: [] }), [schema, onCanvas]);
  const nodes = React.useMemo(() => (schema ? X.boxesOf(schema, ids, pos) : {}), [schema, ids, pos]);
  const groupOf = React.useCallback((id) => (byId.get(id) ? X.moduleOf(byId.get(id), group.mode, group.n) : ''), [byId, group]);
  const groups = React.useMemo(() => (group.mode === 'none' ? [] : X.groupRects(nodes, groupOf)), [nodes, groupOf, group.mode]);
  const related = React.useMemo(() => (selected && onCanvas.has(selected) ? expand(sub, selected, 1) : null), [sub, selected, onCanvas]);

  /** Põe as tabelas `list` no canvas, cada uma perto de uma vizinha que já esteja lá. */
  const place = (list) => {
    const have = new Set(ids);
    const boxes = { ...nodes };
    const nextPos = { ...pos };
    const added = [];
    for (const id of list) {
      const t = byId.get(id);
      if (!t || have.has(id)) continue;
      const anchorId = [...neighbors(schema, id)].find((n) => have.has(n) && boxes[n]);
      const p = X.placeNear(Object.values(boxes), anchorId ? boxes[anchorId] : null, { w: ER.w, h: heightOf(t) });
      boxes[id] = { x: p.x, y: p.y, w: ER.w, h: heightOf(t) };
      nextPos[id] = p;
      have.add(id);
      added.push(id);
    }
    if (added.length) { setIds((l) => [...l, ...added]); setPos(nextPos); }
    return added;
  };

  const addOne = (id) => {
    if (!onCanvas.has(id)) place([id]);
    setSelected(id);
    setFocusReq({ id, nonce: Date.now() });
  };
  const addAll = () => {
    const list = results.filter((id) => !onCanvas.has(id));
    if (!list.length) return;
    const take = list.slice(0, MAX_ADD);
    place(take);
    if (list.length > take.length) toast('Limite de ' + MAX_ADD, `Foram adicionadas as primeiras ${MAX_ADD} de ${list.length}. Refine o filtro para o resto.`, 'warn');
    else setFitSignal((n) => n + 1);
  };
  const expandNeighbors = () => {
    const base = selected && onCanvas.has(selected) ? [selected] : ids;
    if (!base.length) { toast('Nada para expandir', 'Adicione uma tabela primeiro.', 'warn'); return; }
    const all = [...expand(schema, base, depth)].filter((id) => !onCanvas.has(id));
    if (!all.length) { toast('Sem vizinhas novas', 'Todas as tabelas ligadas por FK já estão no canvas.'); return; }
    const take = all.slice(0, MAX_ADD);
    place(take);
    toast(`${take.length} tabela(s) adicionada(s)`, all.length > take.length ? `Limitei em ${MAX_ADD}; ainda há ${all.length - take.length} vizinha(s).` : `Vizinhas por FK até ${depth} nível(is).`, all.length > take.length ? 'warn' : 'ok');
  };
  const removeOne = (id) => {
    setIds((l) => l.filter((x) => x !== id));
    setPos((p) => { const n = { ...p }; delete n[id]; return n; });
    setSelected((s) => (s === id ? null : s));
  };
  const clearAll = () => { setIds([]); setPos({}); setSelected(null); };
  const reorganize = (g = group) => {
    if (!schema || !ids.length) return;
    const go = g.mode === 'none' ? null : (id) => X.moduleOf(byId.get(id), g.mode, g.n);
    setPos(X.layoutAll(sub, go));
    setFitSignal((n) => n + 1);
  };
  const changeGroup = (patch) => {
    const g = { ...group, ...patch };
    setGroup(g);
    if (ids.length) reorganize(g);
  };

  const saveLayout = () => {
    const name = saveName.trim();
    if (!name || !ids.length) return;
    setStore({ ...store, [key]: { ...saved, [name]: X.serializeLayout({ ids, pos, group }) } });
    setLayoutName(name); setSaveName('');
    toast('Layout salvo', `“${name}” — ${ids.length} tabela(s)`, 'ok');
  };
  const loadLayout = (name) => {
    setLayoutName(name);
    const r = X.restoreLayout(schema, saved[name]);
    setIds(r.ids); setPos(r.pos); setGroup(r.group); setSelected(null); setFitSignal((n) => n + 1);
    if (r.missing) toast('Layout carregado', `${r.missing} tabela(s) do layout não existem mais neste banco e foram ignoradas.`, 'warn');
  };
  const deleteLayout = () => {
    if (!layoutName) return;
    const next = { ...saved }; delete next[layoutName];
    setStore({ ...store, [key]: next });
    setLayoutName('');
  };

  const usePaste = () => {
    try { setSource({ schema: parseSchemaInput(pasteText.text), label: '' }); setPasteOpen(false); setPasteErr(''); }
    catch (e) { setPasteErr(errText(e)); }
  };

  const layoutOpts = Object.keys(saved).sort().map((n) => ({ value: n, label: n }));

  const renderRow = (i, style) => {
    const t = byId.get(results[i]);
    const on = onCanvas.has(t.id);
    return (
      <button key={t.id} type="button" style={style} className={'sqv__row' + (on ? ' is-on' : '')} onClick={() => addOne(t.id)} title={`${t.id} · ${t.columns.length} coluna(s)${on ? ' · já está no canvas' : ''}`}>
        <Icon name={on ? 'check' : 'plus'} size={13} />
        <span className="sqv__rname">{t.name}</span>
        <span className="sqv__rmeta">{t.schema !== 'dbo' ? t.schema + ' · ' : ''}{t.columns.length} col</span>
      </button>
    );
  };

  // Contexto da pergunta: as tabelas citadas (ou, sem citação, as do canvas) e as vizinhas por FK. Com duas ou mais
  // citadas, o menor caminho de FKs entre as duas primeiras é calculado aqui e mandado como fato.
  const askAi = () => ask.start(() => {
    const named = mentionedTables(schema, question).slice(0, 6);
    const base = named.length ? named : ids.slice(0, 6);
    const picked = [...expand(schema, base, 1)].slice(0, AI_MAX_TABLES);
    const path = named.length > 1 ? fkPath(schema, named[0], named[1]) : null;
    const withPath = path ? new Set([...picked, ...path.flatMap((s) => s.split(' → ').map((p) => p.slice(0, p.indexOf('('))))]) : new Set(picked);
    return { question, schema: subset(schema, withPath), path: path || [] };
  });

  return (
    <div className="sqv__exp">
      <aside className="sqv__side">
        <ServerLoader
          toast={toast}
          hint={false}
          onLoaded={(s, label) => setSource({ schema: s, label })}
          extra={<Button variant="ghost" size="sm" icon="clipboard-paste" onClick={() => setPasteOpen(true)}>Colar DDL/JSON</Button>}
        />
        {!schema ? (
          <div className="sqv__hint">Carregue um schema (do servidor, ou colando DDL/JSON) para começar. O canvas inicia vazio: você escolhe quais tabelas ver.</div>
        ) : (
          <>
            <div className="sqv__muted">{source.label || 'Texto colado'} · {schema.tables.length} tabela(s) · {schema.fks.length} FK(s)</div>
            <Input size="sm" icon="search" placeholder="Buscar tabela ou coluna…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select size="sm" options={schemaOpts} value={schemaSel} onChange={setSchemaSel} />
            <Input size="sm" placeholder="Prefixo(s): TMOV, FLAN…" value={prefixText} onChange={(e) => setPrefixText(e.target.value)} />
            <div className="sqv__listbar">
              <span className="sqv__muted">{results.length} resultado(s)</span>
              <Button variant="ghost" size="sm" icon="list-plus" disabled={!results.length} onClick={addAll} title={`Adiciona as tabelas filtradas (máx. ${MAX_ADD})`}>Adicionar todas</Button>
            </div>
            <div className="sqv__list">
              {results.length ? <VirtualList count={results.length} rowHeight={30} renderRow={renderRow} /> : <div className="sqv__hint">Nenhuma tabela com esses filtros.</div>}
            </div>
          </>
        )}
      </aside>

      <section className="sqv__main">
        {schema && (
          <div className="sqv__toolbar">
            <Select size="sm" options={DEPTHS} value={depth} onChange={setDepth} style={{ width: 110 }} />
            <Button variant="secondary" size="sm" icon="git-fork" onClick={expandNeighbors} title="Adiciona as tabelas ligadas por FK à selecionada (ou a todas, se nenhuma estiver selecionada)">Expandir vizinhas</Button>
            <Button variant="ghost" size="sm" icon="trash-2" disabled={!selected || !onCanvas.has(selected)} onClick={() => removeOne(selected)}>Remover</Button>
            <Button variant="ghost" size="sm" icon="eraser" disabled={!ids.length} onClick={clearAll}>Limpar</Button>
            <Button variant="ghost" size="sm" icon="layout-dashboard" disabled={!ids.length} onClick={() => reorganize()}>Reorganizar</Button>
            <span className="sqv__sep" />
            <Select size="sm" options={GROUPS} value={group.mode} onChange={(v) => changeGroup({ mode: v })} style={{ width: 190 }} />
            {group.mode === 'letters' && <Input size="sm" type="number" min={1} max={6} value={group.n} onChange={(e) => changeGroup({ n: Math.min(6, Math.max(1, Number(e.target.value) || 1)) })} style={{ width: 64 }} />}
            <span className="sqv__sep" />
            <Select size="sm" options={layoutOpts} value={layoutName} placeholder={layoutOpts.length ? 'Layouts salvos…' : 'Nenhum layout salvo'} disabled={!layoutOpts.length} onChange={loadLayout} style={{ width: 170 }} />
            {layoutName && <Button variant="ghost" size="sm" icon="x" onClick={deleteLayout} title="Apagar o layout selecionado">Apagar</Button>}
            <Input size="sm" placeholder="Nome do layout" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveLayout(); }} style={{ width: 150 }} />
            <Button variant="ghost" size="sm" icon="save" disabled={!saveName.trim() || !ids.length} onClick={saveLayout}>Salvar</Button>
            <span className="sqv__grow" />
            <Badge size="sm" variant="neutral">{ids.length} no canvas</Badge>
          </div>
        )}
        {schema && aiOn(cfg) && (
          <form className="sqv__ask" onSubmit={(e) => { e.preventDefault(); if (question.trim() && !ask.busy) askAi(); }}>
            <Input size="sm" icon="sparkles" placeholder="Pergunte ao schema: como chego de Pedido até Cliente?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            <Button variant="secondary" size="sm" icon={ask.busy ? 'square' : 'sparkles'} type={ask.busy ? 'button' : 'submit'} onClick={ask.busy ? ask.cancel : undefined} disabled={!ask.busy && !question.trim()}>{ask.busy ? 'Parar' : 'Perguntar'}</Button>
          </form>
        )}
        {schema && aiOn(cfg) && <AiPanel ai={ask} className="lg-ai" />}
        <div className="sqv__stage">
          {schema && ids.length > 0 ? (
            <ErCanvas
              schema={sub}
              nodes={nodes}
              groups={groups}
              selectedId={selected}
              onSelect={setSelected}
              related={related}
              fitSignal={fitSignal}
              focusReq={focusReq}
              onMoveNode={(id, x, y) => setPos((p) => ({ ...p, [id]: { x, y } }))}
              onRemove={removeOne}
            />
          ) : (
            <div className="sqv__empty">
              <Icon name="network" size={28} />
              <b>{schema ? 'Canvas vazio' : 'Sem schema'}</b>
              <span>{schema ? 'Busque uma tabela à esquerda e clique nela para adicioná-la. Depois use “Expandir vizinhas”.' : 'Carregue um schema à esquerda.'}</span>
            </div>
          )}
        </div>
      </section>

      {pasteOpen && (
        <Modal
          title="Colar DDL ou JSON de metadados"
          icon="clipboard-paste"
          width="min(760px, 94vw)"
          onClose={() => setPasteOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancelar</Button><Button variant="primary" onClick={usePaste}>Usar</Button></>}
        >
          <div className="sqv__paste">
            {pasteErr && <Alert variant="error" title="Não foi possível ler">{pasteErr}</Alert>}
            <CodeEditor language="sql" editable value={pasteText.text} onChange={(v) => setPasteText({ text: v })} height="320px" placeholder="CREATE TABLE … / ALTER TABLE … FOREIGN KEY … ou o JSON da query de metadados" />
          </div>
        </Modal>
      )}
    </div>
  );
}
