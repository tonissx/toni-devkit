'use strict';
/**
 * Desfaz concatenação de string JavaScript usada para montar SQL dinamicamente, ex.:
 *   "UPDATE T SET C = '"+VAR+"'" -> "DECLARE @VAR VARCHAR(100) = VAR;\nUPDATE T SET C = @VAR"
 *
 * Reconhece uma cadeia de literais de string JS (aspas simples ou duplas, unidas
 * por `+`, podendo quebrar linha) com identificadores JS intercalados. Remove as
 * aspas e os operadores de concatenação, troca cada identificador por uma
 * variável T-SQL (`@NOME`) e insere `DECLARE @NOME TIPO = <expressão original>`
 * no topo — uma declaração por variável, na ordem em que aparece. O tipo é
 * inferido pelo contexto: identificador entre aspas simples do SQL (`'"+VAR+"'`)
 * vira VARCHAR(100); fora de aspas (valor numérico) vira INT.
 *
 * Quando o identificador é um acesso a propriedade (`constraint.CODCOLIGADA` ou
 * `constraint.CODCOLIGADA.VALUE`), o nome do parâmetro usa o segmento mais
 * específico — o campo (`CODCOLIGADA`), não o objeto raiz (`constraint`) nem um
 * sufixo genérico de valor (`.VALUE`/`.VALOR`) — para que `constraint.CODCOLIGADA`
 * e `constraint.FILIAL` virem `@CODCOLIGADA` e `@FILIAL`, não os dois `@constraint`.
 * O DECLARE guarda a expressão original inteira como valor, ex.:
 * `DECLARE @CODCOLIGADA INT = constraint.CODCOLIGADA.VALUE;`.
 *
 * Entradas que não seguem esse padrão (SQL puro) retornam null e o texto original
 * segue inalterado.
 *
 * Chamadas de método JS intercaladas no identificador (ex.: `DESCPT.slice(0, 60)`)
 * são removidas — o parâmetro vira `@DESCPT` e o `DECLARE` referencia só `DESCPT`,
 * sem a chamada — já que o valor real só é conhecido em tempo de execução do JS.
 */

// `var sql = `, `let sql += `, `const sql = `, `sql = ` no início da entrada.
const ASSIGNMENT_RE = /^\s*(?:(?:var|let|const)\s+)?[A-Za-z_$][\w$]*\s*\+?=\s*/;

// Remove chamadas de método JS (`.slice(0, 60)`, `.trim()`, ...) intercaladas num
// identificador, mantendo só o objeto/campo base (`DESCPT.slice(0, 60)` -> `DESCPT`).
// Sem suporte a parênteses aninhados nos argumentos (não ocorre nos casos reais:
// slice/trim/toUpperCase/etc. recebem só literais).
function stripCalls(ident) {
  return ident.replace(/\.[A-Za-z_$][\w$]*\([^()]*\)/g, '');
}

function stripWrapper(src) {
  let s = String(src ?? '').trim();
  s = s.replace(ASSIGNMENT_RE, '');
  s = s.replace(/;\s*$/, '');
  return s.trim();
}

