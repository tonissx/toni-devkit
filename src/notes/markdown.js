// Markdown → HTML para o preview das Notes (marked + realce de sintaxe do DevKit).
// Seguro: HTML cru é escapado, só links http(s)/mailto viram <a>, imagens externas viram link
// (a CSP bloqueia imagens remotas). Extras: [[Título]] (link interno), checklists clicáveis,
// botão "Copiar" em cada bloco de código.
import { Marked } from 'marked';
import { tokenize } from '../tools/diff-checker/syntax.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LANG = {
  sql: 'sql', tsql: 'sql', mssql: 'sql', plsql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
  js: 'js', javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', java: 'js', cs: 'js', csharp: 'js', node: 'js',
  json: 'json', jsonc: 'json',
  xml: 'xml', html: 'xml', xsd: 'xml', svg: 'xml', wsdl: 'xml', ftl: 'xml',
};

/** Código → HTML com as classes tk-syn-* (mesmo realce do CodeEditor/Diff Checker). */
export const highlight = (code, lang) => code.split('\n')
  .map((line) => tokenize(line, LANG[String(lang || '').toLowerCase()] || 'text').map(([c, t]) => (c ? `<span class="tk-syn-${c}">${esc(t)}</span>` : esc(t))).join(''))
  .join('\n');

const WIKI_RE = /^\[\[([^[\]\n|]+)(?:\|([^\]\n]+))?\]\]/;

/**
 * Renderiza markdown. resolve(título) → id | null decide o estilo dos [[links]].
 * Retorna { html, blocks } — blocks[i] é o código do i-ésimo bloco (para o botão Copiar).
 */
export function renderMarkdown(md, { resolve = () => null } = {}) {
  const blocks = [];
  let task = 0;
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start: (src) => { const i = src.indexOf('[['); return i === -1 ? undefined : i; },
      tokenizer(src) {
        const m = WIKI_RE.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] || m[1]).trim() };
        return undefined;
      },
      renderer: (t) => `<a href="#" class="md-wikilink${resolve(t.target) ? '' : ' is-missing'}" data-note="${esc(t.target)}" title="${resolve(t.target) ? 'Abrir nota' : 'Criar nota'}">${esc(t.label)}</a>`,
    }],
    renderer: {
      html: ({ text }) => esc(text),
      code({ text, lang }) {
        const i = blocks.push(text) - 1;
        const label = String(lang || '').trim().split(/\s+/)[0];
        return `<div class="md-code"><div class="md-code__bar"><span>${esc(label || 'código')}</span>`
          + `<button type="button" class="md-code__copy" data-copy="${i}">Copiar</button></div>`
          + `<pre><code>${highlight(text, label)}</code></pre></div>`;
      },
      checkbox: ({ checked }) => `<input type="checkbox" class="md-task" data-task="${task++}"${checked ? ' checked' : ''} aria-label="Tarefa"> `,
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (!/^(https?:|mailto:)/i.test(href || '')) return text;
        return `<a href="${esc(href)}" target="_blank" rel="noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
      image: ({ href, text }) => (/^https?:/i.test(href || '') ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">🖼 ${esc(text || href)}</a>` : esc(text || '')),
    },
  });
  return { html: marked.parse(String(md || '')), blocks };
}

/** Marca/desmarca a n-ésima tarefa "- [ ]" do markdown (ignorando blocos de código). */
export function toggleTask(md, index) {
  const src = String(md || '');
  // Mascara blocos de código com o mesmo comprimento para não contar "- [ ]" dentro deles.
  const masked = src.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  const re = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[( |x|X)\]/gm;
  let m, n = 0;
  while ((m = re.exec(masked))) {
    if (n++ === index) {
      const pos = m.index + m[1].length + 1;
      return src.slice(0, pos) + (m[2] === ' ' ? 'x' : ' ') + src.slice(pos + 1);
    }
  }
  return src;
}
