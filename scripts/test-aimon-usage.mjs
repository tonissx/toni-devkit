// Testes de custo, métricas diárias, avisos, alertas novos, busca global, retomar e diário do Monitor de IA:
//   node --test scripts/test-aimon-usage.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const state = require('../electron/aimon/state.js');
const pricing = require('../electron/aimon/pricing.js');
const { createUsageStore, splitByDay, dayKey } = require('../electron/aimon/usage.js');
const { createAimonService } = require('../electron/aimon/service.js');
const { searchSessions } = require('../electron/aimon/search.js');
const resume = require('../electron/aimon/resume.js');
const { sessionAlerts } = require('../src/tools/aimon/alerts.js');
const { diaryInput } = require('../src/tools/aimon/aiInput.js');
const { TASKS } = require('../src/ai/tasks.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-usage-'));
const j = (o) => JSON.stringify(o) + '\n';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/* ─────────────── custo ─────────────── */

test('preço: família do modelo, Opus novo × antigo, desconhecido e personalizado', () => {
  assert.deepEqual([pricing.priceFor('claude-sonnet-4-5-20250929').input, pricing.priceFor('claude-sonnet-4-5-20250929').output], [3, 15]);
  assert.equal(pricing.priceFor('claude-opus-4-5').input, 5);
  assert.equal(pricing.priceFor('claude-opus-4-1').input, 15);
  assert.equal(pricing.priceFor('claude-haiku-4-5').input, 1);
  assert.equal(pricing.priceFor('claude-3-5-haiku-20241022').input, 0.8);
  assert.equal(pricing.priceFor('gpt-5-codex'), null); // sem preço: fica fora da soma
  assert.equal(pricing.priceFor(null), null);
  const o = { 'gpt-5-codex': { input: 1.25, output: 10 }, 'claude-sonnet-4-5': { input: 99, output: 99 } };
  assert.equal(pricing.priceFor('gpt-5-codex', o).custom, true);
  assert.equal(pricing.priceFor('claude-sonnet-4-5', o).input, 99); // personalizado vence o padrão
});

test('custo: entrada, saída e cache (leitura 10%, gravação 125%); economia do cache', () => {
  const p = { input: 3, output: 15 };
  near(pricing.costOf({ input: 1000, output: 500, cacheRead: 10000, cacheWrite: 2000 }, p), (3000 + 7500 + 3000 + 7500) / 1e6);
  near(pricing.cacheSavings({ cacheRead: 10000 }, p), 10000 * 3 * 0.9 / 1e6);
  assert.equal(pricing.costOf({ input: 1 }, null), null);
  const r = pricing.costByModel({ 'claude-sonnet-4-5': { input: 1e6 }, 'modelo-x': { input: 5e6 } });
  near(r.cost, 3);
  assert.deepEqual(r.unpriced, ['modelo-x']);
  assert.equal(r.byModel['modelo-x'].cost, null);
});

test('preços das preferências: só números não negativos, no máximo 60 modelos', () => {
  assert.deepEqual(pricing.cleanPrices({ a: { input: 1, output: 2 }, b: { input: -1, output: 2 }, c: { input: 'x', output: 2 }, d: null, '': { input: 1, output: 1 } }), { a: { input: 1, output: 2 } });
  assert.deepEqual(pricing.cleanPrices('lixo'), {});
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['m' + i, { input: 1, output: 1 }]));
  assert.equal(Object.keys(pricing.cleanPrices(many)).length, 60);
});

/* ─────────────── métricas diárias ─────────────── */

