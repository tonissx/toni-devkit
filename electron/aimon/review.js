'use strict';
/**
 * Monitor de IA — revisão automática das alterações quando uma sessão fica ociosa.
 *
 * Só roda quando você ligou (prefs.autoReview) E a IA está em modo Local: o diff nunca sai da máquina sem você pedir, então
 * com a Nuvem nada é enviado sozinho (use o botão "Revisar alterações" da aba Alterações, que mostra e pede confirmação).
 * Guarda o resultado só na memória (some ao fechar o app). Um de cada vez, para não sobrecarregar o modelo local.
 *
 * Injetado: getPrefs() → { autoReview }, getMode() → 'off' | 'local' | 'cloud', collect(key) → { diff, branch, goal } | null,
 * generate(requestId, task, input) → { text, model, ms }, onChange() para avisar a tela.
 */
const crypto = require('node:crypto');

const MAX_KEPT = 30;
const MAX_QUEUE = 3;

function createReviewer({ getPrefs, getMode, collect, generate, onChange = () => {}, now = () => Date.now(), delayMs = 5000 }) {
  const results = new Map();  // key → { state: 'running'|'done'|'error'|'none', ts, sig, text, model, ms, error }
  const timers = new Map();
  let chain = Promise.resolve();
  let queued = 0;
  let seq = 0;

  const keep = (key, v) => {
    results.delete(key);
    results.set(key, v);
    while (results.size > MAX_KEPT) results.delete(results.keys().next().value);
    try { onChange(key); } catch { /* a tela é só um aviso */ }
  };

  async function doRun(key, force) {
    const prev = results.get(key);
    keep(key, { ...(prev || {}), state: 'running', ts: now() });
    try {
      const input = await collect(key);
      if (!input || !input.diff) { keep(key, { state: 'none', ts: now() }); return; }
      const sig = crypto.createHash('sha1').update(input.diff).digest('hex');
      if (!force && prev && prev.state === 'done' && prev.sig === sig) { keep(key, prev); return; } // nada mudou desde a última revisão
      const r = await generate(`aimon-auto-${now()}-${++seq}`, 'aimonReview', { diff: input.diff, branch: input.branch, goal: input.goal || '' });
      keep(key, { state: 'done', ts: now(), sig, text: String(r.text || ''), model: r.model || '', ms: r.ms || 0 });
    } catch (e) {
      keep(key, { state: 'error', ts: now(), error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  function enqueue(key, force) {
    if (queued >= MAX_QUEUE) return false;
    queued++;
    chain = chain.then(() => doRun(key, force)).catch(() => {}).finally(() => { queued--; });
    return true;
  }

  return {
    /** A sessão ficou ociosa. Só age se a revisão automática está ligada e a IA é local; espera um pouco o trabalho assentar. */
    settled(key) {
      if (!getPrefs().autoReview || getMode() !== 'local') return false;
      clearTimeout(timers.get(key));
      const t = setTimeout(() => { timers.delete(key); if (getPrefs().autoReview && getMode() === 'local') enqueue(key, false); }, delayMs);
      if (t.unref) t.unref();
      timers.set(key, t);
      return true;
    },
    /** Pedido da pessoa ("Revisar de novo"): ignora a revisão anterior. Só com a IA local. */
    run(key) {
      if (getMode() !== 'local') throw new Error('A revisão automática só usa a IA local. Com a Nuvem, use “Revisar alterações”, que mostra o que vai ser enviado.');
      return enqueue(key, true);
    },
    /** Resumo para o card da sessão. */
    brief(key) {
      const r = results.get(key);
      return r ? { state: r.state, ts: r.ts } : null;
    },
    /** Resultado completo (com o texto) para a aba Alterações. */
    read(key) { const r = results.get(key); return r ? { ...r } : null; },
    stop() { for (const t of timers.values()) clearTimeout(t); timers.clear(); },
  };
}

module.exports = { createReviewer };
