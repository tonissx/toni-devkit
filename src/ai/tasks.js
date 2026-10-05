'use strict';
/**
 * IA — tarefas registradas. Cada tarefa monta o pedido (system + user) a partir da entrada da tela, limpa a resposta e,
 * quando a tela precisa de algo estruturado, a interpreta (parse). JS puro (testado em scripts/test-ai.mjs).
 * O serviço (electron/ai/service.js) só envia o que sai daqui, e a tela mostra exatamente este texto antes.
 * Regra fixa: nada do Vault entra aqui — as telas mandam só o texto que a pessoa vê (referências, nunca segredos).
 */
const { prepareDiff, commitMessagePrompt, cleanCommitMessage } = require('./prompts.js');

const PT = 'Responda em português do Brasil.';
const MD = 'Use markdown simples (títulos curtos, listas, `código`). Seja direto: nada de introdução nem de despedida.';

/** Corta um texto no teto, anotando o corte (nada some em silêncio). */
function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} caracteres cortados: limite de tamanho)\n` : s;
}

const tidy = (t) => String(t || '').replace(/\r\n/g, '\n').trim();

/** Último bloco cercado (```), ou null. */
function lastFence(text) {
  const re = /```[\w+#.-]*\n([\s\S]*?)```/g;
  let m; let last = null;
  while ((m = re.exec(text))) last = m[1].replace(/\n$/, '');
  return last;
}

