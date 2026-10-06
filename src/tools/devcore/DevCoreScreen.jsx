import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { REACTION_MS } from '../../devcore/director.js';
import { Scene } from './Scene.jsx';
import { GeneratorsPanel, UpgradesPanel, PetsPanel, TechPanel } from './Panels.jsx';
import { OpsPanel } from './OpsPanel.jsx';
import { RateWithDetails } from './RateDetails.jsx';
import { MapPanel } from './MapPanel.jsx';

const { Tabs, Modal, Button, ProgressBar, Spinner, Icon } = DS;

const api = () => window.devkit.devcore;
const petName = (snap, id) => (snap.pets.find((p) => p.id === id) || { name: id }).name;

/**
 * Relógio da tela: um único timer para contador, cooldowns e cena (nada de setInterval espalhado).
 * O contador interpola localmente: amount + rate × (agora − recebidoEm) — sem IPC por frame.
 */
function useClock(ms) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Número principal animado a 60 fps sem re-renderizar a tela (escreve direto no nó). */
function LiveCompute({ snap, receivedAt }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    let raf = 0;
    const frame = () => {
      const v = snap.amount + snap.rate * (Date.now() - receivedAt) / 1000;
      if (ref.current) ref.current.textContent = formatNum(v);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [snap, receivedAt]);
  return <span ref={ref} className="dc-amount__value" />;
}

const genName = (snap, id) => (snap.generators.find((g) => g.id === id) || { name: id }).name;

function WelcomeBack({ snap, onClose }) {
  const w = snap.welcome;
  // Achados agrupados por pet: "Byte encontrou 4 caches: +73 Compute" · itens listados à parte.
  const finds = Object.values(w.finds.filter((f) => f.amount).reduce((acc, f) => {
    const a = acc[f.pet] || (acc[f.pet] = { pet: f.pet, n: 0, amount: 0 });
    a.n += 1; a.amount += f.amount;
    return acc;
  }, {}));
  const itemName = (id) => (snap.inventory.find((k) => k.id === id) || { name: id }).name;
  const villain = (id) => snap.bestiary.find((b) => b.id === id) || { name: id };
  const incidents = w.incidents || [];
  return (
    <Modal open title="WELCOME BACK" icon="cpu" onClose={onClose} width={440}
      description={w.capped
        ? `Você ficou fora por ${formatDuration(w.awayMs)}; seu DevCore trabalhou ${formatDuration(w.countedMs)}.`
        : `Seu DevCore trabalhou por ${formatDuration(w.awayMs)}.`}
      footer={<Button variant="primary" onClick={onClose}>Continuar</Button>}>
      <div className="dc-welcome">
        <div className="dc-welcome__big">+{formatNum(w.gained)} <span>Compute</span></div>
        {w.capped && <div className="dc-welcome__note">Limite de trabalho offline: {snap.offlineCapHours} h.</div>}
        {finds.map((f) => (
          <div key={f.pet} className="dc-welcome__line"><Icon name="sparkles" size={13} /> {petName(snap, f.pet)} encontrou {f.n === 1 ? 'um cache' : f.n + ' caches'}: +{formatNum(f.amount)} Compute</div>
        ))}
        {w.finds.filter((f) => f.item).map((f, i) => (
          <div key={'item' + i} className="dc-welcome__line"><Icon name="package" size={13} /> {petName(snap, f.pet)} encontrou um {itemName(f.item)}</div>
        ))}
        {w.finds.filter((f) => f.part).map((f, i) => (
          <div key={'part' + i} className="dc-welcome__line"><Icon name="package" size={13} /> {petName(snap, f.pet)} encontrou a peça <b>{f.partName}</b> ({genName(snap, f.gen)})</div>
        ))}
        {incidents.map((x, i) => (
          <div key={'inc' + i} className={'dc-welcome__line' + (x.contained ? '' : ' is-warn')}>
            <Icon name={x.contained ? 'shield-check' : 'triangle-alert'} size={13} />
            {x.contained
              ? <span><b>{villain(x.villain).name}</b> tentou atacar — {x.by === 'rollback' ? 'o Rollback segurou' : x.by === 'infra' ? 'seus Local Clusters seguraram' : petName(snap, x.by) + ' segurou'}{x.item ? ` · +1 ${itemName(x.item)}` : ''}{x.part ? (x.part.scrap ? ' · +1 sucata' : ` · peça ${x.part.name}`) : ''}</span>
              : <span><b>{villain(x.villain).name}</b> atrapalhou por {formatDuration(x.durationMs || 0)} (nada foi perdido além da produção reduzida)</span>}
          </div>
        ))}
        {w.discoveries.length > 0 && (
          <div className="dc-welcome__line"><Icon name="radar" size={13} /> {w.discoveries.length === 1 ? '1 descoberta' : w.discoveries.length + ' descobertas'}: {w.discoveries.map((id) => (snap.discoveries.find((d) => d.id === id) || {}).title).join(', ')}</div>
        )}
        {snap.newUpgrades.length > 0 && <div className="dc-welcome__line"><Icon name="arrow-up-circle" size={13} /> {snap.newUpgrades.length} upgrade(s) disponível(is)</div>}
      </div>
    </Modal>
  );
}

