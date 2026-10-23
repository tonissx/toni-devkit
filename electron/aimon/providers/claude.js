'use strict';
/**
 * Monitor de IA — adaptador do Claude Code. Lê o que o próprio Claude Code grava em disco:
 *   ~/.claude/projects/<projeto>/<sessão>.jsonl                      (a sessão)
 *   ~/.claude/projects/<projeto>/<sessão>/subagents/agent-<id>.jsonl (um subagente; ao lado, agent-<id>.meta.json)
 * O formato não é uma API pública: tipos e campos desconhecidos são ignorados, nunca viram erro.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { clip, describeInput, textOf, isRejection, isRealApiError, describeError, describeWaiting } = require('../util');
const { createCommitTracker } = require('../commits');

const id = 'claude';
const root = () => path.join(os.homedir(), '.claude', 'projects');
const MSG_MEMORY = 200; // mensagens lembradas para não contar o `usage` repetido
const ts = (o, ctx) => { const t = Date.parse(o && o.timestamp); return Number.isFinite(t) ? t : (ctx && ctx.lastTs) || 0; };

/** Tamanho do conteúdo de um tool_result em caracteres (texto) e quantas imagens ele trouxe. Só números: o texto não é guardado. */
function contentSize(content) {
  if (typeof content === 'string') return { size: content.length };
  if (!Array.isArray(content)) return { size: 0 };
  let size = 0; let images = 0;
  for (const x of content) { if (x && x.type === 'image') images++; else if (x && typeof x.text === 'string') size += x.text.length; }
  return images ? { size, images } : { size };
}

const json = (v) => { try { return JSON.stringify(v).length; } catch { return 0; } };
const baseName = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || String(p || '');

/**
 * Linha `attachment` do transcrito → partes do que o agente injeta no contexto (a "base fixa"): CLAUDE.md, lista de skills,
 * instruções de MCP, nomes de ferramentas adiadas, lista de agentes e dados do ambiente. → [{ part, name, size }]
 */
function attachmentParts(a) {
  switch (a.type) {
    case 'instructions': return (Array.isArray(a.files) ? a.files : []).filter((f) => f && typeof f.content === 'string').map((f) => ({ part: 'instructions', name: `${baseName(f.path)}${f.type ? ` (${f.type === 'Project' ? 'projeto' : f.type === 'User' ? 'usuário' : String(f.type).toLowerCase()})` : ''}`, size: f.content.length }));
    case 'skill_listing': return [{ part: 'skills', name: 'Lista de skills', size: String(a.content || '').length }];
    case 'mcp_instructions_delta': return [{ part: 'mcp', name: 'Instruções de servidores MCP', size: (Array.isArray(a.addedBlocks) ? a.addedBlocks : []).join('').length }];
    case 'deferred_tools_delta': return [{ part: 'tools', name: 'Ferramentas adiadas (nomes)', size: (Array.isArray(a.addedNames) ? a.addedNames : []).join(', ').length }];
    case 'agent_listing_delta': return [{ part: 'agents', name: 'Lista de agentes', size: json(a) }];
    case 'environment': case 'session_context': case 'model': case 'date': return [{ part: 'other', name: 'Ambiente e sessão', size: json(a) }];
    // Durante a sessão o agente ainda injeta coisas no contexto; nomeá-las evita um "Outros" gigante e sem explicação.
    case 'edited_text_file': return [{ part: 'files', name: 'Arquivos alterados fora do agente', size: json(a) }];
    case 'file': return [{ part: 'files', name: 'Arquivos anexados', size: json(a) }];
    case 'plan_file_reference': case 'plan_mode': case 'plan_mode_exit': case 'plan_mode_reentry': return [{ part: 'plan', name: 'Modo de plano', size: json(a) }];
    case 'total_tokens_reminder': case 'task_reminder': case 'silent_turn_reminder': case 'queued_command': case 'hook_system_message': case 'auto_mode': case 'thinking_drop': return [{ part: 'reminders', name: 'Lembretes e avisos do agente', size: json(a) }];
    default: return [];
  }
}

