import { DS, mod, isMod, isMac } from './lib/ds.js';
import { usePersisted, load } from './lib/store.js';
import { SIDEBAR_ORDER, findTool } from './tools/registry.js';
import { resolveTheme } from './lib/themes.js';
import { AppSidebar } from './shell/AppSidebar.jsx';
import { Home } from './screens/Home.jsx';
import { Settings } from './screens/Settings.jsx';
import { emit } from './lib/events.js';

const { TitleBar, Toast, Kbd, IconButton, Button, EmptyState } = DS;

const titlePlatform = isMac ? 'mac' : window.devkit.platform === 'win32' ? 'windows' : 'linux';

function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  window.devkit.theme.set(pref);
}

/** A command palette é global (janela própria): Ctrl+K e os botões "buscar" só pedem para abri-la. */
const openPalette = () => window.devkit.palette.toggle();

/**
 * Janela de uma ferramenta só (aberta com ?tool=<id> — ver electron/toolwindows.js): sem sidebar, sem navegação.
 * Todas as janelas dividem o localStorage; por isso esta NÃO grava o 'prefs' (senão sobrescreveria a rota da principal).
 */
const detachedTool = (() => {
  const id = new URLSearchParams(location.search).get('tool');
  const t = id && findTool(id);
  return t && t.detachable !== false ? id : null;
})();
const DEFAULT_PREFS = { theme: 'dark', collapsed: false, route: 'sql' };
/** Vale durante toda a vida da janela, então a escolha do hook não muda entre renders. */
const usePrefs = detachedTool
  ? () => React.useState(() => ({ ...load('prefs', DEFAULT_PREFS), route: detachedTool }))
  : () => usePersisted('prefs', DEFAULT_PREFS);

/** Na principal, no lugar de uma ferramenta que está em janela própria. */
function InOtherWindow({ tool, onFocus, onAttach }) {
  return (
    <EmptyState icon="external-link" title={tool.name + ' está em outra janela'}
      description="Ela continua funcionando por lá. Traga de volta para usar aqui."
      action={<div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={onFocus}>Ir para a janela</Button>
        <Button onClick={onAttach}>Trazer de volta</Button>
      </div>} />
  );
}

