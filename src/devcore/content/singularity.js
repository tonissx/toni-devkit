'use strict';
/**
 * Singularity — o prestígio do DevCore (docs/devcore-mapa-singularity.md §9).
 * Vencer o chefe do Pico Production libera a Singularity: a run inteira recomeça e o jogador ganha **Insight**,
 * gasto na **Rede da Singularity**, uma árvore permanente em forma de constelação.
 *
 * Por que não é uma linha reta:
 *  - **Adjacência:** só dá para comprar um nó ligado a outro já comprado (começa no Núcleo). Chegar longe custa o caminho.
 *  - **Bifurcações:** cada setor abre em dois braços; os nós do meio ligam os dois.
 *  - **Paradigmas:** cada setor tem dois nós-chave **excludentes** (grupo `excl`) — fortes, com um preço.
 *  - **Sinapses:** pontes entre setores vizinhos, que exigem um vizinho comprado **dos dois lados**.
 *  - **Maestria:** o último nó do setor exige `needs` nós do próprio setor.
 *  - **Infinitos:** nós repetíveis (custo sobe a cada nível) para o fim do jogo.
 *  - **Janela:** logo depois de uma Singularity, até o primeiro passo no mapa da run nova. Nela, o que foi comprado
 *    na própria janela se desfaz de graça; reorganizar a rede inteira devolve só 80% do que vem de runs anteriores.
 *
 * Nó: { id, sector, ring (distância do centro), at (−1…1: posição angular dentro do setor), kind, name, icon, cost,
 *       links: [ids] (ligações não direcionadas; declarar de um lado basta), excl?, needs?, step? (custo a mais por
 *       nível, repetíveis), description, … efeitos }
 * kind: core · minor · notable · keystone · mastery · repeat · bridge
 *
 * Efeitos (somam entre nós; nos repetíveis valem × nível):
 *  effects: Effect[] — o mesmo sistema de modificadores dos upgrades (global, cat:<id>, petBonus, petStation,
 *           stationSlots, offlineCap). perActiveCategory: o valor vale × categorias ativas.
 *  mods:    multiplicadores de regra (produto; repetíveis: valor^nível) — genCost, upgradeCost, abilityCooldown,
 *           abilityDuration, trainCost, craftCost, partCost, petFindEvery, mapCost, shopPrice, expressCost,
 *           recovery (velocidade da recuperação de vida), insight
 *  adds:    somas de regra — atk, hp, def (fração no esquadrão), spd, crit (chance), critMult, maxItems, maxRounds,
 *           itemPower (consumíveis em batalha), itemRefund (chance de voltar ao vencer), itemCap, craftDouble,
 *           heal (curas dos suportes), healItem (Health Check), patchChance, rarityUp, victoryHeal, slotRole
 *           (bônus de papel dos slots a mais), offRole (fora do papel), slotBase (bônus base dos slots a mais),
 *           maxedStats (atributos dos pets no nível máximo), abilityGlow (produção enquanto há habilidade ativa)
 *  flags:   firstCrit, reserve (4º pet de reserva), generalist, autoCast, shortcuts, restHeal, eventFree, bossRare,
 *           areaHeal, newAreaPatch, cleanSlate
 *  start:   como cada run começa — compute, gens {id:n}, tier, petLevel, items {id:n}, patches {raridade:n}
 *  keep:    o que atravessa a Singularity — inventory, scrap, mk
 */

/** Insight ganho numa Singularity (antes dos multiplicadores da árvore). */
const INSIGHT = {
  boss: { localhost: 3, staging: 4, production: 5 }, // por chefe vencido nesta run
  elite: 1,                                          // por elite vencida nesta run
  speed: { days: 14, max: 8 },                       // +1 por dia inteiro abaixo de `days` (até `max`)
  depth: { from: 1e14, per: 3, max: 8 },             // +1 a cada ×`per` de Compute (da run) acima de `from` (seguir jogando rende)
  corePerRun: 0.1,                                   // Núcleo: +10% de produção por Singularity feita (para sempre)
  respecRefund: 0.8,                                 // reorganizar devolve 80% do que foi comprado antes da janela atual
};

