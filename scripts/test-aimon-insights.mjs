// Testes de duração por ferramenta/turno, projeção do limite de uso, comparação, revisão automática, exportação e tarefas de IA
// (descrição de PR e padrões de pedidos) do Monitor de IA: node --test scripts/test-aimon-insights.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const state = require('../electron/aimon/state.js');
const { dayKey } = require('../electron/aimon/time.js');
const { createUsageStore } = require('../electron/aimon/usage.js');
const { createAimonService } = require('../electron/aimon/service.js');
const { createReviewer } = require('../electron/aimon/review.js');
const { exportUsage, cell } = require('../electron/aimon/exporter.js');
const { TASKS } = require('../src/ai/tasks.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-ins-'));
const j = (o) => JSON.stringify(o) + '\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = new Date(2026, 9, 19, 10, 0, 0).getTime();
const day = dayKey(T0);

/* ─────────────── duração por ferramenta e por turno ─────────────── */

function play(events) { const s = state.createSessionState(); for (const e of events) state.apply(s, e); return s; }

test('ferramentas: duração do pedido ao resultado, erros, recusa fora, muito longa fora da média', () => {
  const s = play([
    { ts: T0, kind: 'prompt', summary: 'faz x' },
    { ts: T0 + 1000, kind: 'tool_use', ref: 'a', tool: 'Bash', summary: 'ls' }, { ts: T0 + 3000, kind: 'tool_result', ref: 'a' },
    { ts: T0 + 4000, kind: 'tool_use', ref: 'b', tool: 'Bash', summary: 'npm test' }, { ts: T0 + 10000, kind: 'tool_result', ref: 'b', error: true },
    { ts: T0 + 11000, kind: 'tool_use', ref: 'c', tool: 'Edit', summary: 'a.js' }, { ts: T0 + 12000, kind: 'tool_result', ref: 'c', rejected: true },
    { ts: T0 + 13000, kind: 'tool_use', ref: 'd', tool: 'Bash', summary: 'sleep' }, { ts: T0 + 13000 + 40 * 60_000, kind: 'tool_result', ref: 'd' }, // 40 min: esperou permissão
  ]);
  const bash = s.toolDaily[day].Bash;
  assert.deepEqual([bash.n, bash.errors, bash.timed, bash.ms, bash.max], [3, 1, 2, 2000 + 6000, 6000]);
  assert.equal(s.toolDaily[day].Edit, undefined);   // recusa da pessoa não é execução
  assert.equal(s.toolErrors, 1);
});

test('turnos: duração do primeiro sinal ao fim; erro de API não conta; vários turnos somam', () => {
  const s = play([
    { ts: T0, kind: 'prompt', summary: 'a' }, { ts: T0 + 5000, kind: 'text', summary: 'x' }, { ts: T0 + 20_000, kind: 'turn_end' },
    { ts: T0 + 60_000, kind: 'prompt', summary: 'b' }, { ts: T0 + 90_000, kind: 'turn_end' },
    { ts: T0 + 100_000, kind: 'prompt', summary: 'c' }, { ts: T0 + 101_000, kind: 'error', code: 'x', summary: 'caiu' },
  ]);
  const t = s.turnDaily[day].turn;
  assert.deepEqual([t.n, t.ms, t.max], [2, 20_000 + 30_000, 30_000]);
  assert.equal(s.turnStartTs, 0);
});

test('retrabalho: correções seguem o primeiro pedido; avisos do agente não contam; primeiro pedido guardado', () => {
  const s = play([
    { ts: T0, kind: 'prompt', summary: '<system-reminder>lembrete</system-reminder>' },
    { ts: T0 + 1, kind: 'prompt', summary: 'cria a tela de login' },
    { ts: T0 + 2, kind: 'prompt', summary: 'não era isso, refaz com o botão azul' },
    { ts: T0 + 3, kind: 'prompt', summary: 'agora adiciona o teste' },
    { ts: T0 + 4, kind: 'prompt', summary: 'isso não funciona, de novo' },
    { ts: T0 + 5, kind: 'prompt', summary: 'that is wrong, undo it' },
  ]);
  assert.equal(s.firstPrompt, 'cria a tela de login');
  assert.equal(s.corrections, 3);
  assert.equal(s.firstTs, T0);
  assert.equal(state.summary(s, T0 + 10).corrections, 3);
});

