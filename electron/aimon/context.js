'use strict';
/**
 * Monitor de IA — do que é feito o contexto de uma sessão. Puro: recebe os eventos normalizados (ver util.js) e guarda só
 * números (tamanhos em tokens estimados), nunca o texto das mensagens.
 *
 * O tamanho do contexto em cada chamada ao modelo é exato (`usage`: entrada + cache lido + cache gravado). O que se estima é de
 * que ele é feito. Entre duas chamadas seguidas o contexto cresce `G = ctx(i) − ctx(i−1)`, que é:
 *   a saída da chamada anterior (exata: output_tokens)
 * + o pedido novo e os resultados de ferramentas que chegaram nesse intervalo (estimados pelo tamanho: caracteres ÷ 4)
 * + o resto (lembretes, anexos, tudo o que o transcrito não mostra) → "Outros".
 * Se a soma estimada passa do crescimento medido, tudo é reduzido na mesma proporção para caber. A base fixa é o contexto da
 * 1ª chamada (medido), repartido pelos anexos que o transcrito traz (CLAUDE.md, lista de skills, instruções de MCP…); o que
 * sobra é o prompt de sistema e as definições de ferramentas do agente. Compactação (evento do agente ou queda forte do
 * contexto) zera a composição: o contexto passa a ser a base fixa + o resumo da conversa.
 */
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1500;       // uma imagem pesa mais ou menos isso, seja qual for o tamanho do texto em base64
const MAX_SERIES = 800;
const MAX_FILES = 300;
const MAX_REFS = 200;
const MAX_GROWTHS = 10;
const DROP = 0.4;                // queda de mais de 40% entre duas chamadas = compactação
const WINDOW_DEFAULT = 200_000;
const WINDOW_EXTENDED = 1_000_000;

const est = (chars) => Math.round((chars || 0) / CHARS_PER_TOKEN);

function newCtx() {
  return {
    last: null,                   // { ctx, out } da última chamada
    calls: 0,
    maxCtx: 0,
    window: 0,                    // janela informada pelo provedor (Codex); 0 = estimar
    series: [],                   // [{ ts, ctx }]
    compactions: [],              // [{ ts, from, to, trigger }]
    attach: [],                   // anexos antes da 1ª chamada: [{ part, name, tokens }]
    base: null,                   // { ctx, parts: [{ name, kind, tokens }] } medido na 1ª chamada
    comp: { prompts: 0, assistant: 0, tools: 0, summary: 0, other: 0 },
    tools: {},                    // nome → { tokens, n }
    files: {},                    // "ferramenta\0alvo" → { tool, target, tokens, n }
    otherBy: {},                  // anexos nomeados que entraram durante a sessão: nome → tokens
    pending: { prompt: 0, attach: [], results: [] },  // chegou desde a última chamada
    refs: new Map(),              // ref do tool_use → { tool, target }
    compactNext: null,            // evento de compactação visto, à espera da próxima chamada
    growths: [],                  // crescimento das últimas chamadas (para projetar)
  };
}

function addFile(c, tool, target, tokens) {
  const key = tool + '\u0000' + target;
  const e = c.files[key] || (c.files[key] = { tool, target, tokens: 0, n: 0 });
  e.tokens += tokens; e.n++;
  const keys = Object.keys(c.files);
  if (keys.length > MAX_FILES) { // descarta o mais leve
    let min = null;
    for (const k of keys) if (min === null || c.files[k].tokens < c.files[min].tokens) min = k;
    delete c.files[min];
  }
}

/** Zera a composição (compactação): o contexto passa a ser base fixa + resumo. */
function afterCompaction(c, ctx) {
  const fixed = c.base ? c.base.ctx : 0;
  c.comp = { prompts: 0, assistant: 0, tools: 0, summary: Math.max(0, ctx - fixed), other: 0 };
  c.tools = {}; c.files = {}; c.growths = []; c.otherBy = {};
  c.pending = { prompt: 0, attach: [], results: [] };
}