/** Setores, no sentido horário a partir do topo. Vizinhos: o anterior e o seguinte. */
const SECTORS = [
  { id: 'infra', name: 'Infra', icon: 'server', hue: '#7CF5B0', text: 'Produção e economia' },
  { id: 'ops', name: 'Ops', icon: 'zap', hue: '#FFD27A', text: 'Habilidades e consumíveis' },
  { id: 'combat', name: 'Combate', icon: 'swords', hue: '#FF9F7A', text: 'O esquadrão nas batalhas' },
  { id: 'pets', name: 'DevPets', icon: 'paw-print', hue: '#B98CFF', text: 'Níveis, estações e recuperação' },
  { id: 'map', name: 'Mapa', icon: 'map', hue: '#8EC5FF', text: 'Custos, recompensas e Patches' },
  { id: 'archive', name: 'Arquivo', icon: 'archive', hue: '#FF7B9C', text: 'Como a run começa e o que atravessa' },
];

const KIND = {
  core: { name: 'Núcleo' },
  minor: { name: 'Nó' },
  notable: { name: 'Notável' },
  keystone: { name: 'Paradigma' },
  mastery: { name: 'Maestria' },
  repeat: { name: 'Infinito' },
  bridge: { name: 'Sinapse' },
  founder: { name: 'Fundador' },
};

/**
 * Molde de um setor: entrada → dois braços → três nós do meio → dois notáveis → dois paradigmas (excludentes) →
 * maestria → infinito. `p` é o prefixo dos ids; `n` traz nome, ícone, custo e efeitos de cada posição.
 */
function sector(id, p, n) {
  const node = (key, ring, at, kind, links, extra = {}) => ({ id: `${p}-${key}`, sector: id, ring, at, kind, links: links.map((k) => (k === 'core' ? 'core' : `${p}-${k}`)), ...n[key], ...extra });
  return [
    node('1', 1, 0, 'minor', ['core']),
    node('2a', 2, -0.5, 'minor', ['1']),
    node('2b', 2, 0.5, 'minor', ['1']),
    node('3a', 3, -0.75, 'minor', ['2a']),
    node('3b', 3, 0, 'minor', ['2a', '2b']),
    node('3c', 3, 0.75, 'minor', ['2b']),
    node('4a', 4, -0.45, 'notable', ['3a', '3b']),
    node('4b', 4, 0.45, 'notable', ['3b', '3c']),
    node('5a', 5, -0.55, 'keystone', ['4a'], { excl: id }),
    node('5b', 5, 0.55, 'keystone', ['4b'], { excl: id }),
    node('6', 6, 0, 'mastery', ['5a', '5b'], { needs: 7 }),
    node('r', 7, 0, 'repeat', ['6']),
  ];
}

// Cada anel custa mais: a entrada é um gostinho barato; do meio para fora, cada nó é uma escolha.
const COST = { minor1: 1, minor2: 2, minor3: 3, notable: 5, keystone: 10, mastery: 15, bridge: 5, repeat: 8, repeatStep: 5 };

