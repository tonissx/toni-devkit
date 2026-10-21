'use strict';
/** Diagramas iniciais (Mermaid). JS puro: usado pela tela Diagramas e pelos comandos da palette. */

const TEMPLATES = [
  {
    id: 'er',
    label: 'Diagrama ER',
    icon: 'database',
    title: 'Novo diagrama ER',
    code: `erDiagram
  CLIENTE ||--o{ PEDIDO : faz
  PEDIDO ||--|{ ITEM_PEDIDO : contem
  PRODUTO ||--o{ ITEM_PEDIDO : "vendido em"

  CLIENTE {
    int id PK
    string nome
    string email UK
  }
  PEDIDO {
    int id PK
    int cliente_id FK
    date criado_em
  }
  PRODUTO {
    int id PK
    string descricao
    decimal preco
  }
  ITEM_PEDIDO {
    int pedido_id FK
    int produto_id FK
    int quantidade
  }
`,
  },
  {
    id: 'flow',
    label: 'Fluxo (workflow)',
    icon: 'workflow',
    title: 'Novo fluxo',
    code: `flowchart TD
  A([Início]) --> B[Solicitação criada]
  B --> C{Aprovada?}
  C -- Sim --> D[Executar]
  C -- Não --> E[Devolver ao solicitante]
  E --> B
  D --> F([Fim])
`,
  },
  {
    id: 'sequence',
    label: 'Sequência',
    icon: 'messages-square',
    title: 'Nova sequência',
    code: `sequenceDiagram
  participant U as Usuário
  participant A as App
  participant B as Banco
  U->>A: Salvar nota
  A->>B: INSERT
  B-->>A: ok
  A-->>U: Salvo
`,
  },
  {
    id: 'state',
    label: 'Estados',
    icon: 'git-fork',
    title: 'Novos estados',
    code: `stateDiagram-v2
  [*] --> Rascunho
  Rascunho --> EmAprovacao : enviar
  EmAprovacao --> Aprovado : aprovar
  EmAprovacao --> Rascunho : devolver
  Aprovado --> [*]
`,
  },
];

const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

/** Campos para criar a nota de um template: { title, content, type }. */
const fromTemplate = (id) => {
  const t = templateById(id);
  return { title: t.title, content: t.code, type: 'diagram', tags: [] };
};

/** Tipo do diagrama pela primeira linha de código ("erDiagram", "flowchart", …) — '' se não reconhecer. */
function diagramKind(code) {
  const first = String(code || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) || '';
  const m = first.match(/^(erDiagram|flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|gantt|pie|journey|mindmap|timeline|gitGraph)\b/);
  return m ? m[1] : '';
}

module.exports = { TEMPLATES, templateById, fromTemplate, diagramKind };
