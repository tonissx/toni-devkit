import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';

const {
  PageHeader, SplitView, CodeEditor, SegmentedControl, Select, Toggle, Button,
  Badge, Alert, EmptyState, Spinner,
} = DS;

/** Padrões idênticos ao sqlformat.org (keywords em UPPER, identificadores inalterados, 2 espaços). */
export const DEFAULT_SQL_OPTIONS = {
  keywordCase: 'upper',
  identifierCase: 'unchanged',
  indent: 2,
  stripComments: false,
  compact: false,
  outputFormat: 'sql',
  autoFormat: true,
};

const CASE_OPTIONS = [
  { value: 'upper', label: 'UPPER' },
  { value: 'lower', label: 'lower' },
  { value: 'capitalize', label: 'Capitalize' },
  { value: 'unchanged', label: 'Manter' },
];
const INDENT_OPTIONS = [
  { value: 2, label: '2 espaços' },
  { value: 4, label: '4 espaços' },
  { value: 8, label: '8 espaços' },
  { value: 1, label: '1 espaço' },
  { value: 3, label: '3 espaços' },
  { value: 'tab', label: 'Tab' },
];
const OUTPUT_OPTIONS = [
  { value: 'sql', label: 'SQL' },
  { value: 'python', label: 'Python' },
  { value: 'php', label: 'PHP' },
];

const SAMPLE = `select f.chapa, p.nome, s.descricao as secao, count(a.idanotacao) as qtd_anotacoes -- anotações por funcionário
from pfunc f inner join ppessoa p on p.codigo = f.codpessoa left join psecao s on s.codcoligada = f.codcoligada and s.codigo = f.codsecao
left join zmd_anotacao a on a.chapa = f.chapa and a.codcoligada = f.codcoligada
where f.codcoligada = 1 and f.codsituacao not in ('D', 'I') and f.dataadmissao >= '2024-01-01'
group by f.chapa, p.nome, s.descricao having count(a.idanotacao) > 0 order by qtd_anotacoes desc, p.nome;
update pfunc set codsecao = '01.02.003' where codcoligada = 1 and chapa in (select chapa from ztransferencia where status = 'A');`;

const bytes = (s) => new Blob([s]).size;
const fmtBytes = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

const Opt = ({ label, children }) => (
  <div className="sqlf__opt">
    <span className="sqlf__opt-label">{label}</span>
    {children}
  </div>
);

