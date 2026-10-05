// Configurações → IA: desligada (padrão), Local (Ollama, com instalação guiada) ou Nuvem (API do Claude com a chave
// guardada no Vault). Mostra o que acontece em cada passo e um teste que mede o tempo na máquina da pessoa.
import { DS } from '../lib/ds.js';
import { LOCAL_MODELS, CLOUD_MODELS } from '../ai/prompts.js';

const { Card, SegmentedControl, Button, Badge, Select, Alert, ProgressBar, Spinner, Icon } = DS;
const api = () => window.devkit.ai;
const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const MODES = [
  { value: 'off', label: 'Desligada' },
  { value: 'local', label: 'Local (offline)' },
  { value: 'cloud', label: 'Nuvem (Claude)' },
];

const STEP_LABEL = { download: 'Baixando o instalador oficial', verify: 'Conferindo a assinatura digital', install: 'Instalando o Ollama', start: 'Esperando o Ollama iniciar', done: 'Pronto' };

// Diff pequeno de exemplo para o teste.
const SAMPLE_DIFF = 'diff --git a/src/login.js b/src/login.js\n--- a/src/login.js\n+++ b/src/login.js\n@@ -10,6 +10,9 @@ function validar(form) {\n   if (!form.usuario) throw new Error("Informe o usuário");\n+  if (!form.senha || form.senha.length < 8) {\n+    throw new Error("A senha precisa ter ao menos 8 caracteres");\n+  }\n   return true;\n }\n';

const Row = ({ label, hint, children }) => (
  <div className="set-row">
    <div><div className="set-row__label">{label}</div>{hint && <div className="set-row__hint">{hint}</div>}</div>
    <div className="set-row__ctl">{children}</div>
  </div>
);

const fmtSize = (b) => (b ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : '');

function LocalSection({ st, reload, toast }) {
  const [install, setInstall] = React.useState(null); // { step, percent } durante a instalação
  const [pull, setPull] = React.useState(null);       // { name, status, percent } durante o download do modelo
  const [error, setError] = React.useState(null);
  React.useEffect(() => api().onProgress((p) => {
    if (p.kind === 'install') setInstall({ step: p.step, percent: p.percent });
    if (p.kind === 'pull') setPull({ name: p.name, status: p.status, percent: p.percent });
  }), []);
  const local = st.local;
  const installed = local.models.map((m) => m.name);
  const model = st.config.localModel;

  const doInstall = async () => {
    setError(null); setInstall({ step: 'download', percent: 0 });
    try {
      const r = await api().installOllama();
      if (r.manual) { window.devkit.shell.openUrl(r.url); setInstall(null); return; }
      if (r.warning) toast('Ollama instalado', r.warning, 'warn');
      else toast('Ollama instalado', `Versão ${r.version || ''}`);
    } catch (e) { setError(errText(e)); }
    setInstall(null);
    reload();
  };
  const doPull = async (name) => {
    setError(null); setPull({ name, status: 'iniciando', percent: 0 });
    try {
      await api().pullModel(name);
      await api().setConfig({ localModel: name });
      toast('Modelo baixado', name);
    } catch (e) { setError(errText(e)); }
    setPull(null);
    reload();
  };

  if (!local.running) {
    return (
      <>
        <Row label="Ollama" hint="O programa que roda o modelo nesta máquina, sem internet. É instalado à parte, pelo próprio Devkit.">
          <Badge size="sm" variant="warn">não encontrado</Badge>
        </Row>
        {install ? (
          <div className="ai-progress">
            <div className="ai-progress__step"><Spinner size={13} /> {STEP_LABEL[install.step] || install.step}{install.percent != null && install.step === 'download' ? ` — ${install.percent}%` : ''}</div>
            {install.step === 'download' && <ProgressBar value={install.percent || 0} size="sm" />}
            {install.step === 'install' && <div className="set-row__hint">A janela do instalador mostra o andamento; não precisa responder nada.</div>}
          </div>
        ) : (
          <Alert variant="info" title={st.installable ? 'Instalar o Ollama pelo Devkit' : 'Instale o Ollama'}
            action={<Button variant="primary" icon={st.installable ? 'download' : 'external-link'} onClick={doInstall}>{st.installable ? 'Instalar o Ollama' : 'Abrir a página oficial'}</Button>}>
            {st.installable
              ? 'O Devkit baixa o instalador oficial (ollama.com), confere a assinatura digital — só executa se for da Ollama — e instala para o seu usuário, sem pedir administrador. O Ollama fica na bandeja, inicia com o Windows e é desinstalado à parte (Configurações do Windows → Apps). Depois você escolhe o modelo.'
              : 'Baixe e instale o Ollama pela página oficial; depois volte aqui para escolher o modelo.'}
          </Alert>
        )}
        {error && <Alert variant="error" title="Não deu certo">{error}</Alert>}
      </>
    );
  }

  const options = [...new Set([...LOCAL_MODELS.map((m) => m.id), ...installed])];
  return (
    <>
      <Row label="Ollama" hint={`Rodando nesta máquina (${st.config.endpoint}).`}>
        <Badge size="sm" variant="ok" dot>v{local.version}</Badge>
      </Row>
      <div className="ai-models">
        {options.map((id) => {
          const sug = LOCAL_MODELS.find((m) => m.id === id);
          const inst = local.models.find((m) => m.name === id);
          const busy = pull && pull.name === id;
          return (
            <div key={id} className={'ai-model' + (model === id ? ' is-sel' : '')}>
              <button type="button" className="ai-model__pick" disabled={!inst} onClick={() => api().setConfig({ localModel: id }).then(reload)} title={inst ? 'Usar este modelo' : 'Baixe primeiro'}>
                <span className={'ai-model__radio' + (model === id && inst ? ' is-on' : '')} />
                <span className="ai-model__main">
                  <b>{sug ? sug.label : id}</b>
                  <small>{id} · {inst ? fmtSize(inst.size) + ' · instalado' : `${sug ? sug.size : ''} para baixar`}{sug ? ' · ' + sug.note : ''}</small>
                </span>
              </button>
              {!inst && !busy && <Button size="sm" variant="secondary" icon="download" disabled={!!pull} onClick={() => doPull(id)}>Baixar</Button>}
              {busy && <span className="ai-model__pull"><ProgressBar value={pull.percent || 0} size="sm" /><small>{pull.percent != null ? pull.percent + '%' : pull.status}</small></span>}
            </div>
          );
        })}
      </div>
      {error && <Alert variant="error" title="Não deu certo">{error}</Alert>}
      {!installed.includes(model) && <div className="set-row__hint">Baixe um dos modelos acima para começar. O “Leve” é rápido mesmo sem placa de vídeo.</div>}
    </>
  );
}

