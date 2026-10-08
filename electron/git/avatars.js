'use strict';
/**
 * Avatares do Gravatar para o grafo do Histórico (opcional, desligado por padrão).
 *
 * A busca roda aqui, no processo main, para a CSP da tela continuar fechada: a interface só recebe
 * `data:` URLs. Só o hash SHA-256 do e-mail (minúsculo, sem espaços) sai da máquina, nunca o e-mail.
 * Quem não tem Gravatar (404) vira `null` e a tela cai nas iniciais. Resultados, inclusive os
 * negativos, ficam em memória até o app fechar.
 */
const crypto = require('node:crypto');

const SIZE = 64;
const TIMEOUT_MS = 6000;
const MAX_BYTES = 200 * 1024;
const PARALLEL = 4;

const hashEmail = (email) => crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
const urlFor = (email) => `https://gravatar.com/avatar/${hashEmail(email)}?s=${SIZE}&d=404`;

/** fetchImpl(url, { signal }) → Response; padrão: `net.fetch` do Electron (respeita o proxy do sistema). */
function createAvatarService({ fetchImpl } = {}) {
  const cache = new Map(); // e-mail normalizado -> data URL | null
  const doFetch = fetchImpl || ((url, init) => require('electron').net.fetch(url, init));

  async function one(email) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(urlFor(email), { signal: ctl.signal });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null; // sem rede / tempo esgotado: tenta de novo na próxima sessão
    } finally {
      clearTimeout(timer);
    }
  }

  /** → { [e-mail]: data URL | null } para os e-mails pedidos (no máximo 200 por chamada). */
  async function get(emails) {
    const wanted = [...new Set((emails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))].slice(0, 200);
    const todo = wanted.filter((e) => !cache.has(e));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
      while (next < todo.length) {
        const e = todo[next++];
        cache.set(e, await one(e));
      }
    }));
    const out = {};
    for (const e of wanted) out[e] = cache.get(e) ?? null;
    return out;
  }

  return { get };
}

module.exports = { createAvatarService, hashEmail, urlFor };
