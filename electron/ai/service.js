'use strict';
/**
 * IA (processo principal) — opcional e desligada por padrão. Dois provedores atrás da mesma interface:
 *   local  → Ollama em 127.0.0.1 (nada sai do computador; funciona offline)
 *   cloud  → API do Claude pelo SDK oficial; a chave vem do Vault (getApiKey) e nunca chega ao renderer
 *
 * Também faz a instalação guiada do Ollama no Windows: baixa o instalador oficial (endereço fixo), confere a
 * assinatura digital (tem de ser da Ollama) e só então executa; depois baixa o modelo pela API do próprio Ollama.
 * Configuração em %APPDATA%\Toni Devkit\ai.json (modo, modelos, id da entrada do Vault — nunca a chave).
 * Os prompts (o que é enviado) estão em src/ai/tasks.js; a tela mostra o mesmo texto antes de enviar.
 */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn: nodeSpawn } = require('node:child_process');
const { atomicWrite } = require('../lib/fsx');
const { CLOUD_MODELS, validModelName, pullProgress } = require('../../src/ai/prompts.js');
const { TASKS } = require('../../src/ai/tasks.js');

const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';
const DEFAULTS = { mode: 'off', endpoint: 'http://127.0.0.1:11434', localModel: 'qwen2.5-coder:3b', cloudModel: CLOUD_MODELS[0].id, vaultEntryId: null };

/** Só endereços desta máquina: o modo Local nunca pode virar "nuvem" por engano. */
const localEndpoint = (u) => { try { const x = new URL(u); return x.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(x.hostname); } catch { return false; } };

/** Lê um corpo NDJSON em streaming, chamando onLine para cada linha completa. */
async function readNdjson(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
  }
  if (buf.trim()) onLine(buf.trim());
}

/** Confere a assinatura Authenticode de um arquivo (Windows): válida e emitida para a Ollama. */
function defaultVerifySignature(file) {
  return new Promise((resolve) => {
    const script = '$s = Get-AuthenticodeSignature -LiteralPath $env:DK_FILE; ' +
      '[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, DK_FILE: file }, windowsHide: true, timeout: 60e3 }, (err, stdout) => {
      if (err) return resolve({ ok: false, reason: 'não foi possível conferir a assinatura' });
      try {
        const r = JSON.parse(stdout);
        const ok = r.status === 'Valid' && /(^|,\s*)O=Ollama Inc\.(,|$)/.test(r.subject || '');
        resolve({ ok, status: r.status, subject: r.subject, reason: ok ? null : `assinatura ${r.status === 'Valid' ? 'de outro emissor' : 'inválida'} (${r.subject || 'sem certificado'})` });
      } catch { resolve({ ok: false, reason: 'resposta inesperada ao conferir a assinatura' }); }
    });
  });
}