function CloudSection({ st, reload }) {
  const [entries, setEntries] = React.useState(null);
  const [vault, setVault] = React.useState(null);
  React.useEffect(() => {
    window.devkit.vault.index().then((l) => setEntries(l.filter((e) => e.kind === 'api' || e.kind === 'other')), () => setEntries([]));
    window.devkit.vault.status().then(setVault, () => {});
  }, []);
  const set = (patch) => api().setConfig(patch).then(reload);
  return (
    <>
      <Alert variant="info" title="O que vai para a nuvem">Ao pedir uma sugestão, o diff do que está preparado e os títulos dos últimos commits são enviados para a API da Anthropic. Nada é enviado sem você clicar.</Alert>
      <Row label="Chave da API" hint="Guardada no Vault (entrada do tipo API/token). O Devkit só a lê na hora de chamar a API; ela nunca aparece na tela.">
        {entries == null ? <Spinner size={13} /> : entries.length ? (
          <Select size="sm" options={[{ value: '', label: 'Escolha…' }, ...entries.map((e) => ({ value: e.id, label: e.name }))]} value={st.config.vaultEntryId || ''} onChange={(v) => set({ vaultEntryId: v || null })} style={{ width: 220 }} />
        ) : <Button size="sm" variant="secondary" onClick={() => window.devkit.app.command({ type: 'go', route: 'vault' })}>Criar no Vault</Button>}
      </Row>
      {vault && !vault.unlocked && st.config.vaultEntryId && <div className="set-row__hint"><Icon name="lock" size={12} /> O cofre está bloqueado: desbloqueie-o para usar a IA na nuvem.</div>}
      <Row label="Modelo">
        <Select size="sm" options={CLOUD_MODELS.map((m) => ({ value: m.id, label: m.label }))} value={st.config.cloudModel} onChange={(v) => set({ cloudModel: v })} style={{ width: 220 }} />
      </Row>
    </>
  );
}

export function AiCard({ toast }) {
  const [st, setSt] = React.useState(null);
  const [test, setTest] = React.useState(null); // { busy, text, ms, error, model }
  const reload = React.useCallback(() => api().status().then(setSt), []);
  React.useEffect(() => { reload(); }, [reload]);
  React.useEffect(() => api().onChunk((p) => { if (p.requestId === 'teste') setTest((t) => (t && t.busy ? { ...t, text: (t.text || '') + p.chunk } : t)); }), []);

  const runTest = async () => {
    setTest({ busy: true, text: '' });
    try {
      const r = await api().generate('teste', 'commitMessage', { diff: SAMPLE_DIFF, recent: [] });
      setTest({ busy: false, text: r.text, ms: r.ms, model: r.model });
    } catch (e) { setTest({ busy: false, error: errText(e) }); }
  };

  if (!st) return <Card padding={24}><div className="tk-card__title">IA</div><Spinner size={14} /></Card>;
  const mode = st.config.mode;
  const ready = mode === 'local' ? st.local.running && st.local.models.some((m) => m.name === st.config.localModel) : mode === 'cloud' ? !!st.config.vaultEntryId : false;
  return (
    <Card padding={24}>
      <div className="tk-card__title">IA (opcional)</div>
      <Row label="Modo" hint="Desligada: nenhum recurso de IA aparece. Local: tudo nesta máquina, sem internet. Nuvem: API do Claude (melhor qualidade; envia o diff).">
        <SegmentedControl size="sm" options={MODES} value={mode} onChange={(v) => api().setConfig({ mode: v }).then(() => { setTest(null); reload(); })} />
      </Row>
      {mode === 'local' && <LocalSection st={st} reload={reload} toast={toast} />}
      {mode === 'cloud' && <CloudSection st={st} reload={reload} />}
      {mode !== 'off' && (
        <Row label="Testar" hint="Gera uma mensagem de commit para um diff de exemplo e mostra quanto tempo levou nesta máquina.">
          <Button variant="secondary" icon="sparkles" loading={test && test.busy} disabled={!ready} onClick={runTest}>Testar</Button>
        </Row>
      )}
      {test && (test.text || test.error) && (
        <div className={'ai-test' + (test.error ? ' is-error' : '')}>
          {test.error ? test.error : <><pre>{test.text}</pre>{!test.busy && <small>{test.model} · {(test.ms / 1000).toFixed(1).replace('.', ',')} s</small>}</>}
        </div>
      )}
      {mode !== 'off' && <div className="set-row__hint ai-where">Onde usar: Git → Mudanças → <b>Sugerir mensagem</b> na caixa de commit.</div>}
    </Card>
  );
}
