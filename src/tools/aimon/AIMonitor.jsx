// Monitor de IA — o que cada sessão de agente (Claude Code, Codex…) está fazendo agora. Só lê o que as ferramentas já
// gravam em disco (últimas 24 h); nada sai da máquina. À esquerda as sessões (subagentes aninhados), à direita a timeline.
// O acompanhamento só roda com a tela aberta (aimon:setActive).
import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { errText, fmtCompact, fmtNum, ago } from '../../lib/fmt.jsx';
import { Lanes, SCALES } from './Lanes.jsx';
import { Plans } from './Plans.jsx';
import { Changes } from './Changes.jsx';
import { SessionAi } from './SessionAi.jsx';
import { gitAlerts } from './alerts.js';
import { summarizeAgents, agentParts, isCollapsed } from './agents.js';

const { Icon, Spinner, EmptyState, SegmentedControl } = DS;

const api = () => window.devkit.aimon;

const STATUS = {
  working: { label: 'Trabalhando', icon: 'loader', tone: 'work', hint: 'Turno em andamento' },
  waiting: { label: 'Esperando', icon: 'hand', tone: 'wait', hint: 'Há uma ferramenta sem resultado e sem atividade — costuma ser aprovação pendente (heurística)' },
  idle: { label: 'Ocioso', icon: 'circle-check', tone: 'idle', hint: 'Turno terminado' },
  stale: { label: 'Sem sinal', icon: 'moon', tone: 'idle', hint: 'Turno aberto, mas sem atividade há mais de 10 min — a sessão provavelmente foi fechada' },
  error: { label: 'Erro', icon: 'circle-alert', tone: 'err', hint: 'A sessão parou por um erro (login expirado, limite de uso, servidor). Some quando houver nova atividade.' },
};
const TABS = [{ value: 'sessions', label: 'Sessões' }, { value: 'lanes', label: 'Raias' }, { value: 'plans', label: 'Planos' }];
const KINDS = [
  { v: 'prompt', label: 'Prompts', icon: 'message-square' },
  { v: 'text', label: 'Respostas', icon: 'bot' },
  { v: 'tool_use', label: 'Ferramentas', icon: 'wrench' },
  { v: 'thinking', label: 'Raciocínio', icon: 'brain' },
];
const KIND_ICON = { error: 'circle-alert', commit: 'git-commit-horizontal', prompt: 'message-square', text: 'bot', thinking: 'brain', tool_use: 'wrench', tool_result: 'corner-down-right', turn_start: 'play', turn_end: 'flag' };
const KIND_LABEL = { error: 'Erro', commit: 'Commit', prompt: 'Prompt', text: 'Resposta', thinking: 'Raciocínio', tool_use: 'Ferramenta', tool_result: 'Resultado', turn_start: 'Início do turno', turn_end: 'Fim do turno' };

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const projectOf = (s) => base(s.cwd) || s.project || 'Sem projeto';
const totalTokens = (t) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString('pt-BR') : '');

/** Ponto com anel que se expande: o "ao vivo" do Trabalhando (CSS puro; parado com movimento reduzido). */
function LiveDot() { return <span className="am-live" aria-hidden="true"><i /></span>; }

function StatusBadge({ s }) {
  const st = STATUS[s.status] || STATUS.idle;
  const hint = s.status === 'waiting' && s.statusSource === 'live' ? 'O próprio Claude Code informa que está esperando por você (permissão ou resposta).' : st.hint;
  return <span className={'am-status is-' + st.tone} title={hint}>{s.status === 'working' ? <LiveDot /> : <Icon name={st.icon} size={12} />}{st.label}</span>;
}

/** Subagente: uma linha compacta (estado com ícone + palavra, nome, quando, tokens). O que já está no pai não se repete. */
function AgentRow({ s, sel, onPick, tick, last }) {
  const st = STATUS[s.status] || STATUS.idle;
  const title = s.label || s.title || s.lastText || 'Subagente';
  return (
    <button type="button" className={'am-agent' + (sel ? ' is-sel' : '') + (last ? ' is-last' : '')} onClick={() => onPick(s.key)} data-tick={tick} title={`${title} — ${st.hint}`}>
      <span className={'am-agent__state is-' + st.tone}>{s.status === 'working' ? <LiveDot /> : <Icon name={st.icon} size={12} />}<span>{st.label}</span></span>
      <span className="am-agent__title am-priv">{title}</span>
      {s.status === 'error' && s.error && <span className="am-agent__err am-priv" title={s.error.message}>{s.error.message}</span>}
      {s.lastToolFailed && s.status !== 'error' && <span className="am-agent__warn" title="A última ferramenta falhou"><Icon name="triangle-alert" size={12} />falhou</span>}
      {s.repo && s.repo.worktree && <span className="lg-pill am-priv" title={`Worktree: ${s.repo.top}`}><Icon name="git-fork" size={10} />{s.repo.worktree}</span>}
      <span className="lg-muted">{ago(s.lastTs || s.mtime)}</span>
      <span className="lg-muted" title="Tokens (entrada + saída + cache)">{fmtCompact(totalTokens(s.tokens))} tok</span>
    </button>
  );
}

