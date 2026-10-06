// Testes da IA (prompts e serviço com servidor Ollama falso e cliente Claude falso): node --test scripts/test-ai.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../src/ai/prompts.js');

const fileDiff = (name, lines) => `diff --git a/${name} b/${name}\nindex 1..2 100644\n--- a/${name}\n+++ b/${name}\n@@ -1 +1,${lines} @@\n${Array.from({ length: lines }, (_, i) => '+linha ' + i).join('\n')}\n`;

test('prepareDiff: ruído só pelo nome, cortes anotados', () => {
  const patch = fileDiff('src/a.js', 3) + fileDiff('package-lock.json', 50) + 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n';
  const r = A.prepareDiff(patch);
  assert.deepEqual(r.files, ['src/a.js', 'package-lock.json', 'img.png']);
  assert.deepEqual(r.omitted, ['package-lock.json', 'img.png']);
  assert.match(r.text, /\+linha 2/);
  assert.doesNotMatch(r.text, /lock.*\n\+linha/);
  assert.match(r.text, /conteúdo não enviado\): package-lock\.json, img\.png/);
  assert.equal(r.truncated, false);
  const big = A.prepareDiff(fileDiff('a.js', 2000) + fileDiff('b.js', 2000) + fileDiff('c.js', 2000) + fileDiff('d.js', 2000), { maxChars: 9000, perFile: 4000 });
  assert.equal(big.truncated, true);
  assert.ok(big.text.length < 9500);
  assert.match(big.text, /caracteres deste arquivo cortados/);
  assert.ok(big.omitted.includes('d.js'));
});

test('commitMessagePrompt e cleanCommitMessage', () => {
  const p = A.commitMessagePrompt({ diff: 'DIFF', recent: ['Notes: corrige x', 'Git: adiciona y'], branch: 'feat/z' });
  assert.match(p.system, /SOMENTE com a mensagem/);
  assert.match(p.user, /Branch: feat\/z/);
  assert.match(p.user, /- Notes: corrige x/);
  assert.match(p.user, /DIFF/);
  assert.doesNotMatch(A.commitMessagePrompt({ diff: 'D' }).user, /Commits recentes/);
  assert.equal(A.cleanCommitMessage('```\nGit: adiciona botão\n```'), 'Git: adiciona botão');
  assert.equal(A.cleanCommitMessage('Mensagem de commit: Corrige o login'), 'Corrige o login');
  assert.equal(A.cleanCommitMessage('"Ajusta a tela"'), 'Ajusta a tela');
  assert.equal(A.cleanCommitMessage('Título\r\n\r\n\r\n\r\nCorpo'), 'Título\n\nCorpo');
});

/* ─────────────── serviço ─────────────── */

import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createAiService, localEndpoint } = require('../electron/ai/service.js');

/** Ollama de mentira: versão, modelos, pull e chat em NDJSON. */
function fakeOllama() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
      const nd = (lines) => { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); for (const l of lines) res.write(JSON.stringify(l) + '\n'); res.end(); };
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.9.0' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b', size: 1900000000, details: { parameter_size: '3.1B' } }] }));
      if (req.url === '/api/pull') return body.includes('naoexiste') ? nd([{ error: 'pull model manifest: file does not exist' }]) : nd([{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 40 }, { status: 'pulling abc', total: 100, completed: 100 }, { status: 'success' }]);
      if (req.url === '/api/chat') return nd([{ message: { content: '```\nGit: adiciona ' } }, { message: { content: 'sugestão de mensagem\n```' } }, { done: true }]);
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

const DIFF = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-x\n+y\n';