export function SqlFormatter({ toast }) {
  const [opts, setOpts] = usePersisted('sql.options', DEFAULT_SQL_OPTIONS);
  const [draft, setDraft] = usePersisted('sql.draft', { text: SAMPLE, file: null });
  const input = draft.text;
  const setInput = (text) => setDraft((d) => ({ ...d, text }));

  const [engine, setEngine] = React.useState({ state: 'loading' }); // loading | ready | error
  const [out, setOut] = React.useState({ text: '', ms: 0, error: null, busy: false, jsConcat: null });
  const reqId = React.useRef(0);
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  // Aquece o motor (Pyodide + sqlparse) e descobre a versão.
  React.useEffect(() => {
    let alive = true;
    window.devkit.sql.status().then(
      (s) => alive && setEngine({ state: 'ready', version: s.sqlparse }),
      (e) => alive && setEngine({ state: 'error', error: String(e.message || e) })
    );
    return () => { alive = false; };
  }, []);

  const runFormat = React.useCallback(async (text = input, o = opts) => {
    const id = ++reqId.current;
    if (!text.trim()) { setOut({ text: '', ms: 0, error: null, busy: false, jsConcat: null }); return ''; }
    setOut((p) => ({ ...p, busy: true }));
    try {
      const r = await window.devkit.sql.format(text, o);
      if (id === reqId.current) setOut({ text: r.result, ms: r.ms, error: null, busy: false, jsConcat: r.jsConcat || null });
      return r.result;
    } catch (e) {
      const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (id === reqId.current) setOut((p) => ({ ...p, error: msg, busy: false }));
      return null;
    }
  }, [input, opts]);

  // Formatação automática (debounce) quando entrada ou opções mudam.
  React.useEffect(() => {
    if (engine.state !== 'ready' || !opts.autoFormat) return;
    const t = setTimeout(() => runFormat(input, opts), 220);
    return () => clearTimeout(t);
  }, [input, opts, engine.state]);

  const copyOut = async () => {
    if (!out.text) return;
    await window.devkit.clipboard.write(out.text);
    toast('Copiado', 'SQL formatado na área de transferência');
  };
  const openFile = async () => {
    try {
      const f = await window.devkit.files.openSql();
      if (f) { setDraft({ text: f.content, file: f.name }); toast('Arquivo aberto', f.name + ' · ' + fmtBytes(bytes(f.content))); }
    } catch (e) { toast('Erro ao abrir', String(e.message || e), 'error'); }
  };
  const saveFile = async () => {
    if (!out.text) return;
    const base = draft.file ? draft.file.replace(/(\.[^.]+)?$/, '.formatado$1') : 'formatado.sql';
    const r = await window.devkit.files.saveSql(out.text, base);
    if (r) toast('Salvo', r.name);
  };
  const applyToInput = () => {
    if (out.text) { setInput(out.text); toast('Aplicado', 'Saída formatada movida para a entrada'); }
  };

  // Atalhos: Ctrl/⌘+Enter formatar · Ctrl/⌘+Shift+C copiar · Ctrl/⌘+O abrir · Ctrl/⌘+S salvar
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'enter') { e.preventDefault(); runFormat(); }
      else if (k === 'c' && e.shiftKey) { e.preventDefault(); copyOut(); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const outLang = opts.outputFormat === 'sql' ? 'sql' : opts.outputFormat === 'python' ? 'py' : 'php';
  const outLines = out.text ? out.text.split('\n').length : 0;

  const engineBadge =
    engine.state === 'loading' ? <Badge size="sm" variant="neutral"><span className="sqlf__engine"><Spinner size={10} /> Carregando motor…</span></Badge>
    : engine.state === 'error' ? <Badge size="sm" variant="error" dot>Motor indisponível</Badge>
    : <Badge size="sm" variant="neutral" mono>sqlparse {engine.version}</Badge>;

  return (
    <div className="sqlf">
      <PageHeader
        icon="database"
        title="SQL Formatter"
        subtitle="Mesmo motor e mesmo resultado do sqlformat.org"
        actions={<>
          {engineBadge}
          <Button variant="secondary" icon="folder-open" kbd={mod('O')} onClick={openFile}>Abrir</Button>
          <Button variant="primary" icon="wand-sparkles" kbd={opts.autoFormat ? undefined : mod('↵')} disabled={engine.state !== 'ready' || !input.trim()} loading={out.busy && !opts.autoFormat} onClick={opts.autoFormat ? applyToInput : () => runFormat()}>
            {opts.autoFormat ? 'Aplicar na entrada' : 'Formatar'}
          </Button>
        </>}
      />

      <div className="sqlf__opts">
        <Opt label="Palavras-chave">
          <SegmentedControl size="sm" options={CASE_OPTIONS} value={opts.keywordCase} onChange={set('keywordCase')} />
        </Opt>
        <Opt label="Identificadores">
          <SegmentedControl size="sm" options={CASE_OPTIONS} value={opts.identifierCase} onChange={set('identifierCase')} />
        </Opt>
        <Opt label="Indentação">
          <Select options={INDENT_OPTIONS} value={opts.indent} onChange={set('indent')} style={{ width: 128 }} />
        </Opt>
        <Opt label="Saída">
          <Select options={OUTPUT_OPTIONS} value={opts.outputFormat} onChange={set('outputFormat')} style={{ width: 104 }} />
        </Opt>
        <Opt label="Opções">
          <div className="sqlf__toggles">
            <Toggle size="sm" label="Remover comentários" checked={opts.stripComments} onChange={set('stripComments')} />
            <Toggle size="sm" label="Compacto" checked={opts.compact} onChange={set('compact')} />
            <Toggle size="sm" label="Formatar ao digitar" checked={opts.autoFormat} onChange={set('autoFormat')} />
          </div>
        </Opt>
        <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => setOpts(DEFAULT_SQL_OPTIONS)} style={{ marginLeft: 'auto' }}>Padrão sqlformat.org</Button>
      </div>

      <div className="sqlf__body">
        {engine.state === 'error' && <Alert variant="error" title="Não foi possível iniciar o motor SQL" mono>{engine.error}</Alert>}
        {out.error && <Alert variant="error" title="Erro ao formatar" mono>{out.error}</Alert>}
        {out.jsConcat?.detected && (
          <Alert variant="info" title="Concatenação JavaScript convertida">
            Aspas e operadores <code>+</code> removidos; {out.jsConcat.vars.length} variável(is) declarada(s) no topo com <code>DECLARE</code> e referenciada(s) como {out.jsConcat.vars.map((v) => '@' + v).join(', ')}
          </Alert>
        )}
        <div className="sqlf__split">
          <SplitView
            leftTitle={draft.file ? 'Entrada · ' + draft.file : 'Entrada'}
            leftMeta={fmtBytes(bytes(input))}
            leftActions={<Button variant="ghost" size="sm" icon="file-code" onClick={() => setDraft({ text: SAMPLE, file: null })}>Exemplo</Button>}
            onClear={() => setDraft({ text: '', file: null })}
            rightTitle={opts.outputFormat === 'sql' ? 'Saída' : 'Saída · ' + (opts.outputFormat === 'python' ? 'Python' : 'PHP')}
            rightMeta={out.text ? <Badge size="sm" variant="ok" dot>{outLines} linhas · {out.ms.toFixed(0)} ms</Badge> : null}
            rightActions={<Button variant="ghost" size="sm" icon="download" disabled={!out.text} onClick={saveFile}>Salvar</Button>}
            onCopy={copyOut}
            onSwap={() => out.text && setInput(out.text)}
            left={<CodeEditor language="sql" editable value={input} onChange={setInput} height="100%" placeholder="Cole ou digite o SQL aqui…" />}
            right={
              !input.trim()
                ? <div className="tk-code" style={{ height: '100%', justifyContent: 'center' }}>
                    <EmptyState title="Cole um SQL para começar" description={'Ou abra um arquivo .sql (' + mod('O') + ').'} kbd={mod('V')} />
                  </div>
                : !out.text && !opts.autoFormat
                ? <div className="tk-code" style={{ height: '100%', justifyContent: 'center' }}>
                    <EmptyState title="Pronto para formatar" description="A formatação automática está desligada." action={<Button variant="primary" icon="wand-sparkles" kbd={mod('↵')} onClick={() => runFormat()}>Formatar</Button>} animate="none" />
                  </div>
                : <CodeEditor language={outLang} value={out.text} height="100%" minimap />
            }
          />
        </div>
      </div>
    </div>
  );
}
