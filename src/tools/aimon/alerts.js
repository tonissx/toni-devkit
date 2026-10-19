'use strict';
/**
 * Monitor de IA — avisos sobre o Git de uma sessão. Só avisam; nada bloqueia a sessão nem o Git.
 * Puro: recebe a branch, quantos arquivos estão alterados e se a sessão está escrevendo.
 */
const PROTECTED = /^(main|master|develop|development|release([/-].*)?|prod(uction)?([/-].*)?)$/i;
const MANY_FILES = 30;

/** → [{ id, icon, text, title }] */
function gitAlerts({ branch, dirty, active }) {
  const out = [];
  if (active && branch && PROTECTED.test(branch)) {
    out.push({ id: 'protected', icon: 'shield-alert', text: `Escrevendo em ${branch}`, title: 'A sessão está trabalhando direto numa branch protegida (main, master, develop, release*, prod*). Considere uma branch de trabalho.' });
  }
  if (Number.isFinite(dirty) && dirty >= MANY_FILES) {
    out.push({ id: 'many', icon: 'files', text: `${dirty} arquivos alterados`, title: `Há ${dirty} arquivos com alterações não comitadas neste repositório. Vale revisar e comitar em partes.` });
  }
  return out;
}

const LOOP_FAILS = 3;       // a mesma ferramenta falhando tantas vezes seguidas
const CTX_WARN_PCT = 85;    // contexto ocupado (estimativa)
const PARKED_MS = 10 * 60_000;

const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : Math.round(n / 1000) + ' mil');
const baseName = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || p;

/**
 * Avisos sobre o comportamento da sessão (a linha do monitor, ver AIMonitor): ferramenta em loop, dois agentes no mesmo
 * arquivo, contexto quase cheio e sessão parada com alterações sem commit. Só avisam. → [{ id, icon, text, title }]
 */
function sessionAlerts(s, now = Date.now()) {
  const out = [];
  if (!s) return out;
  const live = s.status === 'working' || s.status === 'waiting';
  const f = s.failStreak;
  if (live && f && f.count >= LOOP_FAILS) {
    out.push({ id: 'loop', icon: 'repeat', text: `${f.tool} falhou ${f.count}× seguidas`, title: `A ferramenta ${f.tool} falhou ${f.count} vezes seguidas. O agente pode estar em loop; vale olhar a timeline e, se for o caso, interromper e orientar.` });
  }
  if (live && Array.isArray(s.conflicts) && s.conflicts.length) {
    const c = s.conflicts[0];
    out.push({ id: 'conflict', icon: 'git-merge', text: `Mesmo arquivo: ${baseName(c.path)}`, title: `${c.path} foi editado nos últimos 30 min por esta sessão e também por: ${c.with.join(', ')}. Dois agentes na mesma pasta podem sobrescrever o trabalho um do outro${s.conflicts.length > 1 ? ` (${s.conflicts.length} arquivos)` : ''}.` });
  }
  const ctx = s.context;
  if (ctx && ctx.pct >= CTX_WARN_PCT && s.status !== 'error') {
    out.push({ id: 'context', icon: 'brain', text: `Contexto ~${ctx.pct}% cheio`, title: `A última chamada leu cerca de ${kTok(ctx.tokens)} tokens de contexto (de uns ${kTok(ctx.limit)}; estimativa). Perto do limite a sessão perde qualidade ou compacta sozinha — considere /compact ou uma sessão nova com o briefing.` });
  }
  const parked = (s.status === 'idle' || s.status === 'stale') && now - (s.lastTs || 0) > PARKED_MS;
  if (parked && Number.isFinite(s.dirty) && s.dirty > 0) {
    out.push({ id: 'parked', icon: 'file-warning', text: `Parada com ${s.dirty} arquivo${s.dirty === 1 ? '' : 's'} sem commit`, title: `A sessão parou há mais de 10 min e a pasta tem ${s.dirty} arquivo(s) com alterações não comitadas. Revise e comite para não perder nem misturar com o próximo trabalho.` });
  }
  return out;
}

module.exports = { gitAlerts, sessionAlerts, PROTECTED, MANY_FILES, LOOP_FAILS, CTX_WARN_PCT };