/* ─────────────── métricas guardadas: ferramentas, turnos e limites ─────────────── */

test('métricas: ferramentas e turnos entram por máximo e somam no período; limites estourados sem duplicar', async () => {
  const file = path.join(tmp(), 'u.json');
  const store = await createUsageStore({ file, now: () => T0 }).init();
  const entry = (extra = {}) => ({ project: 'p', agent: false, tokens: { input: 1 }, byModel: {}, workMs: 1, waitMs: 0, waitCount: 0, ...extra });
  const bash = (n, ms) => ({ Bash: { n, errors: 1, ms, timed: n, max: 9000 } });
  store.merge({ [day]: { a: entry({ tools: bash(4, 8000), turn: { n: 2, errors: 0, ms: 60_000, timed: 2, max: 40_000 } }), b: entry({ agent: true, tools: bash(2, 2000) }) } });
  store.merge({ [day]: { a: entry({ tools: bash(3, 5000) }) } });  // leitura parcial: não diminui
  const r = store.range(1);
  const t = r.byTool.find((x) => x.tool === 'Bash');
  assert.deepEqual([t.n, t.errors, t.avgMs, t.maxMs], [6, 2, 10000 / 6, 9000]);
  assert.equal(r.turns.n, 2); assert.equal(r.turns.avgMs, 30_000); assert.equal(r.turns.maxMs, 40_000);
  store.recordHits([{ ts: T0, used: 1000 }, { ts: T0 + 60_000, used: 1500 }, { ts: T0 + 3 * 3600e3, used: 900 }, { ts: 5, used: 0 }, { ts: NaN, used: 3 }]);
  assert.deepEqual(store.hits(), [{ ts: T0, used: 1500 }, { ts: T0 + 3 * 3600e3, used: 900 }]);   // o 2º é o mesmo estouro: fica o maior
  await store.persist(); await store.flush();
  const again = await createUsageStore({ file }).init();
  assert.equal(again.hits().length, 2);
  await again.clear();
  assert.deepEqual(again.hits(), []);
});

/* ─────────────── serviço: limite de uso, comparação, avisos ─────────────── */

