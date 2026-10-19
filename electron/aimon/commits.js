'use strict';
/**
 * Monitor de IA — commits que a própria sessão fez. Vêm exatos do transcript: a ferramenta de shell rodou
 * `git commit …` e o git respondeu com a linha `[branch abc1234] mensagem`. Nada de adivinhar por horário.
 *
 * O pedido (tool_use) e a resposta (tool_result) vêm em linhas diferentes e, na leitura incremental, às vezes em
 * trechos diferentes: o rastreador guarda os ids dos pedidos de commit que ainda esperam resposta (`pending()`),
 * e quem lê em partes pode devolvê-los ao criar o rastreador de novo.
 */
const { clip } = require('./util');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const MAX_PENDING = 50;
// `git commit`, `git -C dir commit`, `git -c k=v commit -m …` — e não `git commit-tree` nem `git log --grep=commit`.
const COMMIT_CMD = /(^|[\s;&|(])git(\s+-[^\s]+(\s+[^\s-][^\s]*)?)*\s+commit(\s|$)/;
// "[main abc1234] msg", "[main (root-commit) abc1234] msg", "[detached HEAD abc1234] msg"
const COMMIT_LINE = /^\[(detached HEAD|[^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] ?(.*)$/gm;

const commandOf = (input) => (input && typeof input === 'object' ? String(input.command || input.cmd || '') : String(input || ''));
const isGitCommitUse = (input) => COMMIT_CMD.test(commandOf(input));

/** Saída do git → [{ branch, hash, subject }] (um comando pode fazer vários commits). */
function parseCommitResult(text) {
  const out = [];
  const src = String(text || '');
  COMMIT_LINE.lastIndex = 0;
  for (let m = COMMIT_LINE.exec(src); m; m = COMMIT_LINE.exec(src)) out.push({ branch: m[1], hash: m[2], subject: clip(m[3], 200) });
  return out;
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x && x.text).filter(Boolean).join('\n') : '');

function createCommitTracker(pending = []) {
  const ids = new Set(Array.isArray(pending) ? pending : []);
  return {
    /** Um objeto de linha do transcript (já com JSON.parse) → commits que ela revela. */
    feed(o) {
      const out = [];
      if (!o || (o.type !== 'assistant' && o.type !== 'user')) return out; // cópias em "api-request-blob" não contam
      const content = o.message && o.message.content;
      if (!Array.isArray(content)) return out;
      const ts = Date.parse(o.timestamp);
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'tool_use' && SHELL_TOOLS.has(b.name) && b.id && isGitCommitUse(b.input)) {
          ids.add(b.id);
          if (ids.size > MAX_PENDING) ids.delete(ids.values().next().value);
        } else if (b.type === 'tool_result' && ids.has(b.tool_use_id)) {
          ids.delete(b.tool_use_id);
          for (const c of parseCommitResult(textOf(b.content))) out.push({ ts: Number.isFinite(ts) ? ts : 0, ...c });
        }
      }
      return out;
    },
    pending: () => [...ids],
  };
}

module.exports = { isGitCommitUse, parseCommitResult, createCommitTracker };
