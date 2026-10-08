'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** API mínima e explícita exposta ao renderer (window.devkit). */
contextBridge.exposeInMainWorld('devkit', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('win:state', h);
      return () => ipcRenderer.removeListener('win:state', h);
    },
  },
  theme: {
    set: (t) => ipcRenderer.invoke('theme:set', t),
    /** Outra janela trocou o tema (as sticky notes acompanham na hora). */
    onChanged: (cb) => {
      const h = (_e, t) => cb(t);
      ipcRenderer.on('theme:changed', h);
      return () => ipcRenderer.removeListener('theme:changed', h);
    },
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },
  files: {
    openSql: () => ipcRenderer.invoke('file:open-sql'),
    saveSql: (content, name) => ipcRenderer.invoke('file:save-sql', content, name),
    openXml: () => ipcRenderer.invoke('file:open-xml'),
    saveXml: (content, name) => ipcRenderer.invoke('file:save-xml', content, name),
    openText: () => ipcRenderer.invoke('file:open-text'),
    openJson: () => ipcRenderer.invoke('file:open-json'),
    /** content: string (json/yaml/csv/svg) ou Uint8Array (png). */
    saveExport: (content, name) => ipcRenderer.invoke('file:save-export', content, name),
  },
  sql: {
    status: () => ipcRenderer.invoke('sql:status'),
    format: (sql, options) => ipcRenderer.invoke('sql:format', sql, options),
  },
  palette: {
    toggle: () => ipcRenderer.send('palette:toggle'),
    /** opts.restore: devolve o foco ao programa que estava na frente quando a palette abriu (Esc). */
    hide: (opts) => ipcRenderer.send('palette:hide', opts),
    resize: (height) => ipcRenderer.send('palette:resize', height),
    status: () => ipcRenderer.invoke('palette:status'),
    onOpened: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('palette:opened', h);
      return () => ipcRenderer.removeListener('palette:opened', h);
    },
    /** Smart Binds: o processo principal pede para rodar um comando sem mostrar a palette. */
    onRun: (cb) => {
      const h = (_e, id) => cb(id);
      ipcRenderer.on('palette:run', h);
      return () => ipcRenderer.removeListener('palette:run', h);
    },
  },
  /** Smart Binds — atalhos globais para comandos (ver electron/binds.js). */
  binds: {
    get: () => ipcRenderer.invoke('binds:get'),
    set: (next) => ipcRenderer.invoke('binds:set', next),
    suspend: (on) => ipcRenderer.invoke('binds:suspend', on),
    result: (r) => ipcRenderer.send('binds:result', r),
  },
  /** Colar um snippet no programa que tinha o foco (ver electron/paste.js). payload: { code, title } */
  snippet: {
    paste: (payload) => ipcRenderer.invoke('snippet:paste', payload),
  },
  app: {
    /** Mostra a janela principal (e navega para a rota, se houver). */
    open: (route, params) => ipcRenderer.send('app:open', route, params),
    /** Comando para a janela principal: { type: 'go'|'theme'|'sidebar', ... }. */
    command: (cmd) => ipcRenderer.send('app:command', cmd),
    onCommand: (cb) => {
      const h = (_e, cmd) => cb(cmd);
      ipcRenderer.on('app:command', h);
      return () => ipcRenderer.removeListener('app:command', h);
    },
    quit: () => ipcRenderer.send('app:quit'),
    loginItem: (enable) => ipcRenderer.invoke('app:login-item', enable),
  },
  shell: {
    openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  },
  /** Event Bus: anuncia uso de features (nomes da whitelist em electron/events.js). */
  events: {
    emit: (name, data) => ipcRenderer.send('events:emit', name, data),
  },
  /** DevCore — sistema idle (ver electron/devcore/service.js). */
  devcore: {
    get: () => ipcRenderer.invoke('devcore:get'),
    act: (action) => ipcRenderer.invoke('devcore:act', action),
    abilities: () => ipcRenderer.invoke('devcore:abilities'),
    items: () => ipcRenderer.invoke('devcore:items'),
    onChanged: (cb) => {
      const h = (_e, msg) => cb(msg);
      ipcRenderer.on('devcore:changed', h);
      return () => ipcRenderer.removeListener('devcore:changed', h);
    },
  },
  /** Notes — camada de conhecimento do DevKit (ver electron/notes/service.js). */
  notes: {
    info: () => ipcRenderer.invoke('notes:info'),
    list: (filter) => ipcRenderer.invoke('notes:list', filter),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    save: (note) => ipcRenderer.invoke('notes:save', note),
    /** Para ferramentas: cria uma nota { title, content, tags, type, source }. */
    create: (partial) => ipcRenderer.invoke('notes:create', partial),
    remove: (id) => ipcRenderer.invoke('notes:remove', id),
    restore: (note) => ipcRenderer.invoke('notes:restore', note),
    search: (query, opts) => ipcRenderer.invoke('notes:search', query, opts),
    recent: () => ipcRenderer.invoke('notes:recent'),
    markViewed: (id) => ipcRenderer.invoke('notes:markViewed', id),
    resolveLink: (title) => ipcRenderer.invoke('notes:resolveLink', title),
    /** Notas que apontam para `id` com [[link]]: [{ id, title, folder, updated, line }]. */
    backlinks: (id) => ipcRenderer.invoke('notes:backlinks', id),
    /** Quantas notas (fora exceptId) têm [[title]]. */
    linkRefs: (title, exceptId) => ipcRenderer.invoke('notes:linkRefs', title, exceptId),
    /** [[from]] → [[to]] nas outras notas (depois de renomear) → número de notas alteradas. */
    renameLinks: (from, to, exceptId) => ipcRenderer.invoke('notes:renameLinks', from, to, exceptId),
    /** Histórico: versões anteriores [{ stamp, at, title, chars }] · uma versão · voltar para ela. */
    history: (id) => ipcRenderer.invoke('notes:history', id),
    version: (id, stamp) => ipcRenderer.invoke('notes:version', id, stamp),
    restoreVersion: (id, stamp) => ipcRenderer.invoke('notes:restoreVersion', id, stamp),
    /** Lixeira: itens [{ file, id, title, folder, deletedAt, content, preview, exists }] e operações. */
    trashList: () => ipcRenderer.invoke('notes:trashList'),
    restoreFromTrash: (file) => ipcRenderer.invoke('notes:restoreFromTrash', file),
    deleteFromTrash: (file) => ipcRenderer.invoke('notes:deleteFromTrash', file),
    emptyTrash: () => ipcRenderer.invoke('notes:emptyTrash'),
    /** Templates (notas da pasta Templates) e nova nota a partir de um → { note, cursor }. */
    templates: () => ipcRenderer.invoke('notes:templates'),
    fromTemplate: (id, opts) => ipcRenderer.invoke('notes:fromTemplate', id, opts),
    /** Pasta na raiz com esse nome (a existente, mesmo com outra grafia; senão cria) → caminho. */
    ensureRootFolder: (name) => ipcRenderer.invoke('notes:ensureRootFolder', name),
    /** Grafo das notas: { nodes: [{ id, title, folder, type, tags, degree, ghost }], links: [{ source, target }] }. */
    graph: () => ipcRenderer.invoke('notes:graph'),
    /** Quantas notas há na lixeira. */
    trashCount: () => ipcRenderer.invoke('notes:trashCount'),
    tags: () => ipcRenderer.invoke('notes:tags'),
    /** Tarefas ("- [ ]") de todas as notas: { status: 'open'|'done'|'all', tag }. */
    tasks: (filter) => ipcRenderer.invoke('notes:tasks', filter),
    toggleTask: (id, index) => ipcRenderer.invoke('notes:toggleTask', id, index),
    /** Captura rápida: acrescenta "- [ ] texto" à nota Inbox. */
    appendTask: (text) => ipcRenderer.invoke('notes:appendTask', text),
    /** Pastas (diretórios reais): [{ path, count }] e operações. path usa "/" ('' = raiz). */
    folders: () => ipcRenderer.invoke('notes:folders'),
    createFolder: (path) => ipcRenderer.invoke('notes:createFolder', path),
    renameFolder: (path, newName) => ipcRenderer.invoke('notes:renameFolder', path, newName),
    moveFolder: (path, newParent) => ipcRenderer.invoke('notes:moveFolder', path, newParent),
    moveNote: (id, folder) => ipcRenderer.invoke('notes:moveNote', id, folder),
    /** Exclui a pasta (notas vão para .trash) → { notes, folders } para restoreFolder. */
    removeFolder: (path) => ipcRenderer.invoke('notes:removeFolder', path),
    restoreFolder: (snapshot) => ipcRenderer.invoke('notes:restoreFolder', snapshot),
    openFolder: () => ipcRenderer.invoke('notes:open-folder'),
    /** Imagem colada/arrastada ({ bytes: Uint8Array, mime }) → grava em .assets\ → { path: '.assets/<nome>' }. */
    saveImage: (data) => ipcRenderer.invoke('notes:saveImage', data),
    /** Abre uma imagem de .assets\ no visualizador do sistema. */
    openAsset: (ref) => ipcRenderer.invoke('notes:open-asset', ref),
    /** Abre uma nota ({ id } ou { new: true, title? }) na janela principal. */
    open: (payload) => ipcRenderer.send('app:open-note', payload),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('notes:changed', h);
      return () => ipcRenderer.removeListener('notes:changed', h);
    },
    onFlush: (cb) => {
      const h = () => cb();
      ipcRenderer.on('notes:flush', h);
      return () => ipcRenderer.removeListener('notes:flush', h);
    },
  },
  /** Links rápidos: alias → URL com {q} (ver electron/links/service.js). */
  links: {
    list: () => ipcRenderer.invoke('links:list'),
    save: (link) => ipcRenderer.invoke('links:save', link),
    remove: (id) => ipcRenderer.invoke('links:remove', id),
    /** Abre no navegador com o valor no {q} (e guarda o valor nos recentes) → url. */
    open: (id, value) => ipcRenderer.invoke('links:open', id, value),
    /** Só monta a URL (para copiar) → url. */
    url: (id, value) => ipcRenderer.invoke('links:url', id, value),
    forget: (id, value) => ipcRenderer.invoke('links:forget', id, value),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('links:changed', h);
      return () => ipcRenderer.removeListener('links:changed', h);
    },
  },
  /**
   * Vault — cofre de dados sensíveis (ver electron/vault/service.js). Listas trazem só metadados (segredos = null);
   * um segredo só chega aqui por reveal (olho da tela) — o normal é copy, que vai direto para o clipboard.
   */
  vault: {
    status: () => ipcRenderer.invoke('vault:status'),
    create: (password) => ipcRenderer.invoke('vault:create', password),
    unlock: (password) => ipcRenderer.invoke('vault:unlock', password),
    lock: () => ipcRenderer.invoke('vault:lock'),
    /** Entradas (metadados) ou null se trancado. */
    list: () => ipcRenderer.invoke('vault:list'),
    /** Índice público { id, name, kind, tags } — vale com o cofre trancado (a palette busca por ele). */
    index: () => ipcRenderer.invoke('vault:index'),
    /** Notas: nomes → { locked, exists, items: { nome: metadados | null } }. */
    resolve: (names) => ipcRenderer.invoke('vault:resolve', names),
    save: (entry) => ipcRenderer.invoke('vault:save', entry),
    remove: (id) => ipcRenderer.invoke('vault:remove', id),
    reveal: (id, index) => ipcRenderer.invoke('vault:reveal', id, index),
    /** what: índice do campo | 'primary' | 'connstr' | 'jdbc' → { label, name, clearsIn }. */
    copy: (id, what) => ipcRenderer.invoke('vault:copy', id, what),
    setSettings: (s) => ipcRenderer.invoke('vault:setSettings', s),
    changePassword: (current, next) => ipcRenderer.invoke('vault:changePassword', current, next),
    exportBackup: () => ipcRenderer.invoke('vault:export'),
    reset: (confirm) => ipcRenderer.invoke('vault:reset', confirm),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('vault:changed', h);
      return () => ipcRenderer.removeListener('vault:changed', h);
    },
  },
  /**
   * Sticky notes — notas fixadas na tela (ver electron/stickies/service.js). open/list/toggleAll valem de qualquer janela;
   * self/set/close só na janela da própria sticky (o processo principal sabe de qual nota ela é).
   */
  stickies: {
    open: (noteId, opts) => ipcRenderer.invoke('stickies:open', noteId, opts),
    list: () => ipcRenderer.invoke('stickies:list'),
    toggleAll: () => ipcRenderer.invoke('stickies:toggleAll'),
    self: () => ipcRenderer.invoke('stickies:self'),
    set: (patch) => ipcRenderer.invoke('stickies:set', patch),
    close: () => ipcRenderer.invoke('stickies:close'),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('stickies:changed', h);
      return () => ipcRenderer.removeListener('stickies:changed', h);
    },
  },
  /**
   * Git — repositórios locais (ver electron/git/service.js). Escritas só por exec({ op, ... }) — operações tipadas de
   * src/git/ops.js; a tela nunca manda linha de comando.
   */
  git: {
    version: () => ipcRenderer.invoke('git:version'),
    list: () => ipcRenderer.invoke('git:list'),
    add: (dir) => ipcRenderer.invoke('git:add', dir),
    remove: (repo) => ipcRenderer.invoke('git:remove', repo),
    scan: (root, depth) => ipcRenderer.invoke('git:scan', root, depth),
    scanDefault: () => ipcRenderer.invoke('git:scan-default'),
    pick: () => ipcRenderer.invoke('git:pick'),
    open: (repo) => ipcRenderer.invoke('git:open', repo),
    openIn: (repo, where) => ipcRenderer.invoke('git:open-in', repo, where),
    summaries: () => ipcRenderer.invoke('git:summaries'),
    status: (repo) => ipcRenderer.invoke('git:status', repo),
    log: (repo, opts) => ipcRenderer.invoke('git:log', repo, opts),
    /** Fotos do Gravatar por e-mail → { [email]: data URL | null }. Só o hash do e-mail sai da máquina. */
    avatars: (emails) => ipcRenderer.invoke('git:avatars', emails),
    commit: (repo, hash) => ipcRenderer.invoke('git:commit', repo, hash),
    diff: (repo, opts) => ipcRenderer.invoke('git:diff', repo, opts),
    branches: (repo) => ipcRenderer.invoke('git:branches', repo),
    compare: (repo, a, b) => ipcRenderer.invoke('git:compare', repo, a, b),
    stashes: (repo) => ipcRenderer.invoke('git:stashes', repo),
    stashFiles: (repo, ref) => ipcRenderer.invoke('git:stashFiles', repo, ref),
    reflog: (repo, limit) => ipcRenderer.invoke('git:reflog', repo, limit),
    overview: (repo) => ipcRenderer.invoke('git:overview', repo),
    backups: (repo) => ipcRenderer.invoke('git:backups', repo),
    exec: (repo, op) => ipcRenderer.invoke('git:exec', repo, op),
    restoreBackup: (repo, id) => ipcRenderer.invoke('git:restoreBackup', repo, id),
    /** Antes de mesclar: commits que entram, avanço direto e arquivos que vão conflitar (sem mexer em nada). */
    mergePreview: (repo, branch) => ipcRenderer.invoke('git:mergePreview', repo, branch),
    /** Arquivo em conflito: { base, ours, theirs, merged, code, deletedBy, binary }. */
    conflictFile: (repo, path) => ipcRenderer.invoke('git:conflictFile', repo, path),
    /** Commits para reorganizar: { onto, ontoSubject, commits, hasMerges, pushed }. opts: { count } | { base } */
    rebaseInfo: (repo, opts) => ipcRenderer.invoke('git:rebaseInfo', repo, opts),
    /** Arquivos de uma revisão. */
    files: (repo, ref) => ipcRenderer.invoke('git:files', repo, ref),
    /** Quem mudou cada linha: { lines: [{ n, hash, text }], commits: { hash → { author, time, summary } }, groups }. */
    blame: (repo, path, rev) => ipcRenderer.invoke('git:blame', repo, path, rev),
    /** Commits em que um texto apareceu/sumiu (-S) ou casou a regex (-G). opts: { regex, file } */
    searchText: (repo, text, opts) => ipcRenderer.invoke('git:searchText', repo, text, opts),
    bisectState: (repo) => ipcRenderer.invoke('git:bisectState', repo),
    tags: (repo) => ipcRenderer.invoke('git:tags', repo),
    cleanPreview: (repo) => ipcRenderer.invoke('git:cleanPreview', repo),
    gitignore: (repo) => ipcRenderer.invoke('git:gitignore', repo),
    /** Commits por dia da semana × hora (180 dias). */
    rhythm: (repo) => ipcRenderer.invoke('git:rhythm', repo),
    /** Antes/depois de um arquivo num commit (para o Diff Checker). */
    fileVersions: (repo, hash, path) => ipcRenderer.invoke('git:fileVersions', repo, hash, path),
    /** Worktrees além do principal: { path, name, branch, exists, dirty, locked }. */
    worktrees: (repo) => ipcRenderer.invoke('git:worktrees', repo),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('git:changed', h);
      return () => ipcRenderer.removeListener('git:changed', h);
    },
  },
  /**
   * IA opcional (ver electron/ai/service.js): modo Local (Ollama) ou Nuvem (Claude, chave no Vault — nunca chega aqui).
   */
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    /** Só a configuração (rápido: não consulta o Ollama). */
    config: () => ipcRenderer.invoke('ai:config'),
    setConfig: (patch) => ipcRenderer.invoke('ai:setConfig', patch),
    /** O que será enviado (system + user + arquivos), para mostrar antes. */
    buildRequest: (task, input) => ipcRenderer.invoke('ai:buildRequest', task, input),
    installOllama: () => ipcRenderer.invoke('ai:installOllama'),
    pullModel: (name) => ipcRenderer.invoke('ai:pullModel', name),
    generate: (requestId, task, input) => ipcRenderer.invoke('ai:generate', requestId, task, input),
    cancel: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
    onProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('ai:progress', h); return () => ipcRenderer.removeListener('ai:progress', h); },
    onChunk: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('ai:chunk', h); return () => ipcRenderer.removeListener('ai:chunk', h); },
    onChanged: (cb) => { const h = (_e, c) => cb(c); ipcRenderer.on('ai:changed', h); return () => ipcRenderer.removeListener('ai:changed', h); },
  },
  /** Atualização automática (ver electron/updater/service.js). */
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onChanged: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('updater:changed', h);
      return () => ipcRenderer.removeListener('updater:changed', h);
    },
  },
});
