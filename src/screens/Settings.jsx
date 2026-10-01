import { DS, mod } from '../lib/ds.js';
import { THEMES } from '../lib/themes.js';
import { acceleratorFromEvent, acceleratorLabel } from '../commands/binds.js';
import { LinksCard } from './LinksCard.jsx';

const { PageHeader, Card, Select, Kbd, Badge, Toggle, Alert, Button } = DS;

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

/**
 * Smart Binds: atalhos globais que rodam um comando sem abrir o Devkit (ver electron/binds.js).
 * "Gravar" desliga os binds enquanto espera a tecla — senão o próprio atalho seria engolido pelo sistema.
 */
function BindsCard({ onChange }) {
  const [state, setState] = React.useState(null);
  const [recording, setRecording] = React.useState(null);
  const [hint, setHint] = React.useState(null);
  const api = window.devkit.binds;

  const update = (s) => { setState(s); onChange && onChange(s); };
  React.useEffect(() => { api.get().then(update); }, []);

  const save = (next) => api.set(next).then(update);
  const stopRecording = () => { setRecording(null); setHint(null); };

  React.useEffect(() => {
    if (!recording) return undefined;
    api.suspend(true);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) { stopRecording(); api.suspend(false).then(update); return; }
      const acc = acceleratorFromEvent(e);
      if (!acc) { if (!/^(Control|Shift|Alt|Meta)/.test(e.code)) setHint('Use Ctrl ou Alt + uma tecla'); return; }
      if (acc.toLowerCase() === 'control+alt+space') { setHint('Ctrl+Alt+Space é o atalho da palette'); return; }
      // O mesmo atalho em outro comando passa para este.
      const next = {};
      for (const [id, a] of Object.entries(state.binds)) if (a.toLowerCase() !== acc.toLowerCase()) next[id] = a;
      next[recording] = acc;
      stopRecording();
      save(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);
  // Saiu da tela gravando: religa os atalhos.
  const recRef = React.useRef(null);
  recRef.current = recording;
  React.useEffect(() => () => { if (recRef.current) api.suspend(false); }, []);

  if (!state) return null;
  const clear = (id) => { const next = { ...state.binds }; delete next[id]; save(next); };
  return (
    <Card padding={24}>
      <div className="tk-card__title">Smart Binds</div>
      <Row label="Como usar" hint="Copie o texto, aperte o atalho e cole — o Devkit formata o clipboard sem abrir janela, com as opções salvas em cada ferramenta">
        <Button variant="ghost" size="sm" onClick={() => save(state.defaults)}>Restaurar padrão</Button>
      </Row>
      {state.bindable.map(({ id, name }) => {
        const acc = state.binds[id];
        const st = state.status[id];
        const isRec = recording === id;
        return (
          <Row key={id} label={name} hint={isRec ? (hint || 'Pressione o novo atalho · Esc cancela') : undefined}>
            {isRec ? <Badge size="sm" variant="info" dot>gravando…</Badge>
              : acc ? <Kbd size="sm">{acceleratorLabel(acc)}</Kbd>
              : <Badge size="sm">sem atalho</Badge>}
            {!isRec && acc && st && (st.registered
              ? <Badge size="sm" variant="ok" dot>ativo</Badge>
              : <Badge size="sm" variant="warn" dot>em uso por outro app</Badge>)}
            {!isRec && <Button variant="secondary" size="sm" disabled={!!recording} onClick={() => { setHint(null); setRecording(id); }}>Gravar</Button>}
            {!isRec && acc && <Button variant="ghost" size="sm" disabled={!!recording} onClick={() => clear(id)}>Limpar</Button>}
          </Row>
        );
      })}
    </Card>
  );
}

/** Verificar/baixar/instalar atualizações (ver electron/updater/service.js). */
function UpdaterCard({ updater }) {
  const [busy, setBusy] = React.useState(false);
  const check = () => { setBusy(true); window.devkit.updater.check().finally(() => setBusy(false)); };

  if (!updater || updater.mode === 'unsupported') {
    return (
      <Card padding={24}>
        <div className="tk-card__title">Atualizações</div>
        <Row label="Verificar atualizações" hint="Indisponível nesta build (modo de desenvolvimento)">
          <Badge size="sm">indisponível</Badge>
        </Row>
      </Card>
    );
  }

  const checkOnly = updater.mode === 'check-only';
  return (
    <Card padding={24}>
      <div className="tk-card__title">Atualizações</div>
      {checkOnly && (
        <Row label="Modo" hint="macOS e a versão portátil não se atualizam sozinhas — só avisam quando há versão nova">
          <Badge size="sm">somente aviso</Badge>
        </Row>
      )}
      <Row label="Versão instalada"><Badge size="sm" mono>v{updater.version}</Badge></Row>
      {updater.status === 'error' && <Alert variant="error" title="Erro ao verificar">{updater.error}</Alert>}
      {(updater.status === 'idle' || updater.status === 'not-available' || updater.status === 'error') && (
        <Row label="Buscar nova versão">
          <Button variant="secondary" loading={busy || updater.status === 'checking'} onClick={check}>Verificar atualizações</Button>
        </Row>
      )}
      {updater.status === 'available' && (
        <Alert variant="info" title={`Versão ${updater.latestVersion} disponível`}
          action={checkOnly
            ? <Button variant="primary" onClick={() => window.devkit.shell.openUrl(updater.releaseUrl)}>Abrir página da release</Button>
            : <Button variant="primary" onClick={() => window.devkit.updater.download()}>Baixar</Button>} />
      )}
      {updater.status === 'downloading' && (
        <Alert variant="info" title="Baixando atualização…">
          {updater.progress ? Math.round(updater.progress.percent) + '%' : ''}
        </Alert>
      )}
      {updater.status === 'downloaded' && (
        <Alert variant="ok" title="Atualização pronta"
          action={<Button variant="primary" onClick={() => window.devkit.updater.install()}>Reiniciar e instalar</Button>}>
          Versão {updater.latestVersion} baixada.
        </Alert>
      )}
    </Card>
  );
}

export function Settings({ prefs, setPrefs, info, sqlVersion, updater, toast }) {
  const [binds, setBinds] = React.useState(null);
  const shortcuts = [
    ['Command palette (global)', 'Ctrl+Alt+Space'],
    ...(binds ? binds.bindable.filter((b) => binds.binds[b.id]).map((b) => [b.name + ' (global)', acceleratorLabel(binds.binds[b.id])]) : []),
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
        <LinksCard toast={toast} />
        <BindsCard onChange={setBinds} />
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
        <UpdaterCard updater={updater} />
      </div>
    </div>
  );
}
