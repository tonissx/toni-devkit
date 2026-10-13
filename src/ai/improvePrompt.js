// IA — "gerar prompt de melhoria": transforma uma resposta da IA do Devkit num prompt pronto para colar em outro
// assistente (Claude Code, Copilot, ChatGPT…) que aplique de fato o que foi sugerido. Sem chamar a IA de novo: é
// montado aqui, com o pedido original (que já saiu filtrado de segredos) e a resposta.
// buildImprovePrompt({ label, task, request, answer }) → string

const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n) + '\n… (cortado)' : t; };

/** Papel e cuidados por família de tarefa; o resto cai no genérico. */
const FAMILIES = [
  [/^db/, { role: 'engenheiro de dados / DBA de SQL Server', care: [
    'Mostre o T-SQL final (consulta reescrita, CREATE INDEX, UPDATE STATISTICS…) pronto para executar, separado do que é só explicação.',
    'Antes de criar um índice, confira se já existe um parecido (sobreposto) e o custo nas gravações; prefira ajustar o existente.',
    'Se a correção for no código da aplicação (tipo do parâmetro, ORM, filtro), aponte o arquivo e a linha e mostre o diff.',
    'Diga como validar o ganho (plano de execução antes/depois, leituras lógicas, tempo) e não rode nada destrutivo em produção.'] }],
  [/^sql/, { role: 'engenheiro de dados', care: ['Entregue o SQL final pronto para executar e diga se muda o resultado.', 'Preserve o comportamento, a menos que eu peça o contrário.'] }],
  [/^(commit|branch|pr|explainCommit|conflict)/, { role: 'desenvolvedor sênior que cuida do Git', care: ['Entregue o texto/comando final pronto para usar.', 'Não reescreva histórico compartilhado sem avisar.'] }],
  [/^(json|diff|log)/, { role: 'desenvolvedor sênior', care: ['Mostre as mudanças como diff, arquivo por arquivo.', 'Aponte como reproduzir o problema e como confirmar que foi resolvido.'] }],
];

function buildImprovePrompt({ label = 'Resposta da IA', task = '', request = '', answer = '' } = {}) {
  const ans = String(answer || '').trim();
  if (!ans) throw new Error('Sem resposta para transformar em prompt');
  const fam = (FAMILIES.find(([re]) => re.test(String(task))) || [null, { role: 'desenvolvedor sênior', care: ['Mostre as mudanças como diff, arquivo por arquivo.', 'Explique como validar que funcionou.'] }])[1];
  const lines = [
    `Você é um ${fam.role}. Abaixo está uma análise feita por uma IA (${label}). Aplique as melhorias que ela sugere.`,
    '',
    '## O que foi analisado',
    clip(request, 7000) || '(sem o pedido original)',
    '',
    '## Resposta da IA (ponto de partida — verifique antes de confiar)',
    clip(ans, 9000),
    '',
    '## O que fazer',
    '1. Releia a análise com senso crítico: confirme cada afirmação nos dados acima e descarte o que não se sustentar. Não invente tabelas, colunas, arquivos ou métricas que não aparecem aqui.',
    '2. Liste as melhorias em ordem de ganho esperado, cada uma com o motivo em uma frase.',
    '3. Aplique-as, uma de cada vez, na ordem da lista.',
    ...fam.care.map((c, i) => `${4 + i}. ${c}`),
    `${4 + fam.care.length}. Se faltar informação para decidir (ex.: o código que gera a consulta, o esquema), pergunte antes de supor.`,
    '',
    '## Entrega',
    'Resuma o que mudou, o risco de cada mudança e como desfazer.',
  ];
  return lines.join('\n');
}

module.exports = { buildImprovePrompt };
