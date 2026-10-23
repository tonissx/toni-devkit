'use strict';
/**
 * Agentes — leitura e escrita dos subagentes do Claude Code: um arquivo `.md` por agente em ~/.claude/agents.
 * Frontmatter (name, description, tools, model) + o prompt no corpo. É o formato nativo da ferramenta, então o agente
 * criado aqui também funciona no terminal. Qualquer outra chave do frontmatter (color, skills…) é preservada como está.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { atomicWrite } = require('../lib/fsx');
const { permissions } = require('../../src/tools/agents/agentForm.js');

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY_LINE = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/;
const KNOWN = ['name', 'description', 'tools', 'model'];

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

/** → { name, description, model, tools: string[]|null, extra: string, prompt } */
function parseAgent(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const out = { name: '', description: '', model: '', tools: null, extra: '', prompt: src };
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(src);
  if (!m) return out;
  out.prompt = m[2].replace(/^\n+/, '');
  const blocks = []; // { key, lines[] } — continuação (listas, textos longos) fica com a chave de cima
  for (const line of m[1].split('\n')) {
    const k = KEY_LINE.exec(line);
    if (k && !/^\s/.test(line)) blocks.push({ key: k[1], value: k[2] || '', lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  const extra = [];
  for (const b of blocks) {
    const simple = b.lines.length === 1 && !/^[|>]/.test(b.value);
    if (!KNOWN.includes(b.key) || !simple) { extra.push(...b.lines); continue; }
    const v = unquote(b.value);
    if (b.key === 'tools') out.tools = v ? v.split(',').map((t) => t.trim()).filter(Boolean) : null;
    else out[b.key] = v;
  }
  out.extra = extra.join('\n').replace(/\s+$/, '');
  return out;
}

function serializeAgent(a) {
  const lines = ['---', `name: ${quoteIfNeeded(a.name)}`, `description: ${quoteIfNeeded(a.description || '')}`];
  if (Array.isArray(a.tools) && a.tools.length) lines.push(`tools: ${a.tools.join(', ')}`);
  if (a.model) lines.push(`model: ${quoteIfNeeded(a.model)}`);
  if (a.extra && a.extra.trim()) lines.push(a.extra.replace(/\s+$/, ''));
  lines.push('---', '', String(a.prompt || '').replace(/\s+$/, ''), '');
  return lines.join('\n');
}

/** Valida e normaliza o que veio da tela. Lança Error (em português) se algo não presta. */
function cleanAgent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = String(r.name || '').trim();
  if (!NAME.test(name)) throw new Error('O nome do agente usa só letras minúsculas, números e hífens (ex.: revisor-fluig).');
  const description = String(r.description || '').replace(/\s+/g, ' ').trim();
  if (!description) throw new Error('Descreva quando este agente deve ser usado: é com base nisso que o Claude escolhe chamá-lo.');
  const tools = Array.isArray(r.tools) ? [...new Set(r.tools.map((t) => String(t).trim()).filter(Boolean))] : null;
  if (tools && tools.some((t) => /[\r\n,]/.test(t))) throw new Error('Nome de ferramenta inválido.');
  const model = String(r.model || '').trim();
  if (/[\r\n]/.test(model)) throw new Error('Modelo inválido.');
  return { name, description, tools: tools && tools.length ? tools : null, model, extra: String(r.extra || ''), prompt: String(r.prompt || '') };
}

function createAgentStore({ dir = defaultDir() } = {}) {
  const file = (name) => {
    if (!NAME.test(String(name))) throw new Error('Nome de agente inválido');
    return path.join(dir, name + '.md');
  };
  const read = async (name) => {
    const text = await fs.readFile(file(name), 'utf8');
    const a = parseAgent(text);
    return { ...a, name, permissions: permissions(a.tools) };
  };
  return {
    dir,
    /** Todos os agentes da pasta, em ordem alfabética (arquivos que não são agentes válidos são ignorados). */
    async list() {
      let names = [];
      try { names = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((n) => NAME.test(n)); } catch { /* sem pasta ainda */ }
      const rows = await Promise.all(names.sort().map((n) => read(n).catch(() => null)));
      return rows.filter(Boolean).map(({ prompt, extra, ...row }) => ({ ...row, promptChars: prompt.length }));
    },
    get: (name) => read(name),
    /** Cria ou atualiza. `previous`: nome anterior, quando a pessoa renomeou (o arquivo antigo é removido). */
    async save(raw, previous) {
      const a = cleanAgent(raw);
      const target = file(a.name);
      const renamed = previous && previous !== a.name;
      if (renamed || previous == null) {
        const exists = await fs.access(target).then(() => true, () => false);
        if (exists) throw new Error(`Já existe um agente chamado “${a.name}”.`);
      }
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite(target, serializeAgent(a));
      if (renamed) await fs.rm(file(previous), { force: true });
      return read(a.name);
    },
    async remove(name) { await fs.rm(file(name), { force: true }); return true; },
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

module.exports = { createAgentStore, parseAgent, serializeAgent, cleanAgent, NAME };
