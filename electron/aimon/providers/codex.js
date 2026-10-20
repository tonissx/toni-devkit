'use strict';
/**
 * Monitor de IA — adaptador do Codex CLI. Lê ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl, linhas { timestamp, type, payload }.
 * Formato não público: o que não se reconhece é ignorado.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { clip, describeInput, describeError } = require('../util');

const id = 'codex';
const root = () => path.join(os.homedir(), '.codex', 'sessions');
const ts = (o, ctx) => { const t = Date.parse(o && o.timestamp); return Number.isFinite(t) ? t : (ctx && ctx.lastTs) || 0; };

function parseLine(line, ctx = {}) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (!o || typeof o !== 'object' || !o.payload || typeof o.payload !== 'object') return [];
  const t = ts(o, ctx);
  const p = o.payload;
  const ev = [];
  if (o.type === 'session_meta') {
    if (p.cwd) ctx.cwd = p.cwd;
    if (p.cli_version) ctx.version = p.cli_version;
  } else if (o.type === 'turn_context') {
    if (p.cwd && !ctx.cwd) ctx.cwd = p.cwd;
    if (p.model) ctx.model = p.model;
  } else if (o.type === 'event_msg') {
    if (p.type === 'task_started') ev.push({ ts: t, kind: 'turn_start' });
    else if (p.type === 'user_message') ev.push({ ts: t, kind: 'prompt', summary: clip(p.message, 400), size: String(p.message || '').length });
    else if (p.type === 'agent_message') ev.push({ ts: t, kind: 'text', summary: clip(p.message, 600) });
    else if (p.type === 'task_complete' || p.type === 'turn_aborted') ev.push({ ts: t, kind: 'turn_end' });
    else if (/error/i.test(String(p.type))) ev.push({ ts: t, kind: 'error', code: String(p.type), summary: describeError(p.type, p.message || p.error || '') });
    else if (p.type === 'token_count' && p.info && p.info.last_token_usage) {
      const u = p.info.last_token_usage;
      // Codex conta o cache dentro de input_tokens: separa para não somar duas vezes.
      const cached = u.cached_input_tokens || 0;
      ev.push({ ts: t, kind: 'usage', model: ctx.model, window: Number(p.info.model_context_window) || 0, tokens: { input: Math.max(0, (u.input_tokens || 0) - cached), output: u.output_tokens || 0, cacheRead: cached, cacheWrite: 0 } });
    }
  } else if (o.type === 'response_item') {
    if (p.type === 'reasoning') ev.push({ ts: t, kind: 'thinking', summary: '' });
    else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let input = p.arguments != null ? p.arguments : p.input != null ? p.input : p.action;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* texto puro */ } }
      ev.push({ ts: t, kind: 'tool_use', ref: p.call_id || p.id, tool: p.name || (p.type === 'local_shell_call' ? 'shell' : 'tool'), summary: describeInput(input) });
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const out = typeof p.output === 'string' ? p.output : p.output && p.output.content;
      ev.push({ ts: t, kind: 'tool_result', ref: p.call_id, summary: clip(out, 300), size: String(out == null ? '' : out).length });
    }
  }
  if (ev.length) ctx.lastTs = ev[ev.length - 1].ts || ctx.lastTs;
  return ev;
}

async function walk(dir, since, out, depth) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) await walk(f, since, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      const st = await fs.stat(f).catch(() => null);
      if (!st || st.mtimeMs < since) continue;
      const m = /rollout-.*?-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i.exec(e.name);
      out.push({ provider: id, sessionId: m ? m[1] : e.name.slice(0, -6), file: f, project: null, mtime: st.mtimeMs, size: st.size, parentId: null });
    }
  }
}

async function listSessions(since, base = root()) {
  const out = [];
  await walk(base, since, out, 0);
  return out;
}

module.exports = { id, name: 'Codex', icon: 'terminal', root, parseLine, listSessions };
