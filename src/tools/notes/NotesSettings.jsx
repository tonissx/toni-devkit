import { DS } from '../../lib/ds.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { formatSize } from '../../notes/attachments.js';

const { Modal, Input, Button, Icon, Select } = DS;

export const DEFAULT_PREFS = { autosaveMs: 400, undoSec: 8 };

const AUTOSAVE = [200, 400, 800, 1500, 3000].map((v) => ({ value: v, label: v < 1000 ? v + ' ms' : v / 1000 + ' s' }));
const UNDO = [5, 8, 15, 30].map((v) => ({ value: v, label: v + ' segundos' }));

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
