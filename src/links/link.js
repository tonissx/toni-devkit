'use strict';
/**
 * Links rápidos: uma URL atrás de um alias, com `{q}` onde entra a parte variável.
 *   solic → https://tracker.example.com/tickets?id={q}
 * Na palette, Tab (ou Enter) no link fixa o chip "solic ›" e o que se digita depois vira o {q}.
 * Sem {q} o link é um favorito: Enter abre direto.
 *
 * Link: { id, alias, name, url, param, recent: [valores], created, updated }
 * Compartilhado pelo processo principal (electron/links/service.js), palette e Configurações.
 */

const PLACEHOLDER = /\{q\}/gi;
const MAX_RECENT = 8;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sameAlias = (a, b) => norm(a) === norm(b);

/** Alias válido: uma palavra (letras, números, - _ .), até 32 caracteres. */
function cleanAlias(alias) {
  return String(alias || '').trim().replace(/\s+/g, '-').slice(0, 32);
}

/** O link tem {q}, isto é, precisa da parte variável. */
const needsValue = (link) => /\{q\}/i.test(String((link && link.url) || ''));

/** URL aceitável para abrir: só http/https (sem javascript:, file: etc.). */
function checkUrl(url) {
  let u;
  try { u = new URL(String(url || '').replace(PLACEHOLDER, 'x')); } catch { throw new Error('URL inválida'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Só links http:// ou https://');
}

/**
 * Põe o {q} no fim quando a intenção de receber valor é clara mas ele ficou de fora: há rótulo do valor (param)
 * ou a URL termina em "=" (…ProcessInstanceID=). Sem nenhum dos dois, segue favorito (abre direto).
 */
function withPlaceholder(url, param) {
  const u = String(url || '').trim();
  if (!u || /\{q\}/i.test(u)) return u;
  return String(param || '').trim() || /=$/.test(u) ? u + '{q}' : u;
}

function newId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Limpa um link vindo da UI/palette. `prev` mantém id, criação e recentes. */
function normalizeLink(raw, prev = null, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new Error('Link inválido');
  const alias = cleanAlias(raw.alias);
  if (!alias) throw new Error('Dê um alias ao link (ex.: solic)');
  if (!/^[\p{L}\p{N}._-]+$/u.test(alias)) throw new Error('O alias só pode ter letras, números, ponto, - e _');
  const url = withPlaceholder(raw.url, raw.param);
  if (!url) throw new Error('Informe a URL');
  checkUrl(url);
  const stamp = now.toISOString();
  return {
    id: prev ? prev.id : (typeof raw.id === 'string' && raw.id) || newId(),
    alias,
    name: String(raw.name || '').trim().slice(0, 80),
    url,
    param: String(raw.param || '').trim().slice(0, 60),
    recent: prev && Array.isArray(prev.recent) ? prev.recent.slice(0, MAX_RECENT) : [],
    created: prev ? prev.created : stamp,
    updated: stamp,
  };
}

/** URL final: {q} ← valor (trim + encodeURIComponent). Erro se o link pede valor e ele está vazio. */
function buildUrl(link, value = '') {
  const v = String(value ?? '').trim();
  if (needsValue(link)) {
    if (!v) throw new Error(`Digite ${link.param ? link.param.toLowerCase() : 'o valor'}`);
  }
  const url = String(link.url).replace(PLACEHOLDER, () => encodeURIComponent(v));
  checkUrl(url);
  return url;
}

/** Valor usado mais recente primeiro, sem repetir, no máximo MAX_RECENT. */
function pushRecent(list, value) {
  const v = String(value ?? '').trim();
  if (!v) return (list || []).slice(0, MAX_RECENT);
  return [v, ...(list || []).filter((x) => x !== v)].slice(0, MAX_RECENT);
}

/**
 * Captura rápida na palette: "link: solic https://…{q} Chamado do tracker".
 * → { alias, url, name } | { error } | null (o texto não é captura)
 */
const CAPTURE_RE = /^link\s*:\s*(.*)$/i;
function parseCapture(text) {
  const m = CAPTURE_RE.exec(String(text || '').trim());
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'Formato: link: alias https://…{q} Nome opcional' };
  const [alias, url, ...rest] = parts;
  if (!url) return { alias, error: 'Falta a URL — use {q} onde entra a parte variável' };
  return { alias, url, name: rest.join(' ') };
}

/** Texto curto para exibir a URL (sem protocolo). */
const shortUrl = (url) => String(url || '').replace(/^https?:\/\//i, '');

module.exports = { MAX_RECENT, norm, sameAlias, cleanAlias, needsValue, withPlaceholder, checkUrl, normalizeLink, buildUrl, pushRecent, parseCapture, shortUrl };
