import { DS } from '../../lib/ds.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { formatSize } from '../../notes/attachments.js';

const { Modal, Input, Button, Icon, Select } = DS;

export const DEFAULT_PREFS = { autosaveMs: 400, undoSec: 8 };

const AUTOSAVE = [200, 400, 800, 1500, 3000].map((v) => ({ value: v, label: v < 1000 ? v + ' ms' : v / 1000 + ' s' }));
const UNDO = [5, 8, 15, 30].map((v) => ({ value: v, label: v + ' segundos' }));

/** "há 3 min" / data, para a última sincronização. */
function ago(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Sincronização com o Google Drive do próprio usuário (sem servidor do Devkit). As notas ficam na pasta privada
 * do app no Drive; o login é feito no navegador e o acesso fica cifrado neste computador.
 */
function DriveSync({ toast }) {
  const [st, setSt] = React.useState(null);
  const [id, setId] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(null); // 'connect' | 'now' | 'client' | 'off'
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    notesApi().syncStatus().then((s) => alive && setSt(s)).catch((e) => alive && setError(cleanError(e)));
    const off = notesApi().onSyncStatus((s) => alive && setSt(s));
    return () => { alive = false; off(); };
  }, []);

  const run = (kind, fn, okMsg) => async () => {
    setBusy(kind); setError(null);
    try { const r = await fn(); if (r) setSt(r); if (okMsg) toast('Google Drive', okMsg); return true; }
    catch (e) { setError(cleanError(e)); return false; }
    finally { setBusy(null); }
  };
  const saveClient = run('client', async () => { const s = await notesApi().syncSetClient({ clientId: id, clientSecret: secret }); setEditing(false); setSecret(''); return s; }, 'Credenciais salvas');
  const connect = run('connect', () => notesApi().syncConnect(), 'Conectado ao Google Drive');
  const syncNow = (force) => run('now', () => notesApi().syncNow({ force }), 'Sincronização concluída');
  const disconnect = run('off', () => notesApi().syncDisconnect(), 'Desconectado — suas notas continuam neste computador');

  if (!st) return <section className="nts-fset__sec"><h3>Google Drive</h3><small>{error || 'Carregando…'}</small></section>;
  const showForm = !st.configured || editing;
  const r = st.lastResult;

  return (
    <section className="nts-fset__sec">
      <h3>Google Drive (sem servidor)</h3>
      <small>O Devkit sincroniza suas notas, anexos e Lixeira com uma pasta <b>privada do app</b> no seu Google Drive (ela não aparece no site do Drive e o Devkit não vê nenhum outro arquivo seu). Use <b>ou</b> isto <b>ou</b> uma pasta sincronizada por Dropbox/OneDrive, não os dois. O histórico de versões e os links ficam só neste computador.</small>

      {showForm && (
        <>
          <small>Para usar sua conta é preciso um <b>cliente OAuth</b> gratuito do Google Cloud (tipo <i>App para computador</i>, com a <i>Google Drive API</i> ativa). Passo a passo em <code>docs/FEATURES.md</code>, seção “Sincronizar pelo Google Drive”.</small>
          <div className="nts-fset__row">
            <span className="nts-fset__label">ID do cliente</span>
            <div className="nts-fset__field"><Input size="sm" value={id} placeholder={st.clientId || 'xxxx.apps.googleusercontent.com'} aria-label="ID do cliente OAuth" onChange={(e) => setId(e.target.value)} /></div>
          </div>
          <div className="nts-fset__row">
            <span className="nts-fset__label">Chave secreta</span>
            <div className="nts-fset__field"><Input size="sm" type="password" value={secret} aria-label="Chave secreta do cliente OAuth" onChange={(e) => setSecret(e.target.value)} /></div>
          </div>
          <div className="nts-fset__actions">
            <Button size="sm" variant="primary" disabled={!!busy || !id.trim() || !secret.trim()} onClick={saveClient}>Salvar credenciais</Button>
            {editing && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>}
          </div>
        </>
      )}

      {st.configured && !st.connected && !editing && (
        <>
          {!st.encryptionAvailable && <div className="nts-dialog__warn" role="status"><Icon name="triangle-alert" size={13} /> Este sistema não oferece criptografia para guardar o acesso ao Google. Não dá para conectar.</div>}
          <div className="nts-fset__actions">
            <Button size="sm" variant="primary" icon="cloud" disabled={!!busy || !st.encryptionAvailable} onClick={connect}>{busy === 'connect' ? 'Aguardando o login no navegador…' : 'Conectar ao Google Drive'}</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing(true)}>Alterar credenciais</Button>
          </div>
          <small>Vai abrir o navegador para você entrar na sua conta Google e autorizar. Na primeira sincronização as notas deste computador e as do Drive são <b>somadas</b> — nada é apagado.</small>
        </>
      )}

      {st.connected && (
        <>
          <div className="nts-fset__path" role="status">
            <Icon name="cloud" size={13} /> Conectado · {st.syncing ? 'sincronizando…' : <>última sincronização: {ago(st.lastRun)}</>}
          </div>
          {r && !st.syncing && <small>Última rodada: {r.uploaded} enviados · {r.downloaded} baixados · {r.deletedLocal + r.deletedRemote} excluídos · {r.conflicts} conflitos{r.errors ? ` · ${r.errors} com erro` : ''}.</small>}
          <div className="nts-fset__actions">
            <Button size="sm" variant="secondary" icon="refresh-cw" disabled={!!busy || st.syncing} onClick={syncNow(false)}>Sincronizar agora</Button>
            <Button size="sm" variant="ghost" icon="log-out" disabled={!!busy} onClick={disconnect}>Desconectar</Button>
          </div>
          <small>Sincroniza sozinho ao abrir, a cada 5 minutos e logo depois de você editar. Se dois computadores editarem a mesma nota, a edição mais recente fica na nota e a outra vira uma cópia “… (conflito)”. Desconectar não apaga nada, nem aqui nem no Drive.</small>
        </>
      )}

      {st.needsForce && (
        <div className="nts-dialog__warn" role="alert">
          <Icon name="triangle-alert" size={13} /> {st.lastError}
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={syncNow(true)}>Sincronizar mesmo assim</Button>
        </div>
      )}
      {(error || (st.lastError && !st.needsForce)) && <div className="nts-dialog__error" role="alert">{error || st.lastError}</div>}
    </section>
  );
}

