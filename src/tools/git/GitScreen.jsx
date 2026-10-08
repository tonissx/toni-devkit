// Git — ferramenta visual para repositórios locais. Lista de repositórios à esquerda; à direita, o repositório aberto
// em abas (Visão geral, Mudanças, Histórico, Branches, Stash, Máquina do tempo). Toda ação passa por run(): mostra o
// comando, pede confirmação quando reescreve/descarta, executa e deixa na barra de baixo o comando que rodou, a
// explicação e o Desfazer (pelo ponto de volta). Nada de rede: só o que está no disco.
import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { RISK_LABEL } from '../../git/ops.js';
import { gitApi, useRepoData, errText, preview, RiskBadge, OpButton } from './shared.jsx';
import { Overview } from './Overview.jsx';
import { Changes } from './Changes.jsx';
import { History } from './History.jsx';
import { Branches } from './Branches.jsx';
import { Stash } from './Stash.jsx';
import { TimeMachine } from './TimeMachine.jsx';
import { Rebase } from './Rebase.jsx';
import { Recipes } from './Recipes.jsx';
import { MergeModal } from './Merge.jsx';
import { Investigate } from './Investigate.jsx';
import { Maintenance } from './Maintenance.jsx';
import { emit } from '../../lib/events.js';

const { Icon, Spinner, Tabs, Modal, Button, EmptyState, Checkbox } = DS;

const PANELS = { overview: Overview, changes: Changes, history: History, branches: Branches, stash: Stash, rebase: Rebase, investigate: Investigate, maintenance: Maintenance, time: TimeMachine, recipes: Recipes };

/* ─────────────── Repositórios ─────────────── */

