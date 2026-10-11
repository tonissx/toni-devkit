'use strict';
/**
 * Logs — impressão digital de um erro: a mesma falha, com ids/números/horários diferentes, cai no mesmo grupo
 * (aba Problemas). Puro.
 *
 * chave = classe da exceção + primeiro frame "do usuário" (fora de java.*, JBoss, Hibernate…) + mensagem normalizada.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_RE = /\b(?:0x[0-9a-f]+|[0-9a-f]{12,})\b/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const QUOTED_RE = /(["'])(?:(?!\1).){1,200}\1/g;
const WINPATH_RE = /\b[A-Za-z]:\\[^\s"'<>|]*/g;
const URLQ_RE = /\?[^\s"']*/g;
const ISO_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const NUM_RE = /(?<![A-Za-z_])\d+(?:[.,]\d+)?/g;

const HOLE = '◇';

/** Mensagem sem as partes que variam (ids, números, horários, caminhos, strings entre aspas). */
function normalize(msg) {
  return String(msg || '')
    .slice(0, 600)
    .replace(ISO_RE, HOLE)
    .replace(UUID_RE, HOLE)
    .replace(EMAIL_RE, HOLE)
    .replace(IP_RE, HOLE)
    .replace(WINPATH_RE, HOLE)
    .replace(URLQ_RE, '?' + HOLE)
    .replace(QUOTED_RE, (_m, q) => q + HOLE + q)
    .replace(HEX_RE, HOLE)
    .replace(NUM_RE, HOLE)
    .replace(/◇(?:[\s,.:/-]*◇)+/g, HOLE)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

const EXC_RE = /\b((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable|Fault|Failure))\b/;
const SIMPLE_EXC_RE = /\b([A-Z][\w$]*(?:Exception|Error))\b(?::|\s|$)/;
const CAUSED_RE = /^Caused by:\s+([\w$.]+)/gm;
const FRAME_RE = /^\s*at\s+([\w$.<>]+)\(([^)]*)\)/gm;
const FRAMEWORK_RE = /^(?:java\.|javax\.|jakarta\.|sun\.|jdk\.|com\.sun\.|org\.jboss\.|org\.wildfly\.|io\.undertow\.|org\.hibernate\.|org\.springframework\.|org\.apache\.|com\.fasterxml\.|org\.eclipse\.|io\.netty\.|org\.postgresql\.|com\.microsoft\.sqlserver\.|oracle\.jdbc\.|net\.sf\.|org\.glassfish\.|org\.jboss$)/;

/**
 * Exceção principal e onde ela aconteceu. A causa raiz (último "Caused by:") é a que mais ajuda a agrupar e explicar.
 * → { exception, rootCause, frame }
 */
function exceptionOf(msg, stack) {
  const text = String(msg || '') + '\n' + String(stack || '');
  let exception = (EXC_RE.exec(text) || SIMPLE_EXC_RE.exec(String(msg || '')) || [])[1] || '';
  let rootCause = '';
  CAUSED_RE.lastIndex = 0;
  let m;
  while ((m = CAUSED_RE.exec(text))) rootCause = m[1].replace(/:$/, '');
  if (!exception && rootCause) exception = rootCause;
  let frame = '';
  let firstFrame = '';
  FRAME_RE.lastIndex = 0;
  let k = 0;
  while ((m = FRAME_RE.exec(text)) && k < 400) {
    k++;
    if (!firstFrame) firstFrame = m[1];
    if (!FRAMEWORK_RE.test(m[1])) { frame = m[1]; break; }
  }
  return { exception, rootCause, frame: frame || firstFrame };
}

/** FNV-1a 32 bits em hex. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const shortClass = (c) => String(c || '').split('.').pop();

/**
 * Grupo de uma entrada já lida (parse). → { key, title, exception, rootCause, frame }
 * O título é para mostrar: "NullPointerException em WorkflowService.start: Falha ao iniciar processo ◇".
 */
function fingerprint(p) {
  const msg = String((p && p.msg) || '').split('\n')[0];
  const ex = exceptionOf(msg, p && p.stack);
  // Mensagem sem a própria exceção no começo ("java.lang.X: detalhe" → "detalhe").
  let body = msg;
  if (ex.exception && body.includes(ex.exception)) body = body.slice(body.indexOf(ex.exception) + ex.exception.length).replace(/^[:\s-]+/, '');
  const norm = normalize(body);
  const where = ex.frame ? ex.frame.split('.').slice(-2).join('.') : '';
  const key = hash([ex.rootCause || ex.exception, ex.frame, ex.exception ? '' : (p && p.logger) || '', norm].join('|'));
  const lead = ex.exception ? shortClass(ex.rootCause || ex.exception) + (where ? ' em ' + where : '') : '';
  const title = lead ? (norm ? `${lead}: ${norm}` : lead) : norm || '(mensagem vazia)';
  return { key, title, exception: ex.exception, rootCause: ex.rootCause, frame: ex.frame };
}

module.exports = { normalize, exceptionOf, fingerprint, hash, HOLE };
