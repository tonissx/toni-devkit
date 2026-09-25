import { DS, mod } from '../lib/ds.js';
import { TOOLS } from '../tools/registry.js';

const { Sidebar, SidebarGroup, SidebarItem, IconButton } = DS;

export function AppSidebar({ route, go, collapsed, onCollapse }) {
  const groups = [];
  TOOLS.forEach((t) => {
    let g = groups.find((x) => x.name === t.group);
    if (!g) groups.push((g = { name: t.group, items: [] }));
    g.items.push(t);
  });

  const ball = (props) => (
    <span className="app-brand__ballwrap" tabIndex={0} {...props}>
      <span className="app-brand__ballcore">
        <img src="assets/symbol.svg" alt="Toni Devkit" className="app-brand__ball" />
        <span className="app-brand__ball-tex" aria-hidden="true" />
      </span>
      <span className="app-brand__wind" aria-hidden="true" />
      <span className="app-brand__wind" aria-hidden="true" />
      <span className="app-brand__wind" aria-hidden="true" />
    </span>
  );

  const header = collapsed
    ? ball({ title: 'Expandir', style: { cursor: 'pointer', height: 28, width: 28 }, onClick: onCollapse })
    : <>
        <span className="app-brand">
          {ball({ style: { height: 22, width: 22 } })}
          <span className="app-brand__name"><b>Devkit</b></span>
        </span>
        <IconButton icon="panel-left-close" label={'Recolher (' + mod('\\') + ')'} size="sm" onClick={onCollapse} style={{ marginLeft: 'auto' }} />
      </>;

  const footer = <>
    <SidebarItem icon="settings" label="Configurações" shortcut={collapsed ? undefined : mod(',')} active={route === 'settings'} onClick={() => go('settings')} />
  </>;

  return (
    <Sidebar collapsed={collapsed} header={header} footer={footer}>
      <SidebarGroup>
        <SidebarItem icon="layout-grid" label="Início" active={route === 'home'} onClick={() => go('home')} />
      </SidebarGroup>
      {groups.map((g) => (
        <SidebarGroup key={g.name} label={collapsed ? null : g.name}>
          {g.items.map((t) => (
            <SidebarItem key={t.id} icon={t.icon} label={t.name} active={route === t.id}
              shortcut={collapsed || !t.shortcutKey ? undefined : mod(t.shortcutKey)} onClick={() => go(t.id)} />
          ))}
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}