function AddModal({ found, onClose, onAdd }) {
  const [pick, setPick] = React.useState(() => new Set(found));
  const toggle = (f) => setPick((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  return (
    <Modal title="Repositórios encontrados" icon="folder-search" onClose={onClose} width={560}
      description={found.length ? 'Escolha os que quer acompanhar no Devkit.' : 'Nenhum repositório novo encontrado nessas pastas.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!pick.size} onClick={() => onAdd([...pick])}>Adicionar {pick.size || ''}</Button></>}>
      <div className="gt-found tk-scroll">
        {found.map((f) => <Checkbox key={f} label={<span className="gt-found__item"><b>{f.split(/[\\/]/).pop()}</b><small>{f}</small></span>} checked={pick.has(f)} onChange={() => toggle(f)} />)}
      </div>
    </Modal>
  );
}

/** "Antonio Gonçalves" / "toni-devkit" -> "AG" / "TD": a sigla do repositório na rail recolhida. */
const repoInitials = (name) => {
  const p = String(name || '?').split(/[\s._-]+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase();
};

function RepoRail({ repos, current, collapsed, onToggle, onOpen, onAddDone, onRemove, toast }) {
  const [busy, setBusy] = React.useState(false);
  const [found, setFound] = React.useState(null);
  const [menu, setMenu] = React.useState(false);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const api = gitApi();
  const addFolder = async () => {
    const dir = await api.pick();
    if (!dir) return;
    setBusy(true);
    try { const top = await api.add(dir); onAddDone(top); }
    catch {
      // Não é um repositório: procura repositórios dentro da pasta.
      try { setFound(await api.scan(dir, 3)); } catch (e) { toast('Não foi possível adicionar', errText(e), 'error'); }
    } finally { setBusy(false); }
  };
  const scan = async () => { setBusy(true); try { setFound(await api.scanDefault()); } catch (e) { toast('Não foi possível procurar', errText(e), 'error'); } finally { setBusy(false); } };
  const addMany = async (list) => {
    setFound(null);
    let last = null;
    for (const f of list) { try { last = await api.add(f); } catch (e) { toast('Não foi possível adicionar', `${f}: ${errText(e)}`, 'error'); } }
    if (last) onAddDone(last);
  };
  return (
    <aside className={'gt-rail' + (collapsed ? ' is-collapsed' : '')}>
      <div className="gt-rail__head">
        {!collapsed && <span className="home-section__title">Repositórios</span>}
        {!collapsed && busy && <Spinner size={12} />}
        <span className="gt-rail__tools" ref={menuRef}>
          <button type="button" className="gt-rail__btn" title="Adicionar repositório" aria-label="Adicionar repositório" aria-expanded={menu} onClick={() => setMenu((v) => !v)} disabled={busy}><Icon name="plus" size={14} /></button>
          <button type="button" className="gt-rail__btn" title={collapsed ? 'Expandir a lista de repositórios' : 'Recolher a lista de repositórios'} aria-label={collapsed ? 'Expandir a lista de repositórios' : 'Recolher a lista de repositórios'} onClick={onToggle}><Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={14} /></button>
          {menu && (
            <div className="gt-rail__menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); addFolder(); }}><Icon name="folder-plus" size={14} /><span>Adicionar pasta</span></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); scan(); }} title="Procura repositórios em Documentos, source\repos e na pasta do usuário"><Icon name="folder-search" size={14} /><span>Procurar no PC</span></button>
            </div>
          )}
        </span>
      </div>
      <div className="gt-rail__list tk-scroll">
        {repos && repos.map((r) => (
          <div key={r.path} className="gt-repo-wrap">
            <button type="button" className={'gt-repo' + (r.path === current ? ' is-sel' : '')} onClick={() => onOpen(r.path)}
              title={collapsed ? `${r.name} — ${r.error || (r.detached ? 'HEAD solto' : r.branch || '—')}${r.conflicts > 0 ? ` · ${r.conflicts} em conflito` : r.changes > 0 ? ` · ${r.changes} mudança(s)` : ''}\n${r.path}` : r.path}
              aria-label={collapsed ? r.name : undefined}>
              {collapsed ? <span className="gt-repo__abbr">{repoInitials(r.name)}</span> : <Icon name="folder-git-2" size={15} />}
              <span className="gt-repo__main">
                <span className="gt-repo__name">{r.name}</span>
                <span className="gt-repo__branch">{r.error ? <span className="gt-err">{r.error}</span> : <><Icon name="git-branch" size={10} /> {r.detached ? 'HEAD solto' : r.branch || '—'}{r.operation ? ` · ${r.operation} em andamento` : ''}</>}</span>
              </span>
              {r.conflicts > 0 ? <span className="gt-repo__badge is-conf" title="Arquivos em conflito">{r.conflicts}</span>
                : r.changes > 0 ? <span className="gt-repo__badge" title="Mudanças pendentes">{r.changes}</span> : null}
            </button>
            <button type="button" className="gt-repo__rm" title="Remover da lista (não apaga nada do disco)" aria-label={`Remover ${r.name} da lista`} onClick={() => onRemove(r)}><Icon name="x" size={13} /></button>
          </div>
        ))}
        {repos && !repos.length && <div className="gt-msg">Nenhum repositório ainda.</div>}
      </div>
      {found && <AddModal found={found} onClose={() => setFound(null)} onAdd={addMany} />}
    </aside>
  );
}

/** Um erro numa aba não derruba o Devkit: mostra a mensagem e deixa tentar de novo. */
class TabBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="gt-msg is-error">
        Algo deu errado nesta aba: {String(this.state.error.message || this.state.error)}
        <button type="button" className="gt-op is-ghost is-sm" onClick={() => this.setState({ error: null })}><span>Tentar de novo</span></button>
      </div>
    );
  }
}

/* ─────────────── Confirmação e última ação ─────────────── */

function ConfirmModal({ c, onClose }) {
  const p = c.p;
  const danger = p.risk === 'discard';
  return (
    <Modal title={p.title} icon={danger ? 'triangle-alert' : 'history'} onClose={() => onClose(false)} width={540}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant={danger ? 'destructive' : 'primary'} autoFocus onClick={() => onClose(true)}>{p.title}</Button></>}>
      <div className="gt-confirm">
        <RiskBadge risk={p.risk} />
        <p>{p.explain}</p>
        <div className="gt-confirm__cmd"><span>Comando equivalente</span><code>{p.display}</code></div>
        {p.backup && <p className="gt-confirm__safe"><Icon name="shield-check" size={14} /> O Devkit guarda um ponto de volta antes — dá para desfazer pela barra de baixo ou pela Máquina do tempo.</p>}
      </div>
    </Modal>
  );
}