/** Nome de branch aceito pelo git (subconjunto seguro de check-ref-format). */
const validBranch = (s) => typeof s === 'string' && s.length > 0 && s.length <= 100
  && /^[\w.\-/]+$/.test(s) && !/(^[-/.]|[/.]$|\.\.|\/\/|@\{|\.lock$|\/\.)/.test(s);

/** Texto qualquer → nome de branch (minúsculas, sem acento, hífens). */
function slugBranch(s) {
  const t = String(s || '').trim().replace(/^[`'"•*\-\d.)\s]+/, '').replace(/[`'"]+$/, '').trim();
  if (!t) return '';
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split('/').map((p) => p.replace(/[^\w.-]+/g, '-').replace(/_/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')).filter(Boolean).join('/')
    .slice(0, 60).replace(/[-./]+$/, '');
}

/** Prefixos usados nas branches do repositório (feat/, fix/…), os mais comuns primeiro. */
function branchPrefixes(names = []) {
  const n = {};
  for (const b of names) { const m = /^([\w-]+)\//.exec(b); if (m) n[m[1]] = (n[m[1]] || 0) + 1; }
  return Object.keys(n).sort((a, b) => n[b] - n[a]).slice(0, 6);
}

/** JSON dentro de uma resposta (com ou sem cerca). */
function looseJson(text) {
  const t = lastFence(text) || text;
  const i = t.indexOf('{'); const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u;

/** [[cmd:id]] na resposta → ids (na ordem, sem repetir). */
const cmdRefs = (text) => [...new Set([...String(text).matchAll(/\[\[cmd:([\w:.\-/]+)\]\]/g)].map((m) => m[1]))];
/** [[Título]] na resposta → títulos citados. */
const noteRefs = (text) => [...new Set([...String(text).matchAll(/\[\[(?!cmd:)([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()))];

const TASKS = {
  /* ───────── Git ───────── */
  commitMessage: {
    label: 'Mensagem de commit', maxTokens: 300,
    build(i) {
      const d = prepareDiff(i.diff);
      if (!d.files.length) throw new Error('Nada preparado para o commit');
      return { ...commitMessagePrompt({ diff: d.text, recent: i.recent, branch: i.branch }), files: d.files, omitted: d.omitted, truncated: d.truncated };
    },
    clean: cleanCommitMessage,
  },

  explainCommit: {
    label: 'Explicar commit', maxTokens: 900,
    build(i) {
      const d = prepareDiff(i.patch, { maxChars: 14000 });
      return {
        system: ['Você explica commits do git para uma pessoa desenvolvedora que não conhece este código.', PT, MD,
          'Estrutura: **O que mudou** (2 a 5 tópicos), **Por quê** (o objetivo provável; diga "provavelmente" quando inferir), **Atenção** (riscos, efeitos colaterais, o que testar — omita se não houver).',
          'Não repita o diff linha a linha. Não invente nada que não esteja na mensagem ou no diff.'].join('\n'),
        user: `Mensagem do commit:\n${clip(i.message, 2000)}\n\nDiff:\n${d.text || '(sem diff de texto)'}`,
        files: d.files, omitted: d.omitted, truncated: d.truncated,
      };
    },
    clean: tidy,
  },

  conflictHelp: {
    label: 'Combinar conflito', maxTokens: 1500, cloudHint: true,
    build(i) {
      const side = (name, lines) => `${name}:\n\`\`\`\n${clip((lines || []).join('\n'), 3000)}\n\`\`\``;
      return {
        system: ['Você ajuda a resolver conflitos de merge do git.', PT,
          'Primeiro explique em 1 a 3 frases o que cada lado queria fazer. Depois escreva a versão final combinada do trecho, preservando a intenção dos dois lados quando possível, num único bloco de código cercado por ```.',
          'O bloco final deve conter só o código que substitui o trecho em conflito — sem marcadores <<<<<<< ======= >>>>>>> e sem o contexto em volta.'].join('\n'),
        user: [i.path ? `Arquivo: ${i.path}` : null,
          i.before && i.before.length ? side('Contexto antes do trecho', i.before) : null,
          side(`Lado 1 — ${i.labels && i.labels.ours || 'meu'}`, i.ours),
          i.base ? side('Como era antes dos dois (base)', i.base) : null,
          side(`Lado 2 — ${i.labels && i.labels.theirs || 'deles'}`, i.theirs),
          i.after && i.after.length ? side('Contexto depois do trecho', i.after) : null,
          'Explique e escreva a versão combinada.'].filter(Boolean).join('\n\n'),
      };
    },
    clean: tidy,
    parse(text) {
      const all = [...String(text).matchAll(/```[\w+#.-]*\n([\s\S]*?)```/g)];
      const last = all[all.length - 1];
      if (!last) return { explanation: tidy(text), code: null };
      const code = last[1].replace(/\n$/, '');
      return { explanation: tidy(text.slice(0, last.index)), code: /^(<{7}|={7}|>{7})/m.test(code) ? null : code };
    },
  },

  branchName: {
    label: 'Nome de branch', maxTokens: 120,
    build(i) {
      if (!String(i.description || '').trim()) throw new Error('Descreva a tarefa primeiro');
      const pre = branchPrefixes(i.existing);
      return {
        system: ['Você sugere nomes de branch do git.', 'Responda SOMENTE com 3 nomes, um por linha, sem numeração nem comentários.',
          'Formato: prefixo/descricao-curta-com-hifens, minúsculas, sem acentos, até 40 caracteres.',
          pre.length ? `Use um destes prefixos, que o repositório já usa: ${pre.map((p) => p + '/').join(' ')}` : 'Prefixos: feat/ (novidade), fix/ (correção), chore/ (manutenção), docs/ (documentação), refactor/.',
          'Mantenha o idioma da descrição.'].join('\n'),
        user: `Tarefa: ${clip(i.description, 500)}`,
      };
    },
    clean: tidy,
    parse(text, input = {}) {
      const taken = new Set(input.existing || []);
      return [...new Set(tidy(text).split('\n').map(slugBranch))].filter((b) => validBranch(b) && !taken.has(b)).slice(0, 3);
    },
  },

  prSummary: {
    label: 'Resumo para PR', maxTokens: 1500, cloudHint: true,
    build(i) {
      const d = prepareDiff(i.patch, { maxChars: 20000, perFile: 3000 });
      return {
        system: ['Você escreve pull requests.', PT,
          'Formato exato: a primeira linha é "TÍTULO: " seguido de um título curto (até 70 caracteres). Depois uma linha em branco e a descrição em markdown com as seções "## O que muda" (tópicos agrupados por assunto, não por arquivo) e "## Como testar" (passos curtos).',
          'Siga o idioma e o estilo dos commits. Não invente nada que não esteja nos commits ou no diff.'].join('\n'),
        user: `Branch ${i.head} → ${i.base}\n\nCommits (${(i.commits || []).length}):\n${(i.commits || []).slice(0, 60).map((s) => '- ' + s).join('\n')}\n\nDiff resumido:\n${d.text}`,
        files: d.files, omitted: d.omitted, truncated: d.truncated,
      };
    },
    clean: tidy,
    parse(text) {
      const t = tidy(text);
      const m = /^\s*(?:#+\s*)?(?:\*\*)?T[ÍI]TULO(?:\*\*)?\s*:\s*(.+)$/im.exec(t);
      if (!m) { const [first, ...rest] = t.split('\n'); return { title: first.replace(/^#+\s*/, '').trim(), body: rest.join('\n').trim() }; }
      return { title: m[1].replace(/\*\*/g, '').trim(), body: t.slice(m.index + m[0].length).trim() };
    },
  },

  /* ───────── SQL, JSON, Diff ───────── */
  sqlExplain: {
    label: 'Explicar consulta', maxTokens: 900,
    build(i) {
      if (!String(i.sql || '').trim()) throw new Error('Nada para explicar');
      return {
        system: ['Você explica consultas SQL para quem vai mantê-las.', PT, MD,
          'Estrutura: **Em uma frase** (o que a consulta devolve ou altera), **Passo a passo** (tabelas, junções, filtros, agrupamentos, ordenação), **Atenção** (desempenho e riscos — omita se não houver).'].join('\n'),
        user: [`SQL:\n\`\`\`sql\n${clip(i.sql, 12000)}\n\`\`\``, i.risks && i.risks.length ? `Avisos já detectados pelo Devkit (comente se relevantes):\n${i.risks.map((r) => '- ' + r).join('\n')}` : null].filter(Boolean).join('\n\n'),
      };
    },
    clean: tidy,
  },

  sqlFromText: {
    label: 'Escrever SQL', maxTokens: 900, cloudHint: true,
    build(i) {
      if (!String(i.description || '').trim()) throw new Error('Descreva a consulta primeiro');
      return {
        system: ['Você escreve consultas SQL.', 'Responda SOMENTE com a consulta, num bloco ```sql, sem explicações.',
          'Use apenas as tabelas e colunas do esquema, quando ele for informado; se faltar algo, use nomes plausíveis e deixe um comentário -- no SQL dizendo o que confirmar.',
          i.dialect ? `Dialeto: ${i.dialect}.` : 'SQL padrão (ANSI), compatível com SQL Server, PostgreSQL e MySQL quando possível.'].join('\n'),
        user: [String(i.schema || '').trim() ? `Esquema:\n${clip(i.schema, 8000)}` : null, `Pedido: ${clip(i.description, 1500)}`].filter(Boolean).join('\n\n'),
      };
    },
    clean: tidy,
    parse: (text) => tidy(lastFence(text) != null ? lastFence(text) : text.replace(/^sql\s*\n/i, '')),
  },

  jsonNames: {
    label: 'Melhorar nomes', maxTokens: 1500,
    build(i) {
      return {
        system: ['Você melhora os nomes de tipos gerados automaticamente a partir de um JSON.', 'Responda SOMENTE com o código completo, num único bloco cercado por ```.',
          'Troque só os nomes de tipos genéricos (Root, Item, Item2, Root*…) por nomes que descrevam o conteúdo, em PascalCase e no idioma das propriedades. Não altere propriedades, tipos de campo nem a estrutura.'].join('\n'),
        user: `Linguagem: ${i.lang}\n\n\`\`\`\n${clip(i.code, 12000)}\n\`\`\`\n\nExemplo do JSON original (início):\n${clip(i.sample, 1500)}`,
      };
    },
    clean: tidy,
    parse: (text) => lastFence(text),
  },

  jsonError: {
    label: 'Explicar o erro', maxTokens: 500,
    build(i) {
      return {
        system: ['Você explica erros de sintaxe em JSON.', PT, 'Em até 4 frases: o que está errado e como corrigir, citando a linha. Se ajudar, mostre o trecho corrigido num bloco ```json curto.'].join('\n'),
        user: `Erro do parser: ${i.error} (linha ${i.line}, coluna ${i.col})\n\nTrecho (com números de linha):\n${clip(i.excerpt, 3000)}`,
      };
    },
    clean: tidy,
  },

  diffSummary: {
    label: 'Resumir diferenças', maxTokens: 900,
    build(i) {
      return {
        system: ['Você resume as diferenças entre duas versões de um texto (configuração, código, contrato, resposta de API…).', PT, MD,
          'Agrupe por assunto: o que foi adicionado, removido e alterado — com os valores quando forem curtos. Termine com **Atenção** se alguma mudança parecer arriscada (omita se não).'].join('\n'),
        user: `Original: ${i.leftName || 'Original'} · Alterado: ${i.rightName || 'Alterado'}\n\nDiferenças (formato diff unificado):\n${clip(i.patch, 14000)}`,
      };
    },
    clean: tidy,
  },

  /* ───────── Notes ───────── */
  noteMeta: {
    label: 'Título e tags', maxTokens: 200,
    build(i) {
      return {
        system: ['Você sugere título e tags para uma nota.', 'Responda SOMENTE com JSON: {"title": "…", "tags": ["…"]}.',
          'Título: até 60 caracteres, no idioma da nota. Tags: até 5, minúsculas, uma palavra cada (pode usar hífen), sem #.',
          'Prefira tags que já existem quando servirem.'].join('\n'),
        user: [i.existingTags && i.existingTags.length ? `Tags que já existem: ${i.existingTags.slice(0, 80).join(', ')}` : null,
          i.title ? `Título atual: ${i.title}` : null, `Nota:\n${clip(i.content, 6000)}`].filter(Boolean).join('\n\n'),
      };
    },
    clean: tidy,
    parse(text, input = {}) {
      const o = looseJson(text) || {};
      const has = new Set((input.tags || []).map((t) => t.toLowerCase()));
      const tags = [...new Set((Array.isArray(o.tags) ? o.tags : []).map((t) => String(t).toLowerCase().replace(/^#/, '').trim().replace(/\s+/g, '-')))]
        .filter((t) => TAG_RE.test(t) && !has.has(t)).slice(0, 5);
      const title = typeof o.title === 'string' ? o.title.replace(/^["'#\s]+|["'\s]+$/g, '').slice(0, 80) : '';
      return { title, tags };
    },
  },

  noteSummary: {
    label: 'Resumir nota', maxTokens: 600,
    build(i) {
      return {
        system: ['Você resume notas de trabalho.', 'Responda no idioma da nota.', 'Até 5 tópicos curtos com o essencial (decisões, números, próximos passos). Só a lista, sem título.'].join('\n'),
        user: `${i.title ? `Título: ${i.title}\n\n` : ''}${clip(i.content, 12000)}`,
      };
    },
    clean: tidy,
  },

  noteChecklist: {
    label: 'Transformar em checklist', maxTokens: 800,
    build(i) {
      return {
        system: ['Você transforma texto em uma lista de tarefas.', 'Responda SOMENTE com as linhas no formato "- [ ] tarefa", uma ação concreta por linha, no idioma do texto. Mantenha "- [x]" para o que o texto diz que já foi feito.'].join('\n'),
        user: clip(i.text, 8000),
      };
    },
    clean: tidy,
    parse(text) {
      return tidy(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = /^(?:[-*+]|\d+[.)])?\s*(\[[ xX]\])?\s*(.+)$/.exec(l);
        if (!m) return null;
        return `- [${m[1] && /x/i.test(m[1]) ? 'x' : ' '}] ${m[2].replace(/^\[[ xX]\]\s*/, '')}`;
      }).filter(Boolean).join('\n');
    },
  },

  notesAsk: {
    label: 'Perguntar às notas', maxTokens: 900, cloudHint: true,
    build(i) {
      const notes = (i.notes || []).slice(0, 6);
      if (!notes.length) throw new Error('Nenhuma nota encontrada para essa pergunta');
      return {
        system: ['Você responde perguntas usando SOMENTE as notas fornecidas.', PT, MD,
          'Cite as notas usadas no formato [[Título exato]]. Se as notas não respondem, diga isso em uma frase — não invente.'].join('\n'),
        user: `${notes.map((n, k) => `--- Nota ${k + 1}: ${n.title}\n${clip(n.excerpt, 1500)}`).join('\n\n')}\n\nPergunta: ${clip(i.question, 1000)}`,
      };
    },
    clean: tidy,
    parse: (text) => ({ refs: noteRefs(text) }),
  },

  /* ───────── Palette ───────── */
  paletteAsk: {
    label: 'Pergunta', maxTokens: 600,
    build(i) {
      return {
        system: ['Você é o assistente do Toni Devkit, um app de ferramentas para devs (SQL, XML, JSON, Diff, Git, Notes, Vault).', PT,
          'Responda em no máximo 6 linhas, com comandos em `código` quando for o caso.',
          'Se uma ação do Devkit ajudar, cite até 3 no formato [[cmd:id]] usando SOMENTE ids da lista abaixo.',
          `Ações do Devkit (id — nome):\n${(i.commands || []).slice(0, 150).map((c) => `${c.id} — ${c.name}`).join('\n')}`].join('\n'),
        user: clip(i.question, 1500),
      };
    },
    clean: tidy,
    parse(text, input = {}) {
      const ids = new Set((input.commands || []).map((c) => c.id));
      return { cmds: cmdRefs(text).filter((id) => ids.has(id)).slice(0, 3) };
    },
  },

  clipExplain: {
    label: 'Explicar', maxTokens: 900,
    build(i) {
      if (!String(i.text || '').trim()) throw new Error('A área de transferência está vazia');
      const what = { sql: 'uma consulta SQL', json: 'um JSON', xml: 'um XML', error: 'uma mensagem de erro / stack trace', code: 'um trecho de código' }[i.kind] || 'um texto';
      return {
        system: ['Você explica, para uma pessoa desenvolvedora, o que foi copiado para a área de transferência.', PT, MD,
          i.kind === 'error' ? 'Diga a causa provável e como resolver, em passos.' : 'Diga o que é e o que faz, e aponte problemas se houver.'].join('\n'),
        user: `Conteúdo (${what}):\n\`\`\`\n${clip(i.text, 10000)}\n\`\`\``,
      };
    },
    clean: tidy,
  },
};

/** O que o texto da área de transferência parece ser. */
function sniffKind(text) {
  const t = String(text || '').trim();
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* segue */ } }
  if (/^<(\?xml|[\w:-]+[\s>])/.test(t)) return 'xml';
  if (/^\s*(with|select|insert|update|delete|create|alter|merge)\b/i.test(t)) return 'sql';
  if (/(Exception|Error)\b[\s\S]*\n\s+at\s|Traceback \(most recent call last\)|^\w*(Error|Exception):/m.test(t)) return 'error';
  if (/[;{}]\s*$|^\s*(function|const|let|var|class|def|import|public|private)\b/m.test(t)) return 'code';
  return 'text';
}

module.exports = { TASKS, clip, lastFence, validBranch, slugBranch, branchPrefixes, looseJson, cmdRefs, noteRefs, sniffKind };
