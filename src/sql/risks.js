'use strict';
/**
 * Riscos comuns numa consulta SQL, por regras simples (sem IA, instantâneo, offline). Não é um parser completo: tira
 * comentários e textos entre aspas e procura padrões conhecidos. Testado em scripts/test-sql-risks.mjs.
 * → [{ level: 'danger' | 'warn' | 'info', text }]
 */

/** Tira comentários e o conteúdo de strings/identificadores entre aspas (para não achar palavras dentro deles). */
function strip(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"[^"]*"|\[[^\]]*\]|`[^`]*`/g, 'x');
}

/** Divide em comandos pelo ";" (já sem strings). */
const statements = (s) => s.split(';').map((x) => x.trim()).filter(Boolean);

/** Tira o conteúdo de parênteses (subconsultas), para olhar só o nível de cima. */
function topLevel(s) {
  let out = ''; let depth = 0;
  for (const c of s) {
    if (c === '(') { depth++; out += depth === 1 ? '(' : ''; continue; }
    if (c === ')') { depth--; out += depth === 0 ? ')' : ''; continue; }
    if (depth === 0) out += c;
  }
  return out;
}

function sqlRisks(sql) {
  const risks = [];
  const add = (level, text) => { if (!risks.some((r) => r.text === text)) risks.push({ level, text }); };
  for (const st of statements(strip(sql))) {
    const top = topLevel(st);
    const kw = (/^\s*(?:with\b[\s\S]*?\)\s*)?(\w+)/i.exec(top) || [])[1] || '';
    const verb = kw.toLowerCase();
    if ((verb === 'update' || verb === 'delete') && !/\bwhere\b/i.test(top)) {
      add('danger', `${verb.toUpperCase()} sem WHERE: altera todas as linhas da tabela.`);
    }
    if (/^\s*truncate\b/i.test(top)) add('danger', 'TRUNCATE apaga todas as linhas (e em muitos bancos não dá para desfazer).');
    if (/^\s*drop\b/i.test(top)) add('danger', 'DROP remove o objeto inteiro (tabela, view…).');
    if (/\bselect\s+(?:distinct\s+)?(?:top\s+\d+\s+)?\*/i.test(st)) add('info', 'SELECT * traz todas as colunas: liste só as necessárias (mais rápido e não quebra se a tabela mudar).');
    // JOIN sem ON/USING (exceto CROSS JOIN e NATURAL JOIN).
    const joins = [...top.matchAll(/\b(?:(inner|left|right|full|cross|natural)\s+(?:outer\s+)?)?join\b/gi)];
    for (let k = 0; k < joins.length; k++) {
      if (/^(cross|natural)$/i.test(joins[k][1] || '')) continue;
      const seg = top.slice(joins[k].index, k + 1 < joins.length ? joins[k + 1].index : undefined).split(/\b(?:where|group\s+by|order\s+by|having|union|limit)\b/i)[0];
      if (!/\b(on|using)\b/i.test(seg)) { add('danger', 'JOIN sem ON: vira produto cartesiano (cada linha com todas as outras).'); break; }
    }
    // FROM a, b sem WHERE: produto cartesiano.
    const from = /\bfrom\b([\s\S]*?)(?:\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bjoin\b|$)/i.exec(top);
    if (from && /,/.test(from[1]) && !/\bwhere\b/i.test(top)) add('danger', 'Várias tabelas no FROM separadas por vírgula e sem WHERE: produto cartesiano.');
    if (/\bnot\s+in\s*\(\s*select\b/i.test(st)) add('warn', 'NOT IN (SELECT …): se a subconsulta devolver algum NULL, o resultado fica vazio. Prefira NOT EXISTS.');
    const where = /\bwhere\b([\s\S]*)/i.exec(st);
    if (where) {
      if (/\b(upper|lower|year|month|day|convert|cast|isnull|coalesce|substring|trim|ltrim|rtrim|datepart|format|to_char)\s*\(\s*[\w.]+/i.test(where[1])) add('warn', 'Função aplicada a coluna no WHERE: o banco não consegue usar o índice dessa coluna.');
      if (/\blike\s+N?''/i.test(where[1]) && /\blike\s+N?'%/i.test(String(sql))) add('warn', "LIKE '%…' (curinga no começo): não usa índice e varre a tabela.");
      if (/\bor\b/i.test(topLevel(where[1])) && /\band\b/i.test(topLevel(where[1])) && !/\(/.test(where[1])) add('info', 'AND e OR misturados sem parênteses: confira a precedência (AND vem antes de OR).');
    }
  }
  return risks;
}

module.exports = { sqlRisks, strip };
