import { DS, mod, isMod } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { diffLines, applyHunk } from './engine.js';
import { detectLanguage } from './syntax.js';
import { DiffView } from './DiffView.jsx';
import { emit } from '../../lib/events.js';

const {
  PageHeader, SplitView, CodeEditor, SegmentedControl, Select, Toggle, Button, IconButton,
  Alert, EmptyState, Badge,
} = DS;

export const DEFAULT_DIFF_OPTIONS = {
  view: 'split',
  granularity: 'smart',
  ignoreWhitespace: false,
  ignoreCase: false,
  collapse: true,
  language: 'auto',
  live: true,
  editorsHidden: false,
};

const VIEW_OPTIONS = [
  { value: 'split', label: 'Lado a lado' },
  { value: 'unified', label: 'Unificado' },
];
const GRAN_OPTIONS = [
  { value: 'smart', label: 'Inteligente' },
  { value: 'word', label: 'Palavra' },
  { value: 'char', label: 'Caractere' },
];
const LANG_OPTIONS = [
  { value: 'auto', label: 'Automático' },
  { value: 'text', label: 'Texto' },
  { value: 'json', label: 'JSON' },
  { value: 'js', label: 'JavaScript' },
  { value: 'sql', label: 'SQL' },
  { value: 'xml', label: 'XML' },
];

const SAMPLE_LEFT = `{
  "nome": "toni-devkit",
  "versao": "0.1.0",
  "ferramentas": ["sql", "xml"],
  "tema": "dark",
  "atalhos": {
    "palette": "Ctrl+K",
    "sidebar": "Ctrl+\\\\"
  },
  "offline": true
}`;
const SAMPLE_RIGHT = `{
  "nome": "toni-devkit",
  "versao": "0.2.0",
  "ferramentas": ["sql", "xml", "diff"],
  "tema": "dark",
  "atalhos": {
    "palette": "Ctrl+K",
    "sidebar": "Ctrl+\\\\",
    "configuracoes": "Ctrl+,"
  },
  "offline": true
}`;

const MAX_BYTES = 20 * 1024 * 1024;
const bytes = (s) => new Blob([s]).size;
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

const Opt = ({ label, children }) => (
  <div className="sqlf__opt">
    <span className="sqlf__opt-label">{label}</span>
    {children}
  </div>
);

/** Editor que aceita arquivo arrastado. */
function DropPane({ onFile, children }) {
  const [over, setOver] = React.useState(false);
  const onDragOver = (e) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDrop = (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    setOver(false);
    if (!f) return;
    e.preventDefault();
    onFile(f);
  };
  return (
    <div className={'dfc-drop' + (over ? ' is-over' : '')} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {children}
      {over && <div className="dfc-drop__hint">Solte o arquivo aqui</div>}
    </div>
  );
}

