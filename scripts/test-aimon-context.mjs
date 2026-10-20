// Testes da visão de Contexto do Monitor de IA (do que é feito o contexto de uma sessão): node --test scripts/test-aimon-context.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const codex = require('../electron/aimon/providers/codex.js');
const state = require('../electron/aimon/state.js');
const { newCtx, applyCtx, summarize, suggest, thin } = require('../electron/aimon/context.js');
const { createAimonService } = require('../electron/aimon/service.js');

const T = 1_760_000_000_000;
const play = (events, c = newCtx()) => { for (const e of events) applyCtx(c, e); return c; };
const call = (ts, ctx, out = 0, extra = {}) => ({ ts, kind: 'usage', tokens: { input: 2, output: out, cacheRead: 0, cacheWrite: ctx - 2 }, ...extra });
const chars = (tokens) => tokens * 4;
const total = (sm) => sm.composition.reduce((n, c) => n + c.tokens, 0);

/* ─────────────── atribuição do crescimento ─────────────── */

test('base fixa: o contexto da 1ª chamada, repartido pelos anexos; o resto é o sistema do agente', () => {
  const c = play([
    { ts: T, kind: 'ctx_attach', part: 'instructions', name: 'CLAUDE.md (projeto)', size: chars(1000) },
    { ts: T, kind: 'ctx_attach', part: 'skills', name: 'Lista de skills', size: chars(2000) },
    { ts: T, kind: 'prompt', summary: 'faz x', size: chars(100) },
    call(T + 1, 10000, 500),
  ]);
  const sm = summarize(c);
  assert.equal(sm.ctx, 10000);
  assert.equal(sm.base.tokens, 9900);                                  // 10000 − o pedido
  assert.deepEqual(sm.base.parts.map((p) => [p.name, p.tokens]), [['Sistema e ferramentas do agente', 6900], ['Lista de skills', 2000], ['CLAUDE.md (projeto)', 1000]]);
  assert.deepEqual(sm.composition.map((x) => [x.key, x.tokens]), [['base', 9900], ['prompts', 100]]);
  assert.equal(total(sm), 10000);
  assert.equal(sm.has, true);
  assert.deepEqual(summarize(newCtx()), { has: false, partial: false });
});

test('crescimento: saída da chamada anterior (exata) + resultados estimados + resto em "Outros"', () => {
  const c = play([
    { ts: T, kind: 'prompt', summary: 'abre', size: chars(100) }, call(T + 1, 10000, 500),
    { ts: T + 2, kind: 'tool_use', ref: 'a', tool: 'Read', summary: '/x/app.js' },
    { ts: T + 3, kind: 'tool_result', ref: 'a', size: chars(10000) },
    call(T + 4, 20800, 200),                                         // G = 10800 = 500 (saída) + 10000 (Read) + 300 (resto)
  ]);
  const sm = summarize(c);
  const get = (k) => (sm.composition.find((x) => x.key === k) || { tokens: 0 }).tokens;
  assert.deepEqual([get('assistant'), get('tools'), get('other')], [500, 10000, 300]);
  assert.deepEqual(sm.tools, [{ tool: 'Read', tokens: 10000, n: 1 }]);
  assert.deepEqual(sm.items, [{ tool: 'Read', target: '/x/app.js', tokens: 10000, n: 1 }]);
  assert.equal(total(sm), 20800);                                    // a soma sempre fecha com o contexto medido
  assert.equal(sm.growth, 10800);
});

test('crescimento: se a estimativa passa do que o contexto cresceu, tudo é reduzido na mesma proporção', () => {
  const c = play([
    { ts: T, kind: 'prompt', size: chars(100) }, call(T + 1, 10000, 0),
    { ts: T + 2, kind: 'tool_use', ref: 'a', tool: 'Bash', summary: 'ls' }, { ts: T + 3, kind: 'tool_result', ref: 'a', size: chars(50000) },
    { ts: T + 4, kind: 'prompt', size: chars(50000) },
    call(T + 5, 12000, 0),                                           // cresceu só 2000, mas a estimativa diz 100 mil
  ]);
  const sm = summarize(c);
  const tools = sm.composition.find((x) => x.key === 'tools').tokens;
  const prompts = sm.composition.find((x) => x.key === 'prompts').tokens;
  assert.ok(tools + prompts <= 2100 && tools + prompts >= 1900, `${tools} + ${prompts}`);
  assert.equal(tools, prompts + 0 === tools ? tools : tools);       // proporcional: resultados e pedido iguais ⇒ metades iguais
  assert.ok(Math.abs(tools - (prompts - 100)) <= 2);
  assert.equal(total(sm), 12000);
});