function LastAction({ last, onUndo, onClose }) {
  const [why, setWhy] = React.useState(false);
  React.useEffect(() => setWhy(false), [last]);
  if (!last) return (
    <div className="gt-last-bar is-idle"><Icon name="graduation-cap" size={14} /> Passe o mouse sobre qualquer ação para ver o comando git equivalente. Depois de executar, ele aparece aqui.</div>
  );
  return (
    <div className={'gt-last-bar' + (last.error ? ' is-error' : ' is-' + (last.risk || 'safe'))}>
      <Icon name={last.error ? 'circle-x' : 'circle-check'} size={15} />
      <b>{last.title}</b>
      {last.display && <code className="gt-last-bar__cmd" title="Copiar" onClick={() => window.devkit.clipboard.write(last.display)}>{last.display}</code>}
      {last.error && <span className="gt-last-bar__err">{last.error}</span>}
      {last.message && <span>{last.message}</span>}
      {last.stopped && <span className="gt-last-bar__stop">{last.stopped}</span>}
      <span className="gt-last-bar__spacer" />
      {last.explain && <button type="button" className="gt-op is-ghost is-sm" onClick={() => setWhy((v) => !v)}><Icon name="circle-help" size={13} /><span>O que isso fez?</span></button>}
      {last.backup && <button type="button" className="gt-op is-accent is-sm" onClick={() => onUndo(last.backup)}><Icon name="undo-2" size={13} /><span>Desfazer</span></button>}
      <button type="button" className="gt-op is-ghost is-sm" aria-label="Fechar" onClick={onClose}><Icon name="x" size={13} /></button>
      {why && <div className="gt-last-bar__why">{last.explain}{last.risk && last.risk !== 'safe' ? ` (${RISK_LABEL[last.risk]})` : ''}</div>}
    </div>
  );
}

/* ─────────────── Tela ─────────────── */