const iso = (ms) => new Date(ms).toISOString();
const userLine = (text, ts, cwd = '/x/proj') => j({ type: 'user', timestamp: iso(ts), cwd, message: { role: 'user', content: text } });
const usageLine = (ts, out) => j({ type: 'assistant', timestamp: iso(ts), message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 0, output_tokens: out, cache_read_input_tokens: 5_000_000, cache_creation_input_tokens: 0 } } });
const errLine = (ts) => j({ type: 'assistant', timestamp: iso(ts), isApiErrorMessage: true, error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your usage limit" }] } });
const mkBase = (files) => { const base = tmp(); fs.mkdirSync(path.join(base, 'proj'), { recursive: true }); for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(base, 'proj', id + '.jsonl'), text); return base; };
const mkProvider = (base, over = {}) => ({ ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => new Map(), ...over });

/** 600 mil tokens de saída na última hora + 400 mil três horas atrás (cache lido não conta). */
function loadedBase() {
  const now = Date.now();
  let text = userLine('refatora tudo', now - 4 * 3600e3);
  text += usageLine(now - 3 * 3600e3, 400_000);
  for (let i = 0; i < 10; i++) text += usageLine(now - (50 - i * 5) * 60_000, 60_000);
  return mkBase({ big: text });
}

test('limite: ritmo da última hora e projeção levando em conta o que sai da janela de 5 h', async () => {
  const mk = (limit) => createAimonService({ providers: [mkProvider(loadedBase())], windowMs: 6 * 3600e3, getLimit: () => limit });
  const manual = mk(2_000_000);
  await manual._tick();
  const b = manual.burn();
  assert.equal(b.used5h, 1_000_000);                       // saída das duas janelas; leitura de cache fora
  assert.equal(b.ratePerHour, 600_000);
  assert.deepEqual([b.limit, b.limitSource], [2_000_000, 'manual']);
  assert.ok(b.etaMs > 95 * 60_000 && b.etaMs < 105 * 60_000, 'eta ' + b.etaMs / 60_000 + ' min');   // ~100 min: 1 mi restante a 600 mil/h
  const over = mk(900_000); await over._tick();
  assert.equal(over.burn().etaMs, 0);                      // já passou do limite
  const none = mk(null); await none._tick();
  const n = none.burn();
  assert.deepEqual([n.limit, n.limitSource, n.etaMs], [null, null, null]);
  const slow = createAimonService({ providers: [mkProvider(mkBase({ s: userLine('x', Date.now() - 3600e3 * 4) + usageLine(Date.now() - 4 * 3600e3, 100_000) }))], windowMs: 6 * 3600e3, getLimit: () => 5_000_000 });
  await slow._tick();
  assert.equal(slow.burn().etaMs, null);                   // sem consumo na última hora não há como projetar
});

test('limite: estimado pelas vezes em que estourou (mediana do consumo das 5 h anteriores) e guardado', async () => {
  const now = Date.now();
  let text = userLine('x', now - 4 * 3600e3) + usageLine(now - 3 * 3600e3, 400_000) + usageLine(now - 40 * 60_000, 300_000) + errLine(now - 30 * 60_000);
  const file = path.join(tmp(), 'u.json');
  const store = await createUsageStore({ file }).init();
  const svc = createAimonService({ providers: [mkProvider(mkBase({ s: text }))], windowMs: 6 * 3600e3, usage: store });
  await svc._tick();
  assert.deepEqual(store.hits().map((h) => h.used), [700_000]);
  const b = svc.burn();
  assert.deepEqual([b.limit, b.limitSource], [700_000, 'auto']);
  assert.equal(b.etaMs, 0);                                // 700 mil nas últimas 5 h = o limite que estourou
  await store.flush();
  assert.equal((await createUsageStore({ file }).init()).hits().length, 1);
});

test('limite: aviso "perto do limite" uma vez por hora quando o ritmo atual chega em menos de 30 min', async () => {
  const seen = [];
  const svc = createAimonService({ providers: [mkProvider(loadedBase())], windowMs: 6 * 3600e3, getLimit: () => 1_200_000, onAttention: (e) => seen.push(e) });
  await svc._tick(); await svc._tick();
  assert.equal(seen.filter((e) => e.kind === 'limit').length, 1);
  const ev = seen.find((e) => e.kind === 'limit');
  assert.equal(ev.key, null);
  assert.match(ev.detail, /cerca de \d+ min/);
  const far = createAimonService({ providers: [mkProvider(loadedBase())], windowMs: 6 * 3600e3, getLimit: () => 3_000_000, onAttention: (e) => seen.push({ far: true, ...e }) });
  await far._tick();
  assert.ok(!seen.some((e) => e.far));
});

test('ociosa: onSettled quando a sessão sai de trabalhando para ociosa; não repete em seguida', async () => {
  const now = Date.now();
  const base = mkBase({ w: userLine('faz', now) + j({ type: 'assistant', timestamp: iso(now), message: { model: 'm', content: [{ type: 'text', text: 'vou' }] } }) });
  const live = { map: new Map([['w', { status: 'busy', pid: 1 }]]) };
  const seen = [];
  const svc = createAimonService({ providers: [mkProvider(base, { live: async () => live.map })], windowMs: 3600e3, onSettled: (e) => seen.push(e) });
  await svc._tick();
  live.map = new Map([['w', { status: 'idle', pid: 1 }]]); await svc._tick();
  assert.deepEqual(seen.map((e) => e.key), ['claude:w']);
  live.map = new Map([['w', { status: 'busy', pid: 1 }]]); await svc._tick();
  live.map = new Map([['w', { status: 'idle', pid: 1 }]]); await svc._tick();
  assert.equal(seen.length, 1);                            // dentro de 1 min: não repete
});

test('comparar: métricas lado a lado e pares de pedidos parecidos em ferramentas diferentes', async () => {
  const now = Date.now();
  const mine = (id, prompt, extra) => userLine(prompt, now - 600_000) + usageLine(now - 500_000, 1000) + extra;
  const baseA = mkBase({ ca: mine('ca', 'implementa a validação de CPF no cadastro de clientes', userLine('não era isso, refaz', now - 400_000) + j({ type: 'assistant', timestamp: iso(now - 300_000), message: { content: [{ type: 'tool_use', id: 't', name: 'Edit', input: { file_path: '/x/a.js' } }] } })) });
  const baseB = mkBase({ cb: mine('cb', 'implementa validação de CPF no cadastro de clientes novos', '') });
  const codexLike = { ...mkProvider(baseB), id: 'codex', name: 'Codex', listSessions: async (since) => (await claude.listSessions(since, baseB)).map((m) => ({ ...m, provider: 'codex' })) };
  const svc = createAimonService({ providers: [mkProvider(baseA), codexLike], windowMs: 3600e3 });
  await svc._tick();
  const [a, b] = svc.compare(['claude:ca', 'codex:cb']);
  assert.equal(a.provider, 'claude'); assert.equal(b.provider, 'codex');
  assert.equal(a.corrections, 1); assert.equal(b.corrections, 0);
  assert.equal(a.files, 1); assert.equal(b.files, 0);
  assert.equal(a.total, 5_001_000);
  assert.ok(a.cost > 0);
  assert.ok(a.durationMs >= 300_000);
  assert.deepEqual(svc.compare(['claude:nao-existe']), []);
  const pairs = svc.pairs();
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b], ['claude:ca', 'codex:cb']);
  assert.ok(pairs[0].score >= 0.35);
  // padrões dos pedidos: primeiro pedido + sinais de retrabalho
  const p = svc.patterns().sessions;
  assert.equal(p.length, 2);
  assert.equal(p.find((x) => x.provider === 'claude').corrections, 1);
  assert.equal(svc.goal('claude:ca'), 'implementa a validação de CPF no cadastro de clientes');
  // pedidos sem relação não formam par
  const x = createAimonService({ providers: [mkProvider(mkBase({ q: userLine('configura o pipeline de deploy do servidor', now) })), { ...codexLike, listSessions: async (since) => (await claude.listSessions(since, mkBase({ r: userLine('desenha o ícone do aplicativo móvel', now) }))).map((m) => ({ ...m, provider: 'codex' })) }], windowMs: 3600e3 });
  await x._tick();
  assert.deepEqual(x.pairs(), []);
});

