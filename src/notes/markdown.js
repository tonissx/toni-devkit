// Markdown → HTML para o preview das Notes (marked + realce de sintaxe do DevKit).
// Seguro: HTML cru é escapado, só links http(s)/mailto viram <a>, imagens externas viram link
// (a CSP bloqueia imagens remotas). Imagens coladas (".assets/<nome>") viram <img> servidas pelo
// protocolo devkit-note:// do processo principal. Extras: [[Título]] (link interno), checklists
// clicáveis, botão "Copiar" em cada bloco de código e o cartão do Vault (```secret <nome>```: a nota guarda só o
// nome; os campos vêm do cofre, com os segredos mascarados e botões de copiar).
import { Marked } from 'marked';
import { tokenize } from '../tools/diff-checker/syntax.js';
import { toggleTaskAt } from './note.js';
import { isoDate } from './edit.js';
import { priorityInfo } from './priority.js';
import { secretNameFromBlock, kindOf, isDbLike } from '../vault/entry.js';
import { visualKind, extOf, THUMB_KINDS } from './attachments.js';

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

const ASSET_RE = /^\.assets\/([\w-][\w.-]*)$/;

/**
 * Cartão de um anexo ([nome.pdf](.assets/…)): miniatura + nome + tipo. Sem miniatura, o selo colorido com a
 * extensão (data-kind decide a cor) serve de placeholder. Imagens já nascem com o próprio arquivo como fundo;
 * pdf/vídeo/Office levam data-thumb="1" e o NotePreview pede a miniatura ao Windows depois de pintar.
 */
function fileChip(asset, labelHtml) {
  const kind = visualKind(asset);
  const ext = (extOf(asset) || 'arq').toUpperCase().slice(0, 4);
  const thumb = kind === 'image' ? ` style="background-image:url(devkit-note://asset/${encodeURIComponent(asset)})"` : '';
  const cls = 'md-file__thumb' + (kind === 'image' ? ' has-img' : '');
  return `<a class="md-file" href="#" data-asset="${esc(asset)}" data-kind="${kind}"${THUMB_KINDS.has(kind) ? ' data-thumb="1"' : ''} title="Abrir pré-visualização">`
    + `<span class="${cls}"${thumb}><span class="md-file__ext">${esc(ext)}</span></span>`
    + `<span class="md-file__name">${labelHtml}</span></a>`;
}
const WIKI_RE =/^\[\[([^[\]\n|]+)(?:\|([^\]\n]+))?\]\]/;
const EMBED_RE = /^!\[\[([^[\]\n|]+)(?:\|([^\]\n]+))?\]\]/; // ![[Diagrama]] · ![[Diagrama|legenda]]
const META_START_RE = /(^|\s)(?:@\d{4}-\d{2}-\d{2}|![123])(?=\s|$)/;
const META_RE = /^(?:(@\d{4}-\d{2}-\d{2})|!([123]))(?=\s|$)/;

/**
 * Cartão de um bloco ```secret <nome>```. info: undefined (carregando) · { locked, exists } · { missing } · metadados
 * da entrada (segredos = null). Os botões levam data-vault-* (ver NotePreview); nenhum valor secreto entra no HTML.
 */
function secretCard(name, info) {
  const head = (extra = '') => `<div class="md-secret__head"><span class="md-secret__lock">🔒</span><span class="md-secret__name">${esc(name)}</span>${extra}</div>`;
  const msg = (text, btn = '') => `<div class="md-secret is-msg" data-secret="${esc(name)}">${head()}<div class="md-secret__msg"><span>${text}</span>${btn}</div></div>`;
  if (info === undefined) return msg('Carregando…');
  if (info.locked) {
    return info.exists
      ? msg('Cofre bloqueado.', '<button type="button" class="md-secret__btn" data-vault-unlock="1">Desbloquear</button>')
      : msg('Ainda não há cofre neste computador.', `<button type="button" class="md-secret__btn" data-vault-create="${esc(name)}">Criar no Vault</button>`);
  }
  if (info.missing) return msg('Não existe no cofre.', `<button type="button" class="md-secret__btn" data-vault-create="${esc(name)}">Criar no Vault</button>`);
  const rows = info.fields.map((f, i) => {
    const value = f.secret ? (f.set ? '<span class="md-secret__mask">••••••••</span>' : '<span class="md-secret__empty">vazio</span>') : (f.value ? esc(f.value) : '<span class="md-secret__empty">—</span>');
    const can = f.secret ? f.set : !!f.value;
    return `<div class="md-secret__row"><span class="md-secret__key">${esc(f.name)}</span><span class="md-secret__val">${value}</span>`
      + (can ? `<button type="button" class="md-secret__btn" data-vault-copy="${esc(info.id)}" data-vault-what="${i}" title="Copiar ${esc(f.name)}">Copiar</button>` : '<span></span>')
      + '</div>';
  }).join('');
  const extra = isDbLike(info)
    ? `<div class="md-secret__extra"><button type="button" class="md-secret__btn" data-vault-copy="${esc(info.id)}" data-vault-what="connstr">Connection string</button>`
      + `<button type="button" class="md-secret__btn" data-vault-copy="${esc(info.id)}" data-vault-what="jdbc">URL JDBC</button></div>`
    : '';
  return `<div class="md-secret" data-secret="${esc(name)}">${head(`<span class="md-secret__kind">${esc(kindOf(info.kind).label)}</span><button type="button" class="md-secret__open" data-vault-open="${esc(info.id)}" title="Abrir no Vault">Vault ↗</button>`)}`
    + `<div class="md-secret__rows">${rows}</div>${extra}</div>`;
}