/**
 * Configurações de Notes. A pasta das notas e os limites do histórico são do app (processo principal); o tempo
 * do auto-save e a janela de desfazer são só desta tela (`prefs`, no localStorage).
 */
export function NotesSettingsModal({ prefs, setPrefs, toast, onClose }) {
  const [cfg, setCfg] = React.useState(null);
  const [max, setMax] = React.useState('');
  const [gap, setGap] = React.useState('');
  const [error, setError] = React.useState(null);
  const [restart, setRestart] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [orphans, setOrphans] = React.useState(null); // { count, bytes } depois de "Verificar anexos não usados"

  const load = React.useCallback(async () => {
    const c = await notesApi().settings();
    setCfg(c); setMax(String(c.historyMax)); setGap(String(c.historyGapMin));
    setRestart(!!c.customDir && c.customDir !== c.dir && !c.envLocked);
  }, []);
  React.useEffect(() => { load().catch((e) => setError(cleanError(e))); }, [load]);

  const apply = async (patch) => {
    setBusy(true); setError(null);
    try { const r = await notesApi().setSettings(patch); await load(); if (r.restart) setRestart(true); return true; }
    catch (e) { setError(cleanError(e)); return false; }
    finally { setBusy(false); }
  };
  const pickDir = async () => { const d = await notesApi().pickDir(); if (d) apply({ dir: d }); };
  const saveHistory = async () => { if (await apply({ historyMax: Number(max), historyGapMin: Number(gap) })) toast('Configurações salvas', 'Histórico atualizado'); };
  const histDirty = cfg && (Number(max) !== cfg.historyMax || Number(gap) !== cfg.historyGapMin);

  const toggleSync = async (on) => { if (await apply({ syncFolder: on })) toast('Configurações salvas', on ? 'Pasta sincronizada: o Devkit vigia mudanças de fora' : 'Vigia da pasta desligado'); };
  const reloadDisk = async () => {
    setBusy(true); setError(null);
    try {
      const r = await notesApi().reload();
      const n = r.added + r.updated + r.removed;
      toast('Notas recarregadas', n ? `${r.added} novas · ${r.updated} alteradas · ${r.removed} removidas` : 'Nada mudou no disco');
    } catch (e) { setError(cleanError(e)); } finally { setBusy(false); }
  };

  const checkAssets = async () => {
    setBusy(true); setError(null);
    try { setOrphans(await notesApi().orphanAssets()); } catch (e) { setError(cleanError(e)); } finally { setBusy(false); }
  };
  const cleanAssets = async () => {
    setBusy(true); setError(null);
    try {
      const r = await notesApi().cleanAssets();
      setOrphans(await notesApi().orphanAssets()); // o que sobrou (em uso por outro programa, por exemplo)
      toast('Anexos limpos', `${r.removed} ${r.removed === 1 ? 'arquivo removido' : 'arquivos removidos'} (${formatSize(r.bytes)})`);
    } catch (e) { setError(cleanError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon="settings" title="Configurações de Notes" width={520}
      footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      {!cfg ? <div className="nts-list__msg">{error || 'Carregando…'}</div> : (
        <div className="nts-fset">
          <section className="nts-fset__sec">
            <h3>Pasta das notas</h3>
            <div className="nts-fset__path" title={cfg.dir}><Icon name="folder" size={13} /> <code>{cfg.dir}</code></div>
            {cfg.envLocked ? (
              <small>Definida pela variável de ambiente <code>DEVKIT_NOTES_DIR</code> — ela manda sobre esta tela.</small>
            ) : (
              <>
                <div className="nts-fset__actions">
                  <Button size="sm" variant="secondary" icon="folder-open" disabled={busy} onClick={pickDir}>Alterar…</Button>
                  {cfg.customDir && <Button size="sm" variant="ghost" icon="rotate-ccw" disabled={busy} onClick={() => apply({ dir: null })}>Usar a padrão</Button>}
                  <Button size="sm" variant="ghost" icon="external-link" onClick={() => notesApi().openFolder()}>Abrir</Button>
                </div>
                <small>As notas que já existem <b>não são movidas</b>: copie os arquivos .md (e as pastas) para a nova pasta antes de reiniciar. Padrão: <code>{cfg.defaultDir}</code>.</small>
                {restart && (
                  <div className="nts-dialog__warn" role="status">
                    <Icon name="triangle-alert" size={13} /> A nova pasta só vale depois de reiniciar o Devkit.
                    <Button size="sm" variant="secondary" icon="refresh-cw" onClick={() => notesApi().relaunch()}>Reiniciar agora</Button>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="nts-fset__sec">
            <h3>Sincronização entre computadores</h3>
            <small>O Devkit não tem servidor: para ter as mesmas notas em dois PCs, aponte a pasta das notas para uma pasta que o Dropbox, OneDrive, Google Drive, iCloud ou Syncthing já sincronize, e use a mesma pasta nos dois.</small>
            <label className="nts-fset__row">
              <input type="checkbox" checked={!!cfg.syncFolder} disabled={busy} onChange={(e) => toggleSync(e.target.checked)} />
              <span>Esta pasta é sincronizada por outro programa</span>
            </label>
            <small>Liga a vigia da pasta: o que o outro PC alterar aparece aqui sem reiniciar (a sua versão anterior vai para o histórico). Se os dois PCs editarem a mesma nota ao mesmo tempo, a mais recente vale e a outra é guardada como “… (conflito)”. Anexos sem uso só são apagados depois de 24 h, porque podem chegar antes da nota que os cita. O histórico (<code>.devkit/history</code>) fica na pasta e também sincroniza — pode excluí-lo do sync se preferir.</small>
            <div className="nts-fset__actions">
              <Button size="sm" variant="secondary" icon="refresh-cw" disabled={busy} onClick={reloadDisk}>Recarregar do disco</Button>
            </div>
          </section>

          <DriveSync toast={toast} />

          <section className="nts-fset__sec">
            <h3>Histórico de versões</h3>
            <div className="nts-fset__row">
              <span className="nts-fset__label">Versões por nota</span>
              <div className="nts-fset__field"><Input size="sm" type="number" min={5} max={500} value={max} aria-label="Versões por nota" onChange={(e) => setMax(e.target.value)} /></div>
            </div>
            <div className="nts-fset__row">
              <span className="nts-fset__label">Intervalo (min)</span>
              <div className="nts-fset__field">
                <Input size="sm" type="number" min={1} max={240} value={gap} aria-label="Minutos entre versões" onChange={(e) => setGap(e.target.value)} />
                <small>Digitar sem parar gera uma versão a cada tantos minutos, não uma por tecla.</small>
              </div>
            </div>
            <div className="nts-fset__actions"><Button size="sm" variant="primary" disabled={busy || !histDirty} onClick={saveHistory}>Salvar histórico</Button></div>
          </section>

          <section className="nts-fset__sec">
            <h3>Anexos</h3>
            <small>Imagens e arquivos anexados ficam em <code>.assets</code>. Quando uma nota é excluída de vez (Lixeira), os anexos que só ela usava são apagados junto. Se você tirar o link de um anexo do texto, ele fica no disco até esta limpeza.</small>
            <div className="nts-fset__actions">
              <Button size="sm" variant="secondary" icon="search" disabled={busy} onClick={checkAssets}>Verificar anexos não usados</Button>
              {orphans && orphans.count > 0 && <Button size="sm" variant="primary" icon="trash-2" disabled={busy} onClick={cleanAssets}>Limpar agora</Button>}
            </div>
            {orphans && (
              <small role="status">
                {orphans.count
                  ? <>{orphans.count} {orphans.count === 1 ? 'arquivo' : 'arquivos'} ({formatSize(orphans.bytes)}) não {orphans.count === 1 ? 'é usado' : 'são usados'} por nenhuma nota. Versões antigas do histórico que citem esses arquivos passam a mostrar o link quebrado. Anexos de menos de 10 minutos ficam de fora.</>
                  : 'Nenhum anexo sobrando.'}
              </small>
            )}
          </section>

          <section className="nts-fset__sec">
            <h3>Edição</h3>
            <div className="nts-fset__row">
              <span className="nts-fset__label">Auto-save</span>
              <div className="nts-fset__field">
                <Select size="sm" options={AUTOSAVE} value={prefs.autosaveMs} onChange={(v) => setPrefs((p) => ({ ...p, autosaveMs: v }))} />
                <small>Espera depois da última tecla antes de gravar. Vale para as notas abertas a partir de agora.</small>
              </div>
            </div>
            <div className="nts-fset__row">
              <span className="nts-fset__label">Desfazer exclusão</span>
              <div className="nts-fset__field">
                <Select size="sm" options={UNDO} value={prefs.undoSec} onChange={(v) => setPrefs((p) => ({ ...p, undoSec: v }))} />
                <small>Quanto tempo o botão “Desfazer” fica na tela depois de excluir uma nota ou pasta.</small>
              </div>
            </div>
          </section>
          {error && <div className="nts-dialog__error" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
