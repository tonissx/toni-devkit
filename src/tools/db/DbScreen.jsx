// Banco — monitor de SQL Server: quem bloqueia quem, queries lentas, deadlocks e saúde, ao vivo e no histórico.
// Servidores à esquerda; à direita, o servidor aberto em abas. A tela só mostra o que o coletor (processo principal)
// já leu — abrir a tela deixa o ciclo no intervalo cheio (5 s) e fechar volta ao ritmo de segundo plano (ou para).
import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { dbApi, errText, STATUS, StatusDot, fmtNum } from './shared.jsx';
import { ServerForm } from './ServerForm.jsx';
import { Now } from './Now.jsx';
import { History } from './History.jsx';
import { Queries } from './Queries.jsx';
import { Deadlocks } from './Deadlocks.jsx';
import { Health } from './Health.jsx';

const { Icon, Spinner, Modal, Button, EmptyState } = DS;

const TABS = [
  { v: 'now', label: 'Agora', icon: 'activity' },
  { v: 'history', label: 'Histórico', icon: 'history' },
  { v: 'queries', label: 'Queries', icon: 'scan-search' },
  { v: 'deadlocks', label: 'Deadlocks', icon: 'skull' },
  { v: 'health', label: 'Saúde', icon: 'shield-alert' },
];
const RING = 120; // amostras guardadas na tela para as sparklines (~10 min a cada 5 s)

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="lg-empty"><Icon name="bug" size={22} /><b>Algo deu errado nesta aba</b><span>{String(this.state.error.message || this.state.error)}</span><button type="button" className="lg-btn" onClick={() => this.setState({ error: null })}><span>Tentar de novo</span></button></div>;
  }
}

// Largura da bandeja, como a de repositórios do Git: arrastar a borda define; abaixo de RAIL_SNAP vira a coluna de siglas.
const RAIL_COMPACT = 52, RAIL_MIN = 170, RAIL_MAX = 420, RAIL_SNAP = 120, RAIL_DEFAULT = 236;
const railWidth = (raw) => (raw < RAIL_SNAP ? RAIL_COMPACT : Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(raw))));
const initials = (name) => {
  const p = String(name || '?').split(/[\s._\\/-]+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase();
};

function Rail({ servers, current, width, onResize, onPick, onAdd, onEdit, onRemove }) {
  const railRef = React.useRef(null);
  const [live, setLive] = React.useState(null); // largura durante o arrasto (só grava ao soltar)
  const w = live ?? width;
  const collapsed = w <= RAIL_COMPACT;
  const drag = {
    onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setLive(width); },
    onPointerMove: (e) => { if (live != null && railRef.current) setLive(railWidth(e.clientX - railRef.current.getBoundingClientRect().left)); },
    onPointerUp: () => { if (live != null) { onResize(live); setLive(null); } },
    onLostPointerCapture: () => setLive(null),
    onDoubleClick: () => onResize(collapsed ? RAIL_DEFAULT : RAIL_COMPACT),
    onKeyDown: (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      onResize(e.key === 'ArrowRight' ? (width <= RAIL_COMPACT ? RAIL_MIN : railWidth(width + 16)) : railWidth(width - 16));
    },
  };
  return (
    <aside ref={railRef} className={'gt-rail db-rail' + (collapsed ? ' is-collapsed' : '') + (live != null ? ' is-dragging' : '')} style={{ width: w }}>
      <div className="gt-rail__head">{!collapsed && <span className="home-section__title">Servidores</span>}</div>
      <div className="gt-rail__list tk-scroll">
        {servers.map((s) => {
          const st = STATUS[s.status] || STATUS.idle;
          return (
            <div key={s.id} className="gt-repo-wrap">
              <button type="button" className={'gt-repo' + (s.id === current ? ' is-sel' : '')} onClick={() => onPick(s.id)}
                title={collapsed ? `${s.name || s.label} — ${st.label}${s.blocked ? ` · ${s.blocked} bloqueada(s)` : ''}\n${s.label}` : s.label}
                aria-label={collapsed ? s.name || s.label : undefined}>
                {collapsed && <span className="gt-repo__abbr">{initials(s.name || s.label)}</span>}
                {!collapsed && <StatusDot s={s} />}
                <span className="gt-repo__main">
                  <span className="gt-repo__name">{s.name || s.label}</span>
                  <span className="gt-repo__branch">{s.status === 'ok' && s.blocked ? <span className="db-railwarn"><Icon name="octagon-x" size={10} /> {s.blocked} bloqueada(s)</span> : <>{s.background && <Icon name="history" size={10} />} {s.status === 'ok' ? `${fmtNum(s.active)} ativa(s)` : st.label}</>}</span>
                </span>
              </button>
              <button type="button" className="gt-repo__rm db-rail__edit" title="Editar" aria-label={`Editar ${s.name}`} onClick={() => onEdit(s)}><Icon name="pencil" size={12} /></button>
              <button type="button" className="gt-repo__rm" title="Remover (o histórico gravado fica no disco)" aria-label={`Remover ${s.name}`} onClick={() => onRemove(s)}><Icon name="x" size={13} /></button>
            </div>
          );
        })}
        {servers.length === 0 && <div className="gt-msg">Nenhum servidor ainda.</div>}
      </div>
      <div className="gt-rail__foot">
        <button type="button" className="gt-op is-accent is-md" onClick={onAdd} title="Adicionar servidor" aria-label="Adicionar servidor"><Icon name="plus" size={14} />{!collapsed && <span>Adicionar servidor</span>}</button>
      </div>
      <div className="gt-rail__grip" role="separator" aria-orientation="vertical" aria-label="Largura da lista de servidores (arraste; duplo clique alterna entre siglas e padrão)"
        aria-valuemin={RAIL_COMPACT} aria-valuemax={RAIL_MAX} aria-valuenow={w} tabIndex={0} title="Arraste para ajustar a largura · duplo clique alterna" {...drag} />
    </aside>
  );
}

