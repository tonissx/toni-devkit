// Logs — ferramenta para achar rápido erros e avisos em logs (Fluig/JBoss, JSON por linha, IIS, Nginx/Apache, texto).
// Vários logs abertos em abas; cada um acompanha o arquivo ao vivo. Os logs continuam abertos no processo principal
// quando a pessoa vai para outra ferramenta — ao voltar, as abas reaparecem do jeito que estavam.
import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { logsApi, errText, fmtNum, fmtBytes, ago } from './shared.jsx';
import { LogView } from './LogView.jsx';

const { Icon, Spinner } = DS;

const keyOf = (spec) => (spec ? `${spec.kind}:${String(spec.path).toLowerCase()}|${String(spec.family || '').toLowerCase()}` : '');

/** Um erro na tela de um log não derruba o Devkit. */
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lg-empty">
        <Icon name="bug" size={22} />
        <b>Algo deu errado nesta tela</b>
        <span>{String(this.state.error.message || this.state.error)}</span>
        <button type="button" className="lg-btn" onClick={() => this.setState({ error: null })}><Icon name="rotate-ccw" size={13} /><span>Tentar de novo</span></button>
      </div>
    );
  }
}

/**
 * Separa o caminho de um recente em servidor (caminho de rede \\host\...) e pasta, sem o nome do arquivo — o servidor
 * é o que diferencia dois server.log iguais de máquinas diferentes, então ganha coluna própria.
 */
function splitPath(r) {
  let p = String(r.path || '');
  let host = null;
  const unc = /^[\\/]{2}([^\\/]+)[\\/]?(.*)$/.exec(p);
  if (unc) { host = unc[1]; p = unc[2]; }
  if (r.kind !== 'folder') p = p.replace(/[\\/][^\\/]*$/, '');
  return { host, dir: p };
}

