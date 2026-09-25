import { DS, mod, isMod, isMac } from './lib/ds.js';
import { usePersisted } from './lib/store.js';
import { TOOLS, findTool } from './tools/registry.js';
import { AppSidebar } from './shell/AppSidebar.jsx';
import { Home } from './screens/Home.jsx';
import { Settings } from './screens/Settings.jsx';

const { TitleBar, CommandPalette, Toast, Kbd } = DS;

const titlePlatform = isMac ? 'mac' : window.devkit.platform === 'win32' ? 'windows' : 'linux';

function applyTheme(pref) {
  const sys = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = pref === 'system' ? sys : pref;
  window.devkit.theme.set(pref);
}

function App() {
  const [prefs, setPrefs] = usePersisted('prefs', { theme: 'dark', collapsed: false, route: 'sql' });
  const [palette, setPalette] = React.useState(false);
  const [toasts, setToasts] = React.useState([]);
  const [info, setInfo] = React.useState(null);
  const [sqlVersion, setSqlVersion] = React.useState(null);
  const route = prefs.route === 'home' || prefs.route === 'settings' || findTool(prefs.route) ? prefs.route : 'home';

  const go = (r) => { setPrefs((p) => ({ ...p, route: r })); setPalette(false); };
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
      if (k === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (k === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (k === ',') { e.preventDefault(); go('settings'); }
      else { const t = TOOLS.find((x) => x.shortcutKey === e.key); if (t) { e.preventDefault(); go(t.id); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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
  const screen = route === 'home' ? <Home go={go} openPalette={() => setPalette(true)} />
    : route === 'settings' ? <Settings prefs={prefs} setPrefs={setPrefs} info={info} sqlVersion={sqlVersion} />
    : <Screen toast={toast} />;

  const items = [
    ...TOOLS.map((t) => ({ id: t.id, group: 'Ferramentas', label: t.name, icon: t.icon, hint: t.group, shortcut: t.shortcutKey && mod(t.shortcutKey), description: t.desc })),
    { id: 'home', group: 'Navegação', label: 'Início', icon: 'layout-grid' },
    { id: 'a-theme', group: 'Ações', label: 'Alternar tema claro/escuro', icon: 'sun-moon', description: 'Troca entre os temas.' },
    { id: 'a-sidebar', group: 'Ações', label: 'Recolher/expandir sidebar', icon: 'panel-left', shortcut: mod('\\') },
    { id: 'settings', group: 'Ações', label: 'Abrir configurações', icon: 'settings', shortcut: mod(',') },
  ];
  const onSelect = (it) => {
    if (it.id === 'a-theme') { setPrefs((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' })); setPalette(false); }
    else if (it.id === 'a-sidebar') { toggleSidebar(); setPalette(false); }
    else go(it.id);
  };

  const title = (tool ? tool.name : route === 'settings' ? 'Configurações' : 'Início') + ' — Toni Devkit';

  return (
    <div className="tk-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--tk-bg)', position: 'relative', overflow: 'hidden' }}>
      <div onClick={onTitleClick} onDoubleClick={onTitleDbl}>
        <TitleBar platform={titlePlatform} title={title}
          right={<span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tk-text-3)', cursor: 'pointer' }} onClick={() => setPalette(true)}><Kbd size="sm">{mod('K')}</Kbd> buscar</span>} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <AppSidebar route={route} go={go} collapsed={prefs.collapsed} onCollapse={toggleSidebar} />
        <main className="tk-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--tk-surface-1)' }}>{screen}</main>
      </div>
      <CommandPalette open={palette} items={items} onSelect={onSelect} onClose={() => setPalette(false)} key={palette ? 'open' : 'closed'} />
      <div className="toasts">
        {toasts.map((t) => <Toast key={t.id} variant={t.variant} title={t.title} description={t.description} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