export function DbScreen({ toast, request }) {
  const api = dbApi();
  const [servers, setServers] = React.useState(null);
  const [ui, setUi] = usePersisted('db.ui', { server: null, tab: 'now' });
  const [form, setForm] = React.useState(null); // null | {} (novo) | servidor
  const [removing, setRemoving] = React.useState(null);
  const [now, setNow] = React.useState(null);
  const [focus, setFocus] = React.useState(null); // { at } vindo de fora
  const rings = React.useRef({});
  const handled = React.useRef(null);

  const loadList = React.useCallback(() => api.list().then(setServers, (e) => { setServers([]); toast('Banco', errText(e), 'error'); }), []);
  React.useEffect(() => { loadList(); }, []);
  const current = servers && (servers.find((s) => s.id === ui.server) || servers[0]);
  const id = current && current.id;

  // Abriu o servidor: o coletor passa para o intervalo cheio; ao sair, volta (ou para).
  React.useEffect(() => {
    if (!id) return undefined;
    api.watch(id, true);
    api.now(id).then(setNow, () => {});
    return () => { api.watch(id, false); setNow(null); };
  }, [id]);

  // Amostras novas e mudanças de estado (de todos os servidores: o trilho mostra os bloqueios dos outros também).
  React.useEffect(() => {
    let raf = 0; let listT = null;
    const off = api.onChanged((evt) => {
      if (!evt) return;
      if (evt.type === 'sample' && evt.summary) {
        const r = rings.current[evt.id] || (rings.current[evt.id] = []);
        const s = evt.summary;
        r.push({ t: s.t, cpu: s.cpu, batchPerSec: s.batchPerSec, connections: s.connections, active: s.active, blocked: s.blocked, ple: s.ple });
        if (r.length > RING) r.splice(0, r.length - RING);
        if (evt.incidents && evt.incidents.some((i) => i.kind === 'blocking')) toast('Bloqueio no banco', evt.incidents.find((i) => i.kind === 'blocking').title, 'error');
      }
      if (evt.id === id && !raf) raf = requestAnimationFrame(() => { raf = 0; api.now(id).then(setNow, () => {}); });
      clearTimeout(listT); listT = setTimeout(loadList, 400);
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); clearTimeout(listT); };
  }, [id]);

  // Pedidos de fora (Logs → Banco, palette): { server, at, tab }.
  React.useEffect(() => {
    if (!request || !servers || handled.current === request.nonce) return;
    handled.current = request.nonce;
    if (request.server && servers.some((s) => s.id === request.server)) setUi((u) => ({ ...u, server: request.server }));
    if (request.at) { setUi((u) => ({ ...u, tab: 'history' })); setFocus({ at: Number(request.at), nonce: request.nonce }); } else if (request.tab) setUi((u) => ({ ...u, tab: request.tab }));
    if (request.action === 'add') setForm({});
  }, [request && request.nonce, !!servers]);

  const openSql = (sql) => window.devkit.app.command({ type: 'go', route: 'sql', params: { text: sql } });

  const remove = async () => {
    const s = removing; setRemoving(null);
    try { await api.remove(s.id); loadList(); toast('Servidor removido', s.name, 'ok'); } catch (e) { toast('Não foi possível remover', errText(e), 'error'); }
  };

  if (!servers) return <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>;
  const tab = ui.tab || 'now';
  const ring = (id && rings.current[id]) || [];
  return (
    <div className="gt db">
      <Rail servers={servers} current={id} width={ui.railW ?? (window.innerWidth < 1100 ? RAIL_COMPACT : RAIL_DEFAULT)} onResize={(railW) => setUi((u) => ({ ...u, railW }))} onPick={(sid) => setUi((u) => ({ ...u, server: sid }))} onAdd={() => setForm({})} onEdit={(s) => setForm(s)} onRemove={setRemoving} />
      <div className="gt-main">
        {!current ? (
          <EmptyState title="Adicione um SQL Server" animate="none"
            description="O Banco mostra quem bloqueia quem, as queries lentas, os deadlocks e a saúde do servidor — ao vivo e no histórico. A senha fica no Vault; o monitor só lê as views de sistema (com leitura suja e tempo limite curto, para não pesar) e só encerra uma sessão se você confirmar."
            action={<Button variant="primary" icon="plus" onClick={() => setForm({})}>Adicionar servidor</Button>} />
        ) : (
          <>
            <header className="gt-head">
              <div className="gt-head__title">
                <Icon name="database-zap" size={18} />
                <b>{current.name || current.label}</b>
                <span className="lg-muted">{current.label}{current.info ? ` · ${current.info.edition || ''} ${current.info.product_version || ''}` : ''}</span>
              </div>
              <div className="gt-head__actions">
                <span className={'db-status is-' + (STATUS[current.status] || STATUS.idle).tone}><Icon name={(STATUS[current.status] || STATUS.idle).icon} size={13} />{(STATUS[current.status] || STATUS.idle).label}</span>
                {current.background && <span className="lg-pill" title="Grava o histórico mesmo com a tela fechada"><Icon name="history" size={11} />segundo plano</span>}
                <button type="button" className="gt-op is-ghost is-sm" onClick={() => setForm(current)} title="Editar o servidor"><Icon name="pencil" size={14} /><span>Editar</span></button>
              </div>
            </header>
            <div className="lg-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.v} type="button" role="tab" aria-selected={tab === t.v} className={tab === t.v ? 'is-on' : ''} onClick={() => setUi((u) => ({ ...u, tab: t.v }))}>
                  <Icon name={t.icon} size={14} /><span>{t.label}</span>
                  {t.v === 'now' && current.blocked > 0 && <small className="db-tabwarn">{current.blocked}</small>}
                </button>
              ))}
            </div>
            <div className="db-body">
              <Boundary resetKey={id + tab}>
                {tab === 'now' && <Now server={current} now={now} ring={ring} toast={toast} onOpenSql={openSql} />}
                {tab === 'history' && <History server={current} toast={toast} focusAt={focus && focus.at} onDeadlock={() => setUi((u) => ({ ...u, tab: 'deadlocks' }))} />}
                {tab === 'queries' && <Queries server={current} toast={toast} onOpenSql={openSql} />}
                {tab === 'deadlocks' && <Deadlocks server={current} toast={toast} />}
                {tab === 'health' && <Health server={current} toast={toast} />}
              </Boundary>
            </div>
          </>
        )}
      </div>
      {form && <ServerForm initial={form.id ? form : null} toast={toast} onClose={() => setForm(null)} onSaved={(s) => { setForm(null); loadList(); setUi((u) => ({ ...u, server: s.id })); toast('Servidor salvo', s.name, 'ok'); }} />}
      {removing && (
        <Modal title={`Remover ${removing.name}?`} icon="trash-2" onClose={() => setRemoving(null)} width={480}
          description="Para de monitorar e tira da lista. O histórico já gravado continua no disco até a limpeza automática; a credencial continua no Vault."
          footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="destructive" onClick={remove}>Remover</Button></>} />
      )}
    </div>
  );
}