/** Uma chamada ao modelo: `call` = { input, output, cacheRead, cacheWrite } completo. */
function onCall(c, ev, call) {
  const ctx = (call.input || 0) + (call.cacheRead || 0) + (call.cacheWrite || 0);
  if (!(ctx > 0)) return;
  const out = call.output || 0;
  if (ev.window > 0) c.window = ev.window;
  if (ctx > c.maxCtx) c.maxCtx = ctx;
  const p = c.pending;
  const resultsTokens = p.results.reduce((n, r) => n + r.tokens, 0);

  if (!c.last) {
    // 1ª chamada: a base fixa é o que sobra depois de tirar o pedido e o que já tinha chegado de ferramentas.
    const own = p.prompt + resultsTokens;
    const attachTotal = c.attach.reduce((n, a) => n + a.tokens, 0);
    const scaleOwn = own > ctx * 0.6 && own > 0 ? (ctx * 0.6) / own : 1;
    const baseCtx = Math.max(0, ctx - own * scaleOwn);
    const scaleA = attachTotal > baseCtx * 0.95 && attachTotal > 0 ? (baseCtx * 0.95) / attachTotal : 1;
    const parts = c.attach.map((a) => ({ name: a.name, kind: a.part, tokens: a.tokens * scaleA }));
    parts.push({ name: 'Sistema e ferramentas do agente', kind: 'system', tokens: Math.max(0, baseCtx - attachTotal * scaleA) });
    c.base = { ctx: baseCtx, parts };
    c.comp.prompts += p.prompt * scaleOwn;
    for (const r of p.results) { const t = r.tokens * scaleOwn; c.comp.tools += t; (c.tools[r.tool] || (c.tools[r.tool] = { tokens: 0, n: 0 })).tokens += t; c.tools[r.tool].n++; addFile(c, r.tool, r.target, t); }
  } else if (c.compactNext || ctx < c.last.ctx * (1 - DROP)) {
    const trigger = c.compactNext ? c.compactNext.trigger || 'auto' : 'queda';
    c.compactions.push({ ts: ev.ts, from: c.compactNext && c.compactNext.pre ? c.compactNext.pre : c.last.ctx, to: ctx, trigger });
    afterCompaction(c, ctx);
    c.compactNext = null;
  } else {
    const g = Math.max(0, ctx - c.last.ctx);
    const assistant = Math.min(c.last.out, g);
    const remaining = g - assistant;
    const attachTokens = p.attach.reduce((n, a) => n + a.tokens, 0);
    const known = p.prompt + attachTokens + resultsTokens;
    const scale = known > remaining && known > 0 ? remaining / known : 1;
    c.comp.assistant += assistant;
    c.comp.prompts += p.prompt * scale;
    for (const a of p.attach) { c.comp.other += a.tokens * scale; c.otherBy[a.name] = (c.otherBy[a.name] || 0) + a.tokens * scale; }
    c.comp.other += Math.max(0, remaining - known * scale);
    for (const r of p.results) {
      const t = r.tokens * scale;
      c.comp.tools += t;
      const tl = c.tools[r.tool] || (c.tools[r.tool] = { tokens: 0, n: 0 });
      tl.tokens += t; tl.n++;
      addFile(c, r.tool, r.target, t);
    }
    c.growths.push(g);
    if (c.growths.length > MAX_GROWTHS) c.growths.shift();
  }
  c.pending = { prompt: 0, attach: [], results: [] };
  c.last = { ctx, out };
  c.calls++;
  c.series.push({ ts: ev.ts, ctx });
  if (c.series.length > MAX_SERIES) c.series.splice(0, c.series.length - MAX_SERIES);
}