/** Sessão principal: o cabeçalho do cartão do grupo. `sum`: resumo dos subagentes (null se não tem). */
function SessionRow({ s, sel, onPick, tick, sum, collapsed, onToggle }) {
  const title = s.label || s.title || s.lastText || 'Sessão sem título';
  const row = (
    <button type="button" className={'am-session' + (sel ? ' is-sel' : '') + (sum ? ' has-agents' : '') + (s.status === 'working' ? ' is-working' : '')} onClick={() => onPick(s.key)} data-tick={tick}>
      <span className="am-session__top">
        <span className="am-session__title am-priv">{title}</span>
      </span>
      <span className="am-session__meta">
        <StatusBadge s={s} />
        <span className="lg-pill" title="Provedor">{s.provider}</span>
        {s.repo && <span className="lg-pill am-priv" title={s.repo.main}><Icon name="folder-git-2" size={10} />{s.repo.name}</span>}
        {s.repo && s.repo.worktree && <span className="lg-pill am-priv" title={`Worktree: ${s.repo.top}`}><Icon name="git-fork" size={10} />{s.repo.worktree}</span>}
        {s.branch && <span className="am-session__branch"><Icon name="git-branch" size={10} />{s.branch}</span>}
        <span className="lg-muted" title="Tokens (entrada + saída + cache)">{fmtCompact(totalTokens(s.tokens))} tok</span>
        <span className="lg-muted">{ago(s.lastTs || s.mtime)}</span>
      </span>
      {s.status === 'waiting' && s.waitingFor && <span className="am-session__wait am-priv"><Icon name="hand" size={12} />{s.waitingFor}</span>}
      {s.status === 'error' && s.error && <span className="am-session__err am-priv"><Icon name="circle-alert" size={12} />{s.error.message}</span>}
      {s.lastToolFailed && s.status !== 'error' && <span className="am-alert is-card is-soft" title="A última ferramenta falhou. O agente costuma tentar de novo; só chama atenção se a sessão parou aí."><Icon name="triangle-alert" size={11} />Última ferramenta falhou</span>}
      {s.repo && gitAlerts({ branch: s.repo.branch, dirty: s.dirty, active: s.status === 'working' || s.status === 'waiting' }).map((a) => <span key={a.id} className="am-alert is-card" title={a.title}><Icon name={a.icon} size={11} />{a.text}</span>)}
      {s.status !== 'idle' && s.lastTool && <span className="am-session__tool am-priv"><Icon name="wrench" size={10} />{s.lastTool.name}{s.lastTool.summary ? ' · ' + s.lastTool.summary : ''}</span>}
      {sum && (
        <span className={'am-session__agents' + (sum.working || sum.waiting ? ' is-live' : '')} title="Subagentes desta sessão">
          <Icon name="bot" size={11} />{agentParts(sum).join(' · ')}
          <span className="lg-muted">· {fmtNum(sum.tools)} ferr. · {fmtCompact(sum.tokens)} tok</span>
        </span>
      )}
    </button>
  );
  if (!sum) return row;
  return (
    <div className="am-sw">
      {row}
      <button type="button" className="am-sw__toggle" aria-expanded={!collapsed} onClick={onToggle}
        title={collapsed ? `Mostrar os ${sum.n} subagente(s)` : 'Recolher os subagentes'} aria-label={collapsed ? 'Mostrar subagentes' : 'Recolher subagentes'}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
      </button>
    </div>
  );
}