test('splitByDay: bloco que atravessa a meia-noite é cortado em dois dias', () => {
  const at = (h, d = 10) => new Date(2026, 9, d, h, 0, 0).getTime();
  // trabalhando das 22h às 2h do dia seguinte; esperando das 23h à 1h
  const r = splitByDay([{ from: at(22), to: at(2, 11), state: 'working' }, { from: at(23), to: at(1, 11), state: 'waiting' }]);
  assert.equal(r['2026-10-10'].workMs, 2 * 3600e3);
  assert.equal(r['2026-10-11'].workMs, 2 * 3600e3);
  assert.equal(r['2026-10-10'].waitMs, 3600e3);
  assert.equal(r['2026-10-11'].waitMs, 3600e3);
  assert.equal(r['2026-10-10'].waitCount + (r['2026-10-11'].waitCount || 0), 1); // uma pausa só, mesmo cruzando o dia
  assert.deepEqual(splitByDay([{ from: 5, to: 5, state: 'working' }, null].filter(Boolean)), {});
});

test('métricas: gravar por máximo (reler não conta em dobro, leitura parcial não diminui), persistir e somar no período', async () => {
  const file = path.join(tmp(), 'aimon-usage.json');
  const today = Date.now();
  const day = dayKey(today);
  let store = await createUsageStore({ file, now: () => today }).init();
  const entry = (tok, extra = {}) => ({ project: 'devkit', agent: false, tokens: { input: tok, output: tok / 2, cacheRead: 0, cacheWrite: 0 }, byModel: { 'claude-sonnet-4-5': { input: tok, output: tok / 2, cacheRead: 0, cacheWrite: 0 } }, workMs: 60_000, waitMs: 30_000, waitCount: 1, ...extra });
  store.merge({ [day]: { 'claude:a': entry(1000) } });
  store.merge({ [day]: { 'claude:a': entry(1000) } });            // a mesma leitura de novo
  assert.equal(store._data().days[day].sessions['claude:a'].tokens.input, 1000);
  store.merge({ [day]: { 'claude:a': entry(400, { workMs: 10 }) } }); // leitura parcial depois do reinício
  assert.equal(store._data().days[day].sessions['claude:a'].tokens.input, 1000);
  assert.equal(store._data().days[day].sessions['claude:a'].workMs, 60_000);
  store.merge({ [day]: { 'claude:a': entry(3000), 'claude:ag': entry(500, { agent: true, workMs: 0, waitMs: 0, waitCount: 0 }) } });
  assert.equal(await store.persist(), true);
  assert.equal(await store.persist(), false); // nada mudou
  await store.flush();

  store = await createUsageStore({ file, now: () => today }).init();   // sobrevive a reinício
  const r = store.range(7, { plans: [{ ts: today, status: 'approved' }, { ts: today, status: 'rejected' }, { ts: today, status: 'approved' }, { ts: today - 40 * 86400e3, status: 'approved' }] });
  assert.equal(r.series.length, 7);
  assert.equal(r.totals.tokens.input, 3500);                 // sessão + subagente
  assert.equal(r.totals.sessions, 1);                        // subagente não conta como sessão
  assert.equal(r.totals.agents, 1);
  assert.equal(r.totals.workMs, 60_000);                     // tempo é só da sessão principal
  assert.equal(r.totals.waitMs, 30_000);
  near(r.totals.waitShare, 1 / 3);
  near(r.totals.cost, (3500 * 3 + 1750 * 15) / 1e6);
  assert.deepEqual(r.plans, { approved: 2, rejected: 1 });   // o de 40 dias atrás fica de fora
  assert.equal(r.byModel[0].model, 'claude-sonnet-4-5');
  assert.equal(r.byProject[0].project, 'devkit');
  assert.equal(r.series[6].day, day);
  // preço personalizado muda o custo sem tocar nos dados
  const cheap = store.range(7, { prices: { 'claude-sonnet-4-5': { input: 0, output: 0 } } });
  assert.equal(cheap.totals.cost, 0);
  await store.clear();
  assert.equal(store.range(7).totals.total, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).days[day], undefined);
});

test('métricas: arquivo estragado começa vazio e não guarda texto de prompt', async () => {
  const file = path.join(tmp(), 'u.json');
  fs.writeFileSync(file, '{lixo');
  const store = await createUsageStore({ file }).init();
  assert.equal(store.range(1).totals.total, 0);
  store.merge({ [dayKey(Date.now())]: { k: { project: 'p', tokens: { input: 1 }, byModel: {}, workMs: 1, waitMs: 0, waitCount: 0, prompt: 'SEGREDO' } } });
  await store.persist(); await store.flush();
  assert.ok(!fs.readFileSync(file, 'utf8').includes('SEGREDO')); // só números e o nome do projeto
});