/* ─────────────── revisão automática ─────────────── */

test('revisão automática: só liga com a opção E a IA local; reaproveita se o diff não mudou; erro e fila', async () => {
  let prefs = { autoReview: false }; let mode = 'local'; let diff = 'diff --git a/a b/a\n+x\n';
  const calls = []; const changes = [];
  const rv = createReviewer({
    getPrefs: () => prefs, getMode: () => mode, delayMs: 5, onChange: (k) => changes.push(k),
    collect: async () => (diff ? { diff, branch: 'feat', goal: 'meta' } : null),
    generate: async (id, task, input) => { calls.push([task, input]); if (input.goal === 'quebra') throw new Error('modelo fora do ar'); return { text: 'Tudo certo.', model: 'qwen', ms: 10 }; },
  });
  assert.equal(rv.settled('k'), false);                    // opção desligada
  prefs = { autoReview: true }; mode = 'cloud';
  assert.equal(rv.settled('k'), false);                    // Nuvem: nunca sozinho
  assert.throws(() => rv.run('k'), /só usa a IA local/);
  mode = 'local';
  assert.equal(rv.settled('k'), true);
  assert.equal(rv.brief('k'), null);
  await sleep(60);
  assert.deepEqual(rv.brief('k').state, 'done');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'aimonReview');
  assert.deepEqual(calls[0][1], { diff, branch: 'feat', goal: 'meta' });
  assert.equal(rv.read('k').text, 'Tudo certo.');
  rv.settled('k'); await sleep(60);
  assert.equal(calls.length, 1);                           // mesmo diff: não gasta o modelo de novo
  rv.run('k'); await sleep(40);
  assert.equal(calls.length, 2);                           // "Revisar de novo" ignora o cache
  diff = '';
  rv.settled('k'); await sleep(60);
  assert.equal(rv.brief('k').state, 'none');               // sem alterações
  diff = 'diff novo\n';
  rv.settled('k'); await sleep(60);
  assert.equal(calls.length, 3);                           // diff mudou: revisa
  // prefs desligadas antes de o tempo de espera acabar: cancela
  prefs = { autoReview: true };
  rv.settled('z');
  prefs = { autoReview: false };
  await sleep(40);
  assert.equal(rv.brief('z'), null);
  assert.ok(changes.length >= 6);
  // erro do modelo vira estado, não exceção
  const bad = createReviewer({ getPrefs: () => ({ autoReview: true }), getMode: () => 'local', delayMs: 1, collect: async () => ({ diff: 'x', goal: 'quebra' }), generate: async (id, t, i) => { throw new Error('modelo fora do ar'); } });
  bad.settled('e'); await sleep(40);
  assert.deepEqual([bad.brief('e').state, bad.read('e').error], ['error', 'modelo fora do ar']);
  rv.stop(); bad.stop();
});

