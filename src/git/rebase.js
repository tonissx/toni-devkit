'use strict';
/**
 * Git — rebase interativo montado na tela (sem editor de texto). O plano é a lista dos commits na ordem desejada
 * (o mais antigo primeiro, como no todo do git), cada um com uma ação:
 *   pick (manter) · reword (manter com outra mensagem) · squash (juntar ao anterior, somando as mensagens) ·
 *   fixup (juntar ao anterior, descartando esta mensagem) · drop (remover)
 * Daqui sai o arquivo de instruções do git ("todo") e a prévia do resultado. JS puro, testado em scripts/test-git.mjs.
 */

const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];

/**
 * Valida o plano contra os commits do intervalo (mesmo conjunto, cada um uma vez). Lança erro em português.
 * commits: [{ hash, subject }] do intervalo, em qualquer ordem.
 */
function validatePlan(plan, commits) {
  if (!Array.isArray(plan) || !plan.length) throw new Error('Nenhum commit no plano');
  const known = new Set((commits || []).map((c) => c.hash));
  const seen = new Set();
  for (const s of plan) {
    if (!s || !ACTIONS.includes(s.action)) throw new Error('Ação inválida no plano');
    if (!known.has(s.hash)) throw new Error('O plano tem um commit que não está no intervalo');
    if (seen.has(s.hash)) throw new Error('Commit repetido no plano');
    seen.add(s.hash);
    if (s.action === 'reword' && !String(s.message || '').trim()) throw new Error('Escreva a nova mensagem do commit');
  }
  if (seen.size !== known.size) throw new Error('O plano precisa listar todos os commits do intervalo');
  const kept = plan.filter((s) => s.action !== 'drop');
  if (!kept.length) throw new Error('O plano remove todos os commits — use "voltar a branch" para isso');
  if (kept[0].action === 'squash' || kept[0].action === 'fixup') throw new Error('O primeiro commit mantido não pode ser juntado a um anterior');
  return true;
}

/**
 * Arquivo de instruções para o git. msgFile(i) → caminho (com "/") do arquivo com a nova mensagem do passo i; a
 * mensagem é aplicada logo depois com `exec git commit --amend` (o git não abre editor: GIT_EDITOR=true).
 */
function buildTodo(plan, msgFile) {
  const lines = [];
  plan.forEach((s, i) => {
    const custom = (s.action === 'reword' || s.action === 'squash') && String(s.message || '').trim();
    lines.push(`${s.action === 'reword' ? 'pick' : s.action} ${s.hash}`);
    if (custom) lines.push(`exec git commit --amend -q --allow-empty -F "${msgFile(i)}"`);
  });
  return lines.join('\n') + '\n';
}

/**
 * Prévia: os commits que vão existir depois, de cima (mais novo) para baixo, cada um com os commits de origem.
 * byHash: { hash → { subject } }.
 */
function previewPlan(plan, byHash) {
  const out = [];
  for (const s of plan) {
    const subj = (byHash[s.hash] && byHash[s.hash].subject) || s.hash.slice(0, 7);
    if (s.action === 'drop') continue;
    if ((s.action === 'squash' || s.action === 'fixup') && out.length) {
      const last = out[out.length - 1];
      last.from.push(s.hash);
      if (s.action === 'squash' && String(s.message || '').trim()) last.subject = String(s.message).split('\n')[0];
      continue;
    }
    out.push({ subject: s.action === 'reword' && String(s.message || '').trim() ? String(s.message).split('\n')[0] : subj, from: [s.hash], changed: s.action === 'reword' });
  }
  return out.reverse();
}

module.exports = { ACTIONS, validatePlan, buildTodo, previewPlan };