/* ─────────────── estado: sinais para os alertas ─────────────── */

test('estado: falhas seguidas da mesma ferramenta; sucesso, recusa e novo pedido', () => {
  const s = state.createSessionState();
  const use = (ref, tool) => { state.apply(s, { ts: 1, kind: 'tool_use', ref, tool, summary: 'x' }); };
  const res = (ref, extra = {}) => state.apply(s, { ts: 2, kind: 'tool_result', ref, ...extra });
  use('1', 'Bash'); res('1', { error: true });
  use('2', 'Bash'); res('2', { error: true });
  assert.deepEqual(s.failStreak, { tool: 'Bash', count: 2 });
  use('3', 'Bash'); res('3', { rejected: true });   // a pessoa recusou: não conta nem zera
  assert.equal(s.failStreak.count, 2);
  use('4', 'Edit'); res('4', { error: true });      // outra ferramenta recomeça a contagem
  assert.deepEqual(s.failStreak, { tool: 'Edit', count: 1 });
  use('5', 'Edit'); res('5', {});
  assert.equal(s.failStreak, null);
  use('6', 'Bash'); res('6', { error: true });
  state.apply(s, { ts: 3, kind: 'prompt' });
  assert.equal(s.failStreak, null);
});

test('estado: contexto estimado pela última chamada; janela de 200 mil ou 1 milhão', () => {
  const s = state.createSessionState();
  assert.equal(state.contextOf(s), null);
  state.apply(s, { ts: 1, kind: 'usage', model: 'm', tokens: { input: 10, output: 5000, cacheRead: 170_000, cacheWrite: 1000 } });
  assert.deepEqual(state.contextOf(s), { tokens: 171_010, limit: 200_000, pct: 86 });
  state.apply(s, { ts: 2, kind: 'usage', model: 'm', tokens: { input: 10, output: 1, cacheRead: 400_000, cacheWrite: 0 } });
  assert.deepEqual(state.contextOf(s), { tokens: 400_010, limit: 1_000_000, pct: 40 });
  assert.equal(state.summary(s, 10).context.pct, 40);
});

test('estado: arquivos editados (barras e maiúsculas normalizadas); só ferramentas de edição', () => {
  const s = state.createSessionState();
  state.apply(s, { ts: 5, kind: 'tool_use', ref: 'a', tool: 'Edit', summary: 'C:\\Proj\\Src\\A.js' });
  state.apply(s, { ts: 6, kind: 'tool_use', ref: 'b', tool: 'Read', summary: 'C:\\Proj\\Src\\B.js' });
  state.apply(s, { ts: 7, kind: 'tool_use', ref: 'c', tool: 'Write', summary: 'c:/proj/src/a.js' });
  assert.equal(s.edits.size, 1);
  assert.equal(s.edits.get('c:/proj/src/a.js').ts, 7);
});

/* ─────────────── alertas ─────────────── */

