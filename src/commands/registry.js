'use strict';
/**
 * Registro de comandos da command palette.
 *
 * Um comando é um objeto simples:
 *   { id, name, description, category, icon, shortcut?, keywords?, run(ctx, query), takesQuery?, url? }
 *
 * - category: 'search' | 'tools' | 'actions' (ver CATEGORIES).
 * - run roda na janela da palette e recebe ctx (ver src/palette/Palette.jsx → makeCtx):
 *     ctx.openApp(route?)   mostra a janela principal (e navega)
 *     ctx.appCommand(cmd)   muda o estado da janela principal: { type: 'theme'|'sidebar', ... }
 *     ctx.openUrl(url)      abre no navegador (só https)
 *     ctx.clipboard / ctx.sql / ctx.storage / ctx.quit()
 *   Pode ser async. Se devolver uma string, ela aparece como confirmação antes da palette fechar.
 *   Se lançar erro, a palette mostra o erro e continua aberta.
 * - takesQuery: o texto digitado vira argumento (ex.: buscas na web).
 *
 * Para adicionar um comando: inclua um objeto numa das listas abaixo. Ferramentas novas
 * entram sozinhas a partir de src/tools/meta.js.
 */
const { TOOL_META } = require('../tools/meta.js');
const { THEMES } = require('../lib/themes.js');
const { DEFAULT_SQL_OPTIONS } = require('../tools/sql-formatter/defaults.js');
const { DEFAULT_XML_OPTIONS } = require('../tools/xml-formatter/defaults.js');
const { formatXml } = require('../tools/xml-formatter/engine.js');

const CATEGORIES = [
  { id: 'search', name: 'Search', key: 's', icon: 'search', description: 'Buscar na web e dentro do app' },
  { id: 'tools', name: 'Tools', key: 't', icon: 'wrench', description: 'Abrir uma ferramenta do Devkit' },
  { id: 'actions', name: 'Actions', key: 'a', icon: 'zap', description: 'Tema, janela, área de transferência…' },
];

/* ─────────────── Search: buscas na web ─────────────── */
const WEB = [
  { id: 'google', name: 'Google', icon: 'globe', base: 'https://www.google.com/search?q=', home: 'https://www.google.com', keywords: ['web', 'pesquisar'] },
  { id: 'mdn', name: 'MDN', icon: 'book-open', base: 'https://developer.mozilla.org/pt-BR/search?q=', home: 'https://developer.mozilla.org/pt-BR/', keywords: ['javascript', 'css', 'html', 'docs', 'mozilla'] },
  { id: 'stackoverflow', name: 'Stack Overflow', icon: 'messages-square', base: 'https://stackoverflow.com/search?q=', home: 'https://stackoverflow.com', keywords: ['so', 'duvida', 'erro'] },
  { id: 'github', name: 'GitHub', icon: 'github', base: 'https://github.com/search?type=repositories&q=', home: 'https://github.com', keywords: ['repo', 'codigo', 'git'] },
  { id: 'npm', name: 'npm', icon: 'package', base: 'https://www.npmjs.com/search?q=', home: 'https://www.npmjs.com', keywords: ['pacote', 'package', 'node'] },
  { id: 'tdn', name: 'TDN TOTVS', icon: 'library', base: 'https://tdn.totvs.com/dosearchsite.action?queryString=', home: 'https://tdn.totvs.com', keywords: ['totvs', 'fluig', 'rm', 'protheus', 'documentacao'] },
];

const webUrl = (w, query) => (query && query.trim() ? w.base + encodeURIComponent(query.trim()) : w.home);

const searchCommands = WEB.map((w) => ({
  id: 'web:' + w.id,
  name: w.name,
  description: 'Buscar no ' + w.name,
  category: 'search',
  icon: w.icon,
  keywords: w.keywords,
  takesQuery: true,
  url: (query) => webUrl(w, query),
  run: (ctx, query) => ctx.openUrl(webUrl(w, query)),
}));

/* ─────────────── Tools ─────────────── */
const toolCommands = TOOL_META.map((t) => ({
  id: 'tool:' + t.id,
  name: t.name,
  description: t.desc,
  category: 'tools',
  icon: t.icon,
  shortcut: t.shortcutKey ? 'Ctrl+' + t.shortcutKey : undefined,
  keywords: ['abrir', 'ferramenta', ...(t.keywords || [])],
  run: (ctx) => ctx.openApp(t.id),
}));