/**
 * Renderiza markdown. resolve(título) → id | null decide o estilo dos [[links]].
 * secret(nome) → estado da entrada do Vault para os blocos ```secret``` (ver secretCard).
 * embeds: liga o ![[Diagrama]] — vira um marcador `.md-embed` que o NotePreview troca pela miniatura do diagrama.
 *   Desligado (padrão), `![[x]]` sai como "!" + link, como sempre: quem não sabe desenhar o embed (AI, Tarefas, Sticky,
 *   Lixeira) não ganha uma caixa vazia.
 * Retorna { html, blocks } — blocks[i] é o código do i-ésimo bloco (para o botão Copiar).
 */
export function renderMarkdown(md, { resolve = () => null, secret = () => undefined, embeds = false } = {}) {
  const blocks = [];
  let task = 0;
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [...(embeds ? [{
      // ![[Diagrama]] → marcador com o id já resolvido; a miniatura é desenhada depois (NotePreview, assíncrono).
      // Inerte de propósito: um alvo que não existe NÃO cria nota ao clicar, como faria um [[link]].
      name: 'wikiembed',
      level: 'inline',
      start: (src) => { const i = src.indexOf('![['); return i === -1 ? undefined : i; },
      tokenizer(src) {
        const m = EMBED_RE.exec(src);
        if (m) return { type: 'wikiembed', raw: m[0], target: m[1].trim(), caption: (m[2] || '').trim() };
        return undefined;
      },
      renderer(t) {
        const id = resolve(t.target);
        if (!id) return `<span class="md-embed is-missing" data-embed="${esc(t.target)}" title="Diagrama não encontrado"><span class="md-embed__chip">Diagrama não encontrado: ${esc(t.target)}</span></span>`;
        return `<span class="md-embed" data-embed="${esc(t.target)}" data-note-id="${esc(id)}"${t.caption ? ` data-caption="${esc(t.caption)}"` : ''} title="Abrir em Diagramas"><span class="md-embed__chip">Diagrama: ${esc(t.caption || t.target)}</span></span>`;
      },
    }] : []), {
      name: 'wikilink',
      level: 'inline',
      start: (src) => { const i = src.indexOf('[['); return i === -1 ? undefined : i; },
      tokenizer(src) {
        const m = WIKI_RE.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] || m[1]).trim() };
        return undefined;
      },
      renderer: (t) => `<a href="#" class="md-wikilink${resolve(t.target) ? '' : ' is-missing'}" data-note="${esc(t.target)}" title="${resolve(t.target) ? 'Abrir nota' : 'Criar nota'}">${esc(t.label)}</a>`,
    }, {
      // Marcas de tarefa soltas no texto: "@2026-10-02" (prazo) e "!1".."!3" (prioridade) viram chips.
      name: 'taskmeta',
      level: 'inline',
      start: (src) => { const m = META_START_RE.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src, tokens) {
        // Só depois de espaço/início (o texto anterior já foi separado: "a@2020-…" e "wow!1" ficam texto).
        const prev = tokens && tokens[tokens.length - 1];
        if (prev && !/\s$/.test(prev.raw)) return undefined;
        const m = META_RE.exec(src);
        return m ? { type: 'taskmeta', raw: m[0], due: m[1] ? m[0].slice(1) : null, pri: m[2] ? m[2] : null } : undefined;
      },
      renderer: (t) => (t.due
        ? `<span class="md-due${t.due < isoDate() ? ' is-late' : ''}" title="Prazo">📅 ${esc(t.due.slice(8, 10) + '/' + t.due.slice(5, 7))}</span>`
        : `<span class="md-pri is-p${t.pri}" title="${esc(priorityInfo(Number(t.pri)).title)}">⚑ ${esc(priorityInfo(Number(t.pri)).label)}</span>`),
    }],
    renderer: {
      html: ({ text }) => esc(text),
      code({ text, lang }) {
        const secretName = secretNameFromBlock(lang, text);
        if (secretName) return secretCard(secretName, secret(secretName));
        const i = blocks.push(text) - 1;
        const label = String(lang || '').trim().split(/\s+/)[0];
        return `<div class="md-code"><div class="md-code__bar"><span>${esc(label || 'código')}</span>`
          + `<button type="button" class="md-code__copy" data-copy="${i}">Copiar</button></div>`
          + `<pre><code>${highlight(text, label)}</code></pre></div>`;
      },
      checkbox: ({ checked }) => `<input type="checkbox" class="md-task" data-task="${task++}"${checked ? ' checked' : ''} aria-label="Tarefa"> `,
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const asset = ASSET_RE.exec(href || '');
        if (asset) return fileChip(asset[1], text);
        if (!/^(https?:|mailto:)/i.test(href || '')) return text;
        return `<a href="${esc(href)}" target="_blank" rel="noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
      image({ href, text }) {
        const asset = ASSET_RE.exec(href || '');
        if (asset) return `<img class="md-img" src="devkit-note://asset/${encodeURIComponent(asset[1])}" alt="${esc(text || '')}" data-asset="${esc(asset[1])}" loading="lazy" title="Abrir imagem">`;
        return /^https?:/i.test(href || '') ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">🖼 ${esc(text || href)}</a>` : esc(text || '');
      },
    },
  });
  const html = splitColumns(String(md || '')).map((part) => (part.cols
    ? `<div class="md-cols" style="--n:${part.cols.length}">${part.cols.map((c) => `<div class="md-col">${marked.parse(c)}</div>`).join('')}</div>`
    : marked.parse(part.text))).join('');
  return { html, blocks };
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Separa os blocos de colunas do resto do texto:
 *   :::colunas  …  |||  …  :::
 * Devolve [{ text }] (markdown comum) e [{ cols: [markdown, …] }] na ordem do texto. Marcações dentro de
 * ``` são ignoradas; um bloco sem fechamento ou sem nenhum `|||` fica como markdown comum (nada some).
 * Não aninha: um `:::colunas` dentro de outro é só texto da coluna.
 */
export function splitColumns(md) {
  const lines = md.split('\n');
  const parts = [];
  let buf = [];
  const flush = () => { if (buf.length) { parts.push({ text: buf.join('\n') }); buf = []; } };
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      buf.push(line);
      continue;
    }
    if (f) { fence = f[1]; buf.push(line); continue; }
    if (!/^:::colunas\s*$/i.test(line)) { buf.push(line); continue; }

    // Procura o ":::" de fechamento (fora de ```), juntando as colunas pelo caminho.
    const cols = [[]];
    let inner = null, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      const g = FENCE_RE.exec(l);
      if (inner) {
        if (g && g[1][0] === inner[0] && g[1].length >= inner.length && !l.slice(g[0].length).trim()) inner = null;
        cols[cols.length - 1].push(l);
      } else if (g) { inner = g[1]; cols[cols.length - 1].push(l); }
      else if (/^:::\s*$/.test(l)) { end = j; break; }
      else if (/^\|\|\|\s*$/.test(l)) cols.push([]);
      else cols[cols.length - 1].push(l);
    }
    if (end === -1 || cols.length < 2) { buf.push(line); continue; }
    flush();
    parts.push({ cols: cols.map((c) => c.join('\n')) });
    i = end;
  }
  flush();
  return parts;
}

/**
 * Markdown em linha (**negrito**, *itálico*, ~~riscado~~, `código`) → HTML, para textos curtos como o
 * de uma tarefa. Seguro (HTML cru é escapado) e sem elementos clicáveis — o texto fica dentro de um
 * <button> —: links e [[links]] viram só o texto/rótulo, imagens viram o texto alternativo.
 */
export function renderInline(text) {
  const marked = new Marked({ gfm: true });
  marked.use({
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start: (src) => { const i = src.indexOf('[['); return i === -1 ? undefined : i; },
      tokenizer(src) {
        const m = WIKI_RE.exec(src);
        return m ? { type: 'wikilink', raw: m[0], label: (m[2] || m[1]).trim() } : undefined;
      },
      renderer: (t) => esc(t.label),
    }],
    renderer: {
      html: ({ text: raw }) => esc(raw),
      link({ tokens }) { return this.parser.parseInline(tokens); },
      image({ text: alt }) { return esc(alt || ''); },
    },
  });
  return marked.parseInline(String(text || ''));
}

/** Marca/desmarca a n-ésima tarefa "- [ ]" do markdown (ignorando blocos de código). */
export const toggleTask = toggleTaskAt;
