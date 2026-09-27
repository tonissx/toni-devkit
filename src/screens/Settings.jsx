import { DS, mod } from '../lib/ds.js';
import { THEMES } from '../lib/themes.js';

const { PageHeader, Card, Select, Kbd, Badge, Toggle } = DS;

const Row = ({ label, hint, children }) => (
  <div className="set-row">
    <div><div className="set-row__label">{label}</div>{hint && <div className="set-row__hint">{hint}</div>}</div>
    <div className="set-row__ctl">{children}</div>
  </div>
);

/** Atalho global, bandeja e iniciar com o sistema. */
function PaletteCard() {
  const [status, setStatus] = React.useState(null);
  const [login, setLogin] = React.useState(null);
  React.useEffect(() => {
    window.devkit.palette.status().then(setStatus);
    window.devkit.app.loginItem().then(setLogin);
  }, []);
  const setOpenAtLogin = (v) => window.devkit.app.loginItem(v).then(setLogin);
  return (
    <Card padding={24}>
      <div className="tk-card__title">Command Palette</div>
      <Row label="Atalho global" hint="Abre a palette de qualquer lugar, mesmo com o Devkit minimizado ou na bandeja">
        <Kbd size="sm">Ctrl+Alt+Space</Kbd>
        {status && (status.registered
          ? <Badge size="sm" variant="ok" dot>ativo</Badge>
          : <Badge size="sm" variant="warn" dot>em uso por outro app</Badge>)}
      </Row>
      <Row label="Dentro da palette" hint="Digite para buscar em tudo · Alt+T/A/N categorias · Alt+Q Quick Note · Backspace volta · Esc fecha">
        <Kbd size="sm">Alt+T</Kbd><Kbd size="sm">Alt+A</Kbd><Kbd size="sm">Alt+N</Kbd><Kbd size="sm">Alt+Q</Kbd>
      </Row>
      <Row label="Iniciar com o Windows" hint="Sobe em segundo plano (só a bandeja), para o atalho funcionar desde o login">
        {login && login.supported
          ? <Toggle checked={login.openAtLogin} onChange={setOpenAtLogin} />
          : <Badge size="sm">indisponível</Badge>}
      </Row>
      <Row label="Fechar a janela" hint="O Devkit continua na bandeja do sistema; use Sair (bandeja ou palette) para encerrar">
        <Badge size="sm">vai para a bandeja</Badge>
      </Row>
    </Card>
  );
}

export function Settings({ prefs, setPrefs, info, sqlVersion }) {
  const shortcuts = [
    ['Command palette (global)', 'Ctrl+Alt+Space'],
    ['Command palette (no app)', mod('K')],
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
            <Select options={THEMES} value={prefs.theme} onChange={(theme) => setPrefs((p) => ({ ...p, theme }))} style={{ width: 200 }} />
          </Row>
          <Row label="Sidebar recolhida" hint="Mostra só os ícones das ferramentas">
            <Toggle checked={prefs.collapsed} onChange={(collapsed) => setPrefs((p) => ({ ...p, collapsed }))} />
          </Row>
        </Card>
        <PaletteCard />
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