function createAiService({ file, getApiKey = async () => null, fetch: f = globalThis.fetch, spawn = nodeSpawn, verifySignature = defaultVerifySignature, Anthropic = null, platform = process.platform, tmpDir = os.tmpdir() }) {
  let config = { ...DEFAULTS };
  const running = new Map(); // requestId → AbortController

  async function init() {
    try { config = { ...DEFAULTS, ...JSON.parse(await fs.readFile(file, 'utf8')) }; } catch { /* sem arquivo: padrões */ }
    if (!localEndpoint(config.endpoint)) config.endpoint = DEFAULTS.endpoint;
    return getConfig();
  }
  const getConfig = () => ({ ...config });

  async function setConfig(patch = {}) {
    const next = { ...config };
    if (patch.mode !== undefined) { if (!['off', 'local', 'cloud'].includes(patch.mode)) throw new Error('Modo inválido'); next.mode = patch.mode; }
    if (patch.localModel !== undefined) { if (!validModelName(patch.localModel)) throw new Error('Nome de modelo inválido'); next.localModel = patch.localModel; }
    if (patch.cloudModel !== undefined) { if (!CLOUD_MODELS.some((m) => m.id === patch.cloudModel)) throw new Error('Modelo inválido'); next.cloudModel = patch.cloudModel; }
    if (patch.endpoint !== undefined) { if (!localEndpoint(patch.endpoint)) throw new Error('O modo Local só aceita um endereço desta máquina (127.0.0.1 ou localhost)'); next.endpoint = patch.endpoint.replace(/\/+$/, ''); }
    if (patch.vaultEntryId !== undefined) next.vaultEntryId = patch.vaultEntryId || null;
    config = next;
    await atomicWrite(file, JSON.stringify(config, null, 2));
    return getConfig();
  }

  /* ─────────────── Ollama ─────────────── */

  async function ollama(pathname, opts = {}) {
    const res = await f(config.endpoint + pathname, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch { /* corpo não-JSON */ }
      throw new Error(`Ollama: ${msg}`);
    }
    return res;
  }

  /** Ollama rodando? Versão e modelos instalados. Nunca lança: { running, version, models }. */
  async function localStatus() {
    try {
      const v = await (await ollama('/api/version', { signal: AbortSignal.timeout(2500) })).json();
      const t = await (await ollama('/api/tags', { signal: AbortSignal.timeout(5000) })).json();
      return { running: true, version: v.version, models: (t.models || []).map((m) => ({ name: m.name, size: m.size, params: m.details && m.details.parameter_size })) };
    } catch { return { running: false, version: null, models: [] }; }
  }

  async function status() {
    const local = await localStatus();
    return { config: getConfig(), local, platform, installable: platform === 'win32' };
  }

  /**
   * Instala o Ollama (Windows): baixa o instalador oficial, confere a assinatura e executa. onProgress({ step, percent }).
   * Em outros sistemas devolve { manual: true, url } para a tela abrir a página oficial.
   */
  async function installOllama(onProgress = () => {}) {
    if (platform !== 'win32') return { manual: true, url: 'https://ollama.com/download' };
    const dest = path.join(tmpDir, `OllamaSetup-${Date.now()}.exe`);
    onProgress({ step: 'download', percent: 0 });
    const res = await f(OLLAMA_INSTALLER_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Não foi possível baixar o instalador (${res.status})`);
    const total = +res.headers.get('content-length') || 0;
    const out = fss.createWriteStream(dest);
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (total) onProgress({ step: 'download', percent: Math.floor((got / total) * 100) });
      }
    } finally { await new Promise((r) => out.end(r)); }
    onProgress({ step: 'verify' });
    const sig = await verifySignature(dest);
    if (!sig.ok) { await fs.rm(dest, { force: true }); throw new Error(`Instalador recusado: ${sig.reason}. Nada foi executado.`); }
    onProgress({ step: 'install' });
    // /SILENT: mostra só a barra de progresso, sem perguntas (a pessoa já confirmou no Devkit).
    const code = await new Promise((resolve, reject) => {
      const p = spawn(dest, ['/SILENT', '/NORESTART'], { windowsHide: false });
      p.on('error', reject);
      p.on('exit', resolve);
    });
    await fs.rm(dest, { force: true }).catch(() => {});
    if (code !== 0) throw new Error(`O instalador terminou com erro (código ${code})`);
    onProgress({ step: 'start' });
    for (let i = 0; i < 40; i++) {
      const s = await localStatus();
      if (s.running) { onProgress({ step: 'done' }); return { installed: true, version: s.version }; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { installed: true, version: null, warning: 'Instalado, mas o Ollama ainda não respondeu — abra-o pelo menu Iniciar.' };
  }

  /** Baixa um modelo pelo próprio Ollama. onProgress({ status, percent }). */
  async function pullModel(name, onProgress = () => {}, signal) {
    if (!validModelName(name)) throw new Error('Nome de modelo inválido');
    const res = await ollama('/api/pull', { method: 'POST', body: JSON.stringify({ model: name, stream: true }), signal });
    let error = null;
    await readNdjson(res, (line) => { const p = pullProgress(line); if (!p) return; if (p.error) error = p.error; else onProgress(p); });
    if (error) throw new Error(`Ollama: ${error}`);
    return { ok: true };
  }

  async function localChat({ system, user, maxTokens }, onChunk, signal) {
    const res = await ollama('/api/chat', {
      method: 'POST', signal,
      body: JSON.stringify({ model: config.localModel, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], options: { temperature: 0.2, num_ctx: 8192, num_predict: maxTokens || 1024 } }),
    });
    let text = '';
    let error = null;
    await readNdjson(res, (line) => {
      let o; try { o = JSON.parse(line); } catch { return; }
      if (o.error) { error = o.error; return; }
      const piece = o.message && o.message.content;
      if (piece) { text += piece; onChunk(piece); }
    });
    if (error) throw new Error(`Ollama: ${error}`);
    return text;
  }

  /* ─────────────── Claude ─────────────── */

  async function cloudChat({ system, user, maxTokens }, onChunk, signal) {
    const key = await getApiKey(config.vaultEntryId);
    if (!key) throw new Error('Escolha nas Configurações a entrada do Vault com a chave da API (e desbloqueie o cofre)');
    const Sdk = Anthropic || require('@anthropic-ai/sdk').default;
    const client = new Sdk({ apiKey: key, maxRetries: 1, timeout: 60e3 });
    // Fallback no servidor: se o modelo recusar por política, a própria API refaz com outro modelo adequado.
    const stream = client.beta.messages.stream({
      model: config.cloudModel, max_tokens: maxTokens || 1024,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      ...(config.cloudModel === 'claude-haiku-4-5' ? {} : { output_config: { effort: 'low' } }),
      system, messages: [{ role: 'user', content: user }],
    }, { signal });
    stream.on('text', (d) => onChunk(d));
    try {
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('O modelo recusou este pedido');
      return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    } catch (e) {
      throw new Error(friendlyCloudError(e, Sdk));
    }
  }

  function friendlyCloudError(e, Sdk) {
    if (Sdk.AuthenticationError && e instanceof Sdk.AuthenticationError) return 'Chave da API inválida — confira a entrada no Vault';
    if (Sdk.PermissionDeniedError && e instanceof Sdk.PermissionDeniedError) return 'A chave não tem permissão para este modelo';
    if (Sdk.RateLimitError && e instanceof Sdk.RateLimitError) return 'Limite de uso da API atingido — tente de novo em instantes';
    if (Sdk.APIConnectionError && e instanceof Sdk.APIConnectionError) return 'Sem conexão com a API (está offline?) — o modo Local funciona sem internet';
    if (Sdk.APIError && e instanceof Sdk.APIError) return `API: ${e.message}`;
    return e.message || String(e);
  }

  /* ─────────────── Tarefas ─────────────── */

  /** O que será enviado (system + user) — a tela mostra isto antes. Tarefas em src/ai/tasks.js. */
  function buildRequest(task, input = {}) {
    const t = Object.prototype.hasOwnProperty.call(TASKS, task) && TASKS[task];
    if (!t) throw new Error('Tarefa desconhecida');
    return { ...t.build(input || {}), task, label: t.label, maxTokens: t.maxTokens, cloudHint: !!t.cloudHint };
  }

  /**
   * Executa uma tarefa. onChunk(texto) a cada pedaço (para escrever aos poucos na tela).
   * → { text, data, provider, model, ms } — data é a resposta interpretada (quando a tarefa tem parse).
   */
  async function generate(requestId, task, input, onChunk = () => {}) {
    if (config.mode === 'off') throw new Error('A IA está desligada (Configurações → IA)');
    const req = buildRequest(task, input);
    const t = TASKS[task];
    const ctrl = new AbortController();
    running.set(requestId, ctrl);
    const t0 = Date.now();
    try {
      const raw = config.mode === 'local' ? await localChat(req, onChunk, ctrl.signal) : await cloudChat(req, onChunk, ctrl.signal);
      const text = t.clean ? t.clean(raw) : raw;
      return { text, data: t.parse ? t.parse(text, input || {}) : null, provider: config.mode, model: config.mode === 'local' ? config.localModel : config.cloudModel, ms: Date.now() - t0 };
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('Cancelado');
      throw e;
    } finally { running.delete(requestId); }
  }

  function cancel(requestId) { const c = running.get(requestId); if (c) c.abort(); return !!c; }

  return { init, getConfig, setConfig, status, localStatus, installOllama, pullModel, buildRequest, generate, cancel, OLLAMA_INSTALLER_URL };
}

module.exports = { createAiService, localEndpoint, defaultVerifySignature };
