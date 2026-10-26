'use strict';
/**
 * Histórico do Ctrl+P do Notes (igual ao VS Code): os ids das notas escolhidas por ele, a mais recente primeiro.
 * Fica no localStorage (conveniência por máquina); `storage` é injetável para teste.
 */
const KEY = 'devkit.notes.quickopen.history';
const MAX = 30;

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

function loadHistory(storage = defaultStorage()) {
  try {
    const v = JSON.parse(storage.getItem(KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

/** Põe `id` no topo (sem repetir) e devolve a lista nova. */
function pushHistory(id, storage = defaultStorage()) {
  const next = [id, ...loadHistory(storage).filter((x) => x !== id)].slice(0, MAX);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage: o histórico só não persiste */ }
  return next;
}

/** Junta o histórico do Ctrl+P (primeiro) com os recentes gerais, sem repetir. */
function mergeRecents(history, recentIds) {
  return [...new Set([...(history || []), ...(recentIds || [])])];
}

module.exports = { loadHistory, pushHistory, mergeRecents };
