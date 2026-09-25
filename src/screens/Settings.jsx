import { DS, mod } from '../lib/ds.js';

const { PageHeader, Card, SegmentedControl, Kbd, Badge, Toggle } = DS;

const Row = ({ label, hint, children }) => (
  <div className="set-row">
    <div><div className="set-row__label">{label}</div>{hint && <div className="set-row__hint">{hint}</div>}</div>
    <div className="set-row__ctl">{children}</div>
  </div>
);

export function Settings({ prefs, setPrefs, info, sqlVersion }) {
  const shortcuts = [
    ['Command palette', mod('K')],
    ['Formatar SQL', mod('↵')],
    ['Copiar saída', mod('C', true)],
    ['Abrir arquivo .sql', mod('O')],
    ['Salvar saída', mod('S')],
    ['Recolher sidebar', mod('\\')],
    ['Configurações', mod(',')],
  ];
  return (
    <div>
      <PageHeader icon="settings" title="Configurações" subtitle="Preferências salvas localmente neste computador" />
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
        <Card padding={24}>
          <div className="tk-card__title">Aparência</div>
          <Row label="Tema" hint="Escuro é o padrão do Toni Devkit">
            <SegmentedControl size="sm" value={prefs.theme} onChange={(theme) => setPrefs((p) => ({ ...p, theme }))}
              options={[{ value: 'dark', label: 'Escuro', icon: 'moon' }, { value: 'light', label: 'Claro', icon: 'sun' }, { value: 'system', label: 'Sistema', icon: 'monitor' }]} />
          </Row>
          <Row label="Sidebar recolhida" hint="Mostra só os ícones das ferramentas">
            <Toggle checked={prefs.collapsed} onChange={(collapsed) => setPrefs((p) => ({ ...p, collapsed }))} />
          </Row>
        </Card>
        <Card padding={24}>
          <div className="tk-card__title">Atalhos</div>
          {shortcuts.map(([a, k]) => <Row key={a} label={a}><Kbd size="sm">{k}</Kbd></Row>)}
        </Card>
        <Card padding={24}>
          <div className="tk-card__title">Sobre</div>
          <Row label="Toni Devkit" hint="Ferramentas para devs · Toni Devkit Design System"><Badge size="sm" mono>v{info?.version || '—'}</Badge></Row>
          <Row label="Electron"><Badge size="sm" mono>{info?.electron || '—'}</Badge></Row>
          <Row label="Motor SQL" hint="sqlparse (Python) sobre Pyodide — o mesmo usado pelo sqlformat.org, 100% offline">
            <Badge size="sm" mono variant={sqlVersion ? 'ok' : 'neutral'} dot>{sqlVersion ? 'sqlparse ' + sqlVersion : 'carregando…'}</Badge>
          </Row>
        </Card>
      </div>
    </div>
  );
}
