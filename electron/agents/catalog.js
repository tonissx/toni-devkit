'use strict';
/**
 * Agentes — o que existe na máquina para o formulário oferecer: skills (usuário, projeto, plugins), servidores MCP e se o
 * CLAUDE.md do projeto proíbe worktrees. Somente leitura; qualquer arquivo ilegível é simplesmente ignorado.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const readText = async (f) => { try { return await fs.readFile(f, 'utf8'); } catch { return ''; } };

/** `description:` de um SKILL.md (uma linha; blocos dobrados viram vazio) — só para ajudar a reconhecer a skill. */
function skillDescription(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const d = m && /^description:[ \t]*(.*)$/m.exec(m[1]);
  const v = d ? d[1].trim().replace(/^["']|["']$/g, '') : '';
  return /^[>|]/.test(v) ? '' : v.slice(0, 160);
}

async function skillsIn(dir, source, prefix = '') {
  let names = [];
  try { names = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name); } catch { return []; }
  const rows = await Promise.all(names.map(async (n) => {
    const text = await readText(path.join(dir, n, 'SKILL.md'));
    return text ? { name: prefix + n, source, description: skillDescription(text) } : null;
  }));
  return rows.filter(Boolean);
}

/** Skills disponíveis: usuário (~/.claude/skills), projeto (<projeto>/.claude/skills) e plugins instalados (nome `plugin:skill`). */
async function listSkills({ root, home = os.homedir() } = {}) {
  const out = [...await skillsIn(path.join(home, '.claude', 'skills'), 'usuário')];
  if (root) out.push(...await skillsIn(path.join(root, '.claude', 'skills'), 'projeto'));
  const inst = await readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  for (const [key, entries] of Object.entries((inst && inst.plugins) || {})) {
    const plugin = key.split('@')[0];
    for (const e of Array.isArray(entries) ? entries : []) {
      if (e && e.installPath) out.push(...await skillsIn(path.join(e.installPath, 'skills'), 'plugin ' + plugin, plugin + ':'));
    }
  }
  const seen = new Set();
  return out.filter((s) => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Servidores MCP configurados: ~/.claude.json (global e do projeto) e <projeto>/.mcp.json. Só os nomes. */
async function listMcp({ root, home = os.homedir() } = {}) {
  const out = new Map();
  const add = (obj, source) => { for (const n of Object.keys(obj && typeof obj === 'object' ? obj : {})) if (!out.has(n)) out.set(n, { name: n, source }); };
  if (root) add((await readJson(path.join(root, '.mcp.json')) || {}).mcpServers, 'projeto (.mcp.json)');
  const cfg = await readJson(path.join(home, '.claude.json')) || {};
  if (root && cfg.projects) {
    const key = Object.keys(cfg.projects).find((k) => path.resolve(k).toLowerCase() === path.resolve(root).toLowerCase());
    if (key) add(cfg.projects[key].mcpServers, 'projeto (~/.claude.json)');
  }
  add(cfg.mcpServers, 'usuário');
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Linha do CLAUDE.md do projeto que proíbe worktrees (ou null). Heurística: cita "worktree" e uma negação/proibição. */
async function worktreeBan(root) {
  if (!root) return null;
  const text = await readText(path.join(root, 'CLAUDE.md'));
  const line = text.split(/\r?\n/).find((l) => /worktree/i.test(l) && /\b(n[ãa]o|nunca|proib\w*|evit\w*|sem|never|don'?t|do not|forbid\w*|avoid)\b/i.test(l));
  return line ? line.trim().slice(0, 200) : null;
}

async function catalog({ root, home } = {}) {
  const [skills, mcp, worktree] = await Promise.all([listSkills({ root, home }), listMcp({ root, home }), worktreeBan(root)]);
  return { skills, mcp, worktreeBan: worktree };
}

module.exports = { catalog, listSkills, listMcp, worktreeBan, skillDescription };
