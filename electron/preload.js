'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    /** Pastas (diretórios reais): [{ path, count, ...configuração }] e operações. path usa "/" ('' = raiz). */
    folders: () => ipcRenderer.invoke('notes:folders'),
    createFolder: (path) => ipcRenderer.invoke('notes:createFolder', path),
    /** opts.merge: se já existe uma pasta com esse nome, junta as duas (ver folderClash). */
    renameFolder: (path, newName, opts) => ipcRenderer.invoke('notes:renameFolder', path, newName, opts),
    moveFolder: (path, newParent, opts) => ipcRenderer.invoke('notes:moveFolder', path, newParent, opts),
    /** Pasta já existente que seria mesclada ao renomear ({ newName }) ou mover ({ newParent }) `path`; null se nenhuma. */
    folderClash: (path, opts) => ipcRenderer.invoke('notes:folderClash', path, opts),
    duplicateFolder: (path) => ipcRenderer.invoke('notes:duplicateFolder', path),
    /** Configuração da pasta: patch { color, icon, template, tags, sort, pinned } (null remove um campo). */
    setFolderMeta: (path, patch) => ipcRenderer.invoke('notes:setFolderMeta', path, patch),
    /** Sobe (-1) ou desce (+1) a pasta entre as irmãs. */
    moveFolderOrder: (path, delta) => ipcRenderer.invoke('notes:moveFolderOrder', path, delta),
    moveNote: (id, folder) => ipcRenderer.invoke('notes:moveNote', id, folder),
    /** Exclui a pasta (notas vão para .trash) → { notes, folders, meta, kept } para restoreFolder. */
    removeFolder: (path) => ipcRenderer.invoke('notes:removeFolder', path),
    restoreFolder: (snapshot) => ipcRenderer.invoke('notes:restoreFolder', snapshot),
    /** Pastas excluídas com notas na lixeira: [{ path, notes }]; restoreFolderFromTrash volta a pasta inteira. */
    trashFolders: () => ipcRenderer.invoke('notes:trashFolders'),
    restoreFolderFromTrash: (path) => ipcRenderer.invoke('notes:restoreFolderFromTrash', path),
    /** Sem argumento abre a pasta das notas; com um caminho de pasta, abre aquela. */
    openFolder: (folder) => ipcRenderer.invoke('notes:open-folder', folder),
    /** Caminho absoluto de uma pasta (para copiar). */
    folderAbs: (path) => ipcRenderer.invoke('notes:folderAbs', path),
    /** Relê a pasta das notas e aplica o que mudou por fora (sync): { added, updated, removed, folders }. */
    reload: () => ipcRenderer.invoke('notes:reload'),
    /** Google Drive: status { configured, builtin, custom, clientId, encryptionAvailable, connected, syncing, lastRun, lastError, needsForce, lastResult }. */
    syncStatus: () => ipcRenderer.invoke('notes:sync-status'),
    /** Guarda o cliente OAuth do Google Cloud: { clientId, clientSecret }. */
    syncSetClient: (client) => ipcRenderer.invoke('notes:sync-set-client', client),
    /** Esquece as credenciais próprias e volta ao cliente que veio com o app. */
    syncClearClient: () => ipcRenderer.invoke('notes:sync-clear-client'),
    /** Abre o login do Google no navegador; resolve quando o usuário autoriza. */
    syncConnect: () => ipcRenderer.invoke('notes:sync-connect'),
    syncDisconnect: () => ipcRenderer.invoke('notes:sync-disconnect'),
    /** Sincroniza agora; `{ force: true }` ignora a trava de exclusões em massa. Resolve com o status. */
    syncNow: (opts) => ipcRenderer.invoke('notes:sync-now', opts),
    onSyncStatus: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('notes:sync-status', h);
      return () => ipcRenderer.removeListener('notes:sync-status', h);
    },
    /** Configurações de Notes: { historyMax, historyGapMin, syncFolder, dir, defaultDir, envLocked, customDir }. */
    settings: () => ipcRenderer.invoke('notes:settings'),
    /** Patch { historyMax, historyGapMin, syncFolder, dir } (null volta ao padrão) → { restart } (a pasta nova só vale após reiniciar). */
    setSettings: (patch) => ipcRenderer.invoke('notes:set-settings', patch),
    pickDir: () => ipcRenderer.invoke('notes:pick-dir'),
    relaunch: () => ipcRenderer.invoke('notes:relaunch'),
    /** Imagem colada/arrastada ({ bytes: Uint8Array, mime }) → grava em .assets\ → { path: '.assets/<nome>' }. */
    saveImage: (data) => ipcRenderer.invoke('notes:saveImage', data),
    saveAttachment: (data) => ipcRenderer.invoke('notes:saveAttachment', data),
    orphanAssets: () => ipcRenderer.invoke('notes:orphanAssets'),
    cleanAssets: () => ipcRenderer.invoke('notes:cleanAssets'),
    /** Abre uma imagem de .assets\ no visualizador do sistema. */
    openAsset: (ref) => ipcRenderer.invoke('notes:open-asset', ref),
    readAsset: (ref) => ipcRenderer.invoke('notes:read-asset', ref),
    revealAsset: (ref) => ipcRenderer.invoke('notes:reveal-asset', ref),
    assetThumb: (ref) => ipcRenderer.invoke('notes:asset-thumb', ref),
    assetBytes: (ref) => ipcRenderer.invoke('notes:asset-bytes', ref),
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
   * Pop-out — painel destacado numa janela própria (ver electron/main.js). A tela de origem usa open/update/close e
   * onAction/onDocked; a janela destacada usa self/onState/action e close (= re-acoplar).
   */
  popout: {
    open: (state) => ipcRenderer.send('popout:open', state),
    update: (state) => ipcRenderer.send('popout:update', state),
    close: (kind) => ipcRenderer.send('popout:close', kind),
    self: () => ipcRenderer.invoke('popout:self'),
    action: (a) => ipcRenderer.send('popout:action', a),
    onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('popout:state', h); return () => ipcRenderer.removeListener('popout:state', h); },
    onAction: (cb) => { const h = (_e, a) => cb(a); ipcRenderer.on('popout:action', h); return () => ipcRenderer.removeListener('popout:action', h); },
    onDocked: (cb) => { const h = (_e, kind) => cb(kind); ipcRenderer.on('popout:docked', h); return () => ipcRenderer.removeListener('popout:docked', h); },
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
  /** Agentes (ver electron/agents): subagentes do Claude Code, um .md por agente em ~/.claude/agents. */
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    get: (name) => ipcRenderer.invoke('agents:get', name),
    /** Cria ou atualiza; `previous` = nome anterior quando a pessoa renomeou. */
    save: (agent, previous) => ipcRenderer.invoke('agents:save', agent, previous),
    remove: (name) => ipcRenderer.invoke('agents:remove', name),
    duplicate: (name) => ipcRenderer.invoke('agents:duplicate', name),
    dir: () => ipcRenderer.invoke('agents:dir'),
    /** Abre um terminal já com o agente; sem `cwd`, pergunta a pasta → { launched, cwd?, terminal? }. */
    launch: (name, cwd) => ipcRenderer.invoke('agents:launch', name, cwd),
    pickDir: () => ipcRenderer.invoke('agents:pickDir'),
  },
  /** Automações (ver electron/automations): gatilho + passos em sequência; só rodam com o devkit aberto. list → { automations, runs }; o detalhe de uma execução vem de run(id). */
  automations: {
    list: () => ipcRenderer.invoke('automations:list'),
    save: (a) => ipcRenderer.invoke('automations:save', a),
    remove: (id) => ipcRenderer.invoke('automations:remove', id),
    enabled: (id, on) => ipcRenderer.invoke('automations:enabled', id, on),
    /** "Rodar agora": ignora o horário. */
    runNow: (id) => ipcRenderer.invoke('automations:runNow', id),
    runCancel: (runId) => ipcRenderer.invoke('automations:runCancel', runId),
    run: (runId) => ipcRenderer.invoke('automations:run', runId),
    historyClear: () => ipcRenderer.invoke('automations:historyClear'),
    /** Avisa quando automações ou execuções mudam; devolve a função que cancela. */
    onChanged: (cb) => { const h = (_e, evt) => cb(evt); ipcRenderer.on('automations:changed', h); return () => ipcRenderer.removeListener('automations:changed', h); },
  },
  /** Monitor de IA (ver electron/aimon): sessões recentes de Claude Code, Codex… — somente leitura. */
  aimon: {
    providers: () => ipcRenderer.invoke('aimon:providers'),
    /** Liga/desliga o acompanhamento (a tela abriu/fechou). */
    setActive: (on) => ipcRenderer.invoke('aimon:setActive', on),
    list: (opts) => ipcRenderer.invoke('aimon:list', opts),
    timeline: (key, opts) => ipcRenderer.invoke('aimon:timeline', key, opts),
    /** Preferências do monitor: { background } — manter o acompanhamento ligado com a tela fechada (desligado por padrão). */
    prefs: () => ipcRenderer.invoke('aimon:prefs'),
    setBackground: (on) => ipcRenderer.invoke('aimon:setBackground', on),
    /** Avisos do sistema quando uma sessão passa a esperar por você ou dá erro (desligado por padrão; liga o acompanhamento em segundo plano). */
    setNotify: (on) => ipcRenderer.invoke('aimon:setNotify', on),
    /** Preços personalizados por modelo ({ [modelo]: { input, output } }, US$ por 1 milhão de tokens) para a estimativa de custo. */
    setPrices: (prices) => ipcRenderer.invoke('aimon:setPrices', prices),
    /** Métricas dos últimos `days` dias: custo estimado, tokens, tempo trabalhando e esperando por você, por modelo e projeto. */
    usage: (days) => ipcRenderer.invoke('aimon:usage', days),
    usageClear: () => ipcRenderer.invoke('aimon:usageClear'),
    /** Exporta as métricas dos últimos `days` dias ('csv' | 'json' | 'md') para um arquivo escolhido → { saved, path? }. */
    usageExport: (days, format) => ipcRenderer.invoke('aimon:usageExport', days, format),
    /** Ritmo de consumo e projeção do limite de uso das 5 h. */
    burn: () => ipcRenderer.invoke('aimon:burn'),
    /** Limite de uso informado por você (tokens contáveis em 5 h); vazio volta à estimativa automática. */
    setLimit: (n) => ipcRenderer.invoke('aimon:setLimit', n),
    /** Revisão automática das alterações quando a sessão fica ociosa (só com a IA em modo Local). */
    setAutoReview: (on) => ipcRenderer.invoke('aimon:setAutoReview', on),
    review: (key) => ipcRenderer.invoke('aimon:review', key),
    reviewRun: (key) => ipcRenderer.invoke('aimon:reviewRun', key),
    /** Sessões lado a lado (compare) e pares de sessões com pedidos parecidos em provedores diferentes (pairs). */
    compare: (keys) => ipcRenderer.invoke('aimon:compare', keys),
    /** Do que é feito o contexto de uma sessão: composição, base fixa, maiores consumidores, compactações e sugestões (estimativa). */
    context: (key) => ipcRenderer.invoke('aimon:context', key),
    pairs: () => ipcRenderer.invoke('aimon:pairs'),
    /** Base da análise de padrões dos pedidos (para a IA). */
    patterns: () => ipcRenderer.invoke('aimon:patterns'),
    /** Busca nos prompts e respostas das sessões em disco (últimos `days` dias) e nos planos guardados. */
    search: (q, opts) => ipcRenderer.invoke('aimon:search', q, opts),
    /** O que as sessões fizeram hoje, enxuto, para o diário de bordo (IA). */
    dayDigest: () => ipcRenderer.invoke('aimon:dayDigest'),
    /** Abre um terminal na pasta da sessão e retoma ({ key } ou { provider, sessionId, cwd }, mode: 'resume' | 'new'). */
    resume: (req) => ipcRenderer.invoke('aimon:resume', req),
    /** Encerra o processo de uma sessão viva (key da lista). */
    close: (key) => ipcRenderer.invoke('aimon:close', key),
    /** Atividade de IA por repositório principal ({} se o acompanhamento não está ligado). Só consulta; nunca liga nada. */
    repoActivity: () => ipcRenderer.invoke('aimon:repoActivity'),
    /** Git (só leitura) da pasta de uma sessão: alterações não comitadas e o diff de um arquivo delas. */
    gitChanges: (key) => ipcRenderer.invoke('aimon:gitChanges', key),
    gitDiff: (key, path, area) => ipcRenderer.invoke('aimon:gitDiff', key, path, area),
    resolveRepo: (cwd) => ipcRenderer.invoke('aimon:resolveRepo', cwd),
    /** Entrada do Git para a IA ({ diff, recent, branch, files, omitted }), já mascarada. Só leitura. */
    /** Resumo estruturado da sessão para a IA (já limitado em tamanho; o texto ainda é mascarado pelas tarefas). */
    digest: (key) => ipcRenderer.invoke('aimon:digest', key),
    gitAiInput: (key) => ipcRenderer.invoke('aimon:gitAiInput', key),
    /** { provider?, since } → { now, since, lanes: [{ key, parentId, segments: [{ from, to, state }] }], stats } */
    lanes: (opts) => ipcRenderer.invoke('aimon:lanes', opts),
    /** Planos das sessões, guardados localmente. plansScan procura planos novos nos transcripts. */
    plansScan: () => ipcRenderer.invoke('aimon:plansScan'),
    /** { status?: 'approved'|'rejected'|'pending', q?, project? } → { rows, projects } */
    plans: (opts) => ipcRenderer.invoke('aimon:plans', opts),
    plan: (id) => ipcRenderer.invoke('aimon:plan', id),
    planForget: (id) => ipcRenderer.invoke('aimon:planForget', id),
    plansClear: () => ipcRenderer.invoke('aimon:plansClear'),
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('aimon:changed', h);
      return () => ipcRenderer.removeListener('aimon:changed', h);
    },
  },
  /**
   * Logs (ver electron/logs): o texto fica no worker do processo principal; a tela pede só o que mostra.
   * Consultas recebem { id, qid, ... } — qid identifica a consulta da tela (respostas de consultas velhas: { stale }).
   */
  logs: {
    /** Caminho de um arquivo/pasta arrastado para a janela. */
    pathOf: (file) => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
    pickFile: () => ipcRenderer.invoke('logs:pickFile'),
    pickFolder: () => ipcRenderer.invoke('logs:pickFolder'),
    /** spec: { kind: 'file'|'folder', path, family?, format?, encoding?, tail? } */
    open: (spec) => ipcRenderer.invoke('logs:open', spec),
    reformat: (id, opts) => ipcRenderer.invoke('logs:reformat', id, opts),
    switchFamily: (id, family) => ipcRenderer.invoke('logs:switchFamily', id, family),
    setLive: (id, on) => ipcRenderer.invoke('logs:setLive', id, on),
    close: (id) => ipcRenderer.invoke('logs:close', id),
    list: () => ipcRenderer.invoke('logs:list'),
    summaries: () => ipcRenderer.invoke('logs:summaries'),
    markSeen: (id) => ipcRenderer.invoke('logs:markSeen', id),
    recents: () => ipcRenderer.invoke('logs:recents'),
    forgetRecent: (p) => ipcRenderer.invoke('logs:forgetRecent', p),
    presets: () => ipcRenderer.invoke('logs:presets'),
    savePresets: (list) => ipcRenderer.invoke('logs:savePresets', list),
    investigations: () => ipcRenderer.invoke('logs:investigations'),
    saveInvestigations: (list) => ipcRenderer.invoke('logs:saveInvestigations', list),
    scanFolder: (dir) => ipcRenderer.invoke('logs:scanFolder', dir),
    info: (args) => ipcRenderer.invoke('logs:info', args),
    query: (args) => ipcRenderer.invoke('logs:query', args),
    rows: (args) => ipcRenderer.invoke('logs:rows', args),
    entry: (args) => ipcRenderer.invoke('logs:entry', args),
    context: (args) => ipcRenderer.invoke('logs:context', args),
    locate: (args) => ipcRenderer.invoke('logs:locate', args),
    seekTime: (args) => ipcRenderer.invoke('logs:seekTime', args),
    next: (args) => ipcRenderer.invoke('logs:next', args),
    hitNear: (args) => ipcRenderer.invoke('logs:hitNear', args),
    marks: (args) => ipcRenderer.invoke('logs:marks', args),
    sparks: (args) => ipcRenderer.invoke('logs:sparks', args),
    charts: (args) => ipcRenderer.invoke('logs:charts', args),
    textOf: (args) => ipcRenderer.invoke('logs:textOf', args),
    /** Escolhe o arquivo e grava o resultado do filtro. args: { id, qid, kind: 'log'|'md', name } */
    exportTo: (args) => ipcRenderer.invoke('logs:export', args),
    reveal: (p) => ipcRenderer.invoke('logs:reveal', p),
    /** { type: 'progress'|'appended'|'reset'|'opening'|'error'|'crashed', id, ... } */
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('logs:changed', h);
      return () => ipcRenderer.removeListener('logs:changed', h);
    },
  },
  /**
   * Banco — monitor de SQL Server (ver electron/db/service.js). A senha fica no Vault e nunca chega aqui:
   * os servidores guardam só o id da entrada.
   */
  db: {
    list: () => ipcRenderer.invoke('db:list'),
    settings: () => ipcRenderer.invoke('db:settings'),
    setSettings: (patch) => ipcRenderer.invoke('db:setSettings', patch),
    add: (server) => ipcRenderer.invoke('db:add', server),
    update: (id, patch) => ipcRenderer.invoke('db:update', id, patch),
    remove: (id) => ipcRenderer.invoke('db:remove', id),
    /** Testa antes de salvar: { ok, ms, info: { product_version, edition, has_view_server_state, ... } } */
    test: (draft) => ipcRenderer.invoke('db:test', draft),
    /** A tela abriu (true) / fechou (false) o servidor: ao vivo no intervalo cheio. */
    watch: (id, on) => ipcRenderer.invoke('db:watch', id, on),
    now: (id) => ipcRenderer.invoke('db:now', id),
    history: (id, range) => ipcRenderer.invoke('db:history', id, range),
    at: (id, t) => ipcRenderer.invoke('db:at', id, t),
    incident: (id, incidentId, t) => ipcRenderer.invoke('db:incident', id, incidentId, t),
    deadlocks: (id, range) => ipcRenderer.invoke('db:deadlocks', id, range),
    topQueries: (id, opts) => ipcRenderer.invoke('db:topQueries', id, opts),
    queryStoreDbs: (id) => ipcRenderer.invoke('db:queryStoreDbs', id),
    queryStoreTop: (id, database, opts) => ipcRenderer.invoke('db:queryStoreTop', id, database, opts),
    /** Bancos de usuário acessíveis (SQL Visualizer). */
    schemaDbs: (id) => ipcRenderer.invoke('db:schemaDbs', id),
    /** Metadados do banco como JSON { database, json } — só catálogo (SQL Visualizer). */
    schema: (id, database) => ipcRenderer.invoke('db:schema', id, database),
    health: (id) => ipcRenderer.invoke('db:health', id),
    plan: (id, opts) => ipcRenderer.invoke('db:plan', id, opts),
    /** Salva XML como .sqlplan (ext padrão) ou .xdl (deadlock) — os dois abrem no SSMS. */
    savePlan: (xml, name, ext) => ipcRenderer.invoke('db:savePlan', xml, name, ext),
    /** Encerra a sessão; expect = { login_name, program_name } do que a pessoa viu (recusa se a sessão mudou). */
    kill: (id, sessionId, expect) => ipcRenderer.invoke('db:kill', id, sessionId, expect),
    summaries: () => ipcRenderer.invoke('db:summaries'),
    /** { type: 'status'|'sample', id, ... } */
    onChanged: (cb) => {
      const h = (_e, evt) => cb(evt);
      ipcRenderer.on('db:changed', h);
      return () => ipcRenderer.removeListener('db:changed', h);
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