const INFRA = sector('infra', 'inf', {
  1: { name: 'Hot Reload', icon: 'flame', cost: COST.minor1, description: '+15% em toda a produção.',
    effects: [{ type: 'add', target: 'global', value: 0.15 }] },
  '2a': { name: 'Shell Mastery', icon: 'terminal', cost: COST.minor2, description: '+40% em Shell e Automation.',
    effects: [{ type: 'add', target: 'cat:shell', value: 0.4 }, { type: 'add', target: 'cat:automation', value: 0.4 }] },
  '2b': { name: 'Data Lake', icon: 'database', cost: COST.minor2, description: '+40% em Data, Agents e Infra.',
    effects: [{ type: 'add', target: 'cat:data', value: 0.4 }, { type: 'add', target: 'cat:agents', value: 0.4 }, { type: 'add', target: 'cat:infra', value: 0.4 }] },
  '3a': { name: 'Bulk Discount', icon: 'tags', cost: COST.minor3, description: 'Geradores custam 20% menos.', mods: { genCost: 0.8 } },
  '3b': { name: 'Compound Interest', icon: 'trending-up', cost: COST.minor3, description: '+25% em toda a produção.',
    effects: [{ type: 'add', target: 'global', value: 0.25 }] },
  '3c': { name: 'Upgrade Path', icon: 'arrow-up-circle', cost: COST.minor3, description: 'Upgrades custam 30% menos.', mods: { upgradeCost: 0.7 } },
  '4a': { name: 'Economies of Scale', icon: 'factory', cost: COST.notable, description: 'Geradores custam mais 30% menos.', mods: { genCost: 0.7 } },
  '4b': { name: 'Edge Network', icon: 'network', cost: COST.notable, description: '+8% em toda a produção por categoria ativa.',
    effects: [{ type: 'add', target: 'global', value: 0.08, perActiveCategory: true }] },
  '5a': { name: 'Hyperscale', icon: 'rocket', cost: COST.keystone, description: 'Produção ×2, mas geradores custam 50% mais.',
    effects: [{ type: 'mul', target: 'global', value: 2 }], mods: { genCost: 1.5 } },
  '5b': { name: 'Lean Startup', icon: 'feather', cost: COST.keystone, description: 'Geradores e upgrades custam 60% menos, mas a produção fica ×0,8.',
    effects: [{ type: 'mul', target: 'global', value: 0.8 }], mods: { genCost: 0.4, upgradeCost: 0.4 } },
  6: { name: 'Dyson Sphere', icon: 'sun', cost: COST.mastery, description: 'Produção ×1,5 e +8 h de trabalho com o app fechado.',
    effects: [{ type: 'mul', target: 'global', value: 1.5 }, { type: 'add', target: 'offlineCap', value: 8 }] },
  r: { name: 'Overclock', icon: 'gauge', cost: COST.repeat, step: COST.repeatStep, description: '+10% em toda a produção por nível.',
    effects: [{ type: 'add', target: 'global', value: 0.1 }] },
});

const OPS = sector('ops', 'ops', {
  1: { name: 'Runbook', icon: 'book-open', cost: COST.minor1, description: 'Recarga das habilidades 15% mais curta.', mods: { abilityCooldown: 0.85 } },
  '2a': { name: 'Sustained Load', icon: 'battery-charging', cost: COST.minor2, description: 'Habilidades de produção duram 30% mais.', mods: { abilityDuration: 1.3 } },
  '2b': { name: 'Supply Chain', icon: 'truck', cost: COST.minor2, description: 'Fabricar consumíveis custa 40% menos.', mods: { craftCost: 0.6 } },
  '3a': { name: 'Deep Profiling', icon: 'activity', cost: COST.minor3, description: 'Recarga das habilidades mais 15% curta.', mods: { abilityCooldown: 0.85 } },
  '3b': { name: 'Bigger Pockets', icon: 'backpack', cost: COST.minor3, description: '+1 no limite de cada consumível.', adds: { itemCap: 1 } },
  '3c': { name: 'Hardened Builds', icon: 'shield-plus', cost: COST.minor3, description: 'Consumíveis em batalha 40% mais fortes (Coffee, Hotfix, Rollback).', adds: { itemPower: 0.4 } },
  '4a': { name: 'Batch Jobs', icon: 'layers', cost: COST.notable, description: 'Fabricar um consumível tem 50% de chance de render dois.', adds: { craftDouble: 0.5 } },
  '4b': { name: 'Parts Depot', icon: 'package', cost: COST.notable, description: 'Peças de Blueprint compradas custam 40% menos.', mods: { partCost: 0.6 } },
  '5a': { name: 'Full Automation', icon: 'bot', cost: COST.keystone, description: 'Habilidades de produção disparam sozinhas quando ficam prontas (com o app aberto), mas duram 25% menos.',
    flags: { autoCast: true }, mods: { abilityDuration: 0.75 } },
  '5b': { name: 'Manual Override', icon: 'hand', cost: COST.keystone, description: 'Habilidades duram o dobro e recarregam 30% mais rápido, mas fabricar consumíveis custa o dobro.',
    mods: { abilityDuration: 2, abilityCooldown: 0.7, craftCost: 2 } },
  6: { name: 'Self-Healing', icon: 'refresh-cw', cost: COST.mastery, description: 'Ao vencer uma batalha, cada consumível usado tem 50% de chance de voltar ao estoque.', adds: { itemRefund: 0.5 } },
  r: { name: 'Throughput', icon: 'timer', cost: COST.repeat, step: COST.repeatStep, description: 'Recarga das habilidades 4% mais curta por nível.', mods: { abilityCooldown: 0.96 } },
});

