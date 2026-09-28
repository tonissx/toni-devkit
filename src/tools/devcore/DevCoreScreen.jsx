import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { formatNum, formatDuration } from '../../devcore/engine/format.js';
import { REACTION_MS } from '../../devcore/director.js';
import { Scene } from './Scene.jsx';
import { GeneratorsPanel, UpgradesPanel, PetsPanel, TechPanel } from './Panels.jsx';

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

function WelcomeBack({ snap, onClose }) {
  const w = snap.welcome;
  // Achados agrupados por pet: "Byte encontrou 4 caches: +73 Compute".
  const finds = Object.values(w.finds.reduce((acc, f) => {
    const a = acc[f.pet] || (acc[f.pet] = { pet: f.pet, n: 0, amount: 0 });
    a.n += 1; a.amount += f.amount;
    return acc;
  }, {}));
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
        {w.discoveries.length > 0 && (
          <div className="dc-welcome__line"><Icon name="radar" size={13} /> {w.discoveries.length === 1 ? '1 descoberta' : w.discoveries.length + ' descobertas'}: {w.discoveries.map((id) => (snap.discoveries.find((d) => d.id === id) || {}).title).join(', ')}</div>
        )}
        {snap.newUpgrades.length > 0 && <div className="dc-welcome__line"><Icon name="arrow-up-circle" size={13} /> {snap.newUpgrades.length} upgrade(s) disponível(is)</div>}
      </div>
    </Modal>
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
      else if (e.type === 'ability') out.push({ at: t, type: 'ability', pet: e.pet, text: (s.pets.find((p) => p.ability.id === e.id) || { ability: {} }).ability.name });
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
  ];

  return (
    <div className="dc">
      <header className="dc-head">
        <div className="dc-head__brand">
          <span className="dc-logo">DEVCORE</span>
          <span className="dc-online"><i /> ONLINE</span>
          <span className="dc-tierchip">Tier {snap.tier.id} · {snap.tier.name}</span>
        </div>
        <div className="dc-amount">
          <span className="dc-amount__label">Compute</span>
          <LiveCompute snap={snap} receivedAt={receivedAt} />
          <span className="dc-amount__rate">+{formatNum(snap.rate, { rate: true })}/s</span>
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
      </div>

      {snap.welcome && <WelcomeBack snap={snap} onClose={() => act({ type: 'ackWelcome' })} />}
    </div>
  );
}
