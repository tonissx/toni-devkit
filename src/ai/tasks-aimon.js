'use strict';
/**
 * IA — tarefas do Monitor de IA (src/tools/aimon). Entram em TASKS por src/ai/tasks.js, com os mesmos auxiliares dele.
 * Mesma regra do resto: o serviço só envia o que sai daqui e a tela mostra exatamente este texto antes. Tudo que vem de
 * uma sessão (prompts, respostas, diff) passa por `redact` e por um teto de tamanho; resultados completos de ferramentas
 * nunca entram. Nenhuma tarefa age sobre o repositório — só produzem texto.
 */
const { prepareDiff } = require('./prompts.js');

module.exports = function aimonTasks({ clip, tidy, PT, MD, redact }) {
  const safe = (s, max) => clip(redact(String(s == null ? '' : s)).text, max);
  const arr = (a) => (Array.isArray(a) ? a : []);

  /** Resumo textual do que a sessão registrou (a base do resumo e do briefing). */
  function digest(i) {
    const lines = [];
    if (i.title) lines.push(`Sessão: ${safe(i.title, 160)}`);
    if (i.partial) lines.push('Atenção: a sessão é muito longa e só o final dela foi lido — o começo (e o objetivo original) pode não aparecer aqui.');
    const where = [i.project && `Projeto: ${safe(i.project, 80)}`, i.branch && `Branch: ${safe(i.branch, 80)}`, i.status && `Estado: ${safe(i.status, 40)}`].filter(Boolean);
    if (where.length) lines.push(where.join(' · '));
    const prompts = arr(i.prompts).slice(0, 12);
    if (prompts.length) lines.push('', 'Pedidos da pessoa, em ordem:', ...prompts.map((p, n) => `${n + 1}. ${safe(p, 400)}`));
    const answers = arr(i.answers).slice(-3);
    if (answers.length) lines.push('', 'Últimas respostas do agente:', ...answers.map((a) => `- ${safe(a, 500)}`));
    const tools = Object.entries(i.tools && typeof i.tools === 'object' ? i.tools : {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (tools.length) lines.push('', `Ferramentas usadas: ${tools.map(([n, c]) => `${safe(n, 40)} ×${c}`).join(', ')}`);
    const files = arr(i.files).slice(0, 40);
    if (files.length) lines.push(`Arquivos editados: ${files.map((f) => safe(f, 200)).join(', ')}`);
    const commits = arr(i.commits).slice(0, 20);
    if (commits.length) lines.push(`Commits feitos: ${commits.map((c) => `${String(c.hash || '').slice(0, 7)} ${safe(c.subject || c.summary || '', 120)}`).join(' | ')}`);
    return lines.join('\n');
  }
  const hasContent = (i) => arr(i.prompts).length > 0 || arr(i.answers).length > 0;

  return {
    aimonSummary: {
      label: 'Resumir sessão', maxTokens: 500,
      build(i) {
        if (!hasContent(i)) throw new Error('Esta sessão ainda não tem conteúdo para resumir');
        return {
          system: ['Você resume sessões de trabalho de um agente de IA de programação (como o Claude Code ou o Codex).', PT, MD,
            'Até 6 tópicos curtos (uma ou duas linhas cada): objetivo, o que foi feito, estado atual e o que ficou pendente.',
            'Use SOMENTE os dados fornecidos: não invente arquivos, resultados nem decisões. Se algo não consta nos dados, diga que não consta.'].join('\n'),
          user: digest(i),
        };
      },
      clean: tidy,
    },

    aimonReview: {
      label: 'Revisar alterações da sessão', maxTokens: 900, cloudHint: true,
      build(i) {
        const d = prepareDiff(redact(String(i.diff || '')).text);
        if (!d.files.length) throw new Error('Não há alterações para revisar');
        return {
          system: ['Você é uma pessoa revisora de código atenta. Revise as alterações feitas por um agente de IA.', PT, MD,
            'Aponte, por arquivo, só o que importa: bugs prováveis, tratamento de erro ou validação ausente, segredos ou dados sensíveis no código, efeitos colaterais e o que testar.',
            'Cite o arquivo e o trecho. Se não houver nada relevante, diga isso em uma linha — não invente problemas.',
            'Use SOMENTE o diff fornecido; arquivos listados "só pelo nome" não foram lidos.'].join('\n'),
          user: `${i.goal ? `Objetivo do pedido: ${safe(i.goal, 600)}\n` : ''}${i.branch ? `Branch: ${safe(i.branch, 80)}\n` : ''}\nAlterações:\n${d.text}`,
          files: d.files, omitted: d.omitted, truncated: d.truncated,
        };
      },
      clean: tidy,
    },

    aimonBrief: {
      label: 'Briefing para retomar', maxTokens: 700,
      build(i) {
        if (!hasContent(i)) throw new Error('Esta sessão ainda não tem conteúdo para um briefing');
        const changes = arr(i.changes).slice(0, 40).map((c) => `${safe(c.kind || '', 20)} ${safe(c.path || '', 200)}`.trim());
        const parts = [digest(i)];
        if (changes.length) parts.push('', 'Alterações ainda não comitadas:', ...changes.map((c) => `- ${c}`));
        if (i.lastPlan) parts.push('', 'Último plano aprovado:', safe(i.lastPlan, 1500));
        return {
          system: ['Você escreve um briefing para uma NOVA sessão de um agente de IA de programação continuar um trabalho já começado.', PT, MD,
            'Escreva como instrução, em tom direto ("Continue…"), com estas seções curtas: Objetivo, Já feito, Falta fazer, Arquivos tocados, Cuidados.',
            'Use SOMENTE os dados fornecidos: não invente o que foi feito. O que não se sabe vai em "Cuidados" como algo a confirmar.'].join('\n'),
          user: parts.join('\n'),
        };
      },
      clean: tidy,
    },
  };
};
