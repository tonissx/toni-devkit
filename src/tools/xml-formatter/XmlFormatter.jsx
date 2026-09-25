import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { formatXml } from './engine.js';

const {
  PageHeader, SplitView, CodeEditor, SegmentedControl, Select, Toggle, Button,
  Alert, EmptyState,
} = DS;

/** Padrões iguais aos do LemMinX (motor de formatação do vscode-xml). */
export const DEFAULT_XML_OPTIONS = {
  indent: 4,
  maxLineWidth: 80,
  emptyElements: 'ignore',
  quoteStyle: 'ignore',
  splitAttributes: false,
  closingBracketNewLine: false,
  spaceBeforeEmptyCloseTag: true,
  joinLines: false,
  autoFormat: true,
};

const INDENT_OPTIONS = [
  { value: 4, label: '4 espaços' },
  { value: 2, label: '2 espaços' },
  { value: 8, label: '8 espaços' },
  { value: 1, label: '1 espaço' },
  { value: 3, label: '3 espaços' },
  { value: 'tab', label: 'Tab' },
];
const WIDTH_OPTIONS = [
  { value: 80, label: '80 colunas' },
  { value: 100, label: '100 colunas' },
  { value: 120, label: '120 colunas' },
  { value: 0, label: 'Sem limite' },
];
const EMPTY_OPTIONS = [
  { value: 'ignore', label: 'Manter' },
  { value: 'collapse', label: '<a/>' },
  { value: 'expand', label: '<a></a>' },
];
const QUOTE_OPTIONS = [
  { value: 'ignore', label: 'Manter' },
  { value: 'double', label: '"' },
  { value: 'single', label: "'" },
];

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalogo xmlns:x="urn:exemplo">
<produto id='1' categoria="eletronicos"   disponivel='true'>
<nome>Teclado mecânico</nome>
<preco moeda="BRL">349.90</preco>
<!-- estoque por filial -->
<estoque></estoque>
<tags><tag>periferico</tag><tag>usb</tag></tags>
<descricao><![CDATA[Switches <blue> clicky, ABNT2]]></descricao>
</produto>
</catalogo>`;

const bytes = (s) => new Blob([s]).size;
const fmtBytes = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

const Opt = ({ label, children }) => (
  <div className="sqlf__opt">
    <span className="sqlf__opt-label">{label}</span>
    {children}
  </div>
);

export function XmlFormatter({ toast }) {
  const [opts, setOpts] = usePersisted('xml.options', DEFAULT_XML_OPTIONS);
  const [draft, setDraft] = usePersisted('xml.draft', { text: SAMPLE, file: null });
  const input = draft.text;
  const setInput = (text) => setDraft((d) => ({ ...d, text }));

  const [out, setOut] = React.useState({ text: '', ms: 0, error: null });
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  const runFormat = React.useCallback((text = input, o = opts) => {
    if (!text.trim()) { setOut({ text: '', ms: 0, error: null }); return ''; }
    try {
      const r = formatXml(text, o);
      setOut({ text: r.result, ms: r.ms, error: null });
      return r.result;
    } catch (e) {
      setOut((p) => ({ ...p, error: String(e.message || e) }));
      return null;
    }
  }, [input, opts]);

  // Formatação automática (debounce) quando entrada ou opções mudam.
  React.useEffect(() => {
    if (!opts.autoFormat) return;
    const t = setTimeout(() => runFormat(input, opts), 220);
    return () => clearTimeout(t);
  }, [input, opts]);

  const copyOut = async () => {
    if (!out.text) return;
    await window.devkit.clipboard.write(out.text);
    toast('Copiado', 'XML formatado na área de transferência');
  };
  const openFile = async () => {
    try {
      const f = await window.devkit.files.openXml();
      if (f) { setDraft({ text: f.content, file: f.name }); toast('Arquivo aberto', f.name + ' · ' + fmtBytes(bytes(f.content))); }
    } catch (e) { toast('Erro ao abrir', String(e.message || e), 'error'); }
  };
  const saveFile = async () => {
    if (!out.text) return;
    const base = draft.file ? draft.file.replace(/(\.[^.]+)?$/, '.formatado$1') : 'formatado.xml';
    const r = await window.devkit.files.saveXml(out.text, base);
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

  const outLines = out.text ? out.text.split('\n').length : 0;

  return (
    <div className="sqlf">
      <PageHeader
        icon="code-xml"
        title="XML Formatter"
        subtitle="Opções nos moldes do LemMinX (motor do vscode-xml) — roda 100% local"
        actions={<>
          <Button variant="secondary" icon="folder-open" kbd={mod('O')} onClick={openFile}>Abrir</Button>
          <Button variant="primary" icon="wand-sparkles" kbd={opts.autoFormat ? undefined : mod('↵')} disabled={!input.trim()} onClick={opts.autoFormat ? applyToInput : () => runFormat()}>
            {opts.autoFormat ? 'Aplicar na entrada' : 'Formatar'}
          </Button>
        </>}
      />

      <div className="sqlf__opts">
        <Opt label="Indentação">
          <Select options={INDENT_OPTIONS} value={opts.indent} onChange={set('indent')} style={{ width: 128 }} />
        </Opt>
        <Opt label="Largura máx.">
          <Select options={WIDTH_OPTIONS} value={opts.maxLineWidth} onChange={set('maxLineWidth')} style={{ width: 128 }} />
        </Opt>
        <Opt label="Elementos vazios">
          <SegmentedControl size="sm" options={EMPTY_OPTIONS} value={opts.emptyElements} onChange={set('emptyElements')} />
        </Opt>
        <Opt label="Aspas">
          <SegmentedControl size="sm" options={QUOTE_OPTIONS} value={opts.quoteStyle} onChange={set('quoteStyle')} />
        </Opt>
        <Opt label="Opções">
          <div className="sqlf__toggles">
            <Toggle size="sm" label="Dividir atributos" checked={opts.splitAttributes} onChange={set('splitAttributes')} />
            <Toggle size="sm" label="Fechamento em nova linha" checked={opts.closingBracketNewLine} onChange={set('closingBracketNewLine')} />
            <Toggle size="sm" label="Espaço antes de />" checked={opts.spaceBeforeEmptyCloseTag} onChange={set('spaceBeforeEmptyCloseTag')} />
            <Toggle size="sm" label="Juntar linhas de texto/CDATA" checked={opts.joinLines} onChange={set('joinLines')} />
            <Toggle size="sm" label="Formatar ao digitar" checked={opts.autoFormat} onChange={set('autoFormat')} />
          </div>
        </Opt>
        <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => setOpts(DEFAULT_XML_OPTIONS)} style={{ marginLeft: 'auto' }}>Padrão VS Code XML</Button>
      </div>

      <div className="sqlf__body">
        {out.error && <Alert variant="error" title="Erro ao formatar" mono>{out.error}</Alert>}
        <div className="sqlf__split">
          <SplitView
            leftTitle={draft.file ? 'Entrada · ' + draft.file : 'Entrada'}
            leftMeta={fmtBytes(bytes(input))}
            leftActions={<Button variant="ghost" size="sm" icon="file-code" onClick={() => setDraft({ text: SAMPLE, file: null })}>Exemplo</Button>}
            onClear={() => setDraft({ text: '', file: null })}
            rightTitle="Saída"
            rightMeta={out.text ? <DS.Badge size="sm" variant="ok" dot>{outLines} linhas · {out.ms.toFixed(1)} ms</DS.Badge> : null}
            rightActions={<Button variant="ghost" size="sm" icon="download" disabled={!out.text} onClick={saveFile}>Salvar</Button>}
            onCopy={copyOut}
            onSwap={() => out.text && setInput(out.text)}
            left={<CodeEditor language="xml" editable value={input} onChange={setInput} height="100%" placeholder="Cole ou digite o XML aqui…" />}
            right={
              !input.trim()
                ? <div className="tk-code" style={{ height: '100%', justifyContent: 'center' }}>
                    <EmptyState title="Cole um XML para começar" description={'Ou abra um arquivo .xml (' + mod('O') + ').'} kbd={mod('V')} />
                  </div>
                : !out.text && !opts.autoFormat
                ? <div className="tk-code" style={{ height: '100%', justifyContent: 'center' }}>
                    <EmptyState title="Pronto para formatar" description="A formatação automática está desligada." action={<Button variant="primary" icon="wand-sparkles" kbd={mod('↵')} onClick={() => runFormat()}>Formatar</Button>} animate="none" />
                  </div>
                : <CodeEditor language="xml" value={out.text} height="100%" minimap />
            }
          />
        </div>
      </div>
    </div>
  );
}