/* ─────────────── Actions ─────────────── */
const readJson = (storage, key) => { try { return JSON.parse(storage.getItem(key)) || {}; } catch { return {}; } };

const actionCommands = [
  {
    id: 'app:show',
    name: 'Mostrar Devkit',
    description: 'Traz a janela principal para frente',
    icon: 'app-window',
    keywords: ['abrir', 'janela', 'restaurar', 'window'],
    run: (ctx) => ctx.openApp(),
  },
  {
    id: 'app:home',
    name: 'Início',
    description: 'Tela inicial com todas as ferramentas',
    icon: 'layout-grid',
    keywords: ['home', 'inicio', 'ferramentas'],
    run: (ctx) => ctx.openApp('home'),
  },
  {
    id: 'app:settings',
    name: 'Configurações',
    description: 'Tema, atalhos, iniciar com o Windows',
    icon: 'settings',
    shortcut: 'Ctrl+,',
    keywords: ['preferencias', 'settings', 'opcoes', 'config'],
    run: (ctx) => ctx.openApp('settings'),
  },
  {
    id: 'clipboard:sql',
    name: 'Formatar SQL da área de transferência',
    description: 'Formata o SQL copiado (opções do SQL Formatter) e copia o resultado',
    icon: 'database',
    keywords: ['clipboard', 'copiar', 'colar', 'format', 'query'],
    run: async (ctx) => {
      const text = await ctx.clipboard.read();
      if (!text.trim()) throw new Error('A área de transferência está vazia');
      const opts = { ...DEFAULT_SQL_OPTIONS, ...readJson(ctx.storage, 'tk.sql.options') };
      const r = await ctx.sql.format(text, opts);
      await ctx.clipboard.write(r.result);
      return 'SQL formatado e copiado';
    },
  },
  {
    id: 'clipboard:xml',
    name: 'Formatar XML da área de transferência',
    description: 'Formata o XML copiado (opções do XML Formatter) e copia o resultado',
    icon: 'code-xml',
    keywords: ['clipboard', 'copiar', 'colar', 'format', 'pretty'],
    run: async (ctx) => {
      const text = await ctx.clipboard.read();
      if (!text.trim()) throw new Error('A área de transferência está vazia');
      const opts = { ...DEFAULT_XML_OPTIONS, ...readJson(ctx.storage, 'tk.xml.options') };
      await ctx.clipboard.write(formatXml(text, opts).result);
      return 'XML formatado e copiado';
    },
  },
  {
    id: 'theme:toggle',
    name: 'Alternar tema claro/escuro',
    description: 'Troca entre o tema claro e o escuro',
    icon: 'sun-moon',
    keywords: ['theme', 'dark', 'light', 'aparencia'],
    run: (ctx) => {
      const cur = readJson(ctx.storage, 'tk.prefs').theme;
      ctx.appCommand({ type: 'theme', value: cur === 'light' ? 'dark' : 'light' });
      return cur === 'light' ? 'Tema escuro' : 'Tema claro';
    },
  },
  ...THEMES.map((t) => ({
    id: 'theme:' + t.value,
    name: 'Tema ' + t.label,
    description: 'Aplica o tema ' + t.label,
    icon: 'palette',
    keywords: ['theme', 'aparencia', 'cores'],
    run: (ctx) => { ctx.appCommand({ type: 'theme', value: t.value }); return 'Tema ' + t.label; },
  })),
  {
    id: 'app:sidebar',
    name: 'Recolher/expandir sidebar',
    description: 'Mostra só os ícones na barra lateral',
    icon: 'panel-left',
    shortcut: 'Ctrl+\\',
    keywords: ['menu', 'lateral', 'sidebar'],
    run: (ctx) => { ctx.appCommand({ type: 'sidebar' }); },
  },
  {
    id: 'app:quit',
    name: 'Sair do Devkit',
    description: 'Encerra o app (o atalho global deixa de funcionar)',
    icon: 'power',
    keywords: ['quit', 'exit', 'fechar', 'encerrar'],
    run: (ctx) => ctx.quit(),
  },
].map((c) => ({ ...c, category: 'actions' }));

const COMMANDS = [...searchCommands, ...toolCommands, ...actionCommands];

const categoryName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).name || '';

module.exports = { CATEGORIES, COMMANDS, WEB, categoryName };
