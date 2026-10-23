# Automações (estilo n8n) no Toni Devkit — desenho e plano

> Documento para uma sessão nova, sem o contexto da conversa. Lê-se de cima para baixo: por quê, o que já existe, o que construir, em que ordem.
> Branch de partida: `worktree-agentes-builder` (fases 1 e 2 dos Agentes). Idioma da interface e dos comentários: português do Brasil.

## 1. Por que

O Antonio quer uma ferramenta **"automatize qualquer coisa"**, no estilo n8n/Zapier, dentro do devkit. A ideia central, decidida por ele:

> **Pipeline de passos fixos e confiáveis; agentes de IA só em partes específicas.**

Motivo: "qualquer coisa" feita só por um agente com shell é frágil (erra, custa a cada execução), precisa de senhas e é perigosa sem supervisão. Os passos fixos (consultar banco, rodar git, chamar webhook, mandar mensagem) são determinísticos, baratos e auditáveis. A IA entra onde há julgamento: resumir, classificar, decidir, redigir.

Exemplo-guia (dele, ainda a validar): *"Todo dia às 8h: consultar no RM os pedidos pendentes → agente resume o que está atrasado → posta no Google Chat."*

## 2. O que já existe (fases 1 e 2 dos Agentes, branch `worktree-agentes-builder`)

App: Electron 44, renderer React 18 (JSX) empacotado com esbuild (`scripts/build-renderer.mjs`), testes com `node --test` (`scripts/test-*.mjs`, registrados no script `test` do `package.json`).

| Peça | Onde | Observação |
|---|---|---|
| Registro de ferramenta | `src/tools/meta.js` (`TOOL_META`), `src/tools/registry.js` (`COMPONENTS`) | A ferramenta aparece sozinha na sidebar, no Início e na command palette |
| Agentes (CRUD de `~/.claude/agents/*.md`) | `electron/agents/store.js`, `src/tools/agents/AgentsScreen.jsx` | Frontmatter name/description/tools/model; chaves extras preservadas |
| Permissões | `src/tools/agents/agentForm.js` (`permissions`, `runPolicy`, `RUN_MODES`) | Puro, usado pelo Electron e pelo renderer |
| Recorrência | `src/tools/agents/recurrence.js` (`cleanRecurrence`, `nextRun`, `describeRecurrence`) | diário, dias úteis, dias da semana, intervalo (mín. 5 min) |
| **Motor de rotinas** | `electron/agents/schedule.js` (`createScheduler`) | tick de 30 s; `spawn` e relógio injetáveis; histórico (200); "perdida" se atrasou > 10 min; máx. 2 em paralelo; timeout 30 min; grava a execução ao começar |
| UI das rotinas | `src/tools/agents/RoutinesPanel.jsx`, `renderer/agents.css` | Lista, modal de edição, histórico, modal da execução |
| IPC | `electron/main.js` (bloco "Agentes"), `electron/preload.js` (`window.devkit.agents`) | Evento `agents:changed`; aviso do sistema ao terminar |
| Execução headless validada | `claude -p --agent <nome> --output-format json --permission-mode dontAsk\|acceptEdits --allowedTools a,b --max-budget-usd N --session-id <uuid>`, prompt pela **entrada padrão**, `spawn` sem shell | Testado de verdade (Haiku, US$ 0,0013). Resposta JSON: `result`, `total_cost_usd`, `num_turns`, `session_id`, `is_error`, `subtype` |
| Persistência | `electron/lib/fsx.js` (`atomicWrite`, `createQueue`); JSON em `app.getPath('userData')` | Ex.: `agents-schedule.json` |
| Monitor de IA | `electron/aimon/*`, `src/tools/aimon/*` | Lê `~/.claude/projects/**.jsonl`; sessão do `claude -p` aparece com chave `claude:<sessionId>`; navegação: `window.devkit.app.command({type:'go', route:'aimon', params:{sel}})` |

**A verificar na sessão nova** (não li o código): o serviço da ferramenta **Banco** (`electron/db/`, `dbSvc` em `main.js`, `scripts/test-db-service.mjs`), o **Vault** (`electron/vault*`, `scripts/test-vault.mjs`, API `window.devkit.vault`), o Git (`electron/git/`, `src/git/parse.js`) e o `electron/ai/service.js`. São candidatos a conectores; reaproveite, não reimplemente.

## 3. Objetivos

1. **Editor de automações**: uma automação = **gatilho + passos em sequência**; cada passo recebe o que os anteriores produziram.
2. **Conectores determinísticos** executados pelo próprio devkit (v1 abaixo), com tipagem de entrada/saída e prévia do que fazem.
3. **Passo "Agente"**: reaproveita os agentes da fase 1 (e `runPolicy`); recebe texto montado a partir dos passos anteriores; por padrão **só lê**.
4. **Segredos fora dos passos e dos agentes**: referência ao Vault (`{{secret:nome}}`), resolvida só no momento da execução e nunca gravada no histórico.
5. **Histórico por passo**: entrada, saída (truncada e mascarada), duração, custo, erro. Tela de execução mostra a linha do tempo dos passos.
6. **Migrar as Rotinas atuais** para automações sem perder dados (rotina = gatilho de horário + 1 passo Agente).