test('imagens pesam um valor fixo e arquivo lido de novo é contado e sinalizado', () => {
  const evs = [{ ts: T, kind: 'prompt', size: 40 }, call(T + 1, 8000, 0)];
  let ts = T + 2; let ctx = 8000;
  for (let i = 0; i < 3; i++) {
    evs.push({ ts: ts++, kind: 'tool_use', ref: 'r' + i, tool: 'Read', summary: 'C:\\proj\\src\\big.js' }, { ts: ts++, kind: 'tool_result', ref: 'r' + i, size: chars(6000) });
    ctx += 6000; evs.push(call(ts++, ctx, 0));
  }
  evs.push({ ts: ts++, kind: 'tool_use', ref: 'img', tool: 'Read', summary: 'shot.png' }, { ts: ts++, kind: 'tool_result', ref: 'img', size: 0, images: 1 }, call(ts++, ctx + 1500, 0));
  const sm = summarize(play(evs));
  assert.deepEqual(sm.repeated, [{ target: 'C:\\proj\\src\\big.js', n: 3, tokens: 18000 }]);
  assert.equal(sm.items.find((i) => i.target === 'shot.png').tokens, 1500);
  const sg = suggest(sm);
  assert.ok(sg.some((s) => s.id === 'repeat' && /big\.js lido 3×/.test(s.text)));
});

test('chamadas repetidas do mesmo usage (blocos da mesma mensagem) não contam como outra chamada; saída que cresce é somada', () => {
  const c = play([
    { ts: T, kind: 'prompt', size: 40 },
    { ts: T + 1, kind: 'usage', tokens: { input: 2, output: 1, cacheRead: 0, cacheWrite: 7998 }, call: { input: 2, output: 1, cacheRead: 0, cacheWrite: 7998 } },
    { ts: T + 2, kind: 'usage', tokens: { input: 0, output: 299, cacheRead: 0, cacheWrite: 0 }, call: null },   // a saída cresceu na linha seguinte
    { ts: T + 3, kind: 'usage', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, call: null },
    { ts: T + 4, kind: 'tool_use', ref: 'a', tool: 'Bash', summary: 'ls' }, { ts: T + 5, kind: 'tool_result', ref: 'a', size: chars(500) },
    call(T + 6, 8800, 0),                                            // G = 800 = 300 (saída final) + 500 (Bash)
  ]);
  const sm = summarize(c);
  assert.equal(sm.calls, 2);
  assert.equal(sm.composition.find((x) => x.key === 'assistant').tokens, 300);
  assert.equal(sm.composition.find((x) => x.key === 'tools').tokens, 500);
});

/* ─────────────── compactação ─────────────── */

test('compactação do agente: zera a composição; o contexto vira base + resumo; janela de 1 milhão continua', () => {
  const evs = [{ ts: T, kind: 'ctx_attach', part: 'instructions', name: 'CLAUDE.md', size: chars(500) }, { ts: T, kind: 'prompt', size: 40 }, call(T + 1, 20000, 0)];
  let ctx = 20000; let ts = T + 2;
  for (let i = 0; i < 4; i++) { evs.push({ ts: ts++, kind: 'tool_use', ref: 'r' + i, tool: 'Bash', summary: 'cmd ' + i }, { ts: ts++, kind: 'tool_result', ref: 'r' + i, size: chars(200000) }); ctx += 200000; evs.push(call(ts++, ctx, 0)); }
  const before = summarize(play(evs.slice()));
  assert.equal(before.window, 1_000_000);                            // passou de 200 mil: janela estendida
  evs.push({ ts: ts++, kind: 'compact', trigger: 'auto', pre: ctx, post: 16907 }, call(ts++, 30000, 0));
  const sm = summarize(play(evs));
  assert.equal(sm.compactions.length, 1);
  assert.deepEqual([sm.compactions[0].from, sm.compactions[0].to, sm.compactions[0].trigger], [ctx, 30000, 'auto']);
  assert.deepEqual(sm.composition.map((x) => x.key), ['base', 'summary']);
  assert.equal(sm.composition.find((x) => x.key === 'base').tokens, 19990);       // 20000 − o pedido (10)
  assert.equal(sm.composition.find((x) => x.key === 'summary').tokens, 10010);    // 30000 − a base
  assert.equal(total(sm), 30000);
  assert.deepEqual([sm.tools, sm.items], [[], []]);                  // o que foi lido antes não está mais no contexto
  assert.equal(sm.window, 1_000_000);                                // depois de compactar a janela continua a mesma
});

