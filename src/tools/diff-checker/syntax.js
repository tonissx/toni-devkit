'use strict';
/**
 * Realce de sintaxe por linha — port do tokenize do CodeEditor do DS (não exportado pelo bundle).
 * Gera as mesmas classes tk-syn-* para seguir o tema ativo.
 */

const KW = {
  js: /^(const|let|var|function|return|if|else|for|while|await|async|import|from|export|new|class|extends|try|catch|throw|typeof|of|in)$/,
  sql: /^(select|from|where|and|or|join|left|right|inner|outer|on|group|by|order|limit|insert|into|values|update|set|delete|as|having|count|sum|avg|distinct|not|null|is|in|like|desc|asc|case|when|then|else|end|with|top|create|alter|drop|table|view|union|all|exists|between|full|cross|begin|commit|rollback|declare|nolock)$/i,
};

/** Tokens [classe, texto] de uma linha. Sem estado entre linhas. */
function tokenize(line, lang) {
  if (!lang || lang === 'text') return [['', line]];
  const out = [];
  let m;
  let s = line;
  let xmlInTag = lang === 'xml' && /^\s*(\/?>|\?>|[A-Za-z_][\w:.-]*\s*=)/.test(s);
  const push = (c, t) => out.push([c, t]);
  while (s.length) {
    if (lang === 'json') {
      if ((m = s.match(/^\s+/))) push('', m[0]);
      else if ((m = s.match(/^"(?:[^"\\]|\\.)*"(?=\s*:)/))) push('key', m[0]);
      else if ((m = s.match(/^"(?:[^"\\]|\\.)*"?/))) push('string', m[0]);
      else if ((m = s.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/))) push('number', m[0]);
      else if ((m = s.match(/^(true|false|null)\b/))) push('bool', m[0]);
      else if ((m = s.match(/^[{}\[\],:]/))) push('punct', m[0]);
      else { m = [s[0]]; push('', m[0]); }
    } else if (lang === 'js' || lang === 'sql') {
      const cm = lang === 'sql' ? /^--.*/ : /^\/\/.*/;
      if ((m = s.match(cm))) push('comment', m[0]);
      else if ((m = s.match(/^\s+/))) push('', m[0]);
      else if ((m = s.match(/^('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`[^`]*`?)/))) push('string', m[0]);
      else if ((m = s.match(/^\d+(\.\d+)?/))) push('number', m[0]);
      else if ((m = s.match(/^[A-Za-z_$][\w$]*/))) {
        push(KW[lang].test(m[0]) ? 'keyword' : /^(true|false|null|undefined)$/i.test(m[0]) ? 'bool' : s.slice(m[0].length).startsWith('(') ? 'fn' : '', m[0]);
      } else if ((m = s.match(/^[{}()\[\];,.=<>+\-*/!&|?:]/))) push('punct', m[0]);
      else { m = [s[0]]; push('', m[0]); }
    } else if (lang === 'xml') {
      if ((m = s.match(/^\s+/))) push('', m[0]);
      else if ((m = s.match(/^<!--.*?-->/)) || (m = s.match(/^<!--.*/))) push('comment', m[0]);
      else if ((m = s.match(/^<!\[CDATA\[.*?\]\]>/))) push('string', m[0]);
      else if ((m = s.match(/^<!\[CDATA\[/)) || (m = s.match(/^\]\]>/))) push('punct', m[0]);
      else if ((m = s.match(/^<!DOCTYPE/i))) { xmlInTag = true; push('keyword', m[0]); }
      else if ((m = s.match(/^<\?/)) || (m = s.match(/^<\/?/))) { xmlInTag = true; push('punct', m[0]); }
      else if (xmlInTag && (m = s.match(/^(\/?>|\?>)/))) { xmlInTag = false; push('punct', m[0]); }
      else if (xmlInTag && (m = s.match(/^[A-Za-z_][\w:.-]*(?=\s*=)/))) push('key', m[0]);
      else if (xmlInTag && (m = s.match(/^[A-Za-z_][\w:.-]*/))) push('keyword', m[0]);
      else if (xmlInTag && (m = s.match(/^=/))) push('punct', m[0]);
      else if (xmlInTag && ((m = s.match(/^"[^"]*"?/)) || (m = s.match(/^'[^']*'?/)))) push('string', m[0]);
      else if ((m = s.match(/^&[#\w]+;/))) push('bool', m[0]);
      else if ((m = s.match(/^[^<&]+/))) push('', m[0]);
      else { m = [s[0]]; push('', m[0]); }
    } else {
      m = [s];
      push('', s);
    }
    s = s.slice(m[0].length);
  }
  return out;
}

/**
 * Cruza os tokens de sintaxe com os segmentos de mudança [início, fim, alterado]:
 * devolve pedaços [classe, texto, alterado] cortados nas bordas dos dois.
 */
function mergeSegments(toks, segs) {
  if (!segs) return toks.map(([c, t]) => [c, t, false]);
  const out = [];
  let si = 0, pos = 0;
  for (const [c, t] of toks) {
    let i = 0;
    while (i < t.length) {
      while (si < segs.length && segs[si][1] <= pos) si++;
      const seg = segs[si];
      const end = seg ? Math.min(t.length, i + (seg[1] - pos)) : t.length;
      out.push([c, t.slice(i, end), seg ? seg[2] : false]);
      pos += end - i;
      i = end;
    }
  }
  return out;
}

const EXT = {
  json: 'json', jsonc: 'json', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', java: 'js', cs: 'js',
  sql: 'sql', xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml', html: 'xml', htm: 'xml', wsdl: 'xml', pom: 'xml', ftl: 'xml',
};

/** Linguagem pela extensão dos arquivos, senão pelo conteúdo. */
function detectLanguage(text, ...files) {
  for (const f of files) {
    const ext = f && /\.([^.]+)$/.exec(f);
    if (ext && EXT[ext[1].toLowerCase()]) return EXT[ext[1].toLowerCase()];
  }
  const s = text.trimStart();
  if (s.startsWith('<')) return 'xml';
  if (/^[{[]/.test(s)) return 'json';
  if (/^(select|insert|update|delete|create|alter|with|declare|drop)\b/i.test(s)) return 'sql';
  if (/^(import|export|const|let|var|function|class)\b/.test(s) || s.startsWith('//')) return 'js';
  return 'text';
}

module.exports = { tokenize, mergeSegments, detectLanguage };