## 4. Não objetivos (por enquanto)

- Rodar com o devkit fechado / Agendador do Windows (decisão dele: só com o app aberto).
- Editor visual de canvas com ramificações e laços (v1 é lista linear; canvas só depois de a linear provar valor).
- Marketplace ou centenas de conectores. v1 tem poucos e bons.
- Agente que conversa pelo Google Chat (exigiria servidor público). Só **enviar** mensagens.
- Controlar navegador / usar o computador (frágil e perigoso em segundo plano).

## 5. Anti-objetivos (falha mesmo que "funcione")

- Um passo que **escreve ou executa comandos** sem estar marcado como tal e sem o usuário ter aprovado ao criar a automação.
- **Segredo** (senha de banco, URL de webhook) aparecendo em histórico, log, prompt de agente ou arquivo.
- Automação que repete efeitos colaterais ao reexecutar sem aviso (ex.: reenviar a mesma mensagem 10 vezes depois de uma falha).
- Gasto de IA sem teto.

## 6. Modelo de dados (proposta; a sessão nova pode refinar)

```jsonc
{
  "id": "uuid",
  "name": "Pedidos atrasados do RM",
  "enabled": true,
  "trigger": { "type": "schedule", "recurrence": { "kind": "weekdays", "time": "08:00" } },   // ou { "type": "manual" }
  "steps": [
    { "id": "s1", "type": "sql",   "name": "Pedidos pendentes", "config": { "connection": "rm-leitura", "query": "SELECT ...", "maxRows": 200 } },
    { "id": "s2", "type": "agent", "name": "Resumo", "config": { "agent": "analista-rm", "prompt": "Resuma o que está atrasado:\n{{s1.text}}", "maxBudgetUsd": 0.5 } },
    { "id": "s3", "type": "chat",  "name": "Avisar no Chat", "config": { "webhook": "{{secret:chat-compras}}", "text": "{{s2.text}}" } }
  ],
  "onError": "stop",          // v1: stop | continue (por passo, depois)
  "createdAt": 0, "updatedAt": 0
}
```

- **Saída de todo passo** tem a mesma forma mínima: `{ text: string, data?: any, ok: boolean }`. `text` é o que se injeta em prompts; `data` é estruturado (linhas do SQL, JSON da resposta). Referências: `{{s1.text}}`, `{{s1.data.rows[0].pedido}}` (caminho simples, sem executar código), `{{trigger.time}}`, `{{secret:nome}}`.
- **Templating sem `eval`**: só substituição de caminhos. Se faltar valor, o passo falha com mensagem clara (não manda "undefined" para o Chat).
- Persistência em `userData/automations.json` (+ histórico em arquivo separado, limitado), via `atomicWrite`/`createQueue`.

## 7. Conectores da v1 (ordem sugerida)

| Passo | O que faz | Segurança |
|---|---|---|
| **Agente** | `claude -p --agent` (reusa `schedule.js`/`runPolicy`) | por padrão só lê; teto de custo e de tempo; sem acesso a segredos |
| **SQL (somente leitura)** | consulta ao SQL Server pela conexão do **Banco**/Vault | exigir login só de leitura; recusar mais de uma instrução e comandos de escrita como defesa extra (a defesa real é o login); limite de linhas; timeout |
| **Git (somente leitura)** | `log`, `diff`, `status`, `show` num repositório | lista fechada de subcomandos, sem shell, argumentos validados |
| **Google Chat (webhook)** | POST de texto no espaço | URL no Vault; limite de tamanho; sem reenvio automático em falha |
| **HTTP** | GET/POST genéricos | URL permitida lista/aviso; cabeçalhos com `{{secret:}}`; limite de resposta |
| **Arquivo** | ler / escrever texto | pasta base declarada; escrever = passo marcado como "altera arquivos" |
| **Aviso do sistema** | `Notification` (já usada) | — |
| **Condição / transformar** | "só continuar se houver linhas", cortar texto, montar texto | sem código livre |

Fica para depois: **Comando livre** (shell) com lista de comandos permitidos e confirmação a cada alteração da automação; e-mail; gatilhos por arquivo/commit.

## 8. Motor de execução