test('alertas: loop de ferramenta, mesmo arquivo, contexto cheio e sessão parada com alterações', () => {
  const now = 10_000_000;
  const base = { status: 'working', lastTs: now, dirty: null };
  assert.deepEqual(sessionAlerts(base, now), []);
  assert.deepEqual(sessionAlerts({ ...base, failStreak: { tool: 'Bash', count: 2 } }, now), []);
  assert.equal(sessionAlerts({ ...base, failStreak: { tool: 'Bash', count: 3 } }, now)[0].id, 'loop');
  assert.deepEqual(sessionAlerts({ ...base, status: 'idle', failStreak: { tool: 'Bash', count: 9 } }, now), []); // terminou: não é mais loop
  const c = sessionAlerts({ ...base, conflicts: [{ path: '/x/src/a.js', with: ['Outra'] }] }, now)[0];
  assert.equal(c.id, 'conflict'); assert.match(c.text, /a\.js/);
  assert.equal(sessionAlerts({ ...base, context: { tokens: 180_000, limit: 200_000, pct: 90 } }, now)[0].id, 'context');
  assert.deepEqual(sessionAlerts({ ...base, context: { tokens: 100_000, limit: 200_000, pct: 50 } }, now), []);
  const parked = { status: 'idle', lastTs: now - 11 * 60_000, dirty: 4 };
  assert.match(sessionAlerts(parked, now)[0].text, /Parada com 4 arquivos sem commit/);
  assert.match(sessionAlerts({ ...parked, dirty: 1 }, now)[0].text, /1 arquivo sem commit/);
  assert.deepEqual(sessionAlerts({ ...parked, lastTs: now - 60_000 }, now), []);  // parou há pouco
  assert.deepEqual(sessionAlerts({ ...parked, dirty: 0 }, now), []);
  assert.deepEqual(sessionAlerts(null), []);
});

/* ─────────────── serviço ─────────────── */

const iso = () => new Date().toISOString();
const userLine = (text, ts = iso(), cwd = '/x/proj') => j({ type: 'user', timestamp: ts, cwd, message: { role: 'user', content: text } });
const asstLine = (content, extra = {}) => j({ type: 'assistant', timestamp: iso(), message: { model: 'claude-sonnet-4-5', content, ...extra.message }, ...extra.top });
const edit = (id, file) => asstLine([{ type: 'tool_use', id, name: 'Edit', input: { file_path: file } }]);

function mkBase(files) {
  const base = tmp();
  const dir = path.join(base, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, id + '.jsonl'), text);
  return base;
}
const mkProvider = (base, liveRef) => ({ ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => (liveRef ? liveRef.map : new Map()) });

test('avisos: só na mudança para "esperando você" (informado pelo agente) ou erro; não avisa do que já estava assim', async () => {
  const base = mkBase({ s1: userLine('faz') + asstLine([{ type: 'text', text: 'vou' }]) });
  const live = { map: new Map() };
  const seen = [];
  const svc = createAimonService({ providers: [mkProvider(base, live)], windowMs: 3600e3, onAttention: (e) => seen.push(e) });
  await svc._tick();
  assert.equal(seen.length, 0);                                    // 1ª vez: só anota
  live.map = new Map([['s1', { status: 'waiting', waitingFor: 'Aguardando a sua permissão', statusUpdatedAt: Date.now(), pid: 1 }]]);
  await svc._tick();
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].kind, seen[0].key, seen[0].detail, seen[0].project], ['waiting', 'claude:s1', 'Aguardando a sua permissão', 'proj']);
  await svc._tick();
  assert.equal(seen.length, 1);                                    // continua esperando: não repete
  live.map = new Map([['s1', { status: 'busy', pid: 1 }]]); await svc._tick();
  live.map = new Map([['s1', { status: 'waiting', pid: 1 }]]); await svc._tick();
  assert.equal(seen.length, 1);                                    // voltou a esperar dentro de 20 s: não repete
  // erro da API
  fs.appendFileSync(path.join(base, 'proj', 's1.jsonl'), j({ type: 'assistant', timestamp: iso(), isApiErrorMessage: true, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Please run /login' }] } }));
  await svc._tick();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].kind, 'error');
  assert.match(seen[1].detail, /Login expirado/);
  svc.stop();
});