function App() {
  const [prefs, setPrefs] = usePrefs();
  const [detached, setDetached] = React.useState([]); // ferramentas em janela própria
  const [toasts, setToasts] = React.useState([]);
  const [info, setInfo] = React.useState(null);
  const [sqlVersion, setSqlVersion] = React.useState(null);
  // Pedido para a ferramenta aberta, vindo da palette: { route, …params, nonce } (ex.: abrir nota, aba do DevCore).
  const [request, setRequest] = React.useState(null);
  const [dots, setDots] = React.useState({}); // pontos discretos na sidebar: { devcore: true }
  const route = detachedTool || (prefs.route === 'home' || prefs.route === 'settings' || findTool(prefs.route) ? prefs.route : 'home');

  /** Uma ferramenta que está em janela própria não abre aqui: leva o foco para a janela dela. */
  const go = (r) => {
    if (!detachedTool && detached.includes(r)) { window.devkit.tools.detach(r); return; }
    setPrefs((p) => ({ ...p, route: r }));
  };
  const canDetach = (r) => { const t = findTool(r); return !!t && t.detachable !== false; };
  const detachTool = (r) => { if (canDetach(r)) window.devkit.tools.detach(r); };
  const attachTool = (r) => window.devkit.tools.attach(r);
  /** Navega levando um pedido para a ferramenta (ex.: abrir nota, aba Tarefas) — o mesmo caminho da palette. */
  const open = (r, params) => { setRequest({ route: r, ...params, nonce: Date.now() }); go(r); };
  const toggleSidebar = () => setPrefs((p) => ({ ...p, collapsed: !p.collapsed }));
  const toast = (title, description, variant = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, title, description, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  React.useEffect(() => {
    // A janela de uma ferramenta só acompanha o tema (quem muda é a principal) e não o reenvia para as outras.
    if (detachedTool) document.documentElement.dataset.theme = resolveTheme(prefs.theme);
    else applyTheme(prefs.theme);
  }, [prefs.theme]);
  React.useEffect(() => {
    window.devkit.tools.list().then(setDetached, () => {});
    return window.devkit.tools.onChanged(setDetached);
  }, []);
  React.useEffect(() => (detachedTool ? window.devkit.theme.onChanged((theme) => setPrefs((p) => ({ ...p, theme }))) : undefined), []);
  // Na principal: se a ferramenta aberta acabou de ganhar janela própria, a principal volta para o Início.
  React.useEffect(() => {
    if (!detachedTool && detached.includes(prefs.route)) setPrefs((p) => ({ ...p, route: 'home' }));
  }, [detached]);
  React.useEffect(() => {
    window.devkit.info().then(setInfo);
    window.devkit.sql.status().then((s) => setSqlVersion(s.sqlparse), () => {});
  }, []);

  const routeRef = React.useRef(route);
  routeRef.current = route;

  // Atalhos globais
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); openPalette(); }
      else if (k === 'd' && e.shiftKey) {
        // Ctrl+Shift+D: a ferramenta aberta vai para uma janela própria — ou, na janela dela, volta para a principal.
        e.preventDefault();
        if (detachedTool) attachTool(detachedTool);
        else if (canDetach(routeRef.current)) detachTool(routeRef.current);
      }
      else if (detachedTool) return; // o resto é navegação da principal
      else if (k === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (k === ',') { e.preventDefault(); go('settings'); }
      else if (e.key === 'Tab') {
        // Ctrl+Tab / Ctrl+Shift+Tab: próxima / anterior na sidebar (Início → ferramentas → Início). Configurações fica de fora.
        e.preventDefault();
        const ids = ['home', ...SIDEBAR_ORDER.map((t) => t.id)];
        setPrefs((p) => {
          const at = ids.indexOf(p.route);
          const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + ids.length) % ids.length;
          return { ...p, route: ids[next] };
        });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Comandos vindos da command palette (via processo principal).
  React.useEffect(() => window.devkit.app.onCommand((cmd) => {
    if (detachedTool) {
      // Janela de uma ferramenta: só o que é dela (o processo principal já encaminha para cá os pedidos da ferramenta).
      if (cmd.type === 'go' && cmd.route === detachedTool && cmd.params) setRequest({ route: detachedTool, ...cmd.params, nonce: Date.now() });
      else if (cmd.type === 'open-note' && detachedTool === 'notes') setRequest({ ...cmd, route: 'notes', nonce: Date.now() });
      return;
    }
    if (cmd.type === 'go' && (cmd.route === 'home' || cmd.route === 'settings' || findTool(cmd.route))) {
      if (cmd.params) setRequest({ route: cmd.route, ...cmd.params, nonce: Date.now() });
      go(cmd.route);
    }
    else if (cmd.type === 'theme') setPrefs((p) => ({ ...p, theme: cmd.value }));
    else if (cmd.type === 'sidebar') toggleSidebar();
    else if (cmd.type === 'open-note') { setRequest({ ...cmd, route: 'notes', nonce: Date.now() }); go('notes'); }
  }), []);

  // Uso de ferramentas vai para o Event Bus (o DevCore escuta; nada aqui depende dele).
  React.useEffect(() => { if (findTool(route)) emit('tool.opened', { tool: route }); }, [route]);

  // Ponto discreto na sidebar quando o DevCore tem novidade (descoberta ou upgrade novo).
  React.useEffect(() => {
    const set = (v) => setDots((d) => (d.devcore === !!v.hasNews ? d : { ...d, devcore: !!v.hasNews }));
    window.devkit.devcore.get().then(set, () => {});
    return window.devkit.devcore.onChanged((msg) => msg.snapshot && set(msg.snapshot));
  }, []);

  // Atualização automática: status + aviso quando terminar de baixar (ver electron/updater/service.js).
  const [updater, setUpdater] = React.useState(null);
  const prevUpdaterStatus = React.useRef(null);
  React.useEffect(() => {
    window.devkit.updater.status().then(setUpdater, () => {});
    return window.devkit.updater.onChanged(setUpdater);
  }, []);
  React.useEffect(() => {
    if (updater && updater.status === 'downloaded' && prevUpdaterStatus.current !== 'downloaded') {
      toast('Atualização pronta', `Reinicie o Devkit para aplicar a versão ${updater.latestVersion || ''}`);
    }
    prevUpdaterStatus.current = updater && updater.status;
  }, [updater]);

  // Controles de janela (Windows/Linux): os botões do TitleBar do DS → IPC.
  const onTitleClick = (e) => {
    const b = e.target.closest('.tk-winctl button');
    if (!b) return;
    const a = b.getAttribute('aria-label');
    if (a === 'Minimizar') window.devkit.window.minimize();
    else if (a === 'Maximizar') window.devkit.window.toggleMaximize();
    else if (a === 'Fechar') window.devkit.window.close();
  };
  const onTitleDbl = (e) => { if (!e.target.closest('button')) window.devkit.window.toggleMaximize(); };

  const tool = findTool(route);
  const Screen = tool && tool.component;
  const screen = !detachedTool && detached.includes(route) && tool
    ? <InOtherWindow tool={tool} onFocus={() => detachTool(route)} onAttach={() => attachTool(route)} />
    : route === 'home' ? <Home go={go} open={open} openPalette={openPalette} updater={updater} toast={toast}
      theme={prefs.theme} setTheme={(theme) => setPrefs((p) => ({ ...p, theme }))} />
    : route === 'settings' ? <Settings prefs={prefs} setPrefs={setPrefs} info={info} sqlVersion={sqlVersion} updater={updater} toast={toast} />
    : <Screen toast={toast} request={request && request.route === route ? request : undefined} />;

  const title = (tool ? tool.name : route === 'settings' ? 'Configurações' : 'Início') + ' — Devkit';

  return (
    <div className="tk-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--tk-bg)', position: 'relative', overflow: 'hidden' }}>
      <div onClick={onTitleClick} onDoubleClick={onTitleDbl}>
        <TitleBar platform={titlePlatform} title={title}
          right={<span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--tk-text-3)' }}>
            {detachedTool
              ? <IconButton icon="undo-2" size="sm" label={'Trazer de volta para a janela principal (' + mod('D', true) + ')'} onClick={() => attachTool(detachedTool)} />
              : canDetach(route) && !detached.includes(route)
                ? <IconButton icon="external-link" size="sm" label={'Abrir em janela própria (' + mod('D', true) + ')'} onClick={() => detachTool(route)} />
                : null}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={openPalette}><Kbd size="sm">{mod('K')}</Kbd> buscar</span>
          </span>} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!detachedTool && <AppSidebar route={route} go={go} collapsed={prefs.collapsed} onCollapse={toggleSidebar} dots={dots}
          detached={detached} onDetach={detachTool} />}
        <main className="tk-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--tk-surface-1)' }}>{screen}</main>
      </div>
      <div className="toasts">
        {toasts.map((t) => <Toast key={t.id} variant={t.variant} title={t.title} description={t.description} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
