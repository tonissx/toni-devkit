'use strict';
/**
 * Orquestra a sincronização das Notes com o Google Drive: configuração do cliente OAuth, conexão/desconexão,
 * token, agendamento (ao abrir, a cada 5 min e logo depois que uma nota muda) e o status mostrado na tela.
 *
 * Arquivos em userData (nunca na pasta das notas):
 *   sync-google.json  { clientId, clientSecret }  — cliente OAuth "App para computador" do Google Cloud
 *   sync-tokens.json  refresh token cifrado (ver tokens.js)
 *   sync-state.json   { enabled, dir, base, lastRun } — a "base" do motor (hash de cada arquivo na última sincronização)
 */
const fs = require('node:fs/promises');
const { atomicWrite } = require('../lib/fsx.js');
const engine = require('./engine.js');
const oauth = require('./oauth.js');
const { createGDriveProvider } = require('./providers/gdrive.js');
const { createTokenStore } = require('./tokens.js');

const INTERVAL_MS = 5 * 60 * 1000;
const START_DELAY_MS = 4000;
const CHANGE_DELAY_MS = 20000;

const readJson = async (file) => { try { return JSON.parse(await fs.readFile(file, 'utf8')) || {}; } catch { return {}; } };

function createSyncManager({
  files, // { client, tokens, state } — caminhos em userData
  getService, // () => serviço de notas (dir, exclusive, reload)
  cipher, openExternal, broadcast = () => {}, fetchImpl = fetch,
  defaultClient = {}, // { clientId, clientSecret } de fábrica (opcional)
  intervalMs = INTERVAL_MS, startDelayMs = START_DELAY_MS, changeDelayMs = CHANGE_DELAY_MS,
}) {
  const tokens = createTokenStore({ file: files.tokens, cipher });
  // Cliente que veio com o app (build/ambiente). As credenciais próprias do usuário (sync-google.json) mandam sobre ele.
  const builtin = { clientId: defaultClient.clientId || '', clientSecret: defaultClient.clientSecret || '' };
  let client = { ...builtin };
  let custom = false;
  let state = { enabled: false, dir: null, base: {}, lastRun: null };
  let refreshToken = null;
  let access = { token: null, expiresAt: 0 };
  let running = null, pending = false;
  let timer = null, changeTimer = null;
  const status = { syncing: false, lastError: null, needsForce: false, lastResult: null };

  const snapshot = () => ({
    configured: !!(client.clientId && client.clientSecret),
    builtin: !!(builtin.clientId && builtin.clientSecret), // o app já vem com um cliente do Google: o usuário só conecta
    custom, // o usuário informou credenciais próprias
    clientId: custom ? client.clientId : '',
    encryptionAvailable: tokens.available(),
    connected: !!refreshToken && state.enabled,
    syncing: status.syncing,
    lastRun: state.lastRun,
    lastError: status.lastError,
    needsForce: status.needsForce,
    lastResult: status.lastResult,
  });
  const publish = () => broadcast(snapshot());
  // Gravações do estado em fila: o atomicWrite usa o mesmo arquivo temporário por processo, então duas ao mesmo tempo
  // (fim de uma rodada + desconectar) se atropelariam. O JSON é montado só na hora de gravar, com o estado mais novo.
  let saving = Promise.resolve();
  const saveState = () => {
    const run = saving.then(() => atomicWrite(files.state, JSON.stringify(state)));
    saving = run.catch(() => {});
    return run;
  };

  async function getToken(force = false) {
    if (!force && access.token && Date.now() < access.expiresAt - 60_000) return access.token;
    if (!refreshToken) throw new Error('Google Drive não está conectado.');
    const t = await oauth.refresh({ clientId: client.clientId, clientSecret: client.clientSecret, refreshToken, fetchImpl });
    access = { token: t.accessToken, expiresAt: t.expiresAt };
    return access.token;
  }

  function schedule() {
    clearInterval(timer); clearTimeout(changeTimer);
    timer = null; changeTimer = null;
    if (!refreshToken || !state.enabled) return;
    timer = setInterval(() => { self.syncNow().catch(() => {}); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  const self = {
    status: snapshot,

    /** Carrega configuração, token e estado do disco e agenda a primeira rodada. Chamar depois de notes.init(). */
    async start() {
      const c = await readJson(files.client);
      if (c.clientId) { client = { clientId: String(c.clientId), clientSecret: String(c.clientSecret || '') }; custom = true; }
      state = { enabled: false, dir: null, base: {}, lastRun: null, ...(await readJson(files.state)) };
      refreshToken = await tokens.load();
      if (!refreshToken) state.enabled = false;
      schedule();
      if (refreshToken && state.enabled) {
        changeTimer = setTimeout(() => { self.syncNow().catch(() => {}); }, startDelayMs);
        if (changeTimer.unref) changeTimer.unref();
      }
      publish();
      return snapshot();
    },

    stop() { clearInterval(timer); clearTimeout(changeTimer); timer = null; changeTimer = null; },

    /** Guarda o ID e o secret do cliente OAuth (Google Cloud → Credenciais → ID do cliente OAuth → App para computador). */
    async setClient({ clientId, clientSecret }) {
      if (refreshToken && state.enabled) throw new Error('Desconecte do Google Drive antes de trocar as credenciais.');
      const id = String(clientId || '').trim(), secret = String(clientSecret || '').trim();
      if (!id || !secret) throw new Error('Informe o ID do cliente e a chave secreta do cliente.');
      if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('O ID do cliente termina em “.apps.googleusercontent.com”.');
      client = { clientId: id, clientSecret: secret };
      custom = true;
      await atomicWrite(files.client, JSON.stringify(client));
      publish();
      return snapshot();
    },

    /** Esquece as credenciais próprias e volta ao cliente que veio com o app (se houver). */
    async clearClient() {
      if (refreshToken && state.enabled) throw new Error('Desconecte do Google Drive antes de trocar as credenciais.');
      await fs.rm(files.client, { force: true });
      client = { ...builtin };
      custom = false;
      publish();
      return snapshot();
    },

    /** Abre o login do Google no navegador; ao concluir guarda o token, liga o sync e faz a primeira rodada. */
    async connect() {
      if (!snapshot().configured) throw new Error('Configure o ID e a chave do cliente do Google antes de conectar.');
      if (!tokens.available()) throw new Error('O sistema não oferece criptografia para guardar o acesso ao Google com segurança.');
      const t = await oauth.authorize({ clientId: client.clientId, clientSecret: client.clientSecret, openExternal, fetchImpl });
      await tokens.save(t.refreshToken);
      refreshToken = t.refreshToken;
      access = { token: t.accessToken, expiresAt: t.expiresAt };
      state = { enabled: true, dir: getService().dir, base: {}, lastRun: null };
      status.lastError = null; status.needsForce = false;
      await saveState();
      schedule();
      publish();
      self.syncNow().catch(() => {});
      return snapshot();
    },

    /** Desliga o sync e esquece o acesso. As notas locais e os arquivos que já estão no Drive não são apagados. */
    async disconnect({ fromSync = false } = {}) {
      self.stop();
      refreshToken = null; access = { token: null, expiresAt: 0 }; // a rodada em andamento (se houver) falha no próximo pedido
      if (running && !fromSync) await running.catch(() => {}); // espera ela terminar antes de limpar o estado
      await tokens.clear();
      state = { enabled: false, dir: null, base: {}, lastRun: state.lastRun };
      status.lastError = null; status.needsForce = false; status.lastResult = null;
      await saveState();
      publish();
      return snapshot();
    },

    /** Uma nota mudou no app: agenda uma rodada em alguns segundos (várias mudanças seguidas viram uma). */
    touch() {
      if (!refreshToken || !state.enabled) return;
      if (status.syncing) { pending = true; return; }
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => { self.syncNow().catch(() => {}); }, changeDelayMs);
      if (changeTimer.unref) changeTimer.unref();
    },

    /** Uma rodada agora. Chamadas simultâneas dividem a mesma. `force` ignora a trava de exclusões em massa. */
    syncNow({ force = false } = {}) {
      if (running) return running;
      if (!refreshToken || !state.enabled) return Promise.reject(new Error('Google Drive não está conectado.'));
      running = (async () => {
        await null; // deixa `running` ser atribuído antes de qualquer `finally` abaixo
        status.syncing = true; status.lastError = null; status.needsForce = false; pending = false;
        publish();
        try {
          const svc = getService();
          if (state.dir && state.dir !== svc.dir) state.base = {}; // outra pasta de notas: recomeça sem apagar nada
          state.dir = svc.dir;
          const provider = createGDriveProvider({ getToken, fetchImpl });
          const r = await engine.sync({ dir: svc.dir, provider, state, exclusive: (fn) => svc.exclusive(fn), force });
          if (r.changedLocal) await svc.reload();
          state.lastRun = new Date().toISOString();
          status.lastResult = { uploaded: r.uploaded, downloaded: r.downloaded, deletedLocal: r.deletedLocal, deletedRemote: r.deletedRemote, conflicts: r.conflicts, errors: r.errors.length };
          if (r.errors.length) status.lastError = `${r.errors.length} arquivo(s) não sincronizaram: ${r.errors[0].key} — ${r.errors[0].error}`;
          return r;
        } catch (e) {
          if (e instanceof engine.GuardError) { status.needsForce = true; status.lastError = e.message; } else if (e && e.code === 'invalid_grant') {
            await self.disconnect({ fromSync: true }); // é esta rodada: esperar por ela aqui travaria
            status.lastError = 'O acesso ao Google expirou ou foi removido. Conecte de novo.';
          } else status.lastError = String((e && e.message) || e);
          throw e;
        } finally {
          status.syncing = false; running = null;
          await saveState().catch(() => {});
          publish();
          if (pending) self.touch(); // uma nota mudou durante a rodada
        }
      })();
      return running;
    },
  };
  return self;
}

module.exports = { createSyncManager };