/** Uma linha do .jsonl → eventos normalizados (ver ../util.js). `ctx` é o estado do arquivo ({ lastTs, … }). */
function parseLine(line, ctx = {}) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (!o || typeof o !== 'object') return [];
  const t = ts(o, ctx);
  const ev = [];
  if (o.cwd && !ctx.cwd) ctx.cwd = o.cwd;
  if (o.gitBranch && !ctx.branch) ctx.branch = o.gitBranch;
  if (o.version && !ctx.version) ctx.version = o.version;
  if (o.type === 'ai-title' && o.aiTitle) ev.push({ ts: t, kind: 'title', summary: clip(o.aiTitle, 120) });
  else if (o.type === 'user' && o.message) {
    const c = o.message.content;
    // O resumo que o agente gera ao compactar chega como mensagem de usuário: não é um pedido (vem junto do evento `compact`).
    if (typeof c === 'string') {
      if (c.trim() && !o.isMeta && !o.isCompactSummary) ev.push({ ts: t, kind: 'prompt', summary: clip(c, 400), size: c.length });
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_result') ev.push({ ts: t, kind: 'tool_result', ref: b.tool_use_id, error: !!b.is_error && !isRejection(b.content), rejected: !!b.is_error && isRejection(b.content), summary: clip(typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content.map((x) => x && x.text).filter(Boolean).join(' ') : ''), 300), ...contentSize(b.content) });
        else if (b.type === 'text' && b.text && b.text.trim() && !o.isMeta && !o.isCompactSummary) ev.push({ ts: t, kind: 'prompt', summary: clip(b.text, 400), size: b.text.length });
      }
    }
  } else if (o.type === 'assistant' && o.message) {
    const m = o.message;
    // Erro da API (login expirado, limite, servidor): vira um evento de erro, não um texto do agente.
    const apiError = isRealApiError(o);
    if (apiError) ev.push({ ts: t, kind: 'error', code: String(o.error || 'api_error'), summary: describeError(o.error, textOf(m.content)) });
    for (const b of apiError ? [] : (Array.isArray(m.content) ? m.content : [])) {
      if (!b) continue;
      if (b.type === 'thinking') ev.push({ ts: t, kind: 'thinking', summary: clip(b.thinking || '', 200) });
      else if (b.type === 'text' && b.text) ev.push({ ts: t, kind: 'text', summary: clip(b.text, 600) });
      else if (b.type === 'tool_use') ev.push({ ts: t, kind: 'tool_use', ref: b.id, tool: b.name, summary: describeInput(b.input) });
    }
    if (m.usage) {
      const u = m.usage;
      const full = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
      // O Claude Code grava uma linha por bloco da mesma mensagem (thinking, text, tool_use) e repete o mesmo `usage` em todas:
      // contar cada linha infla tokens e custo. Conta-se uma vez por `message.id`; se o id reaparecer com números maiores
      // (saída que cresceu), soma só o acréscimo.
      const seen = ctx.msgUsage || (ctx.msgUsage = new Map());
      const prev = m.id ? seen.get(m.id) : null;
      if (m.id) {
        seen.delete(m.id);
        seen.set(m.id, prev ? { input: Math.max(prev.input, full.input), output: Math.max(prev.output, full.output), cacheRead: Math.max(prev.cacheRead, full.cacheRead), cacheWrite: Math.max(prev.cacheWrite, full.cacheWrite) } : full);
        if (seen.size > MSG_MEMORY) seen.delete(seen.keys().next().value);
      }
      const delta = prev ? { input: Math.max(0, full.input - prev.input), output: Math.max(0, full.output - prev.output), cacheRead: Math.max(0, full.cacheRead - prev.cacheRead), cacheWrite: Math.max(0, full.cacheWrite - prev.cacheWrite) } : full;
      if (!prev || delta.input || delta.output || delta.cacheRead || delta.cacheWrite) ev.push({ ts: t, kind: 'usage', model: m.model, tokens: delta, call: !prev ? full : null });
    }
    // Subagente termina entregando o relatório (ferramenta SubagentHandback), sem um end_turn.
    if (m.stop_reason === 'end_turn' || (Array.isArray(m.content) && m.content.some((b) => b && b.type === 'tool_use' && b.name === 'SubagentHandback'))) ev.push({ ts: t, kind: 'turn_end' });
  } else if (o.type === 'system' && o.subtype === 'compact_boundary') {
    const m = o.compactMetadata || {};
    ev.push({ ts: t, kind: 'compact', trigger: m.trigger === 'manual' ? 'manual' : 'auto', pre: Number(m.preTokens) || 0, post: Number(m.postTokens) || 0,
      summary: `Conversa compactada (${m.trigger === 'manual' ? 'manual' : 'automática'})${m.preTokens ? `: ${m.preTokens} → ${m.postTokens || '?'} tokens` : ''}` });
  } else if (o.type === 'system' && typeof o.durationMs === 'number') ev.push({ ts: t, kind: 'turn_end' });
  else if (o.type === 'attachment' && o.attachment) for (const a of attachmentParts(o.attachment)) ev.push({ ts: t, kind: 'ctx_attach', ...a });
  // Commits que a própria sessão fez (o git responde com "[branch abc1234] mensagem").
  for (const c of (ctx.commits || (ctx.commits = createCommitTracker())).feed(o)) ev.push({ ts: c.ts || t, kind: 'commit', hash: c.hash, branch: c.branch, summary: c.subject });
  if (ev.length) ctx.lastTs = ev[ev.length - 1].ts || ctx.lastTs;
  return ev;
}

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }

/** Sessões (e subagentes) com atividade depois de `since` (ms). */
async function listSessions(since, base = root()) {
  const out = [];
  let projects;
  try { projects = await fs.readdir(base, { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(base, p.name);
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const file = path.join(dir, e.name);
        const st = await fs.stat(file).catch(() => null);
        if (st && st.mtimeMs >= since) out.push({ provider: id, sessionId: e.name.slice(0, -6), file, project: p.name, mtime: st.mtimeMs, size: st.size, parentId: null });
      } else if (e.isDirectory()) {
        const sub = path.join(dir, e.name, 'subagents');
        let subs;
        try { subs = await fs.readdir(sub, { withFileTypes: true }); } catch { continue; }
        for (const s of subs) {
          if (!s.isFile() || !s.name.endsWith('.jsonl')) continue;
          const file = path.join(sub, s.name);
          const st = await fs.stat(file).catch(() => null);
          if (!st || st.mtimeMs < since) continue;
          const aid = s.name.slice(0, -6);
          const meta = await readJson(path.join(sub, aid + '.meta.json'));
          out.push({ provider: id, sessionId: aid, file, project: p.name, mtime: st.mtimeMs, size: st.size, parentId: e.name, label: meta && (meta.description || meta.agentType) ? clip(String(meta.description || meta.agentType), 80) : null });
        }
      }
    }
  }
  return out;
}

const sessionsDir = () => path.join(os.homedir(), '.claude', 'sessions');
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; } };
const waitingText = describeWaiting;

/**
 * Estado ao vivo das sessões, do arquivo que o próprio Claude Code mantém em ~/.claude/sessions/<pid>.json
 * ({ sessionId, status: busy | waiting | shell…, waitingFor?, statusUpdatedAt }). O transcript não registra uma chamada
 * pendente (a linha só aparece quando o resultado chega), então "esperando você" só se sabe por aqui.
 * Só entra processo que ainda existe. Os arquivos .key da pasta guardam segredo e nunca são lidos.
 * → Map sessionId → { status, waitingFor, statusUpdatedAt, pid }
 */
async function live(dir = sessionsDir(), alive = pidAlive) {
  const out = new Map();
  let names;
  try { names = await fs.readdir(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    let o;
    try { o = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')); } catch { continue; }
    if (!o || typeof o.sessionId !== 'string' || !Number.isFinite(o.pid) || !alive(o.pid)) continue;
    const info = { status: String(o.status || ''), waitingFor: waitingText(o.waitingFor), statusUpdatedAt: Number.isFinite(o.statusUpdatedAt) ? o.statusUpdatedAt : null, pid: o.pid, procStart: o.procStart == null ? null : String(o.procStart), updatedAt: Number.isFinite(o.updatedAt) ? o.updatedAt : 0 };
    const prev = out.get(o.sessionId);
    if (!prev || info.updatedAt >= prev.updatedAt) out.set(o.sessionId, info); // sessão retomada em outro processo: vale o mais recente
  }
  return out;
}

const runTaskkill = (args) => new Promise((resolve, reject) => {
  require('node:child_process').execFile('taskkill', args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
});

/**
 * Encerra o processo. Primeiro o pedido educado (SIGTERM; no Windows `taskkill /T`, que leva os filhos: shell, MCP). O Claude Code
 * roda como processo de console, sem janela para receber o pedido, então o Windows recusa ("só pode ser forçada") e o jeito é `/F`.
 * É seguro: o transcript é gravado a cada linha, e quem pediu foi a própria pessoa (com confirmação se estava trabalhando).
 */
async function killPid(pid, { platform = process.platform, run = runTaskkill } = {}) {
  if (platform !== 'win32') { process.kill(pid, 'SIGTERM'); return; }
  try { await run(['/PID', String(pid), '/T']); return; } catch { /* sem janela: tenta forçar */ }
  try { await run(['/PID', String(pid), '/T', '/F']); } catch { throw new Error('O Windows não deixou encerrar o processo (ele pode já ter fechado, ou pertencer a outro usuário e exigir administrador).'); }
}

/**
 * Encerra o processo de uma sessão viva. Relê ~/.claude/sessions antes de matar: o pid só vale se o arquivo ainda é desta
 * sessão e do mesmo início de processo (`procStart`) — o Windows reaproveita pid. `expect.procStart` é o que o monitor viu.
 * → { ok: true, pid } ; lança Error com motivo se a sessão não está mais viva ou o processo mudou.
 */
async function close(sessionId, expect = {}, { dir = sessionsDir(), alive = pidAlive, kill = killPid } = {}) {
  let names;
  try { names = await fs.readdir(dir); } catch { names = []; }
  let found = null;
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const o = await readJson(path.join(dir, n));
    if (!o || o.sessionId !== sessionId || !Number.isFinite(o.pid) || !alive(o.pid)) continue;
    if (!found || (Number(o.updatedAt) || 0) >= (Number(found.updatedAt) || 0)) found = o;
  }
  if (!found) throw new Error('A sessão não está mais aberta.');
  if (expect.pid != null && found.pid !== expect.pid) throw new Error('A sessão agora roda em outro processo; atualize a lista.');
  if (expect.procStart != null && String(found.procStart) !== String(expect.procStart)) throw new Error('O processo mudou desde a leitura; atualize a lista.');
  await kill(found.pid);
  return { ok: true, pid: found.pid };
}

module.exports = { id, name: 'Claude Code', icon: 'sparkles', root, parseLine, listSessions, live, close, killPid };