const COMBAT = sector('combat', 'cmb', {
  1: { name: 'Code Review', icon: 'eye', cost: COST.minor1, description: 'Esquadrão +10% de ataque.', adds: { atk: 0.1 } },
  '2a': { name: 'Defensive Coding', icon: 'heart', cost: COST.minor2, description: 'Esquadrão +15% de vida.', adds: { hp: 0.15 } },
  '2b': { name: 'Static Typing', icon: 'shield', cost: COST.minor2, description: 'Esquadrão +15% de defesa.', adds: { def: 0.15 } },
  '3a': { name: 'Critical Path', icon: 'crosshair', cost: COST.minor3, description: '+6 pontos de chance de crítico.', adds: { crit: 0.06 } },
  '3b': { name: 'Load Testing', icon: 'dumbbell', cost: COST.minor3, description: 'Esquadrão +10% de ataque e de vida.', adds: { atk: 0.1, hp: 0.1 } },
  '3c': { name: 'Hardening', icon: 'shield-check', cost: COST.minor3, description: 'Esquadrão +20% de defesa.', adds: { def: 0.2 } },
  '4a': { name: 'Zero-Day', icon: 'zap', cost: COST.notable, description: 'O 1º ataque de cada DevPet é sempre crítico.', flags: { firstCrit: true } },
  '4b': { name: 'Hot Standby', icon: 'user-plus', cost: COST.notable, description: 'Reserva: um 4º DevPet espera fora da luta e entra no lugar do primeiro que cair.', flags: { reserve: true } },
  '5a': { name: 'Glass Cannon', icon: 'flame-kindling', cost: COST.keystone, description: 'Esquadrão +50% de ataque, mas −25% de vida.', adds: { atk: 0.5, hp: -0.25 } },
  '5b': { name: 'Fortress', icon: 'castle', cost: COST.keystone, description: 'Esquadrão +40% de vida e de defesa, mas −20% de ataque. As batalhas duram até 10 rodadas a mais.',
    adds: { hp: 0.4, def: 0.4, atk: -0.2, maxRounds: 10 } },
  6: { name: 'Blitzkrieg', icon: 'wind', cost: COST.mastery, description: 'Esquadrão +3 de velocidade e críticos causam ×2 (em vez de ×1,6).', adds: { spd: 3, critMult: 0.4 } },
  r: { name: 'War Games', icon: 'target', cost: COST.repeat, step: COST.repeatStep, description: 'Esquadrão +4% de ataque e de vida por nível.', adds: { atk: 0.04, hp: 0.04 } },
});

