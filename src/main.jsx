import { DS, mod, isMod, isMac } from './lib/ds.js';
import { usePersisted } from './lib/store.js';
import { TOOLS, findTool } from './tools/registry.js';
import { resolveTheme } from './lib/themes.js';
import { AppSidebar } from './shell/AppSidebar.jsx';
import { Home } from './screens/Home.jsx';
import { Settings } from './screens/Settings.jsx';

const { TitleBar, Toast, Kbd } = DS;

const titlePlatform = isMac ? 'mac' : window.devkit.platform === 'win32' ? 'windows' : 'linux';

function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  window.devkit.theme.set(pref);
}

/** A command palette é global (janela própria): Ctrl+K e os botões "buscar" só pedem para abri-la. */
const openPalette = () => window.devkit.palette.toggle();

function App() {
  const [prefs, setPrefs] = usePersisted('prefs', { theme: 'dark', collapsed: false, route: 'sql' });
  const [toasts, setToasts] = React.useState([]);
  const [info, setInfo] = React.useState(null);
  const [sqlVersion, setSqlVersion] = React.useState(null);
  const route = prefs.route === 'home' || prefs.route === 'settings' || findTool(prefs.route) ? prefs.route : 'home';

  const go = (r) => setPrefs((p) => ({ ...p, route: r }));
  const toggleSidebar = () => setPrefs((p) => ({ ...p, collapsed: !p.collapsed }));
  const toast = (title, description, variant = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, title, description, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  React.useEffect(() => { applyTheme(prefs.theme); }, [prefs.theme]);
  React.useEffect(() => {
    window.devkit.info().then(setInfo);
    window.devkit.sql.status().then((s) => setSqlVersion(s.sqlparse), () => {});
  }, []);

  // Atalhos globais
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); openPalette(); }
      else if (k === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (k === ',') { e.preventDefault(); go('settings'); }
      else { const t = TOOLS.find((x) => x.shortcutKey === e.key); if (t) { e.preventDefault(); go(t.id); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Comandos vindos da command palette (via processo principal).
  React.useEffect(() => window.devkit.app.onCommand((cmd) => {
    if (cmd.type === 'go' && (cmd.route === 'home' || cmd.route === 'settings' || findTool(cmd.route))) go(cmd.route);
    else if (cmd.type === 'theme') setPrefs((p) => ({ ...p, theme: cmd.value }));
    else if (cmd.type === 'sidebar') toggleSidebar();
  }), []);

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
  const screen = route === 'home' ? <Home go={go} openPalette={openPalette} />
    : route === 'settings' ? <Settings prefs={prefs} setPrefs={setPrefs} info={info} sqlVersion={sqlVersion} />
    : <Screen toast={toast} />;

  const title = (tool ? tool.name : route === 'settings' ? 'Configurações' : 'Início') + ' — Devkit';

  return (
    <div className="tk-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--tk-bg)', position: 'relative', overflow: 'hidden' }}>
      <div onClick={onTitleClick} onDoubleClick={onTitleDbl}>
        <TitleBar platform={titlePlatform} title={title}
          right={<span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tk-text-3)', cursor: 'pointer' }} onClick={openPalette}><Kbd size="sm">{mod('K')}</Kbd> buscar</span>} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <AppSidebar route={route} go={go} collapsed={prefs.collapsed} onCollapse={toggleSidebar} />
        <main className="tk-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--tk-surface-1)' }}>{screen}</main>
      </div>
      <div className="toasts">
        {toasts.map((t) => <Toast key={t.id} variant={t.variant} title={t.title} description={t.description} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