/** Aplica um evento normalizado. */
function applyCtx(c, ev) {
  if (!ev) return c;
  switch (ev.kind) {
    case 'ctx_attach': {
      const tokens = est(ev.size);
      if (!c.last) { if (c.attach.length < 60) c.attach.push({ part: ev.part || 'other', name: ev.name || 'Anexo', tokens }); } else if (c.pending.attach.length < 100) c.pending.attach.push({ name: ev.name || 'Anexo', tokens });
      break;
    }
    case 'prompt': c.pending.prompt += est(ev.size != null ? ev.size : (ev.summary || '').length); break;
    case 'tool_use': if (ev.ref) { c.refs.set(ev.ref, { tool: ev.tool || '?', target: ev.summary || '' }); if (c.refs.size > MAX_REFS) c.refs.delete(c.refs.keys().next().value); } break;
    case 'tool_result': {
      const info = (ev.ref && c.refs.get(ev.ref)) || { tool: '?', target: '' };
      if (ev.ref) c.refs.delete(ev.ref);
      c.pending.results.push({ tool: info.tool, target: info.target, tokens: est(ev.size != null ? ev.size : (ev.summary || '').length) + (ev.images || 0) * IMAGE_TOKENS });
      break;
    }
    case 'compact': c.compactNext = { pre: ev.pre || 0, post: ev.post || 0, trigger: ev.trigger || 'auto' }; break;
    case 'usage': {
      // `call` vem do Claude: o usage completo na 1ª linha da mensagem e null nas repetições. Sem `call` (Codex), cada evento é uma chamada.
      const call = ev.call === undefined ? ev.tokens : ev.call;
      if (call === null) { if (c.last && ev.tokens && ev.tokens.output > 0) c.last.out += ev.tokens.output; } // saída que cresceu depois da 1ª linha
      else if (call) onCall(c, ev, call);
      break;
    }
    default: break;
  }
  return c;
}

const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);

/** Pontos da série reduzidos a no máximo `max`, sempre com o último. */
function thin(series, max) {
  if (series.length <= max) return series.map((p) => ({ ...p }));
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push({ ...series[Math.round((i * (series.length - 1)) / (max - 1))] });
  out.push({ ...series[series.length - 1] });
  return out;
}

/** Resumo para a tela: tudo em tokens (estimados), já arredondado. */
function summarize(c, { partial = false } = {}) {
  if (!c.last) return { has: false, partial };
  const ctx = c.last.ctx;
  const known = c.window > 0;
  const window = known ? c.window : c.maxCtx > WINDOW_DEFAULT ? WINDOW_EXTENDED : WINDOW_DEFAULT;
  const baseCtx = c.base ? Math.min(c.base.ctx, ctx) : 0;
  // O que foi atribuído não pode passar do que o contexto realmente cresceu desde a base; o que faltar vai para "Outros".
  const avail = Math.max(0, ctx - baseCtx);
  const assigned = sum(c.comp);
  const k = assigned > avail && assigned > 0 ? avail / assigned : 1;
  const comp = {};
  for (const key of Object.keys(c.comp)) comp[key] = c.comp[key] * k;
  comp.other += Math.max(0, avail - assigned * k);
  const labels = { prompts: 'Seus pedidos', assistant: 'Respostas do agente', tools: 'Resultados de ferramentas', summary: 'Resumo da compactação', other: 'Outros (lembretes, anexos)' };
  const composition = [{ key: 'base', name: c.base ? 'Base fixa' : 'Base fixa (não lida)', tokens: Math.round(baseCtx) }]
    .concat(Object.keys(labels).map((key) => ({ key, name: labels[key], tokens: Math.round(comp[key]) })))
    .filter((x) => x.tokens > 0);
  const tools = Object.entries(c.tools).map(([tool, v]) => ({ tool, tokens: Math.round(v.tokens * k), n: v.n })).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  const items = Object.values(c.files).filter((f) => f.target).map((f) => ({ tool: f.tool, target: f.target, tokens: Math.round(f.tokens * k), n: f.n })).sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  const repeated = Object.values(c.files).filter((f) => f.n >= 3 && f.target && /^(read|view|cat)$/i.test(f.tool)).map((f) => ({ target: f.target, n: f.n, tokens: Math.round(f.tokens * k) })).sort((a, b) => b.tokens - a.tokens).slice(0, 5);
  // "Outros" detalhado: anexos nomeados que entraram durante a sessão + o que não dá para identificar.
  const named = Object.entries(c.otherBy).map(([name, tokens]) => ({ name, tokens: Math.round(tokens * k) })).filter((x) => x.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 5);
  const namedSum = named.reduce((n, x) => n + x.tokens, 0);
  const unknown = Math.max(0, Math.round(comp.other) - namedSum);
  const others = unknown > 0 ? named.concat([{ name: 'Não identificado', tokens: unknown }]) : named;
  const growth = c.growths.length ? Math.round(sum(c.growths) / c.growths.length) : 0;
  return {
    has: true, partial, ctx, window, windowKnown: known, pct: Math.min(100, Math.round((ctx / window) * 100)), calls: c.calls,
    base: c.base ? { tokens: Math.round(baseCtx), parts: c.base.parts.map((p) => ({ ...p, tokens: Math.round(p.tokens) })).filter((p) => p.tokens > 0).sort((a, b) => b.tokens - a.tokens) } : null,
    composition, others, tools, items, repeated, compactions: c.compactions.slice(-10).map((x) => ({ ...x })),
    series: thin(c.series, 120), growth, callsLeft: growth > 0 ? Math.max(0, Math.floor((window - ctx) / growth)) : null,
  };
}

