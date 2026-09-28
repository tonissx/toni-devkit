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
  theme: { set: (t) => ipcRenderer.invoke('theme:set', t) },
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
  },
  sql: {
    status: () => ipcRenderer.invoke('sql:status'),
    format: (sql, options) => ipcRenderer.invoke('sql:format', sql, options),
  },
  palette: {
    toggle: () => ipcRenderer.send('palette:toggle'),
    hide: () => ipcRenderer.send('palette:hide'),
    resize: (height) => ipcRenderer.send('palette:resize', height),
    status: () => ipcRenderer.invoke('palette:status'),
    onOpened: (cb) => {
      const h = (_e, info) => cb(info);
      ipcRenderer.on('palette:opened', h);
      return () => ipcRenderer.removeListener('palette:opened', h);
    },
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
    tags: () => ipcRenderer.invoke('notes:tags'),
    openFolder: () => ipcRenderer.invoke('notes:open-folder'),
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