test('avisos: sessão que já estava esperando quando o acompanhamento liga não gera aviso; a estimativa do transcript também não', async () => {
  const base = mkBase({ s2: userLine('faz') + asstLine([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]) });
  const live = { map: new Map([['s2', { status: 'waiting', pid: 1 }]]) };
  const seen = [];
  const svc = createAimonService({ providers: [mkProvider(base, live)], windowMs: 3600e3, onAttention: (e) => seen.push(e) });
  await svc._tick(); await svc._tick();
  assert.equal(seen.length, 0);
  // sem o sinal do agente, a estimativa ("ferramenta sem resultado há 15 s") não avisa
  const base2 = mkBase({ s3: userLine('faz', new Date(Date.now() - 60_000).toISOString()) + j({ type: 'assistant', timestamp: new Date(Date.now() - 50_000).toISOString(), message: { content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'sleep 100' } }] } }) });
  const svc2 = createAimonService({ providers: [mkProvider(base2, { map: new Map() })], windowMs: 3600e3, onAttention: (e) => seen.push(e) });
  await svc2._tick(); await svc2._tick();
  assert.equal(svc2.list()[0].status, 'waiting');
  assert.equal(seen.length, 0);
  // um aviso que lança nunca derruba o monitor
  const live3 = { map: new Map() };
  const svc3 = createAimonService({ providers: [mkProvider(base, live3)], windowMs: 3600e3, onAttention: () => { throw new Error('boom'); } });
  await svc3._tick();
  live3.map = new Map([['s2', { status: 'idle', pid: 1 }]]); await svc3._tick();
  live3.map = new Map([['s2', { status: 'waiting', pid: 1 }]]); await svc3._tick();
  assert.equal(svc3.list().length, 1);
});

test('conflito: duas sessões em andamento editando o mesmo arquivo avisam uma à outra; um só não, nem leitura', async () => {
  const body = (f) => userLine('edita') + edit('e1', f);
  const base = mkBase({ a: body('/x/proj/src/app.js'), b: body('/x/proj/src/app.js'), c: body('/x/proj/src/outro.js') });
  const svc = createAimonService({ providers: [mkProvider(base)], windowMs: 3600e3 });
  await svc._tick();
  const rows = Object.fromEntries(svc.list().map((r) => [r.sessionId, r]));
  assert.equal(rows.a.conflicts.length, 1);
  assert.match(rows.a.conflicts[0].path, /app\.js$/);
  assert.equal(rows.a.conflicts[0].with.length, 1);
  assert.equal(rows.b.conflicts.length, 1);
  assert.deepEqual(rows.c.conflicts, []);
  const alone = createAimonService({ providers: [mkProvider(mkBase({ z: body('/x/a.js') }))], windowMs: 3600e3 });
  await alone._tick();
  assert.deepEqual(alone.list()[0].conflicts, []);
  const reads = mkBase({ a: userLine('l') + asstLine([{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x/a.js' } }]), b: userLine('l') + asstLine([{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x/a.js' } }]) });
  const svcR = createAimonService({ providers: [mkProvider(reads)], windowMs: 3600e3 });
  await svcR._tick();
  assert.ok(svcR.list().every((r) => r.conflicts.length === 0));
});

test('métricas no serviço: tokens por dia e por modelo viram custo; reler não dobra; diário traz o que foi pedido hoje', async () => {
  const usageLine = asstLine([{ type: 'text', text: 'feito' }], { message: { usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 } } });
  const base = mkBase({ u1: userLine('refatora o login') + usageLine });
  const file = path.join(tmp(), 'aimon-usage.json');
  const store = await createUsageStore({ file }).init();
  const svc = createAimonService({ providers: [mkProvider(base)], windowMs: 3600e3, usage: store, getPrices: () => ({}) });
  await svc._tick();
  const r = await svc.usage(7, []);
  assert.equal(r.totals.total, 11500);
  near(r.totals.cost, (1000 * 3 + 500 * 15 + 10000 * 3 * 0.1) / 1e6);
  assert.equal(r.totals.sessions, 1);
  assert.equal(r.byProject[0].project, 'proj');
  const again = await svc.usage(7, []);
  assert.equal(again.totals.total, 11500);                       // pedir de novo não soma de novo
  await store.flush();
  const reloaded = await createUsageStore({ file }).init();
  assert.equal(reloaded.range(7).totals.total, 11500);
  // preço personalizado entra pelo getPrices
  const svcP = createAimonService({ providers: [mkProvider(base)], windowMs: 3600e3, usage: store, getPrices: () => ({ 'claude-sonnet-4-5': { input: 0, output: 0 } }) });
  await svcP._tick();
  assert.equal((await svcP.usage(7, [])).totals.cost, 0);
  // diário
  const d = svc.dayDigest();
  assert.equal(d.date, dayKey(Date.now()));
  assert.equal(d.sessions.length, 1);
  assert.deepEqual(d.sessions[0].prompts, ['refatora o login']);
  assert.equal(d.sessions[0].tokens, 11500);
  assert.deepEqual(svc.sessionInfo('claude:u1'), { provider: 'claude', sessionId: 'u1', cwd: '/x/proj' });
  assert.equal(svc.sessionInfo('claude:nao-existe'), null);
  svc.stop();
});