/** Estado no cabeçalho: ONLINE · incidente ativo (âmbar) · contido (escudo) + previsão, se houver. */
function IncidentChip({ ops, now, onOpen }) {
  const a = ops.active;
  const f = ops.forecast && !ops.forecast.hidden ? ops.forecast : null;
  const left = (ms) => formatDuration(Math.max(0, ms));
  return (
    <>
      {!a && <span className="dc-online"><i /> ONLINE</span>}
      {a && !a.contained && <button type="button" className="dc-status is-alert" onClick={onOpen}><Icon name="triangle-alert" size={12} /> {a.villain.name} · {a.name} · {left(a.end - now)}</button>}
      {a && a.contained && <button type="button" className="dc-status is-ok" onClick={onOpen}><Icon name="shield-check" size={12} /> {a.villain.name} contido</button>}
      {f && <button type="button" className={'dc-status' + (f.covered ? ' is-ok' : ' is-warn')} onClick={onOpen}>
        Previsto: {f.villain.name} em {left(f.at - now)} {f.covered ? '· defesa armada' : '· sem defesa'}
      </button>}
    </>
  );
}

export function DevCoreScreen({ toast, request }) {
  const [ui, setUi] = usePersisted('devcore.ui', { tab: 'generators' });
  const [snap, setSnap] = React.useState(null);
  const [receivedAt, setReceivedAt] = React.useState(Date.now());
  const [reactions, setReactions] = React.useState([]);
  const [freshUnseen, setFreshUnseen] = React.useState([]); // descobertas "NOVO" desta visita
  const now = useClock(500);

  const take = React.useCallback((s) => { setSnap(s); setReceivedAt(Date.now()); }, []);

  /** Log da engine → reações dos pets na cena. */
  const react = React.useCallback((log, s) => {
    const t = Date.now();
    const out = [];
    for (const e of log || []) {
      if (e.type === 'purchase') out.push({ at: t, type: 'purchase', category: e.category });
      else if (e.type === 'upgrade' || e.type === 'tier') out.push({ at: t, type: e.type });
      else if (e.type === 'discovery') out.push({ at: t, type: 'discovery', pet: e.finder });
      else if (e.type === 'evolve') out.push({ at: t, type: 'evolve', pet: e.pet, text: e.name });
      else if (e.type === 'skinChanged') out.push({ at: t, type: 'skin', pet: e.pet });
      else if (e.type === 'refactor') out.push({ at: t, type: 'refactor', category: e.category, mk: e.mk });
      else if (e.type === 'contained' && s.pets.some((p) => p.id === e.by)) out.push({ at: t, type: 'ability', pet: e.by, text: 'barrei o vilão' });
      else if (e.type === 'incidentEnd' && e.outcome === 'hotfixed') {
        const b = s.bestiary.find((x) => x.id === e.villain) || {};
        out.push({ at: t, type: 'defeated', villain: e.villain, category: b.category, text: b.defeatedLine || 'derrotado!' });
        out.push({ at: t, type: 'upgrade' }); // metade dos pets comemora
      }
      else if (e.type === 'ability') out.push({ at: t, type: 'ability', pet: e.pet, text: (s.pets.find((p) => p.ability.id === e.id) || { ability: {} }).ability.name });
    }
    for (const e of log || []) {
      if (e.type === 'mapOpen') toast('Mapa liberado', `${e.name}: batalhas, eventos e Patches na aba Mapa`);
      if (e.type === 'battle' && e.cleared) toast('Área concluída', 'O Legacy Monolith caiu!');
      if (e.type !== 'quest') continue;
      const item = e.item && (s.inventory.find((k) => k.id === e.item) || {}).name;
      toast('Missão concluída', e.title + (item ? ' · +1 ' + item : ''));
    }
    if (out.length) setReactions((r) => [...r.filter((x) => t - x.at < REACTION_MS), ...out]);
    if ((log || []).some((e) => e.type === 'discovery')) setFreshUnseen((f) => [...new Set([...f, ...log.filter((e) => e.type === 'discovery').map((e) => e.id)])]);
  }, []);

  React.useEffect(() => {
    api().get().then((s) => {
      take(s);
      setFreshUnseen(s.unseen);
      if (s.welcome) setReactions([{ at: Date.now(), type: 'welcome' }]);
    });
    return api().onChanged((msg) => { if (msg.snapshot) { take(msg.snapshot); react(msg.log, msg.snapshot); } });
  }, []);

  // Ao abrir, marca como vistos (o ponto da sidebar some); os "NOVO" continuam nesta visita.
  React.useEffect(() => {
    if (!snap || snap.welcome || (!snap.unseen.length && !snap.newUpgrades.length)) return undefined;
    const t = setTimeout(() => api().act({ type: 'seen', upgrades: snap.newUpgrades }).then((r) => take(r.snapshot)), 1500);
    return () => clearTimeout(t);
  }, [snap && snap.unseen.length, snap && snap.newUpgrades.join(), snap && !!snap.welcome]);

  // Uma habilidade acabou → a taxa muda: busca o snapshot novo na hora certa.
  React.useEffect(() => {
    if (!snap || !Number.isFinite(snap.nextChange)) return undefined;
    const t = setTimeout(() => api().get().then(take), Math.max(0, snap.nextChange - snap.at) + 50);
    return () => clearTimeout(t);
  }, [snap]);

  // Visuais novos: o "NOVO" some depois que você passa pela aba DevPets.
  React.useEffect(() => {
    if (ui.tab !== 'pets' || !snap || !snap.freshSkins.length) return undefined;
    const t = setTimeout(() => api().act({ type: 'seen', skins: true, upgrades: [] }).then((r) => take(r.snapshot)), 4000);
    return () => clearTimeout(t);
  }, [ui.tab, snap && snap.freshSkins.join()]);

  // Os "NOVO" das descobertas valem até você sair da aba Tech.
  const prevTab = React.useRef(ui.tab);
  React.useEffect(() => { if (prevTab.current === 'tech' && ui.tab !== 'tech') setFreshUnseen([]); prevTab.current = ui.tab; }, [ui.tab]);

  // Pedido da palette: abrir numa aba.
  React.useEffect(() => { if (request && request.tab) setUi((u) => ({ ...u, tab: request.tab })); }, [request && request.nonce]);

  const act = React.useCallback(async (action) => {
    const r = await api().act(action);
    take(r.snapshot);
    react(r.log, r.snapshot);
    if (r.error) toast('DevCore', r.error, 'error');
    return r;
  }, []);

  if (!snap) return <div className="dc-loading"><Spinner size={16} /> Iniciando o DevCore…</div>;

  // Valores "vivos" para habilitar botões e cooldowns (relógio de 500 ms; o número grande anda a 60 fps).
  const liveAmount = snap.amount + snap.rate * (now - receivedAt) / 1000;
  const serverNow = snap.at + (now - receivedAt);
  const next = snap.tier.next;
  const tierPct = next && next.at ? Math.min(100, (snap.lifetime + snap.rate * (now - receivedAt) / 1000) / next.at * 100) : 100;
  const availableUps = snap.upgrades.filter((u) => u.status === 'available').length;
  const readyAbilities = snap.pets.filter((p) => p.owned && p.ability.ready).length;

  const tabs = [
    { value: 'generators', label: 'Generators', icon: 'server' },
    { value: 'pets', label: 'DevPets', icon: 'paw-print', count: readyAbilities || undefined, dot: snap.freshSkins.length > 0 },
    { value: 'upgrades', label: 'Upgrades', icon: 'arrow-up-circle', count: availableUps || undefined, dot: snap.newUpgrades.length > 0 },
    { value: 'tech', label: 'Tech', icon: 'radar', dot: freshUnseen.length > 0 },
    { value: 'ops', label: 'Ops', icon: 'shield', dot: !!(snap.ops.active && !snap.ops.active.contained) },
    ...(snap.map.unlocked ? [{ value: 'map', label: 'Mapa', icon: 'map', dot: !!snap.map.pending || (!snap.map.cleared && snap.map.nodes.some((n) => n.status === 'reachable' && n.affordable)) }] : []),
  ];

  return (
    <div className="dc">
      <header className="dc-head">
        <div className="dc-head__brand">
          <span className="dc-logo">DEVCORE</span>
          <IncidentChip ops={snap.ops} now={serverNow} onOpen={() => setUi((u) => ({ ...u, tab: 'ops' }))} />
          <span className="dc-tierchip">Tier {snap.tier.id} · {snap.tier.name}</span>
        </div>
        <div className="dc-amount">
          <span className="dc-amount__label">Compute</span>
          <LiveCompute snap={snap} receivedAt={receivedAt} />
          <RateWithDetails snap={snap} now={serverNow} />
        </div>
        <div className="dc-head__next">
          {next ? <>
            <span>Próximo: <b>{next.name}</b> · {formatNum(next.at)} acumulado</span>
            <ProgressBar value={tierPct} size="sm" />
          </> : <span>Todos os tiers do MVP liberados</span>}
        </div>
      </header>

      <Scene snap={snap} reactions={reactions} now={now} />

      <div className="dc-tabs">
        <Tabs items={tabs} value={ui.tab} onChange={(tab) => setUi((u) => ({ ...u, tab }))} />
      </div>
      <div className="dc-panel tk-scroll">
        {ui.tab === 'generators' && <GeneratorsPanel snap={snap} amount={liveAmount} act={act} />}
        {ui.tab === 'pets' && <PetsPanel snap={snap} amount={liveAmount} act={act} now={serverNow} />}
        {ui.tab === 'upgrades' && <UpgradesPanel snap={snap} amount={liveAmount} act={act} />}
        {ui.tab === 'tech' && <TechPanel snap={snap} freshUnseen={freshUnseen} />}
        {ui.tab === 'ops' && <OpsPanel snap={snap} amount={liveAmount} act={act} now={serverNow} />}
        {ui.tab === 'map' && snap.map.unlocked && <MapPanel snap={snap} act={act} />}
      </div>

      {snap.welcome && <WelcomeBack snap={snap} onClose={() => act({ type: 'ackWelcome' })} />}
    </div>
  );
}