export function DiffChecker({ toast, request }) {
  const [opts, setOpts] = usePersisted('diff.options', DEFAULT_DIFF_OPTIONS);
  const [draft, setDraft] = usePersisted('diff.draft', { left: SAMPLE_LEFT, right: SAMPLE_RIGHT, leftFile: null, rightFile: null });
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));
  const setSide = (side, text, file = null) => setDraft((d) => ({ ...d, [side]: text, [side + 'File']: file }));

  // Textos efetivamente comparados: acompanham o rascunho com debounce (ao vivo) ou no "Comparar".
  const [cmp, setCmp] = React.useState({ left: draft.left, right: draft.right });
  const compare = () => setCmp({ left: draft.left, right: draft.right });
  // Textos vindos de outra ferramenta (Git: "Abrir no Diff Checker"): viram o Original e o Alterado e já comparam.
  React.useEffect(() => {
    if (!request || typeof request.left !== 'string' || typeof request.right !== 'string') return;
    setDraft({ left: request.left, right: request.right, leftFile: request.leftFile || null, rightFile: request.rightFile || null });
    setCmp({ left: request.left, right: request.right });
  }, [request && request.nonce]);
  React.useEffect(() => {
    if (!opts.live) return;
    const t = setTimeout(compare, 200);
    return () => clearTimeout(t);
  }, [draft.left, draft.right, opts.live]);
  const stale = cmp.left !== draft.left || cmp.right !== draft.right;

  const cmpOpts = React.useMemo(() => ({ ignoreWhitespace: opts.ignoreWhitespace, ignoreCase: opts.ignoreCase }), [opts.ignoreWhitespace, opts.ignoreCase]);
  const { result, error } = React.useMemo(() => {
    try { return { result: diffLines(cmp.left, cmp.right, cmpOpts), error: null }; }
    catch (e) { return { result: null, error: String(e.message || e) }; }
  }, [cmp, cmpOpts]);
  React.useEffect(() => { if (result && result.hunks.length) emit('tool.used', { tool: 'diff' }); }, [result]);

  const hunks = result ? result.hunks.length : 0;
  const [current, setCurrent] = React.useState(0);
  React.useEffect(() => { setCurrent((c) => Math.min(c, Math.max(0, hunks - 1))); }, [hunks]);
  const nav = (dir) => hunks && setCurrent((c) => (c + dir + hunks) % hunks);

  const lang = opts.language === 'auto'
    ? detectLanguage(cmp.left || cmp.right, draft.leftFile, draft.rightFile)
    : opts.language;

  const merge = (h, dir) => {
    if (!result || !result.hunks[h]) return;
    const s = applyHunk(cmp.left, cmp.right, result.hunks[h], dir);
    setDraft((d) => ({ ...d, left: s.left, right: s.right }));
    setCmp(s);
  };

  const readFile = async (side, f) => {
    if (f.size > MAX_BYTES) { toast('Arquivo muito grande', f.name + ' tem mais de 20 MB', 'error'); return; }
    try {
      const text = await f.text();
      setSide(side, text, f.name);
      toast('Arquivo aberto', f.name + ' · ' + fmtBytes(f.size));
    } catch (e) { toast('Erro ao abrir', String(e.message || e), 'error'); }
  };
  const openFile = async (side) => {
    try {
      const f = await window.devkit.files.openText();
      if (f) { setSide(side, f.content, f.name); toast('Arquivo aberto', f.name + ' · ' + fmtBytes(bytes(f.content))); }
    } catch (e) { toast('Erro ao abrir', String(e.message || e), 'error'); }
  };
  const swap = () => {
    setDraft((d) => ({ left: d.right, right: d.left, leftFile: d.rightFile, rightFile: d.leftFile }));
    setCmp((c) => ({ left: c.right, right: c.left }));
  };
  const copyRight = async () => {
    await window.devkit.clipboard.write(draft.right);
    toast('Copiado', 'Texto Alterado na área de transferência');
  };

  // Atalhos: Ctrl/⌘+Enter comparar · Alt+↓/↑ mudança seguinte/anterior · Ctrl/⌘+O abrir Original ·
  // Ctrl/⌘+Shift+O abrir Alterado · Ctrl/⌘+Shift+S trocar lados
  React.useEffect(() => {
    const h = (e) => {
      if (e.altKey && !isMod(e) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); nav(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'enter') { e.preventDefault(); compare(); }
      else if (k === 'o') { e.preventDefault(); openFile(e.shiftKey ? 'right' : 'left'); }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); swap(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const paneTitle = (label, file) => (file ? label + ' · ' + file : label);
  const bothEmpty = !cmp.left && !cmp.right;
  const st = result && result.stats;

  let body;
  if (error) body = <Alert variant="error" title="Erro ao comparar" mono>{error}</Alert>;
  else if (bothEmpty) {
    body = <div className="dfc-center"><EmptyState title="Cole dois textos para comparar" description={'Ou arraste um arquivo para cada lado (' + mod('O') + ' / ' + mod('O', true) + ').'} kbd={mod('V')} /></div>;
  } else if (!hunks) {
    body = <div className="dfc-center"><EmptyState title="Os textos são idênticos" animate="none"
      description={opts.ignoreWhitespace || opts.ignoreCase ? 'Considerando as opções de ignorar espaços/maiúsculas.' : 'Nenhuma diferença encontrada.'} /></div>;
  } else {
    body = <DiffView result={result} view={opts.view} granularity={opts.granularity} collapse={opts.collapse}
      compare={cmpOpts} lang={lang} current={current} onMerge={merge} onPick={setCurrent} />;
  }

  return (
    <div className="sqlf">
      <PageHeader
        icon="git-compare"
        title="Diff Checker"
        subtitle="Compara dois textos: linha, palavra e caractere — roda 100% local"
        actions={<>
          <Button variant="secondary" icon={opts.editorsHidden ? 'panel-top-open' : 'panel-top-close'} onClick={() => set('editorsHidden')(!opts.editorsHidden)}>
            {opts.editorsHidden ? 'Mostrar editores' : 'Recolher editores'}
          </Button>
          {!opts.live && <Button variant="primary" icon="git-compare" kbd={mod('↵')} disabled={!stale} onClick={compare}>Comparar</Button>}
        </>}
      />

      <div className="sqlf__opts">
        <Opt label="Visualização">
          <SegmentedControl size="sm" options={VIEW_OPTIONS} value={opts.view} onChange={set('view')} />
        </Opt>
        <Opt label="Destaque">
          <SegmentedControl size="sm" options={GRAN_OPTIONS} value={opts.granularity} onChange={set('granularity')} />
        </Opt>
        <Opt label="Sintaxe">
          <Select options={LANG_OPTIONS} value={opts.language} onChange={set('language')} style={{ width: 128 }} />
        </Opt>
        <Opt label="Opções">
          <div className="sqlf__toggles">
            <Toggle size="sm" label="Ignorar espaços" checked={opts.ignoreWhitespace} onChange={set('ignoreWhitespace')} />
            <Toggle size="sm" label="Ignorar maiúsculas" checked={opts.ignoreCase} onChange={set('ignoreCase')} />
            <Toggle size="sm" label="Recolher iguais" checked={opts.collapse} onChange={set('collapse')} />
            <Toggle size="sm" label="Comparar ao digitar" checked={opts.live} onChange={set('live')} />
          </div>
        </Opt>
      </div>

      <div className="sqlf__body">
        {!opts.editorsHidden && (
          <div className="dfc-editors">
            <SplitView
              leftTitle={paneTitle('Original', draft.leftFile)}
              leftMeta={fmtBytes(bytes(draft.left))}
              leftActions={<Button variant="ghost" size="sm" icon="folder-open" onClick={() => openFile('left')}>Abrir</Button>}
              onClear={() => setSide('left', '')}
              rightTitle={paneTitle('Alterado', draft.rightFile)}
              rightMeta={fmtBytes(bytes(draft.right))}
              rightActions={<>
                <Button variant="ghost" size="sm" icon="folder-open" onClick={() => openFile('right')}>Abrir</Button>
                <Button variant="ghost" size="sm" icon="eraser" onClick={() => setSide('right', '')}>Limpar</Button>
              </>}
              onSwap={swap}
              left={<DropPane onFile={(f) => readFile('left', f)}>
                <CodeEditor language={lang} editable value={draft.left} onChange={(t) => setSide('left', t, draft.leftFile)} height="100%" placeholder="Cole o texto original aqui…" />
              </DropPane>}
              right={<DropPane onFile={(f) => readFile('right', f)}>
                <CodeEditor language={lang} editable value={draft.right} onChange={(t) => setSide('right', t, draft.rightFile)} height="100%" placeholder="Cole o texto alterado aqui…" />
              </DropPane>}
            />
          </div>
        )}

        <div className="dfc-result tk-diff">
          <div className="tk-diff__stats dfc-bar">
            {st && !bothEmpty ? <>
              <span className="is-add">+{st.added}</span>
              <span className="is-del">−{st.removed}</span>
              <span>{st.similarity.toFixed(st.similarity % 1 ? 1 : 0)}% igual</span>
              <span>{result.ms.toFixed(1)} ms</span>
            </> : <span>Resultado</span>}
            {stale && !opts.live && <Badge size="sm" variant="warn" dot>desatualizado</Badge>}
            <div className="dfc-bar__nav">
              {hunks > 0 && <>
                <span>Mudança {current + 1} de {hunks}</span>
                <IconButton size="sm" icon="chevron-up" label="Mudança anterior (Alt+↑)" onClick={() => nav(-1)} />
                <IconButton size="sm" icon="chevron-down" label="Próxima mudança (Alt+↓)" onClick={() => nav(1)} />
              </>}
              <Button variant="ghost" size="sm" icon="copy" disabled={!draft.right} onClick={copyRight}>Copiar Alterado</Button>
            </div>
          </div>
          {body}
        </div>
      </div>
    </div>
  );
}
