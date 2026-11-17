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

/** → { name, description, model, tools: string[]|null, extra: string, prompt, error } — `error` quando o arquivo não é um agente válido. */
function parseAgent(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const out = { name: '', description: '', model: '', tools: null, extra: '', prompt: src, error: null };
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
    const simple = b.lines.length === 1 && !/^[|>]/.test(b.value);
    if (!KNOWN.includes(b.key) || !simple) { extra.push(...b.lines); continue; }
    const v = unquote(b.value);
    if (b.key === 'tools') out.tools = v ? v.split(',').map((t) => t.trim()).filter(Boolean) : null;
    else out[b.key] = v;
  }
  out.extra = extra.join('\n').replace(/\s+$/, '');
  if (!out.description && !extra.some((l) => /^description:/.test(l))) out.error = 'Falta o campo obrigatório “description” no frontmatter.';
  else if (!out.name && !extra.some((l) => /^name:/.test(l))) out.error = 'Falta o campo obrigatório “name” no frontmatter.';
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
    return { ...a, name, rev: revOf(st), permissions: permissions(a.tools) };
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
          return { ...row, id, name: id, invalid: false, rev: revOf(st), permissions: permissions(a.tools), promptChars: prompt.length };
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
