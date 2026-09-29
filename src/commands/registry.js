'use strict';
/**
 * Registro de comandos da command palette.
 *
 * Um comando é um objeto simples:
 *   { id, name, description, category, icon, shortcut?, keywords?, run(ctx, query), takesQuery?, url? }
 *
 * - category: 'web' | 'tools' | 'actions' | 'notes' (ver CATEGORIES; 'web' não é navegável, aparece na busca).
 * - run roda na janela da palette e recebe ctx (ver src/palette/Palette.jsx → makeCtx):
 *     ctx.openApp(route?)   mostra a janela principal (e navega)
 *     ctx.appCommand(cmd)   muda o estado da janela principal: { type: 'theme'|'sidebar', ... }
 *     ctx.openUrl(url)      abre no navegador (só https)
 *     ctx.clipboard / ctx.sql / ctx.storage / ctx.quit()
 *     ctx.notes (API de Notes) · ctx.openNote({ id } | { new: true, title? }) · ctx.devcore (API do DevCore)
 *     ctx.openApp(route, params?) — params chega à ferramenta (ex.: { tab: 'pets' })
 *     ctx.palette.quickNote(texto?) / ctx.palette.enter(escopo)   (comandos keepOpen: a palette continua aberta)
 *   Pode ser async. Se devolver uma string, ela aparece como confirmação antes da palette fechar.
 *   Se lançar erro, a palette mostra o erro e continua aberta.
 * - takesQuery: o texto digitado vira argumento (ex.: buscas na web).
 * - key: letra do atalho Alt+letra (ver src/commands/keys.js), só para exibição no Kbd.
 * - keepOpen: o comando muda o estado da palette em vez de fechá-la.
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
  { id: 'tools', name: 'Tools', key: 't', icon: 'wrench', description: 'Abrir uma ferramenta do Devkit' },
  { id: 'actions', name: 'Actions', key: 'a', icon: 'zap', description: 'Tema, janela, área de transferência…' },
  { id: 'notes', name: 'Notes', key: 'n', icon: 'notebook-pen', description: 'Quick Note, busca, pinned e recentes' },
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
  category: 'web',
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

/* ─────────────── Notes ─────────────── */
const noteCommands = [
  {
    id: 'notes:quick', key: 'q', name: 'Quick Note', icon: 'sticky-note', keepOpen: true,
    description: 'Capturar agora — sem título, salva sozinha',
    keywords: ['nota rapida', 'anotar', 'capturar', 'note', 'scratch'],
    run: (ctx) => ctx.palette.quickNote(),
  },
  {
    id: 'notes:new', key: 'n', name: 'New Note', icon: 'file-plus',
    description: 'Nova nota no editor do Devkit',
    keywords: ['nova nota', 'criar nota', 'note'],
    run: (ctx) => ctx.openNote({ new: true }),
  },
  {
    id: 'notes:template', name: 'Nova nota a partir de template', icon: 'layout-template',
    description: 'Escolher um modelo da pasta Templates',
    keywords: ['template', 'modelo', 'nova nota', 'note'],
    run: (ctx) => ctx.openApp('notes', { view: 'template' }),
  },
  {
    id: 'notes:search', name: 'Search Notes', icon: 'search', keepOpen: true,
    description: 'Buscar só nas notas e snippets',
    keywords: ['buscar notas', 'procurar', 'note', 'snippets'],
    run: (ctx) => ctx.palette.enter('notes'), // dentro de Notes, digitar já busca
  },
  {
    id: 'notes:pinned', key: 'p', name: 'Pinned Notes', icon: 'pin', keepOpen: true,
    description: 'Notas fixadas',
    keywords: ['fixadas', 'note'],
    run: (ctx) => ctx.palette.enter('notes:pinned'),
  },
  {
    id: 'notes:recent', key: 'r', name: 'Recent Notes', icon: 'history', keepOpen: true,
    description: 'Editadas e vistas recentemente',
    keywords: ['recentes', 'note', 'historico'],
    run: (ctx) => ctx.palette.enter('notes:recent'),
  },
  {
    id: 'notes:tasks', name: 'Tarefas', icon: 'list-checks',
    description: 'Todas as tarefas “- [ ]” das notas — capture uma com “task: texto”',
    keywords: ['tasks', 'todo', 'tarefas', 'checklist', 'pendencias', 'afazeres'],
    run: (ctx) => ctx.openApp('notes', { view: 'tasks' }),
  },
  {
    id: 'notes:folder', name: 'Abrir pasta das notas', icon: 'folder-open',
    description: 'Os arquivos .md das notas no Explorer',
    keywords: ['notes', 'arquivos', 'backup', 'note', 'documentos'],
    run: (ctx) => { ctx.notes.openFolder(); },
  },
].map((c) => ({ ...c, category: 'notes' }));