test('métricas no serviço: sem armazenamento o monitor segue normal (usage vira null)', async () => {
  const svc = createAimonService({ providers: [mkProvider(mkBase({ q: userLine('oi') }))], windowMs: 3600e3 });
  await svc._tick();
  assert.equal(await svc.usage(7, []), null);
  assert.equal(await svc.usageClear(), true);
});

/* ─────────────── busca global ─────────────── */

test('busca: acha em prompts e respostas de sessões em disco, ignora avisos do agente e mostra o trecho', async () => {
  const base = mkBase({
    old1: userLine('preciso REFATORAR o módulo de login para usar tokens') + asstLine([{ type: 'text', text: 'Vou refatorar o login em duas etapas' }]) + userLine('<system-reminder>refatorar nada</system-reminder>') + userLine('x'.repeat(10) + ' refator ' + 'y'.repeat(5)),
    old2: userLine('outra coisa') + asstLine([{ type: 'text', text: 'sem relação' }]),
  });
  const provider = mkProvider(base);
  const r = await searchSessions({ providers: [provider], q: 'refator', days: 30 });
  assert.equal(r.scanned, 2);
  assert.equal(r.results.length, 3);                              // prompt, resposta, prompt curto — o system-reminder não conta
  assert.ok(r.results.every((x) => x.key === 'claude:old1' && x.project === 'proj' && x.cwd === '/x/proj'));
  const first = r.results[0];
  assert.equal(first.kind, 'prompt');
  assert.equal(first.snippet.hit, 'REFATOR');                     // guarda a caixa original
  assert.match(first.snippet.after, /^AR o módulo/);
  assert.deepEqual((await searchSessions({ providers: [provider], q: 'r' })).results, []);   // curto demais
  assert.equal((await searchSessions({ providers: [provider], q: 'inexistente-zzz' })).results.length, 0);
  assert.equal((await searchSessions({ providers: [provider], q: 'refator', limit: 1 })).results.length, 1);
  const none = await searchSessions({ providers: [{ ...provider, listSessions: async () => { throw new Error('x'); } }], q: 'refator' });
  assert.deepEqual(none.results, []);                             // um provedor que falha não derruba a busca
});

test('busca: respeita o limite por sessão e o período', async () => {
  const lines = Array.from({ length: 10 }, (_, i) => userLine(`pedido ${i} sobre deploy`)).join('');
  const base = mkBase({ many: lines });
  const r = await searchSessions({ providers: [mkProvider(base)], q: 'deploy', limit: 50 });
  assert.equal(r.results.length, 4);                              // no máximo 4 trechos por sessão
  const old = mkBase({ velho: userLine('deploy') });
  fs.utimesSync(path.join(old, 'proj', 'velho.jsonl'), new Date(Date.now() - 40 * 86400e3), new Date(Date.now() - 40 * 86400e3));
  assert.equal((await searchSessions({ providers: [mkProvider(old)], q: 'deploy', days: 14 })).results.length, 0);
  assert.equal((await searchSessions({ providers: [mkProvider(old)], q: 'deploy', days: 60 })).results.length, 1);
});

/* ─────────────── retomar ─────────────── */