test('compactação sem evento: queda de mais de 40% entre chamadas é tratada como compactação', () => {
  const sm = summarize(play([{ ts: T, kind: 'prompt', size: 40 }, call(T + 1, 100000, 0), call(T + 2, 30000, 0)]));
  assert.equal(sm.compactions.length, 1);
  assert.equal(sm.compactions[0].trigger, 'queda');
  const small = summarize(play([{ ts: T, kind: 'prompt', size: 40 }, call(T + 1, 100000, 0), call(T + 2, 95000, 0)]));
  assert.equal(small.compactions.length, 0);                         // oscilação pequena não é compactação
});

/* ─────────────── invariante e janela ─────────────── */

test('a soma da composição sempre fecha com o contexto medido, em sequências variadas', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const evs = [{ ts: T, kind: 'ctx_attach', part: 'skills', name: 'Skills', size: chars(3000) }, { ts: T, kind: 'prompt', size: 200 }]; let ctx = 9000; let ts = T + 1;
  evs.push(call(ts++, ctx, 100));
  for (let i = 0; i < 60; i++) {
    if (rnd() < 0.5) { evs.push({ ts: ts++, kind: 'prompt', size: Math.round(rnd() * 5000) }); }
    for (let j = 0; j < Math.round(rnd() * 3); j++) { evs.push({ ts: ts++, kind: 'tool_use', ref: `r${i}-${j}`, tool: ['Read', 'Bash', 'Grep'][j % 3], summary: 'f' + (j % 4) }, { ts: ts++, kind: 'tool_result', ref: `r${i}-${j}`, size: Math.round(rnd() * 80000) }); }
    if (rnd() < 0.1) evs.push({ ts: ts++, kind: 'ctx_attach', part: 'files', name: 'Arquivos anexados', size: Math.round(rnd() * 9000) });
    ctx = rnd() < 0.08 ? Math.round(ctx * 0.3) : ctx + Math.round(rnd() * 15000) - (rnd() < 0.1 ? 500 : 0);
    evs.push(call(ts++, Math.max(5000, ctx), Math.round(rnd() * 800)));
    const sm = summarize(play(evs.slice()));
    assert.ok(Math.abs(total(sm) - sm.ctx) <= sm.composition.length, `passo ${i}: soma ${total(sm)} ≠ contexto ${sm.ctx}`);
    assert.ok(sm.composition.every((x) => x.tokens > 0));
  }
});

