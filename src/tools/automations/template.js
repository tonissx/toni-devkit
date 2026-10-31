'use strict';
/**
 * Automações — templating sem `eval`: só troca `{{caminho}}` por valores. Caminho = nome.nome[0].nome, sem expressões.
 * Raízes: `trigger` (type, at, date, time) e o id de um passo anterior (s1.text, s1.data.rows[0].pedido).
 * Valor ausente falha com mensagem clara: nunca manda "undefined" adiante.
 */
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const PATH = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*$/;
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 'a.b[0].c' → ['a','b',0,'c']; null se não for um caminho simples. */
function parsePath(p) {
  if (!PATH.test(p)) return null;
  const parts = [];
  for (const m of p.matchAll(/([A-Za-z_]\w*)|\[(\d+)\]/g)) parts.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return parts.some((x) => typeof x === 'string' && BAD.has(x)) ? null : parts;
}

/** Referências usadas em um texto → [{ raw, path }] (path null = inválida). */
function refs(text) {
  const out = [];
  for (const m of String(text == null ? '' : text).matchAll(TOKEN)) out.push({ raw: m[1], path: parsePath(m[1]) });
  return out;
}

function lookup(ctx, parts) {
  let v = ctx;
  for (const k of parts) {
    if (v == null || typeof v !== 'object') return undefined;
    if (typeof k === 'number') { if (!Array.isArray(v)) return undefined; v = v[k]; }
    else { if (!has(v, k)) return undefined; v = v[k]; }
  }
  return v;
}

/** Troca cada `{{caminho}}`. Lança Error (português) se o caminho for inválido ou não tiver valor. */
function resolve(text, ctx) {
  return String(text == null ? '' : text).replace(TOKEN, (_all, raw) => {
    const parts = parsePath(raw);
    if (!parts) throw new Error(`Referência inválida: {{${raw}}}. Use algo como {{s1.text}}.`);
    const v = lookup(ctx, parts);
    if (v === undefined || v === null) throw new Error(`Valor ausente: {{${raw}}} não existe (ainda) nos dados desta execução.`);
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

module.exports = { parsePath, refs, resolve };
