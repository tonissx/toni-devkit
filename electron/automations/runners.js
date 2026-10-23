'use strict';
/**
 * Automações — executores dos passos. Cada um recebe a configuração já com os `{{...}}` resolvidos e devolve
 * `{ ok, text, data, error, costUsd, sessionId, turns }`. Nunca lança. `h.setKill(fn)` deixa o motor cancelar / estourar o tempo.
 * Sem shell: o prompt do agente vai pela entrada padrão.
 */
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const { buildArgs, parseOutput } = require('../agents/schedule');

const MAX_OUT = 2 * 1024 * 1024;
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) + '\n… (cortado)' : t; };

function createRunners({ agents, spawn = require('node:child_process').spawn, bin = 'claude', notify = () => {} }) {
  async function agent(cfg, h) {
    try {
      if (!fsSync.statSync(cfg.cwd).isDirectory()) return { ok: false, error: 'A pasta de trabalho não é uma pasta.' };
    } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'A pasta de trabalho não existe mais: ' + cfg.cwd : String(e.message || e) }; }
    let def;
    try { def = await agents.get(cfg.agent); } catch { return { ok: false, error: `O agente “${cfg.agent}” não existe mais em ~/.claude/agents.` }; }
    const sessionId = crypto.randomUUID();
    const built = buildArgs(def, cfg, sessionId);
    if (built.problem) return { ok: false, error: built.problem };
    return new Promise((resolve) => {
      let child;
      try { child = spawn(bin, built.args, { cwd: cfg.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return resolve({ ok: false, error: 'Não foi possível iniciar o claude: ' + (e.message || e) }); }
      h.setKill(() => { try { child.kill(); } catch { /* já saiu */ } });
      if (h.isCanceled && h.isCanceled()) { try { child.kill(); } catch { /* já saiu */ } } // cancelada enquanto o processo nascia
      let out = ''; let err = ''; let ended = false;
      child.stdout && child.stdout.on('data', (b) => { if (out.length < MAX_OUT) out += b; });
      child.stderr && child.stderr.on('data', (b) => { if (err.length < 16384) err += b; });
      const done = (code, spawnError) => {
        if (ended) return;
        ended = true;
        if (spawnError) return resolve({ ok: false, sessionId, error: spawnError.code === 'ENOENT' ? 'O comando “claude” não foi encontrado. Instale o Claude Code ou ajuste o PATH.' : String(spawnError.message || spawnError) });
        const p = parseOutput(out);
        if (!p) return resolve({ ok: false, sessionId, error: clip(err.trim() || `O claude terminou (código ${code}) sem resposta legível.`, 2000) });
        const failed = p.isError || code !== 0;
        resolve({
          ok: !failed, text: p.result, data: { turns: p.turns, sessionId: p.sessionId || sessionId }, costUsd: p.costUsd, turns: p.turns, sessionId: p.sessionId || sessionId,
          error: failed ? (p.subtype === 'error_max_budget_usd' ? `Parou ao atingir o teto de US$ ${cfg.maxBudgetUsd}.` : p.result || clip(err.trim(), 2000) || 'O claude relatou um erro.') : '',
        });
      };
      child.once('error', (e) => done(null, e));
      child.once('close', (code) => done(code));
      try { child.stdin.end(cfg.prompt); } catch { /* o close/error trata */ }
    });
  }

  async function notifyStep(cfg) {
    try { notify(cfg.title, cfg.text); } catch (e) { return { ok: false, error: 'Não foi possível mostrar o aviso: ' + (e.message || e) }; }
    return { ok: true, text: cfg.text };
  }

  return { agent, notify: notifyStep };
}

module.exports = { createRunners };