test('revisão automática: guarda só as últimas 30 e limita a fila', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const rv = createReviewer({ getPrefs: () => ({ autoReview: true }), getMode: () => 'local', delayMs: 1, collect: async (k) => ({ diff: 'd' + k }), generate: async () => { await gate; return { text: 't' }; } });
  assert.equal(rv.run('1'), true); assert.equal(rv.run('2'), true); assert.equal(rv.run('3'), true);
  assert.equal(rv.run('4'), false);                        // fila cheia
  release(); await sleep(60);
  const many = createReviewer({ getPrefs: () => ({ autoReview: true }), getMode: () => 'local', collect: async (k) => ({ diff: 'd' + k }), generate: async () => ({ text: 't' }) });
  for (let i = 0; i < 40; i++) { many.run('s' + i); await sleep(3); }
  await sleep(40);
  assert.equal(many.read('s0'), null);                     // as mais antigas saem
  assert.equal(many.read('s39').state, 'done');
});

/* ─────────────── exportar ─────────────── */

const range = () => ({
  days: 7, series: [{ day: '2026-10-18', tokens: 1000, cost: 1.5, workMs: 600_000, waitMs: 120_000, sessions: 2 }, { day: '2026-10-19', tokens: 0, cost: 0, workMs: 0, waitMs: 0, sessions: 0 }],
  totals: { tokens: { input: 600, output: 400, cacheRead: 0, cacheWrite: 0 }, total: 1000, workMs: 600_000, waitMs: 120_000, waitCount: 3, cost: 1.5, savings: 0.4, sessions: 2, agents: 1, waitShare: 0.17 },
  byModel: [{ model: 'claude-sonnet-4-5', tokens: {}, total: 1000, cost: 1.5, price: { input: 3, output: 15 } }, { model: 'gpt-5', tokens: {}, total: 5, cost: null, price: null }],
  byProject: [{ project: '=cmd|calc', total: 1000, cost: 1.5, workMs: 600_000, waitMs: 120_000, sessions: 2 }, { project: 'a,b "c"', total: 1, cost: 0, workMs: 0, waitMs: 0, sessions: 1 }],
  byTool: [{ tool: 'Bash', n: 10, errors: 2, errorRate: 0.2, avgMs: 1500, maxMs: 9000, totalMs: 15000 }], turns: { n: 4, avgMs: 30_000, maxMs: 90_000 },
  plans: { approved: 3, rejected: 1 }, unpriced: ['gpt-5'],
});