const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1000 ? Math.round(n / 1000) + ' mil' : String(n));
const short = (p) => { const s = String(p).split('\\').join('/').split('/').filter(Boolean); return s.length > 2 ? '…/' + s.slice(-2).join('/') : s.join('/'); };

/** Sugestões em português a partir do resumo, da mais urgente para a menos. → [{ id, icon, text, detail }] */
function suggest(sm) {
  if (!sm || !sm.has) return [];
  const out = [];
  if (sm.pct >= 85) out.push({ id: 'full', icon: 'triangle-alert', text: `Contexto ${sm.pct}% cheio`, detail: 'Perto do limite a conversa perde qualidade ou compacta sozinha. Rode /compact agora, ou abra uma sessão nova com o briefing (botão Briefing).' });
  for (const r of sm.repeated.slice(0, 2)) out.push({ id: 'repeat', icon: 'repeat', text: `${short(r.target)} lido ${r.n}×`, detail: `O mesmo arquivo entrou no contexto ${r.n} vezes (~${kTok(r.tokens)} tokens no total). Peça trechos (offset/limit) ou um resumo em vez de reler o arquivo inteiro.` });
  for (const it of sm.items.filter((x) => x.tokens >= 15000 && x.n < 3).slice(0, 2)) out.push({ id: 'big', icon: 'file-warning', text: `${it.tool} pesou ~${kTok(it.tokens)}`, detail: `${short(it.target)}: um único resultado ocupa ${Math.round((it.tokens / sm.ctx) * 100)}% do contexto. Filtre a saída (grep, head, --quiet) ou peça só o que interessa.` });
  if (sm.base && sm.base.tokens >= 30000 && sm.base.tokens >= sm.window * 0.12) {
    const heavy = sm.base.parts.filter((p) => p.kind !== 'system').slice(0, 2).map((p) => `${p.name} (~${kTok(p.tokens)})`);
    out.push({ id: 'base', icon: 'layers', text: `Base fixa de ~${kTok(sm.base.tokens)}`, detail: `Isso entra em toda sessão antes do primeiro pedido${heavy.length ? `; os maiores itens identificados: ${heavy.join(', ')}` : ''}. Enxugar CLAUDE.md, skills e servidores MCP libera espaço em todas as sessões.` });
  }
  const dyn = sm.composition.filter((x) => x.key !== 'base').reduce((n, x) => n + x.tokens, 0);
  const tools = (sm.composition.find((x) => x.key === 'tools') || { tokens: 0 }).tokens;
  if (dyn > 20000 && tools / dyn >= 0.6) out.push({ id: 'tools', icon: 'wrench', text: `Ferramentas são ${Math.round((tools / dyn) * 100)}% do que foi acrescentado`, detail: 'A maior parte do contexto veio de resultados de ferramentas. Pedir buscas mais específicas e saídas curtas reduz o consumo.' });
  if (sm.compactions.length >= 2) out.push({ id: 'compact', icon: 'archive', text: `Compactou ${sm.compactions.length}×`, detail: 'Cada compactação resume a conversa e perde detalhes. Numa sessão tão longa, uma sessão nova com o briefing costuma render mais.' });
  if (sm.callsLeft != null && sm.callsLeft <= 15 && sm.pct < 85) out.push({ id: 'proj', icon: 'gauge', text: `Enche em ~${sm.callsLeft} chamadas`, detail: `No ritmo atual (~${kTok(sm.growth)} tokens por chamada) o contexto chega ao limite em poucas chamadas.` });
  return out.slice(0, 6);
}

module.exports = { newCtx, applyCtx, summarize, suggest, thin, est, WINDOW_DEFAULT, WINDOW_EXTENDED };
