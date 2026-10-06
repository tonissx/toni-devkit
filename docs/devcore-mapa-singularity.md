# DevCore — Mapa, batalhas e Singularity

Documento de design do próximo grande sistema do DevCore. **Ainda não implementado.**
Substitui a ideia de *Legado/Rebuild* (prestige por fragmentos e árvore de perks), que ficou guardada no branch
`worktree-devcore-legacy` e pode ter partes reaproveitadas na árvore de Singularity.

Convenções deste documento:
- **Decidido**: combinado na conversa de design e registrado em [Decisões](#11-registro-de-decisões).
- **Proposta**: valor ou regra sugerida, para confirmar ou calibrar com o simulador (`npm run devcore:sim`).

---

## 1. Por que

- **Depois do Tier 3 o jogo não pede mais nenhuma decisão.** No simulador, o jogador casual chega ao Tier 3 em ~1,2 dia
  e passa o resto da semana só vendo números subirem.
- **Compute só tem um destino óbvio:** comprar mais produção. Não há escolha entre gastos que competem entre si.
- **Os sistemas que já existem pedem um palco:** vilões dos incidentes, counters de pets, consumíveis, peças de
  Blueprint e habilidades.

O mapa dá ao Compute um uso disputado ("aumento minha produção ou avanço no mapa?") e cria um objetivo de médio e longo
prazo. A Singularity fecha o ciclo com um reset que dá progresso permanente.

## 2. Princípios

Os mesmos do DevCore, que continuam valendo:

1. **Idle de verdade:** nada de reflexo nem atenção constante. As decisões acontecem *antes* da batalha; o resultado
   vem sozinho.
2. **Nunca tirar progresso:** derrota custa só o Compute da tentativa. Nada que já foi conquistado se perde fora da
   Singularity, que é escolha do jogador.
3. **Engine puro e determinístico:** `dispatch(state, action, now)`. A batalha é calculada no engine com acaso
   semeado; a arena só reproduz o resultado.
4. **Conteúdo como dados** em `src/devcore/content/`, validado por `validate()`, e ritmo medido pelo simulador.
5. **O uso do DevKit desbloqueia conteúdo, nunca vira força de combate.**

## 3. O ciclo

```
 Produção (geradores, upgrades, combos, pets)
        │  gera Compute
        ▼
 Mapa: cada ponto custa Compute ──► batalha / evento / loja / atalho
        │  recompensas: Patches (+produção), consumíveis, peças
        ▼
 Chefe da área ──► próxima área ──► … ──► 3 áreas vencidas
                                              │
                                              ▼
                                    Singularity (reset escolhido)
                                    + pontos de Singularity → árvore permanente
```

A tensão central: **o custo do mapa é fixo por área** e as **recompensas do mapa alimentam a produção**. Investir em
produção deixa o mapa relativamente mais barato com o tempo; avançar no mapa dá Patches que aceleram a produção. Os dois
caminhos se ajudam, mas o Compute de agora só pode ir para um deles.

## 4. Mapa

### 4.1 Estrutura (proposta)

- No estilo Slay the Spire: **3 trilhas** e **~10 colunas** por área. Um caminho completo passa por ~10 pontos.
- Gerado com a semente da run ao entrar na área (determinístico). Ligações vão para a mesma trilha ou para uma
  vizinha, e as bifurcações aparecem a cada 2–3 colunas.
- **O tipo de cada ponto é visível antes.** Sem isso não existe decisão de risco e recompensa.
- Garantias de geração: coluna 1 é sempre batalha; há uma loja ou descanso no meio; a penúltima coluna é descanso; a
  última é o chefe.
- O jogador só anda para a frente, para um ponto ligado ao atual.
- **O mapa não avança offline** (é feito de decisões). A produção offline continua igual.

### 4.2 Tipos de ponto

| Ponto | Custo (proposta) | O que acontece | Recompensa (proposta) |
|---|---|---|---|
| **Batalha** | 1× | Auto-battle contra 2–4 inimigos da área | Consumível ou peça + Patch comum (chance) |
| **Elite** | 3× | Batalha difícil; algumas são **atalho** (ligam a coluna +2) | Patch forte garantido |
| **Deploy expresso** | 5× | Paga e avança, sem lutar | Nenhuma: é o preço de pular |
| **Evento** | grátis para entrar | Escolha em texto, no estilo log do sistema | Depende da escolha (trocas) |
| **Loja** | itens à venda | Consumíveis, peças de Blueprint, Patches | O que comprar |
| **Descanso** | grátis | Escolhe 1 benefício (treino de pet com desconto, recarregar consumível, gatilho extra) | O escolhido |
| **Chefe** | 4× | Batalha contra o chefe da área | Patch raro + abre a próxima área |

"×" é a **unidade de custo da área** (ver [Ritmo e custos](#8-ritmo-e-custos)).

### 4.3 Eventos (exemplos, proposta)

Eventos nunca tiram progresso: toda perda é uma troca que o jogador escolhe.

- **Código legado encontrado:** pagar 2× para "refatorar" e ganhar um Patch, ou seguir em frente.
- **Hackathon:** um pet do esquadrão sobe 1 nível de graça, ou todos ganham +10% de ataque na próxima batalha.
- **Stack Overflow fora do ar:** pagar 1× por um consumível aleatório, ou arriscar uma batalha extra por uma peça.
- **Refactor espontâneo:** uma peça de Blueprint do gerador que mais produz.
- **Code review do Lint:** troca um Patch comum por um aleatório de raridade maior.

### 4.4 Patches (relíquias da run)

Recompensa principal do mapa. **Valem até a Singularity** e entram no sistema de modificadores do engine (como os
upgrades), com `source: 'patch:<id>'`. A maioria **alimenta a produção**; alguns ajudam na batalha.

| Raridade | Exemplos (proposta) |
|---|---|
| Comum | +15% Shell · +15% Data · Coffee dura o dobro · +1 consumível de cada no início das batalhas |
| Raro | Combos rendem o dobro · habilidades dos pets duram +50% · −20% no custo de treino dos pets |
| Épico | Produção ×1,5 · o 1º ataque de cada batalha é crítico · uma Elite por área custa 1× |

## 5. Batalha — auto-battler com preparação (decidido)

### 5.1 Preparação

Antes de confirmar, o jogador vê os inimigos do ponto (sprite, nome, traço) e decide:

- **Esquadrão de 3 pets** (decidido: 3 por enquanto) entre os que já encontrou.
- **Formação:** cada pet na **frente** ou **atrás**. Inimigos atacam a frente primeiro; quem está atrás só apanha
  quando a frente cai (ou contra inimigos com alcance).
- **Até 2 consumíveis** levados para a luta.
- **Gatilho da habilidade** de cada pet: "no início", "quando um aliado ficar abaixo de 50% de vida", "contra o
  chefe/elite", "na rodada N".

### 5.2 Atributos e papéis (proposta)

Atributos de combate: **vida, ataque, defesa e velocidade**, derivados do que os pets já têm:

```
atributo = base do papel × (1 + 0,15 × (nível − 1)) × estágio × raridade
estágio: Base ×1 · Veterano ×1,1 · Mestre ×1,25        raridade: comum ×1 · raro ×1,1 · épico ×1,2
```

| Papel | Pets | Perfil |
|---|---|---|
| Atacante | Byte, Git | Ataque alto, vida média |
| Tanque | Armo, Query | Vida e defesa altas, segura a frente |
| Suporte | Memo, Relay | Cura e buffs no esquadrão |
| Velocidade | Noxi, Lint | Age mais vezes, aplica efeitos |

**Os níveis dos pets zeram na Singularity (decidido).** Por isso, treinar pets vale para produção e para a arena ao
mesmo tempo, e a decisão de treinar volta a cada run.

### 5.3 Habilidades em batalha (proposta)

Cada habilidade que já existe ganha uma versão de batalha, usada **uma vez por luta**, no gatilho escolhido:

| Habilidade | Pet | Efeito em batalha |
|---|---|---|
| Compile Burst | Byte | Próximo ataque ×3 |
| Branch Off | Git | Cria um clone que absorve um golpe |
| Scale Out | Armo | Escudo no esquadrão por 2 rodadas |
| Index | Query | Marca um inimigo: +30% de dano recebido |
| Recall | Memo | Cura 30% da vida de um aliado |
| Orchestrate | Relay | Esquadrão +25% de ataque por 3 rodadas |
| Parallelize | Noxi | Esquadrão age 2× por 2 rodadas |
| Lint Pass | Lint | Remove efeitos negativos do esquadrão |

### 5.4 Inimigos

Os vilões dos incidentes viram inimigos com um **traço**. **Os counters dos incidentes valem na luta**, o que dá
peso tático à escolha do esquadrão:

| Vilão | Traço (proposta) | Counter |
|---|---|---|
| Leaky | Dreno: reduz o ataque de quem acerta | Query ou Memo no esquadrão anulam |
| Flicker | Esquiva 30% | Noxi acerta sempre |
| Swarm | Vários inimigos fracos | Armo na frente segura o grupo |
| Forky | Ao cair, se divide em dois | Relay impede a divisão |
| Zero | Elite: ignora defesa | Rollback (consumível) anula um golpe |

Cada área adiciona 2–3 inimigos novos e um chefe (ver [Áreas](#7-áreas-e-chefes)). Tudo vai para o bestiário, que
ganha uma seção de batalha (vencidos, derrotas).

### 5.5 Consumíveis em batalha (proposta)

| Consumível | Em batalha |
|---|---|
| Coffee | +50% de ataque do esquadrão por 3 rodadas |
| Hotfix | Dano grande num inimigo |
| Rollback | Revive um pet com 30% de vida |
| Cache Warmer | Recarrega a habilidade de um pet |

### 5.6 Resolução

- O engine resolve em **rodadas** (proposta: no máximo 30; empate por tempo conta como derrota). Em cada rodada, as
  unidades agem por ordem de velocidade.
- Dano = ataque × 100 / (100 + defesa) × crítico. **Acaso semeado** (crítico, esquiva) com semente = run + ponto +
  número da tentativa. Sem acaso, a previsão seria exata e o jogo viraria "testar montagens até ficar verde".
- **Previsão de vitória:** antes de confirmar, o engine simula a luta ~20 vezes com sementes diferentes e mostra
  "favorável" (≥ 80%), "arriscado" (40–80%) ou "muito arriscado" (< 40%), com a porcentagem.
- **Vida não persiste entre batalhas** (proposta, para simplificar). A tensão vem do custo em Compute, não de desgaste.
- **Derrota:** perde só o Compute de entrada; o ponto continua lá para tentar de novo.

## 6. Arena (decidido: própria e temática da área)

- Um componente **separado da cena de estações**, que reaproveita `PetSprite` e `VillainSprite`.
- Um "diretor" da arena (no espírito do `director.js`) **reproduz o log da luta** que o engine já calculou: ataques,
  habilidades, críticos, quedas. Duração de 20–40 s e **dá para pular**.
- Cada área tem ambientação própria. É só fundo e paleta; a lógica é a mesma, então uma área nova custa pouco.

| Área | Ambientação (proposta) |
|---|---|
| Localhost | Mesa de dev: monitor, teclado e caneca ao fundo |
| Staging | Esteiras de pipeline com luzes de CI piscando |
| Production | Datacenter: racks, cabos e alarmes |

## 7. Áreas e chefes

Tema de pipeline de deploy. Vencer o chefe abre a próxima área.

| Área | Abre | Chefe | Novos inimigos (proposta) |
|---|---|---|---|
| 1. Localhost | Tier 2 | **Legacy Monolith** | Bug, Typo, Dependência quebrada |
| 2. Staging | Chefe da Área 1 | **The Merge Conflict** | Flaky Test, Race Condition, Config Drift |
| 3. Production | Chefe da Área 2 | **Production Outage** | Memory Leak gigante, DDoS, Cold Start |

Chefes têm fases (proposta): por exemplo, o Legacy Monolith ganha defesa a cada rodada até ser "refatorado" (dano
acumulado), e a habilidade certa no momento certo faz diferença.

**Áreas extras** (Cloud, Edge, …) abrem depois de algumas Singularities e dão o conteúdo longo.

## 8. Ritmo e custos

**Ritmo (decidido): alguns dias por área.**

| Meta (proposta) | Uso casual |
|---|---|
| Mapa abre (Tier 2) | ~2 h |
| Área 1 vencida | ~3 dias |
| Área 2 vencida | ~7 dias |
| Área 3 vencida → Singularity | ~12 dias (1–2 semanas) |

- Isso dá **~3–4 pontos por dia**, convivendo com a parte idle em vez de substituí-la.
- **Custo fixo por área (decidido).** A unidade de custo `U` de cada área é calibrada no simulador para que um ponto
  comum custe **algumas horas da produção esperada** quando o jogador chega àquela área. Proposta de partida:
  `U₂ ≈ 50 × U₁`, `U₃ ≈ 50 × U₂`, ajustado pelo simulador.
- O custo **não acompanha a produção atual** de propósito: se acompanhasse, investir em geradores nunca ajudaria a
  avançar e a tensão sumiria.

## 9. Singularity

- **Quando:** ao vencer o chefe da Área 3 (e das áreas extras, quando existirem), o jogador **pode** fazer a
  Singularity. É uma escolha; ele pode continuar a run.
- **Zera:** a run inteira (Compute, geradores, upgrades, combos, tiers, Blueprints, consumíveis, **níveis dos pets**
  (decidido)), o progresso do mapa (volta à Área 1, com mapa novo) e os Patches.
- **Fica:** pets já encontrados (voltam no nível 1), descobertas, fatos de uso do DevKit, visuais, bestiário,
  missões, pontos de Singularity e a árvore.
- **Pontos de Singularity** (proposta): uma base por chefe vencido + bônus por Elites vencidas e por terminar mais
  rápido. Gastos numa **árvore de skill permanente**, que será desenhada depois.
- Ideias que já servem de ponto de partida para a árvore (do Legado guardado): pets voltam num nível maior, começar
  já no Tier 2, consumíveis iniciais, +1 vaga no esquadrão, custo do mapa menor, Patch inicial.

## 10. Arquitetura prevista

Segue o padrão atual: conteúdo como dados, engine puro, view derivada, UI fina, simulador.

**Estado** (`engine/state.js`):
- `run.map`: área atual, mapa gerado (pontos e ligações), posição, pontos visitados, Patches da run, tentativas.
- `run.squad`: último esquadrão, formação, gatilhos e consumíveis escolhidos (para repetir rápido).
- `meta.singularity`: contagem, pontos e árvore (nunca zera).
- `bestiary`: ganha contadores de batalha.

**Conteúdo** (`src/devcore/content/`):
- `areas.js`: áreas, arena, unidade de custo, inimigos, chefe, regras de geração.
- `enemies.js`: inimigos e chefes (atributos, traço, counters, falas).
- `patches.js`: Patches (raridade, efeitos no sistema de modificadores).
- `events.js`: eventos (texto e escolhas como trocas).
- `battle.js` (ou em `balance.js`): papéis, fórmulas, limites de rodada, previsão.

**Engine** (`src/devcore/engine/`):
- `map.js`: gerar o mapa da área, mover, aplicar o tipo de ponto.
- `battle.js`: `resolve(squad, enemies, seed) → { win, log }` e `preview(…) → chance`.
- `patches.js`: efeitos dos Patches entram em `collectEffects` (como upgrades e combos).
- Ações novas no `dispatch`: `mapMove`, `mapPay` (deploy expresso), `battle` (com a preparação), `eventChoose`,
  `shopBuy`, `rest`, `singularity`, `treePerk`.

**View** (`engine/view.js`): `mapView` (mapa, posição, custos, o que dá para pagar) e `battlePreview`.

**UI** (`src/tools/devcore/`): aba **Mapa** (`MapPanel.jsx`), tela de preparação, `Arena.jsx` com o diretor da arena
e as três ambientações.

**Simulador** (`src/devcore/sim.js`): um robô que joga o mapa (escolhe caminho, monta esquadrão pelos counters, decide
entre investir em produção ou avançar) para medir o ritmo por área e a taxa de vitória.

## 11. Fases (MVP primeiro)

| Fase | Entrega | Como validar |
|---|---|---|
| 0 | Este documento | Revisão |
| 1 | Motor de batalha + previsão, sem UI | Testes + simulador (taxas de vitória por montagem) |
| 2 | Mapa da Área 1 no engine + robô no simulador | Ritmo "~3 dias" e custos calibrados |
| 3 | UI: aba Mapa, preparação e arena Localhost | App de teste com saves semeados |
| 4 | Áreas 2–3, chefes e a Singularity (reset) | Simulador: Singularity em 1–2 semanas |
| 5 | Árvore de Singularity | Desenho próprio antes de construir |

A batalha vem primeiro porque é a parte mais arriscada de balancear, e o mapa depende dela.

## 12. Registro de decisões

| Data | Decisão |
|---|---|
| 2026-10-06 | O prestige passa a ser mapa + Singularity; o Legado/Rebuild fica guardado (branch `worktree-devcore-legacy`) |
| 2026-10-06 | Batalha: **auto-battler com preparação** (não tower defense nem tática por turnos) |
| 2026-10-06 | Ritmo: **alguns dias por área** (Singularity em 1–2 semanas de uso casual) |
| 2026-10-06 | Ações do mapa custam **Compute**, com **custo fixo por área** |
| 2026-10-06 | Singularity ao vencer **3 áreas**; mais áreas depois de algumas runs; pontos para uma árvore permanente (desenho adiado) |
| 2026-10-06 | **Níveis dos pets zeram** na Singularity |
| 2026-10-06 | Batalha numa **arena própria e temática da área** |
| 2026-10-06 | **Esquadrão de 3** por enquanto |

## 13. Em aberto

- **Vida entre batalhas:** proposta é não persistir. Persistir daria mais peso ao descanso, mas aumenta o desgaste.
- **Deploy expresso:** ponto próprio no mapa (proposta atual) ou uma opção "pagar para pular" em qualquer batalha?
- **Abandonar a área:** dá para gerar um mapa novo da área (pagando) se o caminho ficou ruim?
- **Combos e upgrades:** algum atravessa a Singularity, ou tudo vem da árvore?
- **Avisos:** notificar quando o Compute para o próximo ponto estiver disponível?
- **4º lugar no esquadrão:** via Patch raro ou perk da árvore?
- **Árvore de Singularity:** estrutura, custos e quanto ela acelera as runs seguintes.

## 14. Riscos

- **Escopo:** é o maior sistema do DevCore até agora. Por isso as fases e o MVP só com a Área 1.
- **Ritmo:** se os pontos forem baratos, o mapa acaba numa tarde. O custo fixo por área e o simulador são a proteção.
- **Batalha "resolvida":** se uma montagem sempre ganha, a preparação perde a graça. Os traços dos inimigos e os
  counters precisam forçar trocas de esquadrão entre pontos.
- **Peso de UI:** a arena e o mapa são as telas mais complexas do DevCore. A divisão engine/arena (o engine calcula,
  a arena só reproduz) mantém a lógica testável sem UI.