test('exportar: CSV com aspas, sem executar fórmulas de planilha; JSON válido; Markdown com tabelas', () => {
  const csv = exportUsage(range(), 'csv');
  assert.equal(csv.ext, 'csv');
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines[0], 'secao,nome,tokens,custo_usd,trabalho_min,espera_min,sessoes,execucoes,erros,media_ms,max_ms');
  assert.ok(lines.includes('dia,2026-10-18,1000,1.5,10,2,2,,,,'));
  assert.ok(lines.includes("projeto,'=cmd|calc,1000,1.5,10,2,2,,,,"));        // fórmula neutralizada
  assert.ok(lines.includes('projeto,"a,b ""c""",1,0,0,0,1,,,,'));
  assert.ok(lines.includes('modelo,gpt-5,5,,,,,,,,'));                            // sem preço: custo vazio
  assert.ok(lines.includes('ferramenta,Bash,,,,,,10,2,1500,9000'));
  assert.equal(cell('=1+1'), "'=1+1"); assert.equal(cell(5), '5'); assert.equal(cell(null), '');
  const js = JSON.parse(exportUsage(range(), 'json').text);
  assert.equal(js.dias, 7); assert.equal(js.porFerramenta[0].tool, 'Bash'); assert.equal(js.totais.cost, 1.5); assert.deepEqual(js.semPreco, ['gpt-5']);
  assert.ok(!JSON.stringify(js).includes('prompt'));
  const md = exportUsage(range(), 'md').text;
  assert.match(md, /^# Uso de IA — últimos 7 dia\(s\)/);
  assert.match(md, /\| Ferramenta \| Execuções \| Erros \| Taxa de erro \| Média \| Maior \|/);
  assert.match(md, /Planos: 3 aprovado\(s\), 1 recusado\(s\)/);
  assert.match(md, /sem preço/);
  assert.doesNotMatch(md, /2026-10-19/);                                           // dia vazio fica de fora
  assert.throws(() => exportUsage(range(), 'xls'), /desconhecido/);
  assert.throws(() => exportUsage(null, 'csv'), /Nada para exportar/);
});

/* ─────────────── tarefas de IA ─────────────── */

test('descrição de PR: usa plano, commits e arquivos; mascara segredos; proíbe linha de atribuição; recusa entrada vazia', () => {
  const r = TASKS.aimonPr.build({ title: 'Login', branch: 'feat/login', base: 'main', goal: 'cria o login, token ana@empresa.com.br', plan: '# Plano\n- tela\n- testes', commits: [{ hash: 'abcdef1234', subject: 'Adiciona a tela de login' }], files: ['src/Login.jsx'] });
  assert.match(r.user, /Branch: feat\/login → main/);
  assert.match(r.user, /- abcdef1 Adiciona a tela de login/);
  assert.match(r.user, /Plano aprovado:\n# Plano/);
  assert.match(r.user, /- src\/Login\.jsx/);
  assert.doesNotMatch(r.user, /ana@empresa\.com\.br/);
  assert.match(r.system, /NÃO inclua linhas de atribuição a IA/);
  assert.match(r.system, /SOMENTE os dados fornecidos/);
  assert.throws(() => TASKS.aimonPr.build({ title: 'x' }), /ainda não tem plano, commits nem alterações/);
});

test('padrões de pedidos: junta sinais de retrabalho e planos recusados com o motivo; pede amostra mínima', () => {
  const sessions = [
    { provider: 'claude', prompt: 'faz o login', turns: 12, corrections: 5, toolErrors: 3, commits: 0 },
    { provider: 'claude', prompt: 'ajusta o botão em src/ui/Button.jsx para usar o token color.primary', turns: 2, corrections: 0, toolErrors: 0, commits: 1 },
    { provider: 'codex', prompt: 'melhora o app, cpf 123.456.789-09', turns: 8, corrections: 2, toolErrors: 1, commits: 0 },
  ];
  const r = TASKS.aimonPatterns.build({ sessions, plans: [{ status: 'rejected', title: 'Reescrever tudo', reason: 'escopo grande demais' }, { status: 'approved', title: 'Ajustar botão' }] });
  assert.match(r.user, /1\. \[claude\] "faz o login" — turnos: 12, correções da pessoa: 5, falhas de ferramenta: 3, commits: 0/);
  assert.match(r.user, /RECUSADO: Reescrever tudo — motivo: escopo grande demais/);
  assert.match(r.user, /aprovado: Ajustar botão/);
  assert.doesNotMatch(r.user, /123\.456\.789-09/);
  assert.match(r.system, /SOMENTE os dados fornecidos/);
  assert.throws(() => TASKS.aimonPatterns.build({ sessions: sessions.slice(0, 2) }), /pelo menos 3/);
});