const PETS = sector('pets', 'pet', {
  1: { name: 'Muscle Memory', icon: 'brain', cost: COST.minor1, description: 'DevPets voltam da Singularity no nível 3.', start: { petLevel: 3 } },
  '2a': { name: 'Mentorship', icon: 'graduation-cap', cost: COST.minor2, description: '+25% nos bônus de produção dos DevPets.',
    effects: [{ type: 'add', target: 'petBonus', value: 0.25 }] },
  '2b': { name: 'Bootcamp', icon: 'tent', cost: COST.minor2, description: 'Treinar DevPets custa 30% menos.', mods: { trainCost: 0.7 } },
  '3a': { name: 'Extra Desk', icon: 'armchair', cost: COST.minor3, description: '+1 estação para DevPets.',
    effects: [{ type: 'add', target: 'stationSlots', value: 1 }] },
  '3b': { name: 'Veterans', icon: 'medal', cost: COST.minor3, description: 'DevPets voltam da Singularity no nível 5.', start: { petLevel: 5 } },
  '3c': { name: 'Fast Recovery', icon: 'heart-pulse', cost: COST.minor3, description: 'A vida dos DevPets recupera 50% mais rápido.', mods: { recovery: 1.5 } },
  '4a': { name: 'Pack Leader', icon: 'crown', cost: COST.notable, description: '+50% no bônus dos DevPets em estação.',
    effects: [{ type: 'add', target: 'petStation', value: 0.5 }] },
  '4b': { name: 'Field Medic', icon: 'stethoscope', cost: COST.notable, description: 'Suportes curam 50% mais e o Health Check cura a vida toda.', adds: { heal: 0.5, healItem: 0.5 } },
  '5a': { name: 'Specialists', icon: 'puzzle', cost: COST.keystone, description: 'Bônus de papel dos slots em dobro, mas DevPets fora do papel do slot têm −10% de ataque e de vida.',
    adds: { slotRole: 1, offRole: -0.1 } },
  '5b': { name: 'Generalists', icon: 'shuffle', cost: COST.keystone, description: 'Todo DevPet ganha o bônus de papel de qualquer slot, mas o bônus base dos slots cai pela metade.',
    flags: { generalist: true }, adds: { slotBase: -0.5 } },
  6: { name: 'Legendary Team', icon: 'sparkles', cost: COST.mastery, description: 'DevPets voltam no nível 8 e têm +15% em todos os atributos de batalha.',
    start: { petLevel: 8 }, adds: { atk: 0.15, hp: 0.15, def: 0.15 } },
  r: { name: 'Pet Treats', icon: 'cookie', cost: COST.repeat, step: COST.repeatStep, description: '+10% nos bônus de produção dos DevPets por nível.',
    effects: [{ type: 'add', target: 'petBonus', value: 0.1 }] },
});