test('retomar: comando fixo e entradas validadas (provedor, pasta, id)', () => {
  const dir = tmp();
  const id = '3f2a9c1e-1111-4222-8333-444455556666';
  assert.deepEqual(resume.plan({ provider: 'claude', sessionId: id, cwd: dir }), { bin: 'claude', args: ['--resume', id], cwd: dir });
  assert.deepEqual(resume.plan({ provider: 'codex', sessionId: id, cwd: dir }), { bin: 'codex', args: ['resume', id], cwd: dir });
  assert.deepEqual(resume.plan({ provider: 'claude', cwd: dir, mode: 'new' }), { bin: 'claude', args: [], cwd: dir });
  assert.throws(() => resume.plan({ provider: 'bash', sessionId: id, cwd: dir }), /desconhecida/);
  assert.throws(() => resume.plan({ provider: 'claude', sessionId: id, cwd: 'relativo' }), /pasta/);
  assert.throws(() => resume.plan({ provider: 'claude', sessionId: id, cwd: path.join(dir, 'nao-existe') }), /não existe/);
  assert.throws(() => resume.plan({ provider: 'claude', sessionId: id, cwd: dir, mode: 'x' }), /Modo/);
  for (const bad of ['', 'a', '; rm -rf /', '$(whoami)-aaaa-bbbb', 'id com espaco aaaaaaaa', "x'y-zzzzzzzz", id + '\n']) {
    assert.throws(() => resume.plan({ provider: 'claude', sessionId: bad, cwd: dir }), /inválido/, JSON.stringify(bad));
  }
  const evil = path.join(dir, 'a&b');
  fs.mkdirSync(evil);
  assert.throws(() => resume.plan({ provider: 'claude', sessionId: id, cwd: evil }), /caracteres/);   // não passa por um terminal sem escape
});

test('retomar: Windows Terminal primeiro, cmd se não houver; macOS e Linux; nada além do comando fixo', async () => {
  const dir = tmp();
  const id = '3f2a9c1e-1111-4222-8333-444455556666';
  const calls = [];
  const ok = async (file, args, opts) => { calls.push([file, args, opts]); };
  let r = await resume.open({ provider: 'claude', sessionId: id, cwd: dir }, { platform: 'win32', run: ok });
  assert.deepEqual(calls[0], ['wt.exe', ['-d', dir, 'cmd', '/k', `claude --resume ${id}`], {}]);
  assert.deepEqual([r.terminal, r.command], ['wt', `claude --resume ${id}`]);
  calls.length = 0;
  const noWt = async (file, args, opts) => { calls.push([file, args, opts]); if (file === 'wt.exe') throw new Error('ENOENT'); };
  r = await resume.open({ provider: 'codex', sessionId: id, cwd: dir }, { platform: 'win32', run: noWt });
  assert.equal(calls[1][0], 'cmd.exe');
  assert.deepEqual(calls[1][1], ['/c', 'start', '', 'cmd', '/k', `codex resume ${id}`]);
  assert.equal(calls[1][2].cwd, dir);
  assert.equal(r.terminal, 'cmd');
  calls.length = 0;
  await resume.open({ provider: 'claude', cwd: dir, mode: 'new' }, { platform: 'darwin', run: ok });
  assert.equal(calls[0][0], 'osascript');
  assert.match(calls[0][1][1], new RegExp(`do script "cd '${dir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}' && claude"`));
  calls.length = 0;
  const onlyXterm = async (file, args, opts) => { calls.push([file]); if (file !== 'xterm') throw new Error('ENOENT'); };
  await resume.open({ provider: 'claude', sessionId: id, cwd: dir }, { platform: 'linux', run: onlyXterm });
  assert.deepEqual(calls.map((c) => c[0]), ['gnome-terminal', 'konsole', 'xterm']);
  await assert.rejects(resume.open({ provider: 'claude', sessionId: id, cwd: dir }, { platform: 'linux', run: async () => { throw new Error('x'); } }), /Nenhum terminal/);
  await assert.rejects(resume.open({ provider: 'claude', sessionId: 'inválido', cwd: dir }, { platform: 'win32', run: ok }), /inválido/);
});