export function GitScreen({ toast, request }) {
  const api = gitApi();
  const [ver, setVer] = React.useState(null);
  const [repos, setRepos] = React.useState(null);
  const [ui, setUi] = usePersisted('git.ui', { tab: 'overview', repo: null });
  const [last, setLast] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null);
  const [focus, setFocus] = React.useState(null); // pedido para a aba aberta: { hash } · { amend } · { squash } · { recipe } + nonce
  const [merging, setMerging] = React.useState(null); // branch sendo mesclada (painel com prévia)
  const repo = repos && repos.some((r) => r.path === ui.repo) ? ui.repo : repos && repos[0] ? repos[0].path : null;
  // Recolhida por escolha da pessoa (lembrada); sem escolha ainda, nasce recolhida só em janela estreita.
  const railCollapsed = ui.rail ? ui.rail === 'collapsed' : window.innerWidth < 1100;

  const loadRepos = React.useCallback(() => api.summaries().then(setRepos, () => setRepos([])), []);
  const removeRepo = async (r) => {
    try {
      await api.remove(r.path);
      setUi((u) => (u.repo === r.path ? { ...u, repo: null } : u));
      loadRepos();
      toast('Removido da lista', `${r.name} — nada foi apagado do disco. Dá para adicionar de novo quando quiser.`);
    } catch (e) { toast('Não foi possível remover', errText(e), 'error'); }
  };
  React.useEffect(() => {
    api.version().then(setVer);
    loadRepos();
    let t = null;
    const off = api.onChanged(() => { clearTimeout(t); t = setTimeout(loadRepos, 300); });
    return () => { off(); clearTimeout(t); };
  }, []);
  React.useEffect(() => { if (repo) api.open(repo).catch(() => {}); setLast(null); }, [repo]);
  // Pedido de fora (Início, palette): repositório e/ou aba.
  React.useEffect(() => {
    if (!request) return;
    setUi((u) => ({ ...u, ...(request.tab ? { tab: request.tab } : {}), ...(request.repo ? { repo: request.repo } : {}) }));
    if (request.recipe) setFocus({ recipe: request.recipe, nonce: Date.now() });
  }, [request && request.nonce]);

  const status = useRepoData(repo, (r) => api.status(r));
  const s = status.data && status.data.path === repo ? status.data : null;

  const go = (tab, opts) => { setUi((u) => ({ ...u, tab })); if (opts) setFocus({ ...opts, nonce: Date.now() }); };

  /** Executa uma operação: confirma se arriscada, roda, registra o resultado. Resolve true se deu certo. */
  const run = React.useCallback(async (op, opts = {}) => {
    const p = preview(op, { unborn: s && s.unborn });
    if (p.error) { toast('Não dá para fazer isso', p.error, 'error'); return false; }
    if (p.risk !== 'safe' && !opts.confirmed) {
      const ok = await new Promise((resolve) => setConfirm({ p, resolve }));
      if (!ok) return false;
    }
    try {
      const r = await api.exec(repo, op);
      emit('tool.used', { tool: 'git' }); // DevCore: uso da ferramenta (o bus limita a 1×/min)
      if (r.stopped) {
        // Parou em conflito: não é erro — leva para Mudanças, onde está o editor de conflitos.
        setLast({ title: r.title, display: r.display, risk: r.risk, explain: p.explain, backup: r.backup, stopped: `O ${r.operation || 'git'} parou: ${r.conflicts} arquivo(s) em conflito. Resolva em Mudanças e use Continuar — ou Cancelar para voltar como estava.` });
        setUi((u) => ({ ...u, tab: 'changes' }));
        return true;
      }
      // Feito em parte (ex.: uma das branches estava em uso): mostra o que ficou e por quê.
      setLast({ title: r.title, display: r.display, risk: r.risk, explain: p.explain, backup: r.backup, stopped: r.warning || undefined });
      return true;
    } catch (e) {
      setLast({ title: p.title, display: p.display, error: errText(e), explain: p.explain });
      return false;
    }
  }, [repo, s && s.unborn]);

  const undo = async (id) => {
    try {
      const r = await api.restoreBackup(repo, id);
      setLast({ title: 'Desfeito', message: r.message, risk: 'safe' });
    } catch (e) { setLast({ title: 'Não foi possível desfazer', error: errText(e) }); }
  };
  // Fetch/pull/push demoram (rede): trava os botões de rede enquanto uma está em andamento.
  const [netBusy, setNetBusy] = React.useState(null);
  const net = React.useCallback(async (op) => {
    setNetBusy(op.op);
    try { return await run(op); } finally { setNetBusy(null); }
  }, [run]);

  // Sem upstream: "Publicar branch" cria a branch no remoto (push -u). Sem remoto nenhum, não há o que enviar.
  const pushOp = s && (s.branch.upstream ? { op: 'push' } : s.remote && s.branch.head ? { op: 'push', setUpstream: true, remote: s.remote, branch: s.branch.head } : null);
  const pushWhy = !s ? '' : netBusy ? 'Aguarde a operação em andamento' : !pushOp ? 'Este repositório não tem remoto — adicione um com git remote add' : s.branch.behind > 0 ? 'O remoto tem commits novos: receba antes de enviar' : '';

  if (ver && !ver.available) {
    return <EmptyState title="Git não encontrado" animate="none"
      description="Esta ferramenta usa o Git instalado no computador. Instale o Git para Windows (git-scm.com/download/win), reabra o Devkit e pronto." />;
  }

  const counts = s ? { changes: s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length, stash: s.stashes } : {};
  // Ícones só quando a área é larga o bastante (container query em git.css); na janela estreita ficam só os textos.
  const tabs = [
    { value: 'overview', label: 'Visão geral', icon: 'layout-dashboard' },
    { value: 'recipes', label: 'Quero…', icon: 'sparkles' },
    { value: 'changes', label: 'Mudanças', icon: 'file-diff', count: counts.changes || undefined },
    { value: 'history', label: 'Histórico', icon: 'git-commit-horizontal' },
    { value: 'branches', label: 'Branches', icon: 'git-branch' },
    { value: 'stash', label: 'Stash', icon: 'archive', count: counts.stash || undefined },
    { value: 'rebase', label: 'Reorganizar', icon: 'list-ordered' },
    { value: 'investigate', label: 'Investigar', icon: 'search-code' },
    { value: 'maintenance', label: 'Manutenção', icon: 'wrench' },
    { value: 'time', label: 'Máquina do tempo', icon: 'life-buoy' },
  ];
  const props = { repo, status: s, run, go, undo, focus, openMerge: setMerging, toast };
  const Panel = PANELS[ui.tab] || Overview;

  return (
    <div className="gt">
      <RepoRail repos={repos} current={repo} collapsed={railCollapsed} onToggle={() => setUi((u) => ({ ...u, rail: railCollapsed ? 'open' : 'collapsed' }))} onOpen={(p) => setUi((u) => ({ ...u, repo: p }))} onAddDone={(p) => { setUi((u) => ({ ...u, repo: p, tab: 'overview' })); loadRepos(); }} onRemove={removeRepo} toast={toast} />
      <div className="gt-main">
        {!repos ? <div className="gt-msg"><Spinner size={14} /> Carregando…</div>
          : !repo ? (
            <EmptyState title="Adicione um repositório" animate="none"
              description="Escolha a pasta de um projeto com git (ou uma pasta que tenha vários) e o Devkit mostra o histórico, as mudanças e as branches — e faz as operações mais chatas com um clique, sempre com um jeito de desfazer." />
          ) : (
            <>
              <header className="gt-head">
                <div className="gt-head__title">
                  <Icon name="folder-git-2" size={18} />
                  <b>{repos.find((r) => r.path === repo).name}</b>
                  {s && (
                    <button type="button" className="gt-branchchip" onClick={() => go('branches')} title="Branch atual — clique para ver as branches">
                      <Icon name="git-branch" size={12} /> {s.branch.detached ? `HEAD solto em ${String(s.branch.oid).slice(0, 7)}` : s.branch.head}
                    </button>
                  )}
                </div>
                <div className="gt-head__actions">
                  {s && (
                    <div className="gt-sync">
                      <OpButton op={{ op: 'fetch' }} run={net} icon="refresh-cw" disabled={!!netBusy} className={netBusy === 'fetch' ? 'is-busy' : ''}>Buscar</OpButton>
                      {!s.branch.detached && (
                        <>
                          <OpButton op={{ op: 'pull' }} run={net} icon="arrow-down-to-line" disabled={!!netBusy || !s.branch.upstream}
                            className={(s.branch.behind ? 'is-pending ' : '') + (netBusy === 'pull' ? 'is-busy' : '')}>{s.branch.behind ? `Receber ↓${s.branch.behind}` : 'Receber'}</OpButton>
                          <OpButton op={pushOp} run={net} icon="arrow-up-from-line" disabled={!!netBusy || !pushOp || s.branch.behind > 0} reason={pushWhy}
                            className={(s.branch.ahead || !s.branch.upstream ? 'is-pending ' : '') + (netBusy === 'push' ? 'is-busy' : '')}>{s.branch.ahead ? `Enviar ↑${s.branch.ahead}` : s.branch.upstream ? 'Enviar' : 'Publicar branch'}</OpButton>
                          {s.branch.upstream && s.branch.ahead > 0 && s.branch.behind > 0 && (
                            <>
                              <OpButton op={{ op: 'pull', mode: 'merge' }} run={net} icon="git-merge" disabled={!!netBusy}>Receber com merge</OpButton>
                              <OpButton op={{ op: 'push', force: true }} run={net} icon="triangle-alert" variant="danger" disabled={!!netBusy}>Enviar à força</OpButton>
                            </>
                          )}
                        </>
                      )}
                                          </div>
                  )}
                  <button type="button" className="gt-op is-ghost is-sm" title="Abrir no Explorer" onClick={() => api.openIn(repo, 'explorer')}><Icon name="folder-open" size={14} /></button>
                  <button type="button" className="gt-op is-ghost is-sm" title="Abrir no VS Code" onClick={() => api.openIn(repo, 'vscode')}><Icon name="code" size={14} /></button>
                  <button type="button" className="gt-op is-ghost is-sm" title="Abrir um terminal na pasta" onClick={() => api.openIn(repo, 'terminal')}><Icon name="terminal" size={14} /></button>
                  <button type="button" className="gt-op is-ghost is-sm" title="Remover da lista (não apaga nada do disco)" onClick={() => removeRepo(repos.find((r) => r.path === repo))}><Icon name="x" size={14} /><span>Remover</span></button>
                </div>
              </header>
              {s && s.operation && (
                <div className="gt-opalert">
                  <Icon name="triangle-alert" size={14} />
                  {s.operation === 'bisect'
                    ? <span>Há uma <b>caça ao commit do bug (bisect)</b> em andamento — os arquivos estão numa versão antiga. Responda em Investigar.</span>
                    : <span>Há um <b>{s.operation}</b> em andamento. {s.conflicts.length ? `${s.conflicts.length} arquivo(s) em conflito — resolva em Mudanças e depois continue.` : 'Conflitos resolvidos — é só continuar.'}</span>}
                  {s.operation === 'bisect' && ui.tab !== 'investigate' && <button type="button" className="gt-op is-accent is-sm" onClick={() => go('investigate')}><Icon name="search-code" size={13} /><span>Ir para Investigar</span></button>}
                  {s.operation !== 'bisect' && <>
                    {!s.conflicts.length && <OpButton op={{ op: 'continue', operation: s.operation }} run={run} icon="play" variant="accent">Continuar</OpButton>}
                    {s.conflicts.length > 0 && ui.tab !== 'changes' && <button type="button" className="gt-op is-accent is-sm" onClick={() => go('changes')}><Icon name="file-diff" size={13} /><span>Resolver</span></button>}
                    <OpButton op={{ op: 'abort', operation: s.operation }} run={run} icon="x" variant="danger">Cancelar o {s.operation}</OpButton>
                  </>}
                </div>
              )}
              <Tabs items={tabs} value={ui.tab} onChange={(tab) => setUi((u) => ({ ...u, tab }))} className="gt-tabs" />
              <div className="gt-body">
                {status.error && !s ? <div className="gt-msg is-error">{status.error}</div>
                  : !s ? <div className="gt-msg"><Spinner size={14} /> Lendo o repositório…</div>
                    : <TabBoundary resetKey={repo + ':' + ui.tab}><Panel {...props} /></TabBoundary>}
              </div>
              <LastAction last={last} onUndo={undo} onClose={() => setLast(null)} />
            </>
          )}
      </div>
      {merging && s && <MergeModal repo={repo} branch={merging} current={s.branch.head || 'HEAD'} run={run} onClose={() => setMerging(null)} />}
      {confirm && <ConfirmModal c={confirm} onClose={(ok) => { confirm.resolve(ok); setConfirm(null); }} />}
    </div>
  );
}