/* ─────────────── DevCore ─────────────── */
const devcoreTab = (id, name, tab, icon, description, keywords) => ({
  id: 'devcore:' + id, name, description, icon, keywords: ['devcore', 'idle', ...keywords],
  run: (ctx) => ctx.openApp('devcore', tab ? { tab } : undefined),
});
const devcoreCommands = [
  devcoreTab('open', 'Open DevCore', null, 'cpu', 'Sua infraestrutura idle e os DevPets', ['jogo', 'infraestrutura', 'compute']),
  devcoreTab('generators', 'View Generators', 'generators', 'server', 'Produtores de Compute do DevCore', ['geradores', 'workers']),
  devcoreTab('pets', 'View DevPets', 'pets', 'paw-print', 'Níveis, estações e habilidades dos DevPets', ['pets', 'mascotes']),
  devcoreTab('upgrades', 'View Upgrades', 'upgrades', 'arrow-up-circle', 'Upgrades disponíveis no DevCore', ['melhorias']),
  devcoreTab('looks', 'Customize DevPets', 'pets', 'palette', 'Visual e evolução dos DevPets', ['visual', 'skin', 'aparência', 'cores', 'pets']),
  devcoreTab('discoveries', 'View Discoveries', 'tech', 'radar', 'Tiers, sinergias e descobertas', ['descobertas', 'tech', 'sinergias']),
  devcoreTab('blueprints', 'View Blueprints', 'generators', 'package', 'Peças, sucata e Refactor (Mk II/III) dos geradores', ['blueprints', 'peças', 'sucata', 'refactor', 'mk', 'marcos']),
  devcoreTab('ops', 'View Ops', 'ops', 'shield', 'Incidentes, previsão, consumíveis e bestiário', ['incidentes', 'vilões', 'consumíveis', 'itens', 'bestiário', 'ops']),
  {
    id: 'devcore:collect', name: 'Collect Offline Progress', icon: 'download',
    description: 'Mostra o resumo do que o DevCore produziu enquanto você esteve fora',
    keywords: ['devcore', 'offline', 'coletar', 'welcome'],
    run: async (ctx) => {
      const s = await ctx.devcore.get();
      if (!s.welcome) return 'Nada pendente: o DevCore está em dia';
      ctx.openApp('devcore');
      return undefined;
    },
  },
  {
    id: 'devcore:abilities', name: 'Activate Pet Ability', icon: 'zap', keepOpen: true,
    description: 'Lista as habilidades dos DevPets para ativar daqui',
    keywords: ['devcore', 'habilidade', 'ability', 'pets', 'burst'],
    run: (ctx) => ctx.palette.search('ativar'),
  },
].map((c) => ({ ...c, category: 'devcore' }));

/**
 * Habilidades dos DevPets como comandos (dinâmicos: vêm do DevCore quando a palette abre).
 * Executam sem abrir a janela; em recarga, mostram o tempo restante como erro na própria palette.
 */
function abilityCommands(list, formatWait) {
  return list.map((a) => ({
    id: 'devcore:ability:' + a.id, name: `Ativar ${a.name} (${a.pet})`, category: 'devcore', icon: 'zap', dynamic: true,
    description: a.active ? 'Ativa agora' : a.ready ? a.description : 'Em recarga · ' + formatWait(a.readyInMs),
    keywords: ['devcore', 'habilidade', 'ability', 'ativar', a.pet.toLowerCase()],
    run: async (ctx) => {
      const r = await ctx.devcore.act({ type: 'ability', id: a.id });
      if (!r.ok) throw new Error(r.error);
      return `${a.name} ativado · ${a.description}`;
    },
  }));
}

/**
 * Consumíveis em estoque como comandos (dinâmicos). Cache Warmer vai para a habilidade com a recarga mais longa.
 */
function itemCommands(list) {
  return list.map((k) => ({
    id: 'devcore:item:' + k.id, name: `Usar ${k.name} (${k.n})`, category: 'devcore', icon: 'package', dynamic: true,
    description: k.usable ? k.description : k.id === 'hotfix' ? 'Nenhum incidente ativo agora' : k.description,
    keywords: ['devcore', 'item', 'consumível', 'usar', k.name.toLowerCase()],
    run: async (ctx) => {
      const r = await ctx.devcore.act({ type: 'use', item: k.id });
      if (!r.ok) throw new Error(r.error);
      return `${k.name} usado · ${k.description}`;
    },
  }));
}

const COMMANDS = [...searchCommands, ...toolCommands, ...actionCommands, ...noteCommands, ...devcoreCommands];

const categoryName = (id) => (id === 'web' ? 'Web' : id === 'devcore' ? 'DevCore' : (CATEGORIES.find((c) => c.id === id) || {}).name || '');

module.exports = { CATEGORIES, COMMANDS, WEB, categoryName, abilityCommands, itemCommands };