/** Lista por projeto; cada sessão principal é um cartão que leva os seus subagentes dentro (região comum). */
function SessionList({ sessions, sel, onPick, tick, collapsed, onToggle }) {
  const groups = React.useMemo(() => {
    const kids = new Map();
    for (const s of sessions) if (s.parentId) (kids.get(s.parentId) || kids.set(s.parentId, []).get(s.parentId)).push(s);
    const roots = sessions.filter((s) => !s.parentId || !sessions.some((p) => p.sessionId === s.parentId && p.provider === s.provider));
    const byProject = new Map();
    for (const r of roots) { const k = projectOf(r); (byProject.get(k) || byProject.set(k, []).get(k)).push(r); }
    return [...byProject.entries()].map(([name, list]) => ({ name, list, kids }));
  }, [sessions]);
  return (
    <div className="am-list tk-scroll">
      {groups.map((g) => (
        <section key={g.name} className="am-group">
          <h3 className="am-group__title"><Icon name="folder" size={13} /><span>{g.name}</span><small>{g.list.length}</small></h3>
          {g.list.map((s) => {
            const kids = g.kids.get(s.sessionId) || [];
            const sum = kids.length ? summarizeAgents(kids) : null;
            const closed = isCollapsed(sum, collapsed, s.key);
            return (
              <div key={s.key} className="am-card">
                <SessionRow s={s} sel={sel === s.key} onPick={onPick} tick={tick} sum={sum} collapsed={closed} onToggle={() => onToggle(s.key, closed)} />
                {sum && !closed && (
                  <div className="am-card__kids">
                    {kids.map((k, i) => <AgentRow key={k.key} s={k} sel={sel === k.key} onPick={onPick} tick={tick} last={i === kids.length - 1} />)}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Timeline({ data, kinds, q }) {
  const ref = React.useRef(null);
  const stick = React.useRef(true);
  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ? data.events : []).filter((e) => {
      const k = e.kind === 'tool_result' ? 'tool_use' : e.kind;
      if (KIND_ICON[e.kind] && !['turn_start', 'turn_end', 'commit', 'error'].includes(e.kind) && !kinds.includes(k)) return false;
      return !needle || (e.summary || '').toLowerCase().includes(needle) || (e.tool || '').toLowerCase().includes(needle);
    });
  }, [data, kinds, q]);
  React.useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [rows]);
  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>;
  return (
    <div className="am-timeline tk-scroll" ref={ref} onScroll={onScroll}>
      {data.partial && <div className="am-note"><Icon name="info" size={12} />Arquivo grande: só o final foi lido — turnos e tokens desta sessão podem estar incompletos.</div>}
      {data.total > data.events.length && <div className="am-note"><Icon name="info" size={12} />Mostrando os últimos {data.events.length} de {data.total} eventos.</div>}
      {rows.length === 0 && <div className="lg-muted lg-pad">Nenhum evento com esses filtros.</div>}
      {rows.map((e, i) => (
        <div key={i} className={'am-ev is-' + e.kind + (e.error ? ' is-error' : '')}>
          <span className="am-ev__time">{clock(e.ts)}</span>
          <span className="am-ev__icon"><Icon name={KIND_ICON[e.kind] || 'dot'} size={13} /></span>
          <span className="am-ev__body">
            <b>{e.tool || KIND_LABEL[e.kind] || e.kind}</b>
            {e.summary ? <span className="am-ev__text am-priv">{e.summary}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AIMonitor({ toast }) {
  const [ui, setUi] = usePersisted('aimon.ui', { provider: 'all', kinds: KINDS.map((k) => k.v), hide: false, sel: null });
  const [providers, setProviders] = React.useState(null);
  const [sessions, setSessions] = React.useState(null);
  const [data, setData] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const [bg, setBg] = React.useState(false); // acompanhar em segundo plano (desligado por padrão)
  const [rev, setRev] = React.useState(0); // sobe a cada aviso do processo principal: as raias buscam de novo
  const selRef = React.useRef(null);
  const provRef = React.useRef('all');
  selRef.current = ui.sel;
  provRef.current = ui.provider;

  const loadList = React.useCallback(() => api().list({ provider: provRef.current }).then(setSessions, (e) => toast('Monitor de IA', errText(e), 'error')), []);
  const loadTimeline = React.useCallback(() => {
    const key = selRef.current;
    if (!key) return setData(null);
    api().timeline(key, { limit: 600 }).then((d) => { if (selRef.current === key) setData(d); }, () => {});
  }, []);

  React.useEffect(() => {
    api().providers().then(setProviders, () => setProviders([]));
    api().prefs().then((p) => setBg(!!(p && p.background)), () => {});
    api().setActive(true).catch(() => {});
    let raf = 0;
    const off = api().onChanged(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; loadList(); loadTimeline(); setRev((r) => r + 1); }); });
    const clockT = setInterval(() => setTick((t) => t + 1), 5000); // "há 12 s" e o status dependem do relógio
    return () => { off(); clearInterval(clockT); if (raf) cancelAnimationFrame(raf); api().setActive(false).catch(() => {}); };
  }, []);
  React.useEffect(() => { loadList(); }, [ui.provider]);
  React.useEffect(() => { setData(null); loadTimeline(); }, [ui.sel]);

  const installed = (providers || []).filter((p) => p.installed);
  const options = [{ value: 'all', label: 'Todos' }, ...installed.map((p) => ({ value: p.id, label: p.name }))];
  const list = sessions || [];
  const current = list.find((s) => s.key === ui.sel) || null;
  const working = list.filter((s) => s.status === 'working').length;
  const waiting = list.filter((s) => s.status === 'waiting').length;
  const failed = list.filter((s) => s.status === 'error').length;
  const view = ui.view === 'changes' ? 'changes' : 'timeline';
  const tab = ui.tab === 'lanes' || ui.tab === 'plans' ? ui.tab : 'sessions';
  const toggleBg = () => api().setBackground(!bg).then((on) => { setBg(on); toast(on ? 'Acompanhamento em segundo plano ligado' : 'Acompanhamento em segundo plano desligado', on ? 'Continua lendo as sessões com esta tela fechada; o Git passa a mostrar o selo de IA.' : 'Só acompanha com esta tela aberta.', 'ok'); }, (e) => toast('Monitor de IA', errText(e), 'error'));
  const openGit = async (r, extra = {}) => {
    try {
      const key = (p) => String(p).split('\\').join('/').toLowerCase();
      const same = (a, b) => key(a) === key(b);
      const known = ((await window.devkit.git.list()).repos || []).find((x) => same(x.path, r.main));
      const top = known ? known.path : await window.devkit.git.add(r.main); // só registra se o usuário pediu para abrir
      if (!known) toast('Repositório adicionado ao Git', r.name, 'ok');
      window.devkit.app.command({ type: 'go', route: 'git', params: { repo: top, tab: extra.tab || 'overview', ...(extra.hash ? { hash: extra.hash } : {}) } });
    } catch (e) { toast('Não foi possível abrir no Git', errText(e), 'error'); }
  };
  const toggleKind = (v) => setUi((u) => ({ ...u, kinds: u.kinds.includes(v) ? u.kinds.filter((k) => k !== v) : [...u.kinds, v] }));

  if (!providers || !sessions) return <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>;
  if (!installed.length) {
    return <div className="am"><EmptyState title="Nenhuma ferramenta de IA encontrada" animate="none" description="O monitor procura as sessões em ~/.claude (Claude Code) e ~/.codex (Codex). Nenhuma das duas pastas existe neste computador." /></div>;
  }
  return (
    <div className={'am' + (ui.hide ? ' is-private' : '')}>
      <header className="gt-head">
        <div className="gt-head__title">
          <Icon name="bot" size={18} />
          <b>Monitor de IA</b>
          <span className="lg-muted">{working} trabalhando{waiting ? ` · ${waiting} esperando` : ''}{failed ? ` · ${failed} com erro` : ''} · {list.length} sessão(ões) nas últimas 24 h</span>
        </div>
        <div className="gt-head__actions">
          <SegmentedControl size="sm" options={TABS} value={tab} onChange={(v) => setUi((u) => ({ ...u, tab: v }))} />
          {tab !== 'plans' && <SegmentedControl size="sm" options={options} value={ui.provider} onChange={(provider) => setUi((u) => ({ ...u, provider, sel: null }))} />}
          <button type="button" className={'gt-op is-ghost is-sm' + (ui.hide ? ' is-on' : '')} onClick={() => setUi((u) => ({ ...u, hide: !u.hide }))} title="Desfoca prompts, respostas e comandos (útil ao compartilhar a tela)" aria-pressed={ui.hide}>
            <Icon name={ui.hide ? 'eye-off' : 'eye'} size={14} /><span>{ui.hide ? 'Conteúdo oculto' : 'Ocultar conteúdo'}</span>
          </button>
          <button type="button" className={'gt-op is-ghost is-sm' + (bg ? ' is-on' : '')} onClick={toggleBg} aria-pressed={bg} title="Continua lendo as sessões com esta tela fechada (desligado por padrão). Ligado, a tela do Git mostra quantas sessões de IA estão ativas em cada repositório.">
            <Icon name="radio" size={14} /><span>{bg ? 'Segundo plano: ligado' : 'Segundo plano'}</span>
          </button>
        </div>
      </header>
      {tab === 'plans' ? (
        <Plans sessions={list} toast={toast} onOpenCommit={async (plan, c) => { try { const r = await api().resolveRepo(plan.cwd); if (!r || !r.git) { toast('Repositório não encontrado', 'A pasta deste plano não é mais um repositório git.', 'warn'); return; } openGit({ main: r.main, name: r.name }, { tab: 'history', hash: c.hash }); } catch (e) { toast('Não foi possível abrir no Git', errText(e), 'error'); } }} onOpenSession={(sel) => setUi((u) => ({ ...u, sel, tab: 'sessions', provider: 'all' }))} />
      ) : tab === 'lanes' ? (
        <Lanes provider={ui.provider} scale={ui.scale || SCALES[0].value} onScale={(scale) => setUi((u) => ({ ...u, scale }))} sel={ui.sel} rev={rev} toast={toast}
          onPick={(sel) => setUi((u) => ({ ...u, sel, tab: 'sessions' }))}
          onCommit={(lane, c) => openGit(lane.repo, { tab: 'history', hash: c.hash })} />
      ) : (
      <div className="am-body">
        <aside className="am-side">
          {list.length === 0
            ? <div className="gt-msg">Nenhuma sessão com atividade nas últimas 24 h.</div>
            : <SessionList sessions={list} sel={ui.sel} onPick={(sel) => setUi((u) => ({ ...u, sel }))} tick={tick} collapsed={ui.collapsed || {}}
              onToggle={(key, closed) => setUi((u) => ({ ...u, collapsed: { ...(u.collapsed || {}), [key]: !closed } }))} />}
        </aside>
        <main className="am-main">
          {!current ? (
            <EmptyState title="Escolha uma sessão" animate="none" description="A timeline mostra prompts, respostas, ferramentas chamadas e o que voltou delas, em tempo real. Subagentes aparecem dentro da sessão que os criou." />
          ) : (
            <>
              <div className="am-main__head">
                <div className="am-main__title"><b className="am-priv">{current.label || current.title || 'Sessão'}</b><StatusBadge s={current} /></div>
                <div className="am-main__meta lg-muted">
                  <span>{current.provider}{current.model ? ' · ' + current.model : ''}</span>
                  <span>{current.turns} turno(s) · {current.tools} ferramenta(s)</span>
                  <span title={`entrada ${current.tokens.input} · saída ${current.tokens.output} · cache lido ${current.tokens.cacheRead} · cache gravado ${current.tokens.cacheWrite}`}>{fmtCompact(totalTokens(current.tokens))} tokens</span>
                  {current.cwd && <span className="am-priv" title={current.cwd}>{base(current.cwd)}</span>}
                  {current.repo && <span className="am-priv" title={current.repo.main}>repo {current.repo.name}{current.repo.worktree ? ` · worktree ${current.repo.worktree}` : ''}{current.repo.branch ? ` · ${current.repo.branch}` : ''}</span>}
                  {current.repo && <button type="button" className="lg-btn" onClick={() => openGit(current.repo)} title="Abre este repositório na ferramenta Git"><Icon name="folder-git-2" size={12} /><span>Abrir no Git</span></button>}
                </div>
              </div>
              <SessionAi session={current} events={data ? data.events : null} />
              <div className="am-subtabs" role="tablist">
                <button type="button" role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'is-on' : ''} onClick={() => setUi((u) => ({ ...u, view: 'timeline' }))}><Icon name="list" size={13} /><span>Timeline</span></button>
                <button type="button" role="tab" aria-selected={view === 'changes'} className={view === 'changes' ? 'is-on' : ''} onClick={() => setUi((u) => ({ ...u, view: 'changes' }))}><Icon name="git-compare" size={13} /><span>Alterações</span></button>
              </div>
              {view === 'changes' ? <Changes session={current} events={data ? data.events : null} onOpenGit={openGit} toast={toast} /> : (
              <>
              <div className="am-filters">
                {KINDS.map((k) => (
                  <button key={k.v} type="button" className={'lg-btn' + (ui.kinds.includes(k.v) ? ' is-accent' : '')} aria-pressed={ui.kinds.includes(k.v)} onClick={() => toggleKind(k.v)}><Icon name={k.icon} size={12} /><span>{k.label}</span></button>
                ))}
                <input className="am-search" type="search" placeholder="Buscar na timeline…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na timeline" />
              </div>
              <Timeline data={data} kinds={ui.kinds} q={q} />
              </>
              )}
            </>
          )}
        </main>
      </div>
      )}
    </div>
  );
}
