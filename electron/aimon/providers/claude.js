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
const { clip, describeInput, textOf, isRejection, isRealApiError, describeError } = require('../util');
const { createCommitTracker } = require('../commits');

const id = 'claude';
const root = () => path.join(os.homedir(), '.claude', 'projects');
const ts = (o, ctx) => { const t = Date.parse(o && o.timestamp); return Number.isFinite(t) ? t : (ctx && ctx.lastTs) || 0; };

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
    if (typeof c === 'string') {
      if (c.trim() && !o.isMeta) ev.push({ ts: t, kind: 'prompt', summary: clip(c, 400) });
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_result') ev.push({ ts: t, kind: 'tool_result', ref: b.tool_use_id, error: !!b.is_error && !isRejection(b.content), rejected: !!b.is_error && isRejection(b.content), summary: clip(typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content.map((x) => x && x.text).filter(Boolean).join(' ') : ''), 300) });
        else if (b.type === 'text' && b.text && b.text.trim() && !o.isMeta) ev.push({ ts: t, kind: 'prompt', summary: clip(b.text, 400) });
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
      ev.push({ ts: t, kind: 'usage', model: m.model, tokens: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 } });
    }
    // Subagente termina entregando o relatório (ferramenta SubagentHandback), sem um end_turn.
    if (m.stop_reason === 'end_turn' || (Array.isArray(m.content) && m.content.some((b) => b && b.type === 'tool_use' && b.name === 'SubagentHandback'))) ev.push({ ts: t, kind: 'turn_end' });
  } else if (o.type === 'system' && typeof o.durationMs === 'number') ev.push({ ts: t, kind: 'turn_end' });
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
const waitingText = (w) => (w == null || w === '' ? null : clip(typeof w === 'string' ? w : JSON.stringify(w), 80));

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
    const info = { status: String(o.status || ''), waitingFor: waitingText(o.waitingFor), statusUpdatedAt: Number.isFinite(o.statusUpdatedAt) ? o.statusUpdatedAt : null, pid: o.pid, updatedAt: Number.isFinite(o.updatedAt) ? o.updatedAt : 0 };
    const prev = out.get(o.sessionId);
    if (!prev || info.updatedAt >= prev.updatedAt) out.set(o.sessionId, info); // sessão retomada em outro processo: vale o mais recente
  }
  return out;
}

module.exports = { id, name: 'Claude Code', icon: 'sparkles', root, parseLine, listSessions, live };