const MAP = sector('map', 'map', {
  1: { name: 'Fast Track', icon: 'footprints', cost: COST.minor1, description: 'Pontos do mapa custam 10% menos.', mods: { mapCost: 0.9 } },
  '2a': { name: 'Scouting', icon: 'binoculars', cost: COST.minor2, description: 'Batalhas comuns: +15 pontos de chance de ganhar um Patch.', adds: { patchChance: 0.15 } },
  '2b': { name: 'Haggling', icon: 'handshake', cost: COST.minor2, description: 'Lojas 25% mais baratas.', mods: { shopPrice: 0.75 } },
  '3a': { name: 'Shortcuts', icon: 'git-branch', cost: COST.minor3, description: 'Toda elite (fora das últimas colunas) tem atalho para a coluna +2.', flags: { shortcuts: true } },
  '3b': { name: 'Budget Approval', icon: 'badge-dollar-sign', cost: COST.minor3, description: 'Pontos do mapa custam mais 15% menos.', mods: { mapCost: 0.85 } },
  '3c': { name: 'Rest Stop', icon: 'coffee', cost: COST.minor3, description: 'No descanso, o time também volta com a vida cheia (além da escolha).', flags: { restHeal: true } },
  '4a': { name: 'Loot Tables', icon: 'gem', cost: COST.notable, description: 'Patches ganhos têm 25% de chance de subir uma raridade.', adds: { rarityUp: 0.25 } },
  '4b': { name: 'Express Lane', icon: 'rocket', cost: COST.notable, description: 'Deploy expresso custa 50% menos e as escolhas dos eventos não cobram Compute.',
    mods: { expressCost: 0.5 }, flags: { eventFree: true } },
  '5a': { name: 'Speedrun', icon: 'timer-reset', cost: COST.keystone, description: 'Pontos do mapa custam 35% menos, mas a vida dos DevPets recupera 30% mais devagar.',
    mods: { mapCost: 0.65, recovery: 0.7 } },
  '5b': { name: 'Treasure Hunter', icon: 'map-pin', cost: COST.keystone, description: 'Toda batalha comum vencida dá um Patch, mas pontos do mapa custam 20% mais.',
    adds: { patchChance: 1 }, mods: { mapCost: 1.2 } },
  6: { name: 'Continuous Deployment', icon: 'infinity', cost: COST.mastery, description: 'Cada chefe derrotado também dá um Patch raro, e cada área nova começa com o time de vida cheia.',
    flags: { bossRare: true, areaHeal: true } },
  r: { name: 'Deploy Budget', icon: 'wallet', cost: COST.repeat, step: COST.repeatStep, description: 'Pontos do mapa custam 4% menos por nível.', mods: { mapCost: 0.96 } },
});

const ARCHIVE = sector('archive', 'arc', {
  1: { name: 'Bootstrap Script', icon: 'file-code', cost: COST.minor1, description: 'Cada run começa com 5.000 Compute e 10 Terminal Workers.',
    start: { compute: 5000, gens: { 'terminal-worker': 10 } } },
  '2a': { name: 'Supply Cache', icon: 'package-open', cost: COST.minor2, description: 'Cada run começa com 2 Coffee, 1 Hotfix e 1 Health Check.',
    start: { items: { coffee: 2, hotfix: 1, 'health-check': 1 } } },
  '2b': { name: 'Nightly Build', icon: 'moon', cost: COST.minor2, description: '+4 h de trabalho com o app fechado.',
    effects: [{ type: 'add', target: 'offlineCap', value: 4 }] },
  '3a': { name: 'Warm Start', icon: 'thermometer-sun', cost: COST.minor3, description: 'Cada run começa no Tier 2 com 50.000 Compute (o mapa abre na hora).',
    start: { tier: 2, compute: 5e4 } },
  '3b': { name: 'Insight Engine', icon: 'lightbulb', cost: COST.minor3, description: '+15% de Insight em cada Singularity.', mods: { insight: 1.15 } },
  '3c': { name: 'Scavenger', icon: 'search', cost: COST.minor3, description: 'Achados dos DevPets com o app fechado 2× mais frequentes.', mods: { petFindEvery: 0.5 } },
  '4a': { name: 'Design Docs', icon: 'file-stack', cost: COST.notable, description: 'Geradores que chegaram ao Mk II voltam em Mk II, e a sucata atravessa a Singularity.',
    keep: { mk: 2, scrap: true } },
  '4b': { name: 'Patch Library', icon: 'library', cost: COST.notable, description: 'Cada run começa com 1 Patch comum aleatório.', start: { patches: { common: 1 } } },
  '5a': { name: 'Time Capsule', icon: 'hourglass', cost: COST.keystone, description: 'Consumíveis em estoque atravessam a Singularity e cada run começa com 1 Patch raro, mas o Insight cai 15%.',
    keep: { inventory: true }, start: { patches: { rare: 1 } }, mods: { insight: 0.85 } },
  '5b': { name: 'Clean Slate', icon: 'eraser', cost: COST.keystone, description: '+50% de Insight, mas nenhum bônus de início de run nem nada que atravessa vale (Bootstrap, Warm Start, Muscle Memory, Veterans, Design Docs…).',
    flags: { cleanSlate: true }, mods: { insight: 1.5 } },
  6: { name: 'Akashic Records', icon: 'scroll-text', cost: COST.mastery, description: 'Cada run começa no Tier 3 com 10 M de Compute.', start: { tier: 3, compute: 1e7 } },
  r: { name: 'Compound Insight', icon: 'brain-circuit', cost: COST.repeat, step: COST.repeatStep, description: '+6% de Insight por nível.', mods: { insight: 1.06 } },
});

