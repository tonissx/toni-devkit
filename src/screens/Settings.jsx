import { DS, mod } from '../lib/ds.js';

const { PageHeader, Card, Select, Kbd, Badge, Toggle } = DS;

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Hacking (padrão)' },
  { value: 'min-dark', label: 'Min Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'tokyo-nightstorm', label: 'Tokyo Night Storm' },
  { value: 'night-owl', label: 'Night Owl' },
];

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
          <Row label="Tema" hint="Hacking é o padrão do Toni Devkit">
            <Select options={THEME_OPTIONS} value={prefs.theme} onChange={(theme) => setPrefs((p) => ({ ...p, theme }))} style={{ width: 200 }} />
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
          <Row label="Toni Devkit" hint="Ferramentas para devs"><Badge size="sm" mono>v{info?.version || '—'}</Badge></Row>
          <Row label="Desenvolvido por"><Badge size="sm">Antônio Gonçalves</Badge></Row>
          <Row label="Repositório">
            <a className="set-link" href="https://github.com/tonissx/toni-devkit" target="_blank" rel="noreferrer">github.com/tonissx/toni-devkit</a>
          </Row>
          <Row label="Electron"><Badge size="sm" mono>{info?.electron || '—'}</Badge></Row>
          <Row label="Motor SQL" hint="sqlparse (Python) sobre Pyodide — o mesmo usado pelo sqlformat.org, 100% offline">
            <Badge size="sm" mono variant={sqlVersion ? 'ok' : 'neutral'} dot>{sqlVersion ? 'sqlparse ' + sqlVersion : 'carregando…'}</Badge>
          </Row>
        </Card>
      </div>
    </div>
  );
}