/* ─────────────── diário ─────────────── */

test('diário: entrada enxuta (limites) e tarefa mascara segredos, traz totais e recusa dia vazio', () => {
  const sessions = Array.from({ length: 20 }, (_, n) => ({ title: 'S' + n, project: 'p', prompts: Array.from({ length: 9 }, (_, i) => `pedido ${n}.${i} ana@empresa.com.br`), answers: ['a', 'b', 'c'], files: Array.from({ length: 30 }, (_, i) => 'f' + i), commits: Array.from({ length: 15 }, (_, i) => ({ hash: 'abcdef' + i, subject: 'c' + i })), tools: { Edit: 3 }, tokens: 100 }));
  const d = diaryInput({ date: '2026-10-19', sessions }, { workMs: 7_500_000, waitMs: 600_000, tokens: 1234, cost: 4.5, extra: 'x' });
  assert.equal(d.sessions.length, 12);
  assert.equal(d.sessions[0].prompts.length, 5);
  assert.equal(d.sessions[0].answers.length, 1);
  assert.equal(d.sessions[0].files.length, 15);
  assert.equal(d.sessions[0].commits.length, 10);
  assert.deepEqual(d.totals, { workMs: 7_500_000, waitMs: 600_000, tokens: 1234, cost: 4.5 });
  assert.deepEqual(diaryInput(null, null), { date: '', sessions: [], totals: { workMs: null, waitMs: null, tokens: null, cost: null } });
  const t = TASKS.aimonDiary.build(d);
  assert.match(t.user, /Data: 2026-10-19/);
  assert.match(t.user, /trabalhando: 2 h 05 min/);
  assert.match(t.user, /custo estimado: US\$ 4\.50/);
  assert.doesNotMatch(t.user, /ana@empresa\.com\.br/);              // segredo mascarado
  assert.match(t.system, /SOMENTE os dados fornecidos/);
  assert.throws(() => TASKS.aimonDiary.build({ sessions: [] }), /Não há sessões/);
  assert.ok(TASKS.aimonDiary.build(d).user.length < 30000);
});

/* ─────────────── sessão parada com alterações sem commit ─────────────── */

test('parada com alterações: só a sessão principal mais recente de cada pasta mostra os arquivos alterados', async () => {
  const { execFileSync } = await import('node:child_process');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const repo = fs.realpathSync.native(tmp());
  sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'config', 'user.email', 't@t'); sh(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'inicial');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dois\n'); fs.writeFileSync(path.join(repo, 'novo.txt'), 'x\n'); // 2 arquivos alterados
  const ended = (minAgo) => {
    const ts = new Date(Date.now() - minAgo * 60_000).toISOString();
    return j({ type: 'user', timestamp: ts, cwd: repo, message: { role: 'user', content: 'faz' } })
      + j({ type: 'assistant', timestamp: ts, message: { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'pronto' }] } });
  };
  const base = mkBase({ velha: ended(120), nova: ended(15) });
  const svc = createAimonService({ providers: [mkProvider(base)], pollMs: 30, windowMs: 6 * 3600e3 });
  svc.setActive(true);
  try {
    const end = Date.now() + 5000;
    let rows = [];
    while (Date.now() < end) { rows = svc.list(); if (rows.length === 2 && rows.some((r) => r.dirty != null)) break; await new Promise((r) => setTimeout(r, 40)); }
    const nova = rows.find((r) => r.sessionId === 'nova'); const velha = rows.find((r) => r.sessionId === 'velha');
    assert.equal(nova.status, 'idle');
    assert.equal(nova.dirty, 2);                                    // a dona da pasta mostra
    assert.equal(velha.dirty, null);                                // a antiga da mesma pasta, não
    assert.equal(sessionAlerts(nova)[0].id, 'parked');
    assert.deepEqual(sessionAlerts(velha), []);
  } finally { svc.stop(); }
});