test('serviço: configuração — desligada por padrão, endereço local obrigatório', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devkit-ai-'));
  try {
    const svc = createAiService({ file: path.join(dir, 'ai.json') });
    assert.equal((await svc.init()).mode, 'off');
    await assert.rejects(svc.generate('r', 'commitMessage', { diff: DIFF }), /desligada/);
    await assert.rejects(svc.setConfig({ endpoint: 'https://ollama.exemplo.com' }), /desta máquina/);
    await assert.rejects(svc.setConfig({ mode: 'turbo' }), /Modo inválido/);
    await assert.rejects(svc.setConfig({ localModel: 'x;rm -rf' }), /inválido/);
    await svc.setConfig({ mode: 'local', localModel: 'llama3.2:3b' });
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'ai.json'), 'utf8')).localModel, 'llama3.2:3b');
    assert.ok(localEndpoint('http://localhost:11434') && !localEndpoint('http://10.0.0.5:11434'));
    // O que será enviado: diff preparado + estilo dos commits.
    const req = svc.buildRequest('commitMessage', { diff: DIFF, recent: ['Notes: x'], branch: 'main' });
    assert.match(req.user, /\+y/);
    assert.deepEqual(req.files, ['src/a.js']);
    assert.throws(() => svc.buildRequest('commitMessage', { diff: '' }), /Nada preparado/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: modo Local — status, baixar modelo, gerar mensagem em pedaços', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devkit-ai-'));
  const o = await fakeOllama();
  try {
    const svc = createAiService({ file: path.join(dir, 'ai.json') });
    await svc.init();
    await svc.setConfig({ mode: 'local', endpoint: o.url });
    const st = await svc.status();
    assert.equal(st.local.running, true);
    assert.deepEqual(st.local.models.map((m) => m.name), ['qwen2.5-coder:3b']);
    const prog = [];
    await svc.pullModel('qwen2.5-coder:3b', (p) => prog.push(p.percent));
    assert.deepEqual(prog, [null, 40, 100, null]);
    await assert.rejects(svc.pullModel('naoexiste:1b'), /file does not exist/);
    const chunks = [];
    const r = await svc.generate('req1', 'commitMessage', { diff: DIFF, recent: ['Git: algo'] }, (c) => chunks.push(c));
    assert.equal(chunks.length, 2);
    assert.equal(r.text, 'Git: adiciona sugestão de mensagem'); // sem a cerca de código
    assert.equal(r.provider, 'local');
    const chat = o.calls.find((c) => c.url === '/api/chat').body;
    assert.equal(chat.model, 'qwen2.5-coder:3b');
    assert.match(chat.messages[1].content, /Git: algo/);
    // Ollama parado: status diz que não está rodando (não lança).
    o.server.close();
    assert.equal((await svc.localStatus()).running, false);
  } finally { o.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: instalar Ollama — assinatura recusada não executa; aceita executa e espera subir', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devkit-ai-'));
  const o = await fakeOllama();
  try {
    // fetch: o instalador "oficial" vem de um corpo falso; o resto vai ao Ollama falso.
    const fakeFetch = (url, opts) => (String(url).includes('ollama.com/download')
      ? Promise.resolve(new Response('MZ-instalador-de-mentira', { status: 200, headers: { 'content-length': '24' } }))
      : fetch(url, opts));
    const spawned = [];
    const fakeSpawn = (file, args) => { spawned.push({ file, args, existed: existsSync(file) }); const ee = new (require('node:events'))(); setTimeout(() => ee.emit('exit', 0), 10); return ee; };
    let verified = null;
    const mk = (verify) => createAiService({ file: path.join(dir, 'ai.json'), fetch: fakeFetch, spawn: fakeSpawn, verifySignature: async (f) => { verified = f; return verify; }, platform: 'win32', tmpDir: dir });

    const bad = mk({ ok: false, reason: 'assinatura inválida (sem certificado)' });
    await bad.init();
    await assert.rejects(bad.installOllama(), /Instalador recusado: assinatura inválida.*Nada foi executado/);
    assert.equal(spawned.length, 0);
    assert.equal(existsSync(verified), false); // o arquivo baixado foi apagado

    const good = mk({ ok: true });
    await good.init();
    await good.setConfig({ endpoint: o.url });
    const steps = [];
    const r = await good.installOllama((p) => steps.push(p.step));
    assert.deepEqual([...new Set(steps)], ['download', 'verify', 'install', 'start', 'done']);
    assert.equal(r.installed, true);
    assert.equal(spawned[0].existed, true);
    assert.deepEqual(spawned[0].args, ['/SILENT', '/NORESTART']);
    // Fora do Windows: só a página oficial.
    assert.deepEqual(await createAiService({ file: path.join(dir, 'x.json'), platform: 'darwin' }).installOllama(), { manual: true, url: 'https://ollama.com/download' });
  } finally { o.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('serviço: modo Nuvem — chave do Vault, streaming, erros em português', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devkit-ai-'));
  try {
    let lastParams = null, lastKey = null;
    class AuthErr extends Error {}
    class FakeAnthropic {
      constructor({ apiKey }) { lastKey = apiKey; this.beta = { messages: { stream: (params) => { lastParams = params; return this.makeStream(); } } }; }
      makeStream() {
        const handlers = {};
        return {
          on: (ev, fn) => { handlers[ev] = fn; },
          finalMessage: async () => {
            if (lastKey === 'ruim') throw new AuthErr('401');
            handlers.text('Notes: corrige ');
            handlers.text('o auto-save');
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Notes: corrige o auto-save' }] };
          },
        };
      }
    }
    FakeAnthropic.AuthenticationError = AuthErr;
    let key = 'sk-ant-teste';
    const svc = createAiService({ file: path.join(dir, 'ai.json'), Anthropic: FakeAnthropic, getApiKey: async (id) => (id === 'cofre-1' ? key : null) });
    await svc.init();
    await svc.setConfig({ mode: 'cloud' });
    await assert.rejects(svc.generate('a', 'commitMessage', { diff: DIFF }), /entrada do Vault/);
    await svc.setConfig({ vaultEntryId: 'cofre-1' });
    const chunks = [];
    const r = await svc.generate('b', 'commitMessage', { diff: DIFF }, (c) => chunks.push(c));
    assert.equal(r.text, 'Notes: corrige o auto-save');
    assert.deepEqual(chunks, ['Notes: corrige ', 'o auto-save']);
    assert.equal(lastKey, 'sk-ant-teste');
    assert.equal(lastParams.model, 'claude-opus-5-5');
    assert.deepEqual(lastParams.output_config, { effort: 'low' });
    assert.equal(lastParams.fallbacks, 'default');
    key = 'ruim';
    await assert.rejects(svc.generate('c', 'commitMessage', { diff: DIFF }), /Chave da API inválida/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verificação de assinatura real: arquivo sem assinatura é recusado', { skip: process.platform !== 'win32' }, async () => {
  const { defaultVerifySignature } = require('../electron/ai/service.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devkit-sig-'));
  try {
    const f = path.join(dir, 'falso.exe');
    require('node:fs').writeFileSync(f, 'MZ não é um instalador de verdade');
    const r = await defaultVerifySignature(f);
    assert.equal(r.ok, false);
    assert.match(r.reason, /assinatura/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validModelName e pullProgress', () => {
  for (const ok of ['qwen2.5-coder:3b', 'llama3.2:3b', 'usuario/modelo:latest', 'mistral']) assert.ok(A.validModelName(ok), ok);
  for (const bad of ['', '-rm', 'a b', 'x;rm', '../x', 'a:b:c']) assert.ok(!A.validModelName(bad), bad);
  assert.deepEqual(A.pullProgress('{"status":"pulling abc","total":200,"completed":50}'), { status: 'pulling abc', percent: 25, done: false });
  assert.deepEqual(A.pullProgress('{"status":"success"}'), { status: 'success', percent: null, done: true });
  assert.deepEqual(A.pullProgress('{"error":"model not found"}'), { error: 'model not found' });
  assert.equal(A.pullProgress('lixo'), null);
});