- Generalize `electron/agents/schedule.js`: o "tick" decide **quando**; um **runner de passos** decide **o quê**. Mantenha o que já foi aprendido e testado: `spawn`/relógio injetáveis, vaga de paralelismo contada **desde o início da execução** (bug real já corrigido), "perdida" em vez de rodar atrasado, execução gravada ao começar (recuperação de "devkit fechou no meio"), cancelamento.
- Cada passo roda isolado, com timeout, e devolve `{ok,text,data,error,costUsd,durationMs}`. Falha de passo → automação `error` (v1: sempre `stop`).
- **Idempotência**: passos com efeito externo (Chat, HTTP POST, arquivo) ficam marcados; "Rodar agora" e reexecução pedem confirmação quando o último resultado foi parcial.
- **Teste de passo**: o editor permite rodar um passo isolado com dados de exemplo (essencial para depurar SQL e prompts sem esperar o horário).

## 9. Segurança (resumo operacional)

1. Cada tipo de passo declara `risk: 'read' | 'write' | 'exec'`. A UI mostra o selo e um resumo em palavras do que a automação faz, antes de ligar o agendamento (mesmo padrão do `describePermissions`).
2. Segredos: guardar só `{{secret:nome}}`. Resolver no runner, usar e **mascarar** em qualquer saída/histórico/log.
3. Agente sempre sem segredos e (por padrão) sem escrita; o que ele "vê" é só o texto montado pelos passos.
4. Tetos: custo por passo de agente, tempo por passo, linhas do SQL, bytes de resposta, nº de execuções simultâneas.
5. Nada de `shell: true`; argumentos validados; prompt do agente pela entrada padrão.

## 10. Interface

- Nova ferramenta **"Automações"** (substitui a aba "Rotinas"; manter "Agentes" como está para criar/editar agentes). Registrar em `meta.js`/`registry.js`.
- **v1: editor em lista** — gatilho no topo, passos empilhados com setas de ordem, painel de configuração por tipo, chips para inserir `{{...}}` com autocompletar dos passos anteriores, botão "Testar este passo".
- Tela de **execução**: linha do tempo dos passos (status, duração, custo, saída colapsável), "Ver sessão no Monitor de IA" nos passos Agente.
- Reaproveitar `RoutinesPanel.jsx` (cartões, histórico, modal) e as classes `ag-*`; prefixo novo `au-*` para o que for específico.

## 11. Fases (cada uma entrega algo usável e vira uma PR)

1. **Base**: modelo, `automations.json`, runner de passos, gatilhos manual+horário, passos **Agente** e **Aviso**, histórico por passo, migração das Rotinas, UI em lista. *Critério:* tudo que as Rotinas faziam continua funcionando.
2. **Dados**: passos **SQL (leitura)** e **Git (leitura)**, templating com `data`, "Testar passo". *Critério:* o exemplo-guia roda até o resumo do agente.
3. **Saídas**: **Google Chat (webhook)**, **HTTP**, **Arquivo**, ligação com o **Vault** (`{{secret:}}` + máscara). *Critério:* exemplo-guia completo, sem segredo no histórico.
4. **Controle de fluxo e gatilhos**: condição, `onError` por passo, gatilho por arquivo/commit; avaliar canvas.
5. **Comando livre** com lista de permitidos e confirmação (só se ainda fizer falta).

## 12. Decisões em aberto (perguntar ao Antonio antes de fixar)

1. **Qual é a primeira automação real dele?** Define SQL (RM? Fluig? qual servidor?), formato do resultado e o destino (Chat?). Ele já foi perguntado e ainda não respondeu.
2. Ele tem um **login só de leitura** no SQL Server? Sem isso o passo SQL fica bloqueado para produção.
3. Webhook do Chat: **um único** ou **um por automação**? Avisar **sempre** ou **só em erro**?
4. Os dados do Banco/Vault: reaproveitar as conexões já cadastradas na ferramenta Banco? (verificar o formato guardado.)

## 13. Verificação

- Testes `node --test` por camada, no padrão de `scripts/test-agents-schedule.mjs`: templating (valor ausente, caminho inválido, injeção), cada conector com dependências injetadas (sem rede/banco reais), runner (falha no meio, cancelamento, timeout, paralelismo), migração das Rotinas, **máscara de segredos** (nenhum segredo no JSON do histórico).
- Execução real de ponta a ponta com custo mínimo: agente em Haiku, `--max-budget-usd 0.1` (já feito na fase 2 com `claude -p`; ver o script de fumaça descrito no commit `cc6e9c7`).
- Rodar o app isolado para não colidir com o devkit do usuário: `electron . --dev --user-data-dir=<pasta temporária>` com `DEVKIT_NOTES_DIR=<pasta temporária>`; em worktree, criar a junção `node_modules` para o checkout principal (a pasta é ignorada pelo git).
- Convenções do projeto: commits sem `-q`; descrição de PR **sem** "Generated with Claude Code"; `CLAUDE.md` na raiz tem as regras do projeto.

## 14. Primeira coisa a fazer na sessão nova

Ler este documento, ler `electron/agents/schedule.js` e `src/tools/agents/RoutinesPanel.jsx`, fazer as 4 perguntas da seção 12 ao Antonio, e só então escrever o plano de implementação da **fase 1** (superpowers:writing-plans).