function Start({ recents, onCancel, onOpen, onPickFile, onPickFolder, onForget }) {
  return (
    <div className="lg-start">
      <header className="lg-start__head">
        <span className="lg-start__icon"><Icon name="scroll-text" size={20} /></span>
        <div className="lg-start__intro">
          <b>Abra um log</b>
          <span>Arraste um arquivo ou pasta para cá. O Devkit detecta o formato (Fluig/JBoss, JSON por linha, IIS, Nginx/Apache, texto com data), junta stack traces numa entrada só, agrupa os erros repetidos e acompanha o arquivo ao vivo.</span>
        </div>
        <div className="lg-start__acts">
          <button type="button" className="lg-btn is-primary is-lg" onClick={onPickFile}><Icon name="file-text" size={15} /><span>Abrir arquivo</span></button>
          <button type="button" className="lg-btn is-lg" onClick={onPickFolder} title="Junta os arquivos rotacionados (server.log, server.log.2026-10-10, app.log.1, .gz…)"><Icon name="folder-open" size={15} /><span>Abrir pasta de logs</span></button>
          {onCancel && <button type="button" className="lg-btn is-lg" onClick={onCancel}><Icon name="x" size={15} /><span>Voltar ao log</span></button>}
        </div>
      </header>
      {recents.length > 0 && (
        <section className="lg-recents">
          <span className="home-section__title">Recentes</span>
          <div className="lg-recents__list">
            {recents.map((r) => {
              const { host, dir } = splitPath(r);
              return (
                <div key={keyOf(r)} className="lg-recents__row">
                  <button type="button" className="lg-recents__main" onClick={() => onOpen(r)} title={r.path}>
                    <Icon name={r.kind === 'folder' ? 'folder-open' : 'file-text'} size={14} />
                    <span className="lg-recents__name">{r.name}</span>
                    <span>{host ? <span className="lg-recents__host" title={`Servidor ${host}`}>{host}</span> : <span className="lg-recents__local">local</span>}</span>
                    {/* rtl corta o começo da pasta com "…"; o bdi mantém a ordem do texto (senão o \ do início ia para o fim). */}
                    <span className="lg-recents__dir"><bdi dir="ltr">{dir}</bdi></span>
                    <span className="lg-recents__when">{ago(r.at)}</span>
                  </button>
                  <button type="button" className="lg-icon lg-recents__rm" title="Tirar dos recentes" aria-label={`Tirar ${r.name} dos recentes`} onClick={() => onForget(r.path)}><Icon name="x" size={13} /></button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="lg-start__tips">
        <span><Icon name="keyboard" size={12} /> n / N pulam para o próximo/anterior erro · Ctrl+F filtra</span>
        <span><Icon name="shield" size={12} /> Tudo é lido nesta máquina; só vai para a IA o que você pedir, sem senhas e tokens.</span>
      </div>
    </div>
  );
}

export function LogsScreen({ toast, request }) {
  const api = logsApi();
  const [sources, setSources] = React.useState(null); // [info]
  const [ui, setUi] = usePersisted('logs.ui', { active: null });
  const [views, setViews] = usePersisted('logs.views', {}); // chave do caminho → { q, levels, range, tab, tlMode }
  const [recents, setRecents] = React.useState([]);
  const [presets, setPresets] = React.useState([]);
  // Investigações (modo Investigação): a lista inteira é salva com um pequeno atraso, por causa das anotações digitadas.
  const [cases, setCases] = React.useState([]);
  const [caseUi, setCaseUi] = usePersisted('logs.case', { active: null });
  const casesRef = React.useRef([]);
  const saveT = React.useRef(null);
  const removedRef = React.useRef(new Set()); // ids excluídos aqui e ainda não avisados ao processo principal
  const saveCases = () => {
    clearTimeout(saveT.current); saveT.current = null;
    const removed = [...removedRef.current];
    removedRef.current = new Set();
    // o processo principal mescla com o que as outras janelas gravaram (e avisa todas por `logs:changed`)
    api.saveInvestigations(casesRef.current, removed).catch((e) => {
      for (const id of removed) removedRef.current.add(id);
      toast('Não foi possível salvar a investigação', errText(e), 'error');
    });
  };
  const loadCases = () => api.investigations().then((l) => { if (!saveT.current) { casesRef.current = l; setCases(l); } }, () => {});
  const updateCases = (fn) => {
    const next = typeof fn === 'function' ? fn(casesRef.current) : fn;
    const keep = new Set(next.map((x) => x.id));
    for (const x of casesRef.current) if (!keep.has(x.id)) removedRef.current.add(x.id);
    casesRef.current = next;
    setCases(next);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(saveCases, 400);
  };
  React.useEffect(() => () => { if (saveT.current) saveCases(); }, []);
  // Aberturas em andamento — várias ao mesmo tempo: req (marca desta tela) → { id, name, key, done, total, n }.
  // O `id` do processo principal chega no evento 'opening'; até lá a entrada já aparece como aba "lendo…".
  const [opening, setOpening] = React.useState({});
  const openingRef = React.useRef({});
  const patchOpening = (fn) => { openingRef.current = fn(openingRef.current); setOpening(openingRef.current); };
  const dropOpening = (req) => patchOpening((o) => { if (!o[req]) return o; const n = { ...o }; delete n[req]; return n; });
  // Abertura que a pessoa está acompanhando no palco (o cartão de progresso). Ao terminar, só ela vira a aba ativa;
  // as outras terminam em segundo plano, sem tirar a pessoa do log que está lendo.
  const [watching, setWatchingState] = React.useState(null);
  const watchingRef = React.useRef(null);
  const watch = (req) => { watchingRef.current = req; setWatchingState(req); };
  const reqSeq = React.useRef(0);
  const sourcesRef = React.useRef(null);
  sourcesRef.current = sources;
  const [adding, setAdding] = React.useState(false); // "+" da barra: mostra a tela inicial (com recentes) em vez do explorador
  const [drag, setDrag] = React.useState(false);
  const openedAt = React.useRef({});
  const handled = React.useRef(null);

  const refreshRecents = () => api.recents().then(setRecents, () => {});

  // O intervalo de tempo não volta de outra sessão (o log pode ser outro); filtros e aba voltam. Guarda até 40 logs.
  React.useEffect(() => {
    setViews((v) => Object.fromEntries(Object.entries(v).slice(-40).map(([k, s]) => [k, { ...s, range: null }])));
  }, []);

  // Volta para os logs que continuam abertos no processo principal.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.list();
        const infos = [];
        for (const s of list) {
          try { infos.push({ ...(await api.info({ id: s.id })), ...s }); } catch { /* fechado */ }
          if (!openedAt.current[s.id]) openedAt.current[s.id] = Date.now();
        }
        if (alive) setSources(infos);
      } catch (e) { if (alive) { setSources([]); toast('Logs', errText(e), 'error'); } }
    })();
    refreshRecents();
    api.presets().then(setPresets, () => {});
    loadCases();
    const off = api.onChanged((evt) => {
      if (!evt) return;
      // Só as aberturas pedidas por esta tela (com `req`); reaberturas de um log já aberto não viram aba "lendo…".
      if (evt.type === 'opening') patchOpening((o) => (evt.req && o[evt.req] ? { ...o, [evt.req]: { ...o[evt.req], id: evt.id, name: evt.name } } : o));
      else if (evt.type === 'progress') {
        patchOpening((o) => {
          const req = Object.keys(o).find((k) => o[k].id === evt.id);
          return req ? { ...o, [req]: { ...o[req], done: evt.done, total: evt.total, n: evt.n } } : o;
        });
      // 'opened' chega antes da resposta de api.open: quem tira a entrada é o doOpen, junto com a aba nova (sem piscar).
      } else if (evt.type === 'investigations') loadCases(); // outra janela (ou esta mesma) gravou: pega a versão mesclada
      else if (evt.type === 'crashed') { setSources([]); patchOpening(() => ({})); watch(null); toast('O leitor de logs parou', 'Provavelmente faltou memória com um arquivo enorme. Abra de novo.', 'error'); }
    });
    return () => { alive = false; off(); };
  }, []);

  const doOpen = async (spec) => {
    const key = keyOf(spec);
    const existing = (sourcesRef.current || []).find((s) => keyOf(s.spec) === key);
    if (existing) { setUi((u) => ({ ...u, active: existing.id })); setAdding(false); watch(null); return; }
    // O mesmo log já está sendo lido: só mostra o progresso dele.
    const inflight = Object.keys(openingRef.current).find((k) => openingRef.current[k].key === key);
    if (inflight) { setAdding(false); watch(inflight); return; }
    const req = 'r' + (++reqSeq.current);
    patchOpening((o) => ({ ...o, [req]: { id: null, name: String(spec.path).split(/[\\/]/).filter(Boolean).pop() || spec.path, key, done: 0, total: 0 } }));
    setAdding(false);
    watch(req);
    try {
      const info = await api.open({ ...spec, req });
      openedAt.current[info.id] = Date.now();
      const hadActive = (sourcesRef.current || []).length > 0;
      setSources((s) => [...(s || []).filter((x) => x.id !== info.id), info]);
      if (watchingRef.current === req || !hadActive) {
        setUi((u) => ({ ...u, active: info.id }));
      } else {
        // A pessoa foi ler outro log (ou abrir mais um) enquanto este carregava: não tira ela de lá.
        toast('Log pronto', `${String(info.name).split(/[\\/]/).pop()} já pode ser lido — está nas abas.`, 'ok');
      }
      refreshRecents();
      if (info.truncated) toast('Arquivo grande', 'Abrindo só o final (1,5 GB) para caber na memória.', 'ok');
    } catch (e) {
      toast('Não foi possível abrir', errText(e), 'error');
    } finally {
      dropOpening(req);
      if (watchingRef.current === req) watch(null);
    }
  };
  const pickFile = async () => { const p = await api.pickFile(); if (p) doOpen({ kind: 'file', path: p }); };
  const pickFolder = async () => { const p = await api.pickFolder(); if (p) doOpen({ kind: 'folder', path: p }); };
  const close = async (id) => {
    await api.close(id).catch(() => {});
    setSources((s) => {
      const next = (s || []).filter((x) => x.id !== id);
      if (ui.active === id) setUi((u) => ({ ...u, active: next.length ? next[next.length - 1].id : null }));
      return next;
    });
  };
  const savePresets = async (list) => { try { setPresets(await api.savePresets(list)); } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } };

  // Pedidos da palette / Início: { action: 'openFile'|'openFolder'|'open', spec }.
  React.useEffect(() => {
    if (!request || !sources || handled.current === request.nonce) return;
    handled.current = request.nonce;
    if (request.action === 'openFile') pickFile();
    else if (request.action === 'openFolder') pickFolder();
    else if (request.action === 'open' && request.spec) doOpen(request.spec);
    else if (request.action === 'show' && request.id) { setAdding(false); watch(null); setUi((u) => ({ ...u, active: request.id })); }
  }, [request && request.nonce, !!sources]);

  // Arrastar e soltar arquivo/pasta.
  const onDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f && api.pathOf(f);
    if (!p) return;
    doOpen({ kind: 'auto', path: p }); // arquivo ou pasta: o serviço decide pelo disco
  };

  const active = sources && (sources.find((s) => s.id === ui.active) || sources[sources.length - 1]);
  const pending = Object.entries(opening);
  const watched = (watching && opening[watching]) || null;

  return (
    <div className={'lg' + (drag ? ' is-drag' : '')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={onDrop}>
      {sources && (sources.length > 0 || pending.length > 0) && (
        <nav className="lg-srcs" role="tablist" aria-label="Logs abertos">
          {sources.map((s) => (
            <SourceTab key={s.id} s={s} active={!!active && active.id === s.id && !watched} onClick={() => { setAdding(false); watch(null); setUi((u) => ({ ...u, active: s.id })); }} onClose={() => close(s.id)} />
          ))}
          {pending.filter(([, o]) => !(o.id && sources.some((s) => s.id === o.id))).map(([req, o]) => (
            <span key={req} className={'lg-src is-opening' + (watching === req && !adding ? ' is-on' : '')} role="tab" aria-selected={watching === req && !adding}>
              <button type="button" className="lg-src__main" onClick={() => { setAdding(false); watch(req); }} title={`Lendo ${o.name} — ver o progresso`}>
                <Spinner size={11} /><span className="lg-src__name">{o.name}</span>
                <small>{o.total ? `${Math.round((o.done / o.total) * 100)}%` : 'lendo…'}{o.n ? ` · ${fmtNum(o.n)}` : ''}</small>
              </button>
            </span>
          ))}
          <button type="button" className={'lg-src is-add' + (adding ? ' is-on' : '')} onClick={() => { refreshRecents(); watch(null); setAdding(true); }} title="Abrir outro log" aria-label="Abrir outro log"><Icon name="plus" size={14} /></button>
        </nav>
      )}
      <div className="lg-stage">
        {!sources ? <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>
          : (adding || (!active && !pending.length)) ? (
            <Start recents={recents} onCancel={active ? () => setAdding(false) : null} onOpen={(r) => doOpen({ kind: r.kind, path: r.path, family: r.family })} onPickFile={pickFile} onPickFolder={pickFolder}
              onForget={async (p) => setRecents(await api.forgetRecent(p))} />
          ) : (watched || !active) ? (
            <OpeningCard o={watched || pending[0][1]} />
          ) : (
            <Boundary resetKey={active.id}>
              <LogView key={active.id} src={active} toast={toast} openedAt={openedAt.current[active.id] || Date.now()}
                state={views[keyOf(active.spec)] || {}}
                setState={(fn) => setViews((v) => { const k = keyOf(active.spec); const cur = v[k] || {}; const next = typeof fn === 'function' ? fn(cur) : fn; return { ...v, [k]: { ...next, range: next.range || null } }; })}
                presets={presets} onPresets={savePresets}
                cases={cases} onCases={updateCases} activeCase={caseUi.active} onActiveCase={(id) => setCaseUi({ ...caseUi, active: id })}
                onInfo={(info) => setSources((list) => list.map((x) => (x.id === info.id ? { ...x, ...info } : x)))}
                onClose={() => close(active.id)} />
            </Boundary>
          )}
        {drag && <div className="lg-drop"><Icon name="file-down" size={28} /><b>Solte para abrir</b><span>arquivo de log ou pasta com os rotacionados</span></div>}
      </div>
    </div>
  );
}

