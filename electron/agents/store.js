'use strict';
/**
 * Agentes — leitura e escrita dos subagentes do Claude Code: um arquivo `.md` por agente em ~/.claude/agents.
 * Frontmatter (name, description, tools, model, skills, permissionMode…) + o prompt no corpo. É o formato nativo da ferramenta, então o agente
 * criado aqui também funciona no terminal. Qualquer outra chave do frontmatter (hooks, campos novos…) é preservada como está.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { atomicWrite } = require('../lib/fsx');
const { permissions, isBuiltinName } = require('../../src/tools/agents/agentForm.js');

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY_LINE = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/;
const SCALARS = ['name', 'description', 'model', 'permissionMode', 'maxTurns', 'memory', 'effort', 'isolation', 'color', 'background'];
const LISTS = ['tools', 'disallowedTools', 'skills', 'mcpServers'];

const defaultDir = () => path.join(os.homedir(), '.claude', 'agents');

function unquote(v) {
  const s = String(v == null ? '' : v).trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** Escreve um valor escalar de forma que o YAML do Claude Code leia de volta igual. */
function quoteIfNeeded(v) {
  const s = String(v);
  return s === '' || /^[\s"'`>|*&!%@#\-?[\]{},]/.test(s) || /:\s|\s#|[\r\n]|\s$/.test(s) ? JSON.stringify(s) : s;
}

/**
 * → { name, description, model, tools: string[]|null, disallowedTools, skills, mcpServers: string[], permissionMode, maxTurns,
 *     memory, effort, isolation, color: string, background: boolean, extra: string, prompt, error }.
 * `error` quando o arquivo não é um agente válido. Tudo que não é campo conhecido (hooks, mcpServers com configuração inline,
 * campos futuros…) fica em `extra`, linha a linha, e é regravado como estava.
 */
function parseAgent(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const out = { name: '', description: '', model: '', tools: null, disallowedTools: [], skills: [], mcpServers: [], permissionMode: '', maxTurns: '', memory: '', effort: '', isolation: '', color: '', background: false, extra: '', prompt: src, error: null };
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(src);
  if (!m) { out.error = /^---\n/.test(src) ? 'O frontmatter não termina: falta a linha “---” de fechamento.' : 'O arquivo não começa com um frontmatter (“---” na primeira linha).'; return out; }
  out.prompt = m[2].replace(/^\n+/, '');
  const blocks = []; // { key, lines[] } — continuação (listas, textos longos) fica com a chave de cima
  for (const line of m[1].split('\n')) {
    const k = KEY_LINE.exec(line);
    if (k && !/^\s/.test(line)) blocks.push({ key: k[1], value: k[2] || '', lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  const extra = [];
  for (const b of blocks) {
    if (SCALARS.includes(b.key) && b.lines.length === 1 && !/^[|>]/.test(b.value)) {
      const v = unquote(b.value);
      if (b.key === 'background') out.background = /^true$/i.test(v);
      else out[b.key] = v;
      continue;
    }
    if (LISTS.includes(b.key)) {
      const list = parseList(b);
      if (list) { out[b.key] = b.key === 'tools' && !list.length ? null : list; continue; }
    }
    extra.push(...b.lines);
  }
  out.extra = extra.join('\n').replace(/\s+$/, '');
  if (!out.description && !extra.some((l) => /^description:/.test(l))) out.error = 'Falta o campo obrigatório “description” no frontmatter.';
  else if (!out.name && !extra.some((l) => /^name:/.test(l))) out.error = 'Falta o campo obrigatório “name” no frontmatter.';
  return out;
}

/** Lista simples de um bloco: `a, b`, `[a, b]` ou itens `- a`. null quando há algo mais complexo (mapas, aninhamento) → fica no extra. */
function parseList(b) {
  const item = (s) => { const v = unquote(s); return v && !/:\s|:$|^[{[]/.test(v) ? v : null; };
  const v = b.value.trim();
  if (b.lines.length === 1) {
    if (/^[|>]/.test(v)) return null;
    const inner = /^\[(.*)\]$/.exec(v);
    const parts = (inner ? inner[1] : v).split(',').map((t) => t.trim()).filter(Boolean);
    const items = parts.map(item);
    return items.some((x) => x === null) ? null : items;
  }
  if (v) return null;
  const items = [];
  for (const line of b.lines.slice(1)) {
    if (!line.trim()) continue;
    const mm = /^\s+-\s+(.*)$/.exec(line);
    const it = mm && item(mm[1]);
    if (!it) return null;
    items.push(it);
  }
  return items;
}

function serializeAgent(a) {
  const lines = ['---', `name: ${quoteIfNeeded(a.name)}`, `description: ${quoteIfNeeded(a.description || '')}`];
  const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
  if (arr(a.tools).length) lines.push(`tools: ${a.tools.join(', ')}`);
  if (arr(a.disallowedTools).length) lines.push(`disallowedTools: ${a.disallowedTools.join(', ')}`);
  if (a.model) lines.push(`model: ${quoteIfNeeded(a.model)}`);
  if (a.permissionMode) lines.push(`permissionMode: ${quoteIfNeeded(a.permissionMode)}`);
  if (a.maxTurns !== '' && a.maxTurns != null) lines.push(`maxTurns: ${a.maxTurns}`);
  if (arr(a.skills).length) lines.push('skills:', ...a.skills.map((s) => `  - ${quoteIfNeeded(s)}`));
  if (arr(a.mcpServers).length) lines.push('mcpServers:', ...a.mcpServers.map((s) => `  - ${quoteIfNeeded(s)}`));
  if (a.memory) lines.push(`memory: ${quoteIfNeeded(a.memory)}`);
  if (a.background) lines.push('background: true');
  if (a.effort) lines.push(`effort: ${quoteIfNeeded(a.effort)}`);
  if (a.isolation) lines.push(`isolation: ${quoteIfNeeded(a.isolation)}`);
  if (a.color) lines.push(`color: ${quoteIfNeeded(a.color)}`);
  if (a.extra && a.extra.trim()) lines.push(a.extra.replace(/\s+$/, ''));
  lines.push('---', '', String(a.prompt || '').replace(/\s+$/, ''), '');
  return lines.join('\n');
}

/** Lista de nomes limpa: sem vazios nem repetidos; recusa quebra de linha e vírgula (que quebrariam o frontmatter). */
function cleanList(v, what) {
  if (!Array.isArray(v)) return [];
  const out = [...new Set(v.map((t) => String(t).trim()).filter(Boolean))];
  if (out.some((t) => /[\r\n,]/.test(t))) throw new Error(`${what}: nome inválido.`);
  return out;
}

/** Valida e normaliza o que veio da tela. Lança Error (em português) se algo não presta. */
function cleanAgent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = String(r.name || '').trim();
  if (!NAME.test(name)) throw new Error('O nome do agente usa só letras minúsculas, números e hífens (ex.: revisor-fluig).');
  if (isBuiltinName(name)) throw new Error(`“${name}” é o nome de um agente embutido do Claude Code. Escolha outro.`);
  const description = String(r.description || '').replace(/\s+/g, ' ').trim();
  if (!description) throw new Error('Descreva quando este agente deve ser usado: é com base nisso que o Claude escolhe chamá-lo.');
  const tools = Array.isArray(r.tools) ? cleanList(r.tools, 'Ferramentas') : null;
  const one = (v, what) => { const s = String(v == null ? '' : v).trim(); if (/[\r\n]/.test(s)) throw new Error(`${what} inválido.`); return s; };
  const model = one(r.model, 'Modelo');
  const maxTurns = one(r.maxTurns, 'Máximo de turnos');
  if (maxTurns && !/^[1-9]\d{0,5}$/.test(maxTurns)) throw new Error('O máximo de turnos é um número inteiro maior que zero.');
  return {
    name, description, tools: tools && tools.length ? tools : null, model, maxTurns,
    disallowedTools: cleanList(r.disallowedTools, 'Ferramentas bloqueadas'), skills: cleanList(r.skills, 'Skills'), mcpServers: cleanList(r.mcpServers, 'Servidores MCP'),
    permissionMode: one(r.permissionMode, 'Modo de permissão'), memory: one(r.memory, 'Memória'), effort: one(r.effort, 'Esforço'),
    isolation: one(r.isolation, 'Isolamento'), color: one(r.color, 'Cor'), background: r.background === true,
    extra: String(r.extra || ''), prompt: String(r.prompt || ''),
  };
}

/** Identifica a versão do arquivo em disco (detecta edição externa entre abrir e salvar). */
const revOf = (st) => `${Math.round(st.mtimeMs)}-${st.size}`;

function createAgentStore({ dir = defaultDir() } = {}) {
  const file = (name) => {
    if (!NAME.test(String(name))) throw new Error('Nome de agente inválido');
    return path.join(dir, name + '.md');
  };
  // Arquivos inválidos são identificados pelo nome do arquivo (sem .md), que pode nem seguir a regra de nomes.
  const rawFile = (id) => {
    const s = String(id);
    if (!s || /[\\/]/.test(s) || s.startsWith('.') || s.includes('\0')) throw new Error('Arquivo inválido');
    return path.join(dir, s + '.md');
  };
  const read = async (name) => {
    const f = file(name);
    const [text, st] = await Promise.all([fs.readFile(f, 'utf8'), fs.stat(f)]);
    const a = parseAgent(text);
    return { ...a, name, rev: revOf(st), permissions: permissions(a.tools, a.disallowedTools) };
  };
  const bad = (id, error, promptChars = 0) => ({ id, name: id, invalid: true, error, description: '', model: '', tools: null, permissions: permissions(null), promptChars });
  return {
    dir,
    /**
     * Todos os .md da pasta, em ordem alfabética. Nenhum some: o que não é um agente válido vem com `invalid: true`
     * e `error` (a tela mostra e deixa abrir o texto cru para corrigir).
     */
    async list() {
      let ids = [];
      try { ids = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('.')).map((f) => f.slice(0, -3)); } catch { /* sem pasta ainda */ }
      const rows = await Promise.all(ids.sort().map(async (id) => {
        try {
          const f = rawFile(id);
          const [text, st] = await Promise.all([fs.readFile(f, 'utf8'), fs.stat(f)]);
          if (!st.isFile()) return null;
          const a = parseAgent(text);
          const err = a.error || (NAME.test(id) ? null : 'O nome do arquivo precisa usar só letras minúsculas, números e hífens.');
          if (err) return bad(id, err, a.prompt.length);
          const { prompt, extra, error, ...row } = a;
          return { ...row, id, name: id, invalid: false, rev: revOf(st), permissions: permissions(a.tools, a.disallowedTools), promptChars: prompt.length };
        } catch (e) { return bad(id, 'Não foi possível ler o arquivo: ' + (e.message || e)); }
      }));
      return rows.filter(Boolean);
    },
    get: (name) => read(name),
    /** Texto cru de um arquivo (para corrigir um agente inválido) → { id, text, rev, error }. */
    async rawGet(id) {
      const f = rawFile(id);
      const [text, st] = await Promise.all([fs.readFile(f, 'utf8'), fs.stat(f)]);
      return { id: String(id), text, rev: revOf(st), error: parseAgent(text).error };
    },
    /** Grava o texto cru. Com `rev` diferente do disco devolve { conflict: true }, a menos que `force`. */
    async rawSave(id, text, { rev, force } = {}) {
      const f = rawFile(id);
      if (rev && !force) {
        const st = await fs.stat(f).catch(() => null);
        if (st && revOf(st) !== rev) return { conflict: true };
      }
      await atomicWrite(f, String(text == null ? '' : text));
      return { ok: true };
    },
    /**
     * Cria ou atualiza. `previous`: nome anterior, quando a pessoa renomeou (o arquivo antigo é removido).
     * `opts.rev`: versão do arquivo quando foi aberto; se o disco mudou desde então devolve { conflict: true } sem
     * gravar (a tela pede confirmação e repete com `opts.force`).
     */
    async save(raw, previous, opts = {}) {
      const a = cleanAgent(raw);
      const target = file(a.name);
      const renamed = previous && previous !== a.name;
      if (renamed || previous == null) {
        const exists = await fs.access(target).then(() => true, () => false);
        if (exists) throw new Error(`Já existe um agente chamado “${a.name}”.`);
      } else if (opts.rev && !opts.force) {
        const st = await fs.stat(target).catch(() => null);
        if (st && revOf(st) !== opts.rev) return { conflict: true };
      }
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite(target, serializeAgent(a));
      if (renamed) await fs.rm(file(previous), { force: true });
      return read(a.name);
    },
    async remove(name) { await fs.rm(rawFile(name), { force: true }); return true; },
    async duplicate(name) {
      const src = await read(name);
      const taken = new Set((await this.list()).map((x) => x.name));
      let n = 2;
      let copy = `${name}-copia`.slice(0, 64);
      while (taken.has(copy)) copy = `${name.slice(0, 56)}-copia-${n++}`;
      return this.save({ ...src, name: copy }, null);
    },
  };
}

module.exports = { createAgentStore, parseAgent, serializeAgent, cleanAgent, defaultDir, NAME };