/**
 * Tokeniza em { type: 'str' | 'ident', value }, respeitando aspas e escapes JS.
 * Retorna null assim que encontra algo fora do padrão "string" + identificador + "+".
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  let sawPlus = false;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '+') { sawPlus = true; i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) { value += src[j + 1]; j += 2; continue; }
        value += src[j]; j++;
      }
      if (j >= n) return null; // aspas não fechadas
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let raw = '';
      let j = i;
      for (;;) {
        const start = j;
        while (j < n && /[\w$.[\]]/.test(src[j])) j++;
        raw += src.slice(start, j);
        if (src[j] !== '(') break;
        // Chamada de função JS (ex.: `.slice(0, 60)`) intercalada no identificador:
        // consome os parênteses balanceados (ignorando parênteses dentro de strings)
        // para não quebrar a tokenização, mas o trecho é descartado do valor final —
        // ver `stripCalls` logo abaixo.
        let depth = 0, k = j;
        do {
          const ch = src[k];
          if (ch === '"' || ch === "'") {
            const quote = ch; k++;
            while (k < n && src[k] !== quote) { if (src[k] === '\\') k++; k++; }
          } else if (ch === '(') depth++;
          else if (ch === ')') depth--;
          k++;
        } while (k < n && depth > 0);
        if (depth > 0) return null; // parênteses não fechados
        raw += src.slice(j, k);
        j = k;
      }
      tokens.push({ type: 'ident', value: stripCalls(raw) });
      i = j;
      continue;
    }
    return null; // caractere fora do padrão de concatenação (ex.: `,`, `=`)
  }
  return { tokens, sawPlus };
}

// Sufixos genéricos de "acesso ao valor" em objetos wrapper (ex.: constraint.CODCOLIGADA.VALUE).
// Quando o último segmento é um desses, o nome do parâmetro vem do segmento anterior
// (o campo de verdade), não do sufixo genérico nem do objeto raiz.
const GENERIC_VALUE_SEGMENTS = new Set(['VALUE', 'VALOR', 'VAL', 'TEXT', 'TEXTO', 'DATA', 'CONTENT', 'CONTEUDO']);

/**
 * Deriva o nome da variável SQL a partir do identificador JS completo.
 * Para um identificador simples (`IDPRJ`) usa o próprio nome. Para uma cadeia de
 * acesso a propriedade (`obj.CAMPO` ou `obj.CAMPO.VALUE`) usa o segmento mais
 * específico — o último, a menos que seja um acessor genérico de valor, caso em
 * que usa o penúltimo — em vez do objeto raiz, para não colapsar `obj.A` e
 * `obj.B` no mesmo parâmetro.
 */
function deriveVarName(ident) {
  const segments = ident.split(/[.[\]]+/).filter(Boolean);
  if (!segments.length) return 'PARAM';
  let name = segments[segments.length - 1];
  if (segments.length > 1 && GENERIC_VALUE_SEGMENTS.has(name.toUpperCase())) {
    name = segments[segments.length - 2];
  }
  return name.replace(/[^A-Za-z0-9_]/g, '') || 'PARAM';
}

/**
 * Tenta desfazer a concatenação de strings JS. Retorna `{ sql, vars }` quando
 * reconhece o padrão, ou `null` quando a entrada não é uma concatenação (nesse
 * caso o chamador deve usar o texto original sem alterações).
 */
function unwrapJsConcat(input) {
  const src = stripWrapper(input);
  if (!src) return null;

  const tokenized = tokenize(src);
  if (!tokenized) return null;
  const { tokens, sawPlus } = tokenized;
  if (!tokens.length || !sawPlus) return null;

  const hasString = tokens.some((t) => t.type === 'str');
  if (!hasString) return null;

  const declOrder = [];
  const declInfo = new Map(); // nome -> { quoted }
  let sql = '';
  let stripLeadingQuote = false; // a próxima string começa colada num @VAR que já "engoliu" a aspa de abertura
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'str') {
      let value = t.value;
      if (stripLeadingQuote && value.startsWith("'")) value = value.slice(1);
      stripLeadingQuote = false;
      sql += value;
      continue;
    }
    const name = deriveVarName(t.value);
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    // Entre aspas simples de SQL (ex.: '"+VAR+"') = valor textual -> VARCHAR.
    // Como @VAR é uma variável de verdade (não texto concatenado), as aspas
    // simples que só existiam para delimitar o literal são removidas.
    const quoted = !!(prev && prev.type === 'str' && prev.value.endsWith("'") &&
                       next && next.type === 'str' && next.value.startsWith("'"));
    if (quoted) {
      if (sql.endsWith("'")) sql = sql.slice(0, -1);
      stripLeadingQuote = true;
    }
    // O valor de origem completo (ex.: `constraint.CODCOLIGADA.VALUE`) fica só
    // no DECLARE, como pista de onde o valor vem — a primeira ocorrência vence.
    if (!declInfo.has(name)) { declInfo.set(name, { quoted, source: t.value }); declOrder.push(name); }
    else if (quoted) declInfo.get(name).quoted = true; // qualquer ocorrência textual força VARCHAR
    sql += '@' + name;
  }
  if (!sql.trim()) return null;

  const declares = declOrder.map((name) => {
    const info = declInfo.get(name);
    const type = info.quoted ? 'VARCHAR(100)' : 'INT';
    return `DECLARE @${name} ${type} = ${info.source};`;
  });
  const finalSql = declares.join('\n') + '\n' + sql.trim();
  return { sql: finalSql, vars: declOrder };
}

module.exports = { unwrapJsConcat };
