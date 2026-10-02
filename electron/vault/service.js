'use strict';
/**
 * Vault — cofre local de dados sensíveis (senhas de banco, tokens…), protegido por senha mestra.
 *
 * - Arquivo: %APPDATA%\Toni Devkit\vault.json (fora de Documentos\Devkit Notes, que pode ir para OneDrive/git).
 *   Todo o conteúdo — nomes inclusive — é criptografado (src/vault/crypto.js); trancado, o Devkit não sabe nada.
 * - Aberto, a chave e as entradas ficam só aqui no processo principal. As janelas recebem metadados (segredos =
 *   null); um segredo só sai daqui para o clipboard (`copy`) ou, sob pedido explícito, para o olho da tela (`reveal`).
 * - Auto-lock por inatividade (só ações do usuário contam: listar/abrir a palette não prolonga), e também ao
 *   bloquear a tela/suspender (electron/main.js).
 * - Copiar: o texto vai para o clipboard marcado para ficar fora do histórico do Windows (Win+V) e da nuvem
 *   (`writeSecret`), e é apagado depois de `clearSeconds` se ainda for ele que estiver lá.
 * - Senha errada: a partir da 3ª seguida, espera crescente (1 s, 2 s, 4 s… até 60 s) antes de aceitar outra.
 *
 * Dependências por parâmetro para o serviço ser testável no Node (relógio, timers, clipboard).
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, createQueue } = require('../lib/fsx');
const vc = require('../../src/vault/crypto.js');
const { normalizeEntry, metaOf, primaryIndex, connectionString, sameName, cleanName } = require('../../src/vault/entry.js');

const DEFAULT_SETTINGS = { autoLockMin: 10, clearSeconds: 30 };
const AUTO_LOCK_OPTIONS = [1, 5, 10, 15, 30, 60];
const CLEAR_OPTIONS = [10, 20, 30, 60, 120];

function createVaultService({
  file,
  clipboard,                       // { readText(), clear() }
  writeSecret,                     // (text) → Promise: grava no clipboard fora do histórico (fallback: writeText)
  broadcast = () => {},
  now = () => Date.now(),
  timers = { setTimeout, clearTimeout },
  kdfParams = {},                  // testes: { N: 2 ** 12 }
}) {
  const queue = createQueue();
  let env = null;      // envelope em disco (ou null se o cofre não existe)
  let key = null;      // chave AES derivada (só com o cofre aberto)
  let data = null;     // { entries: [], settings: {} } (só com o cofre aberto)
  let lockTimer = null;
  let clearTimer = null;
  let failures = 0;
  let waitUntil = 0;
  let unlocking = null;

  const settings = () => ({ ...DEFAULT_SETTINGS, ...((data && data.settings) || {}) });
  const isOpen = () => !!(key && data);
  const changed = (reason) => broadcast({ reason, unlocked: isOpen() });

  async function init() {
    try { env = JSON.parse(await fs.readFile(file, 'utf8')); vc.assertEnvelope(env); } catch (e) {
      if (e.code === 'ENOENT') { env = null; return; }
      // Arquivo ilegível: não sobrescreve nada; o status mostra o erro.
      env = { broken: String((e && e.message) || e) };
    }
  }

  function status() {
    const s = settings();
    return {
      exists: !!env && !env.broken,
      broken: env && env.broken ? env.broken : null,
      unlocked: isOpen(),
      count: isOpen() ? data.entries.length : null,
      waitMs: Math.max(0, waitUntil - now()),
      autoLockMin: s.autoLockMin,
      clearSeconds: s.clearSeconds,
      autoLockOptions: AUTO_LOCK_OPTIONS,
      clearOptions: CLEAR_OPTIONS,
      file,
    };
  }

  /** Reinicia a contagem do auto-lock (chamado nas ações do usuário). */
  function touch() {
    if (lockTimer) timers.clearTimeout(lockTimer);
    lockTimer = null;
    if (!isOpen()) return;
    lockTimer = timers.setTimeout(() => lock('auto'), settings().autoLockMin * 60 * 1000);
    if (lockTimer && lockTimer.unref) lockTimer.unref();
  }

  function requireOpen() {
    if (!isOpen()) { const e = new Error('O cofre está bloqueado'); e.code = 'LOCKED'; throw e; }
    touch();
  }

  const persist = () => queue.run('vault', async () => {
    env = vc.seal(key, env.kdf, data);
    await atomicWrite(file, JSON.stringify(env, null, 1));
  });

  async function create(password) {
    if (env) throw new Error(env.broken ? 'O arquivo do cofre está ilegível — use “Esqueci a senha” para guardá-lo de lado' : 'O cofre já existe');
    const problem = vc.passwordProblem(password);
    if (problem) throw new Error(problem);
    const kdf = vc.newKdf(kdfParams);
    key = await vc.deriveKey(password, kdf);
    data = { entries: [], settings: { ...DEFAULT_SETTINGS } };
    env = { kdf };
    await persist();
    failures = 0; waitUntil = 0;
    touch();
    changed('create');
    return status();
  }

  async function unlock(password) {
    if (isOpen()) return status();
    if (!env || env.broken) throw new Error(env ? env.broken : 'Ainda não há cofre — crie um');
    const wait = waitUntil - now();
    if (wait > 0) throw new Error(`Muitas tentativas — aguarde ${Math.ceil(wait / 1000)} s`);
    if (unlocking) return unlocking; // duplo Enter: uma derivação só
    unlocking = (async () => {
      try {
        const k = await vc.deriveKey(password, env.kdf);
        const d = vc.open(k, env);
        key = k;
        data = { entries: Array.isArray(d.entries) ? d.entries : [], settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
        failures = 0; waitUntil = 0;
        touch();
        changed('unlock');
        return status();
      } catch (e) {
        if (e.code !== 'WRONG_PASSWORD') throw e;
        failures++;
        if (failures >= 3) waitUntil = now() + Math.min(60000, 1000 * 2 ** (failures - 3));
        throw e;
      } finally { unlocking = null; }
    })();
    return unlocking;
  }

  /** Tranca: esquece chave e entradas (o arquivo continua igual). */
  function lock(reason = 'manual') {
    if (lockTimer) timers.clearTimeout(lockTimer);
    lockTimer = null;
    const was = isOpen();
    key = null; data = null;
    if (was) changed('lock:' + reason);
    return status();
  }

  /** Metadados de todas as entradas (sem segredos). null se trancado. Não conta como atividade. */
  function list() {
    if (!isOpen()) return null;
    return data.entries.map(metaOf).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }

  const find = (id) => {
    const e = data.entries.find((x) => x.id === id);
    if (!e) throw new Error('A entrada não existe mais');
    return e;
  };

  /** Notas: nome → metadados (ou null se não existe). Trancado → { locked: true }. */
  function resolve(names) {
    const list = Array.isArray(names) ? names.slice(0, 50) : [];
    if (!isOpen()) return { locked: true, exists: !!env && !env.broken, items: {} };
    const items = {};
    for (const n of list) {
      const e = data.entries.find((x) => sameName(x.name, n));
      items[n] = e ? metaOf(e) : null;
    }
    return { locked: false, exists: true, items };
  }

  async function save(raw) {
    requireOpen();
    const prev = raw && raw.id ? data.entries.find((x) => x.id === raw.id) || null : null;
    const next = normalizeEntry(raw, prev, new Date(now()));
    if (data.entries.some((x) => x.id !== next.id && sameName(x.name, next.name))) throw new Error(`Já existe uma entrada chamada “${next.name}”`);
    data.entries = prev ? data.entries.map((x) => (x.id === next.id ? next : x)) : [...data.entries, next];
    await persist();
    changed('save');
    return metaOf(next);
  }

  async function remove(id) {
    requireOpen();
    find(id);
    data.entries = data.entries.filter((x) => x.id !== id);
    await persist();
    changed('remove');
    return true;
  }

  /** O valor de um campo secreto, para o "olho" da tela. Só sob clique explícito. */
  function reveal(id, index) {
    requireOpen();
    const f = find(id).fields[index];
    if (!f) throw new Error('Campo inexistente');
    return f.value;
  }

  /**
   * Copia para o clipboard: what = índice do campo | 'primary' | 'connstr' | 'jdbc'.
   * → { label, clearsIn } (segundos até apagar).
   */
  async function copy(id, what = 'primary') {
    requireOpen();
    const e = find(id);
    let text, label;
    if (what === 'connstr' || what === 'jdbc') {
      text = connectionString(e, what === 'jdbc' ? 'jdbc' : 'sqlserver');
      label = what === 'jdbc' ? 'URL JDBC' : 'Connection string';
    } else {
      const i = what === 'primary' ? primaryIndex(e) : Number(what);
      const f = e.fields[i];
      if (!f) throw new Error('A entrada não tem um campo secreto');
      text = f.value;
      label = f.name;
    }
    if (!text) throw new Error(`“${label}” está vazio`);
    await writeSecret(text);
    const secs = settings().clearSeconds;
    if (clearTimer) timers.clearTimeout(clearTimer);
    clearTimer = timers.setTimeout(() => {
      clearTimer = null;
      try { if (clipboard.readText() === text) clipboard.clear(); } catch { /* clipboard ocupado: deixa */ }
    }, secs * 1000);
    if (clearTimer && clearTimer.unref) clearTimer.unref();
    return { label, name: e.name, clearsIn: secs };
  }

  async function setSettings(next) {
    requireOpen();
    const s = { ...settings() };
    if (next && AUTO_LOCK_OPTIONS.includes(Number(next.autoLockMin))) s.autoLockMin = Number(next.autoLockMin);
    if (next && CLEAR_OPTIONS.includes(Number(next.clearSeconds))) s.clearSeconds = Number(next.clearSeconds);
    data.settings = s;
    await persist();
    touch();
    changed('settings');
    return status();
  }

  async function changePassword(current, next) {
    requireOpen();
    const problem = vc.passwordProblem(next);
    if (problem) throw new Error(problem);
    // Confere a senha atual de verdade (quem achou o Devkit aberto não troca a senha sem saber a antiga).
    const k = await vc.deriveKey(current, env.kdf);
    vc.open(k, env);
    const kdf = vc.newKdf(kdfParams);
    key = await vc.deriveKey(next, kdf);
    env = { kdf };
    await persist();
    changed('password');
    return status();
  }

  /** Cópia do arquivo (já criptografado) para `dest`. */
  async function exportTo(dest) {
    requireOpen();
    await queue.flush();
    await fs.copyFile(file, dest);
    return { path: dest, name: path.basename(dest) };
  }

  /**
   * Esqueceu a senha: tira o cofre do caminho (renomeia para vault-<data>.bak.json — continua criptografado,
   * dá para voltar se lembrar a senha) e permite criar outro.
   */
  async function reset(confirm) {
    if (confirm !== 'APAGAR') throw new Error('Digite APAGAR para confirmar');
    lock('reset');
    await queue.flush();
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    try { await fs.rename(file, path.join(path.dirname(file), `vault-${stamp}.bak.json`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    env = null; failures = 0; waitUntil = 0;
    changed('reset');
    return status();
  }

  return {
    init, status, create, unlock, lock, list, resolve, save, remove, reveal, copy, setSettings, changePassword,
    exportTo, reset, flush: () => queue.flush(),
    /** Só testes. */
    _peek: () => ({ env, failures }),
  };
}

module.exports = { createVaultService, DEFAULT_SETTINGS, cleanName };