/** Sinapses: entre setores vizinhos (ligam o nó 3c de um ao 3a do seguinte; exigem os dois lados). */
const bridge = (id, a, b, pa, pb, n) => ({ id, sector: null, sectors: [a, b], ring: 3.4, at: 0, kind: 'bridge', cost: COST.bridge, links: [`${pa}-3c`, `${pb}-3a`], ...n });
const BRIDGES = [
  bridge('br-autoscaling', 'infra', 'ops', 'inf', 'ops', { name: 'Autoscaling', icon: 'expand', description: '+25% em toda a produção enquanto alguma habilidade de produção estiver ativa.', adds: { abilityGlow: 0.25 } }),
  bridge('br-chaos', 'ops', 'combat', 'ops', 'cmb', { name: 'Chaos Engineering', icon: 'dices', description: 'Leve até 3 consumíveis por batalha (em vez de 2).', adds: { maxItems: 1 } }),
  bridge('br-pair', 'combat', 'pets', 'cmb', 'pet', { name: 'Pair Programming', icon: 'users', description: 'DevPets no nível máximo têm +20% em todos os atributos de batalha.', adds: { maxedStats: 0.2 } }),
  bridge('br-fieldtrip', 'pets', 'map', 'pet', 'map', { name: 'Field Trip', icon: 'tent-tree', description: 'Cada vitória no mapa cura 15% da vida do esquadrão.', adds: { victoryHeal: 0.15 } }),
  bridge('br-patchnotes', 'map', 'archive', 'map', 'arc', { name: 'Patch Notes', icon: 'scroll', description: 'Ao entrar numa área nova, ganha um Patch comum.', flags: { newAreaPatch: true } }),
  bridge('br-seed', 'archive', 'infra', 'arc', 'inf', { name: 'Seed Funding', icon: 'sprout', description: 'Terminal Workers e Script Runners começam a run com 25 unidades.',
    start: { gens: { 'terminal-worker': 25, 'script-runner': 25 } } }),
];

const CORE = { id: 'core', sector: null, ring: 0, at: 0, kind: 'core', cost: 0, links: [], name: 'Singularity Core', icon: 'atom',
  description: 'O que sobra de cada Singularity. +10% em toda a produção por Singularity feita (para sempre).' };

/**
 * Estrela do Fundador: presente para quem já jogava o DevCore antes do mapa e da Singularity (ver engine/state.js,
 * migração da versão 1). Já vem ligada ao Núcleo; não se compra nem sai ao reorganizar. `angle`: posição fixa (graus).
 */
const FOUNDER = { id: 'founder', sector: null, ring: 1.4, angle: -120, kind: 'founder', cost: 0, links: ['core'], name: 'Estrela do Fundador', icon: 'star',
  description: 'Para quem jogava o DevCore antes do mapa e da Singularity. +10% em toda a produção e +1 Insight em cada Singularity, para sempre.',
  effects: [{ type: 'add', target: 'global', value: 0.1 }], adds: { insightFlat: 1 } };

const TREE = [CORE, ...INFRA, ...OPS, ...COMBAT, ...PETS, ...MAP, ...ARCHIVE, ...BRIDGES, FOUNDER];

module.exports = { INSIGHT, SECTORS, KIND, TREE };
