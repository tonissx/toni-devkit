'use strict';
/**
 * Logs — antes de mandar um trecho para a IA (ou copiar "limpo"): troca senhas, tokens, chaves, cookies, CPFs e
 * e-mails por ‹oculto›. Puro. Não é garantia — é a rede de segurança para o caso comum.
 */

const HIDDEN = '‹oculto›';

const RULES = [
  // Authorization: Bearer xxx / Basic xxx
  [/\b(authorization|proxy-authorization)(\s*[:=]\s*)(?:bearer|basic|digest|negotiate)?\s*[^\s,;"']+/gi, (_m, k, sep) => k + sep + HIDDEN],
  // JWT
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, HIDDEN],
  // senha=..., "password": "...", token: ..., api_key=..., secret, client_secret, cookie
  [/((?:"|')?(?:pass(?:word|wd)?|senha|pwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key|apikey|x-api-key|cookie|set-cookie|session(?:id)?|jsessionid)(?:"|')?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    (_m, k, v) => k + (v[0] === '"' ? `"${HIDDEN}"` : v[0] === "'" ? `'${HIDDEN}'` : HIDDEN)],
  // usuário:senha@ em URLs
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, (_m, pre) => pre + HIDDEN + '@'],
  // chaves de provedores (AWS, GitHub, Anthropic/OpenAI, Slack)
  [/\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g, HIDDEN],
  // CPF e e-mail
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, HIDDEN],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, HIDDEN],
];

/** → { text, count } */
function redact(text) {
  let s = String(text || '');
  let count = 0;
  for (const [re, rep] of RULES) {
    s = s.replace(re, (...args) => { count++; return typeof rep === 'function' ? rep(...args) : rep; });
  }
  return { text: s, count };
}

module.exports = { redact, HIDDEN };