test('janela: informada pelo provedor vale; senão 200 mil ou, se o contexto já passou disso, 1 milhão — também no estado do card', () => {
  const sm = summarize(play([{ ts: T, kind: 'prompt', size: 4 }, call(T + 1, 100000, 0, { window: 258400 })]));
  assert.deepEqual([sm.window, sm.windowKnown, sm.pct], [258400, true, 39]);
  const s = state.createSessionState();
  state.apply(s, { ts: T, kind: 'usage', model: 'm', tokens: { input: 1, output: 0, cacheRead: 600_000, cacheWrite: 0 } });
  assert.equal(state.contextOf(s).limit, 1_000_000);
  state.apply(s, { ts: T + 1, kind: 'usage', model: 'm', tokens: { input: 1, output: 0, cacheRead: 30_000, cacheWrite: 0 } });   // depois de compactar
  assert.deepEqual([state.contextOf(s).tokens, state.contextOf(s).limit], [30001, 1_000_000]);   // a janela não volta a 200 mil
  const cx = state.createSessionState();
  state.apply(cx, { ts: T, kind: 'usage', model: 'm', window: 258400, tokens: { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.equal(state.contextOf(cx).limit, 258400);
});

test('thin: reduz a série mantendo o último ponto', () => {
  const s = Array.from({ length: 500 }, (_, i) => ({ ts: i, ctx: i }));
  const t = thin(s, 120);
  assert.equal(t.length, 120); assert.deepEqual([t[0].ts, t[119].ts], [0, 499]);
  assert.equal(thin(s.slice(0, 5), 120).length, 5);
});

/* ─────────────── sugestões ─────────────── */

test('sugestões: contexto cheio, saída enorme, base pesada, ferramentas dominando, compactou demais e projeção', () => {
  const base = { has: true, ctx: 180000, window: 200000, pct: 90, calls: 50, base: { tokens: 60000, parts: [{ name: 'CLAUDE.md (usuário)', kind: 'instructions', tokens: 9000 }, { name: 'Sistema e ferramentas do agente', kind: 'system', tokens: 40000 }] },
    composition: [{ key: 'base', tokens: 60000 }, { key: 'tools', tokens: 100000 }, { key: 'prompts', tokens: 20000 }], tools: [], items: [{ tool: 'Bash', target: 'npm test', tokens: 25000, n: 1 }], repeated: [], compactions: [{}, {}], growth: 12000, callsLeft: 1 };
  const ids = suggest(base).map((s) => s.id);
  assert.deepEqual(ids, ['full', 'big', 'base', 'tools', 'compact']);   // 'proj' não aparece porque 'full' já cobre
  const proj = suggest({ ...base, pct: 70, ctx: 140000, compactions: [] }).map((s) => s.id);
  assert.ok(proj.includes('proj') && !proj.includes('full'));
  assert.match(suggest(base).find((s) => s.id === 'base').detail, /CLAUDE\.md \(usuário\) \(~9 mil\)/);
  assert.deepEqual(suggest({ has: false }), []);
  assert.deepEqual(suggest({ ...base, pct: 20, base: { tokens: 5000, parts: [] }, composition: [{ key: 'base', tokens: 5000 }], items: [], compactions: [], callsLeft: 400 }), []);
});

/* ─────────────── leitura dos transcritos ─────────────── */

const j = (o) => JSON.stringify(o);
const parse = (o, ctx = {}) => claude.parseLine(j(o), ctx);

test('Claude: anexos viram partes da base fixa; só medida, sem guardar o texto; tipos que não são injetados ficam de fora', () => {
  const att = (a) => parse({ type: 'attachment', timestamp: new Date(T).toISOString(), attachment: a });
  const inst = att({ type: 'instructions', files: [{ path: 'C:\\Users\\x\\proj\\CLAUDE.md', type: 'Project', content: 'a'.repeat(400) }, { path: 'C:\\Users\\x\\.claude\\CLAUDE.md', type: 'User', content: 'b'.repeat(80) }] });
  assert.deepEqual(inst.map((e) => [e.kind, e.part, e.name, e.size]), [['ctx_attach', 'instructions', 'CLAUDE.md (projeto)', 400], ['ctx_attach', 'instructions', 'CLAUDE.md (usuário)', 80]]);
  assert.deepEqual(att({ type: 'skill_listing', content: 'x'.repeat(1000) }).map((e) => [e.part, e.size]), [['skills', 1000]]);
  assert.equal(att({ type: 'mcp_instructions_delta', addedNames: ['a'], addedBlocks: ['x'.repeat(30), 'y'.repeat(20)] })[0].size, 50);
  assert.equal(att({ type: 'deferred_tools_delta', addedNames: ['Read', 'Write'] })[0].size, 'Read, Write'.length);
  assert.equal(att({ type: 'edited_text_file', filename: 'a.js', snippet: 'z'.repeat(300) })[0].part, 'files');
  assert.equal(att({ type: 'total_tokens_reminder', text: '<total_tokens>1</total_tokens>' })[0].part, 'reminders');
  assert.deepEqual(att({ type: 'prompt_snapshot', big: 'x'.repeat(5000) }), []);          // registro do transcrito, não é injetado
  assert.deepEqual(att({ type: 'deferred_tools_record', names: ['x'] }), []);
  assert.deepEqual(att({ type: 'coisa-nova' }), []);
  assert.ok(!JSON.stringify(inst).includes('aaaa'));                                       // o conteúdo não vai junto
});

test('Claude: compactação vira evento; o resumo gerado não é um pedido; tamanhos de pedido e resultado (com imagem)', () => {
  const cb = parse({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(T).toISOString(), compactMetadata: { trigger: 'auto', preTokens: 974707, postTokens: 16907 } });
  assert.deepEqual(cb.map((e) => [e.kind, e.trigger, e.pre, e.post]), [['compact', 'auto', 974707, 16907]]);
  assert.match(cb[0].summary, /compactada \(automática\): 974707 → 16907/);
  assert.deepEqual(parse({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Resumo gigante da conversa…' } }), []);
  assert.deepEqual(parse({ type: 'user', message: { role: 'user', content: 'x'.repeat(900) } }).map((e) => [e.kind, e.size, e.summary.length <= 400]), [['prompt', 900, true]]);
  const tr = parse({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'y'.repeat(700) }, { type: 'image', source: {} }] }, { type: 'tool_result', tool_use_id: 't2', content: 'z'.repeat(50) }] } });
  assert.deepEqual(tr.map((e) => [e.ref, e.size, e.images]), [['t1', 700, 1], ['t2', 50, undefined]]);
  assert.ok(tr.every((e) => e.summary.length <= 300));
});

test('Codex: tamanho do pedido e do resultado, e a janela de contexto informada', () => {
  const line = (o) => codex.parseLine(j({ timestamp: new Date(T).toISOString(), ...o }), {});
  assert.equal(line({ type: 'event_msg', payload: { type: 'user_message', message: 'a'.repeat(120) } })[0].size, 120);
  assert.equal(line({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c', output: 'b'.repeat(77) } })[0].size, 77);
  const u = line({ type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 258400, last_token_usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 10 } } } })[0];
  assert.deepEqual([u.window, u.tokens.input, u.tokens.cacheRead], [258400, 4000, 1000]);
});

/* ─────────────── serviço ─────────────── */

test('serviço: context(key) junta anexos, chamadas e compactação; anexos não vão para a timeline; compactação vai', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-ctx-'));
  fs.mkdirSync(path.join(base, 'proj'), { recursive: true });
  const iso = (ms) => new Date(ms).toISOString();
  const now = Date.now();
  const L = (o) => j(o) + '\n';
  const asst = (ms, id, ctx, out, content) => L({ type: 'assistant', timestamp: iso(ms), message: { id, model: 'claude-sonnet-5-5', content, usage: { input_tokens: 2, cache_creation_input_tokens: ctx - 2, cache_read_input_tokens: 0, output_tokens: out } } });
  const text = L({ type: 'attachment', timestamp: iso(now - 9000), attachment: { type: 'instructions', files: [{ path: '/p/CLAUDE.md', type: 'Project', content: 'c'.repeat(2000) }] } })
    + L({ type: 'user', timestamp: iso(now - 8000), cwd: '/x/proj', message: { role: 'user', content: 'p'.repeat(400) } })
    + asst(now - 7000, 'm1', 12000, 300, [{ type: 'thinking', thinking: 't' }]) + asst(now - 7000, 'm1', 12000, 300, [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/x/proj/a.js' } }])
    + L({ type: 'user', timestamp: iso(now - 6000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r'.repeat(20000) }] } })
    + asst(now - 5000, 'm2', 17400, 100, [{ type: 'text', text: 'ok' }])
    + L({ type: 'system', subtype: 'compact_boundary', timestamp: iso(now - 4000), compactMetadata: { trigger: 'manual', preTokens: 17400, postTokens: 3000 } })
    + asst(now - 3000, 'm3', 15000, 50, [{ type: 'text', text: 'depois' }]);
  fs.writeFileSync(path.join(base, 'proj', 's1.jsonl'), text);
  const svc = createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => new Map() }], windowMs: 3600e3 });
  await svc._tick();
  const sm = svc.context('claude:s1');
  assert.equal(sm.found, true);
  assert.equal(sm.calls, 3);                                         // 3 mensagens (a m1 tem 2 linhas, conta uma vez)
  assert.deepEqual([sm.ctx, sm.compactions.length, sm.compactions[0].trigger], [15000, 1, 'manual']);
  assert.deepEqual(sm.composition.map((x) => [x.key, x.tokens]), [['base', 11900], ['summary', 3100]]);   // base = 12000 − o pedido (100)
  assert.equal(sm.base.parts.find((p) => p.name === 'CLAUDE.md (projeto)').tokens, 500);
  assert.ok(Array.isArray(sm.suggestions));
  const kinds = new Set(svc.timeline('claude:s1').events.map((e) => e.kind));
  assert.ok(kinds.has('compact') && !kinds.has('ctx_attach'));
  assert.ok(!JSON.stringify(sm).includes('pppp') && !JSON.stringify(sm).includes('rrrr'));        // só números e nomes: nada do texto
  assert.deepEqual(svc.context('claude:nao-existe'), { has: false, partial: false, found: false });
  assert.equal(svc.list()[0].tokens.output, 300 + 100 + 50);         // e o usage repetido da m1 não inflou os totais
});
