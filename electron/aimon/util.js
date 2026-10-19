'use strict';
/**
 * Monitor de IA — utilidades dos adaptadores.
 *
 * Evento normalizado (o que todo adaptador produz):
 *   { ts, kind, tool?, ref?, summary?, tokens?, model?, error? }
 *   kind: prompt | text | thinking | tool_use | tool_result | turn_start | turn_end | usage | title | meta
 *   ref liga tool_use ↔ tool_result; tokens = { input, output, cacheRead, cacheWrite }.
 */
const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** Resumo curto do argumento de uma ferramenta (comando, caminho, padrão…). */
function describeInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return clip(input, 160);
  if (typeof input !== 'object') return clip(String(input), 160);
  const k = ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt'].find((x) => typeof input[x] === 'string' && input[x]);
  if (k) return clip(input[k], 160);
  try { return clip(JSON.stringify(input), 160); } catch { return ''; }
}

/** Texto de um conteúdo (string ou lista de blocos). */
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x && x.text).filter(Boolean).join('\n') : '');

/** A resposta de uma ferramenta é a recusa da própria pessoa a um pedido de permissão (não é falha). */
const isRejection = (content) => /doesn't want to proceed|tool use was rejected|user (rejected|denied)/i.test(textOf(content));

const API_ERR_TEXT = /^(API Error|Login expired|Please run \/login|Credit balance|Usage limit|You've hit|Request timed out|Prompt is too long|Overloaded)/i;

/**
 * Linha do transcript do Claude Code que é um erro de verdade da API (login expirado, limite, servidor). O Claude Code marca
 * também mensagens que não são erro (ex.: "No response requested.") com isApiErrorMessage: essas ficam de fora.
 */
function isRealApiError(o) {
  if (!o || !o.isApiErrorMessage) return false;
  if (o.error) return true;
  return API_ERR_TEXT.test(textOf(o.message && o.message.content).trim());
}

/** Mensagem curta, em português, para um erro da API. Código ou texto desconhecido: o próprio texto, cortado. */
function describeError(code, text) {
  const both = `${code || ''} ${text || ''}`;
  if (/authentication_failed|login expired|\/login/i.test(both)) return 'Login expirado — rode /login';
  if (/rate_limit|usage limit|limit reached|you've hit/i.test(both)) return 'Limite de uso atingido';
  if (/credit balance|billing/i.test(both)) return 'Saldo de créditos insuficiente';
  if (/overloaded|unavailable|\b(502|503|529)\b/i.test(both)) return 'Servidor indisponível ou sobrecarregado';
  if (/prompt is too long|context/i.test(both)) return 'Contexto grande demais para continuar';
  return clip(text || code || 'Erro da API', 160);
}

/**
 * O que o agente informa em `waitingFor` ("input needed" ao esperar uma resposta, algo de permissão/aprovação ao esperar um OK)
 * → texto curto em português. Texto que não conhece passa como veio, cortado; objeto vira texto.
 */
function describeWaiting(w) {
  if (w == null || w === '') return null;
  const text = typeof w === 'string' ? w : JSON.stringify(w);
  if (/input needed|needs? input|waiting for input/i.test(text)) return 'Aguardando a sua resposta';
  if (/permission|approval|approve/i.test(text) && !/[áãç]/i.test(text)) return 'Aguardando a sua permissão';
  return clip(text, 80);
}

module.exports = { clip, describeInput, textOf, isRejection, isRealApiError, describeError, describeWaiting };
