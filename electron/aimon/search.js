'use strict';
/**
 * Monitor de IA — busca nos prompts e nas respostas das sessões gravadas em disco (Claude Code, Codex…), além das 24 h que
 * o acompanhamento mantém na memória. Sem índice e sem cópia: lê os .jsonl na hora, só os modificados nos últimos `days`
 * dias, linha a linha; só as linhas que contêm o texto são interpretadas pelo adaptador. Somente leitura.
 */
const fs = require('node:fs');
const readline = require('node:readline');

const MIN_QUERY = 2;
const MAX_FILE = 300 * 1024 * 1024;   // arquivo maior que isso fica de fora
const MAX_LINE = 2_000_000;           // linha gigante (resultado de ferramenta) não é interpretada
const PER_SESSION = 4;                // no máximo tantos trechos de cada sessão
const BUDGET_MS = 9000;               // passou disso, devolve o que achou e avisa que cortou
const KINDS = new Set(['prompt', 'text']);
// Avisos do próprio agente chegam como "prompt": não são o que a pessoa escreveu.
const HARNESS = /^\s*<(task-notification|system-reminder|command-name|command-message|command-args|local-command|user-prompt-submit-hook)\b/i;

const base = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || '';
const CWD = /"cwd":"((?:[^"\\]|\\.)*)"/;

/** Recorte de `text` em torno da primeira ocorrência de `needle` (minúsculo): { before, hit, after }. */
function around(text, needle, radius = 70) {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const a = Math.max(0, at - radius); const b = Math.min(text.length, at + needle.length + radius);
  return { before: (a > 0 ? '…' : '') + text.slice(a, at), hit: text.slice(at, at + needle.length), after: text.slice(at + needle.length, b) + (b < text.length ? '…' : '') };
}

/**
 * → { results: [{ provider, sessionId, parentId, key, project, cwd, ts, kind, snippet }], scanned, truncated }
 * Mais recentes primeiro (por arquivo; dentro do arquivo, na ordem em que aparecem).
 */
async function searchSessions({ providers, q, days = 14, limit = 60, now = Date.now(), budgetMs = BUDGET_MS }) {
  const needle = String(q == null ? '' : q).trim().toLowerCase();
  const out = { results: [], scanned: 0, truncated: false };
  if (needle.length < MIN_QUERY) return out;
  limit = Math.max(1, Math.min(200, Math.floor(limit) || 60));
  const since = now - Math.max(1, Math.min(90, Math.floor(days) || 14)) * 86400e3;
  const t0 = Date.now();

  const files = [];
  for (const p of providers) {
    let list = [];
    try { list = await p.listSessions(since); } catch { list = []; }
    for (const m of list) if (!(m.size > MAX_FILE)) files.push({ p, m });
  }
  files.sort((a, b) => b.m.mtime - a.m.mtime);

  for (const { p, m } of files) {
    if (out.results.length >= limit || Date.now() - t0 > budgetMs) { out.truncated = true; break; }
    out.scanned++;
    const ctx = {};
    let cwd = null; let n = 0; let found = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(m.file, { encoding: 'utf8' }), crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        n++;
        if (!cwd && n <= 40) { const c = CWD.exec(line); if (c) { try { cwd = JSON.parse('"' + c[1] + '"'); } catch { /* sem pasta */ } } }
        if (line.length > MAX_LINE || !line.toLowerCase().includes(needle)) continue;
        let evs;
        try { evs = p.parseLine(line, ctx); } catch { continue; }
        for (const ev of evs) {
          if (!KINDS.has(ev.kind) || !ev.summary || HARNESS.test(ev.summary)) continue;
          const snippet = around(ev.summary, needle);
          if (!snippet) continue;
          out.results.push({ provider: p.id, sessionId: m.sessionId, parentId: m.parentId || null, key: p.id + ':' + m.sessionId, project: base(cwd) || m.project || '', cwd, ts: ev.ts || m.mtime, kind: ev.kind, snippet });
          if (++found >= PER_SESSION || out.results.length >= limit) break;
        }
        if (found >= PER_SESSION || out.results.length >= limit) break;
        if (Date.now() - t0 > budgetMs) { out.truncated = true; break; }
      }
    } catch { /* arquivo sumiu ou ilegível: segue para o próximo */ } finally { rl.close(); }
  }
  return out;
}

module.exports = { searchSessions, around, HARNESS };
