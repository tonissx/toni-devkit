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

    aimonDiary: {
      label: 'Diário de bordo do dia', maxTokens: 900,
      build(i) {
        const sessions = arr(i.sessions);
        if (!sessions.length) throw new Error('Não há sessões com atividade hoje');
        const h = (ms) => (Number.isFinite(ms) ? `${Math.floor(ms / 3600e3)} h ${String(Math.round((ms % 3600e3) / 60e3)).padStart(2, '0')} min` : null);
        const t = i.totals || {};
        const facts = [h(t.workMs) && `trabalhando: ${h(t.workMs)}`, h(t.waitMs) && `esperando a pessoa: ${h(t.waitMs)}`, Number.isFinite(t.tokens) && `tokens: ${Math.round(t.tokens)}`, Number.isFinite(t.cost) && `custo estimado: US$ ${t.cost.toFixed(2)}`].filter(Boolean);
        const parts = [`Data: ${safe(i.date, 12)}`, facts.length ? `Totais do dia — ${facts.join(' · ')}` : ''];
        sessions.slice(-12).forEach((s, n) => parts.push('', `=== Sessão ${n + 1} ===`, digest(s)));
        return {
          system: ['Você escreve o diário de bordo de um dia de trabalho de uma pessoa desenvolvedora, a partir das sessões que ela teve com agentes de IA de programação (como o Claude Code ou o Codex).', PT, MD,
            'Estrutura curta: "## Hoje" (o que foi feito, agrupado por projeto, em tópicos), "## Entregas" (commits relevantes, se houver), "## Pendências" (o que ficou aberto) e, se os totais constarem, "## Uso" (uma linha com tempo e custo).',
            'Use SOMENTE os dados fornecidos: não invente trabalho, arquivos nem resultados. O que não consta nos dados fica de fora. Escreva em primeira pessoa, em tom de nota pessoal.'].join('\n'),
          user: parts.filter((x, n) => x !== '' || n > 1).join('\n'),
        };
      },
      clean: tidy,
    },

    aimonPr: {
      label: 'Descrição de PR', maxTokens: 800,
      build(i) {
        const commits = arr(i.commits).slice(0, 30);
        if (!i.plan && !commits.length && !arr(i.files).length) throw new Error('A sessão ainda não tem plano, commits nem alterações para descrever');
        const parts = [];
        if (i.title) parts.push(`Sessão: ${safe(i.title, 160)}`);
        if (i.branch) parts.push(`Branch: ${safe(i.branch, 80)}${i.base ? ` → ${safe(i.base, 40)}` : ''}`);
        if (i.goal) parts.push('', 'Pedido original:', safe(i.goal, 600));
        if (i.plan) parts.push('', 'Plano aprovado:', safe(i.plan, 2500));
        if (commits.length) parts.push('', 'Commits:', ...commits.map((c) => `- ${String(c.hash || '').slice(0, 7)} ${safe(c.subject || c.summary || '', 140)}`));
        const files = arr(i.files).slice(0, 40);
        if (files.length) parts.push('', 'Arquivos tocados:', ...files.map((f) => `- ${safe(f, 200)}`));
        return {
          system: ['Você escreve a descrição de um pull request a partir do plano aprovado e dos commits de uma sessão de trabalho com um agente de IA.', PT, MD,
            'Seções curtas: "## O que muda" (tópicos objetivos), "## Por quê" (uma ou duas frases, a partir do pedido e do plano), "## Como testar" (passos que decorram do que foi feito; se não der para saber, diga que falta confirmar) e "## Pontos de atenção" (riscos ou decisões; omita se não houver).',
            'Use SOMENTE os dados fornecidos: não invente testes executados, resultados nem arquivos. NÃO inclua linhas de atribuição a IA (como "Generated with…" ou "Co-Authored-By") nem menção de que um agente escreveu o código.'].join('\n'),
          user: parts.join('\n'),
        };
      },
      clean: tidy,
    },

    aimonPatterns: {
      label: 'Padrões dos meus pedidos', maxTokens: 900,
      build(i) {
        const sessions = arr(i.sessions).slice(0, 25);
        if (sessions.length < 3) throw new Error('Há poucas sessões para achar padrões (são necessárias pelo menos 3)');
        const plans = arr(i.plans).slice(0, 20);
        const parts = ['Sessões recentes (primeiro pedido e sinais de retrabalho):'];
        sessions.forEach((s, n) => parts.push(`${n + 1}. [${safe(s.provider, 12)}] "${safe(s.prompt, 300)}" — turnos: ${Number(s.turns) || 0}, correções da pessoa: ${Number(s.corrections) || 0}, falhas de ferramenta: ${Number(s.toolErrors) || 0}, commits: ${Number(s.commits) || 0}`));
        if (plans.length) {
          parts.push('', 'Planos recentes:');
          for (const p of plans) parts.push(`- ${p.status === 'rejected' ? 'RECUSADO' : 'aprovado'}: ${safe(p.title, 140)}${p.reason ? ` — motivo: ${safe(p.reason, 240)}` : ''}`);
        }
        return {
          system: ['Você analisa como uma pessoa desenvolvedora escreve pedidos para agentes de IA de programação e o que leva a retrabalho.', PT, MD,
            'Compare os pedidos de sessões com muitas correções, muitos turnos, falhas de ferramenta ou planos recusados com os de sessões que correram bem.',
            'Entregue: "## O que se repete" (2 a 4 padrões, citando trechos dos pedidos) e "## Como pedir melhor" (3 a 5 dicas práticas, cada uma com um exemplo de reescrita curto).',
            'Use SOMENTE os dados fornecidos; se a amostra for pequena demais para concluir algo, diga isso em vez de inventar. Não critique a pessoa: foque no texto dos pedidos.'].join('\n'),
          user: parts.join('\n'),
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
