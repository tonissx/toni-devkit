'use strict';
/**
 * Event Bus do DevKit (processo principal). As features anunciam o que aconteceu com nomes genéricos
 * — sem saber quem escuta. Hoje quem escuta é o DevCore; amanhã pode ser qualquer outro módulo.
 *
 * Regras:
 * - só nomes da whitelist (o renderer não inventa eventos);
 * - payload mínimo: só { tool } ou { id } curtos (nunca conteúdo do usuário);
 * - throttle: o mesmo nome+chave no máximo 1× por minuto (spam não passa daqui).
 */

const EVENTS = new Set([
  'tool.opened',        // { tool }   abriu uma ferramenta
  'tool.used',          // { tool }   executou a ação principal (formatar, comparar…)
  'palette.opened',     //            abriu a command palette
  'command.executed',   // { id }     executou um comando da palette
  'clipboard.formatted',// { tool }   formatou algo da área de transferência
  'note.created',       //            nova nota
  'snippet.created',    //            novo snippet
  'note.linked',        //            criou uma nota a partir de [[link]]
]);
const THROTTLE_MS = 60e3;
const KEY_RE = /^[\w.:-]{1,40}$/;

function createBus({ now = () => Date.now() } = {}) {
  const listeners = new Map(); // nome | '*' → Set(fn)
  const last = new Map();      // nome+chave → último envio

  /** Normaliza o payload: só tool/id curtos e seguros. */
  const clean = (data) => {
    const out = {};
    if (data && typeof data.tool === 'string' && KEY_RE.test(data.tool)) out.tool = data.tool;
    if (data && typeof data.id === 'string' && KEY_RE.test(data.id)) out.id = data.id;
    return out;
  };

  return {
    EVENTS,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    /** Emite; retorna false se o evento foi recusado (fora da whitelist ou em throttle). */
    emit(name, data) {
      if (!EVENTS.has(name)) return false;
      const payload = clean(data);
      const key = name + '|' + (payload.tool || payload.id || '');
      const t = now();
      if (last.has(key) && t - last.get(key) < THROTTLE_MS) return false;
      last.set(key, t);
      for (const fn of [...(listeners.get(name) || []), ...(listeners.get('*') || [])]) {
        try { fn(name, payload); } catch (e) { console.error('[events]', name, e); }
      }
      return true;
    },
  };
}

module.exports = { createBus, EVENTS };