function OpeningCard({ o }) {
  const pct = o.total ? Math.round((o.done / o.total) * 100) : 0;
  return (
    <div className="lg-empty">
      <Spinner size={20} />
      <b>Lendo {o.name}…</b>
      <span>{o.total ? `${pct}% de ${fmtBytes(o.total)}` : 'começando'}{o.n ? ` · ${fmtNum(o.n)} entradas` : ''}</span>
      <div className="lg-progress"><span style={{ width: pct + '%' }} /></div>
    </div>
  );
}

function SourceTab({ s, active, onClick, onClose }) {
  const errs = s.levelTotals ? s.levelTotals[5] + s.levelTotals[6] : 0;
  return (
    <span className={'lg-src' + (active ? ' is-on' : '')} role="tab" aria-selected={active}>
      <button type="button" className="lg-src__main" onClick={onClick} title={s.files ? s.files.map((f) => f.path).join('\n') : s.name}>
        {s.live ? <span className="lg-live__dot is-on" title="Ao vivo" /> : <Icon name={s.spec && s.spec.kind === 'folder' ? 'folder' : 'file-text'} size={12} />}
        <span className="lg-src__name">{String(s.name).split(/[\\/]/).pop()}</span>
        {errs > 0 && <span className="lg-src__err" title={`${errs} erros`}>{errs > 999 ? '999+' : errs}</span>}
      </button>
      <button type="button" className="lg-src__x" onClick={onClose} title="Fechar" aria-label={`Fechar ${s.name}`}><Icon name="x" size={12} /></button>
    </span>
  );
}
