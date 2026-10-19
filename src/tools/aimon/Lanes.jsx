// Monitor de IA — raias: uma linha do tempo por sessão (subagentes recuados), com blocos de "trabalhando" e "esperando".
// O ocioso é o vazio entre os blocos. O cálculo dos blocos é do processo principal (electron/aimon/lanes.js); aqui só se desenha.
import { DS } from '../../lib/ds.js';
import { Stat, useWidth } from '../../lib/charts.jsx';
import { fmtTick, fmtTime, errText } from '../../lib/fmt.jsx';

const { Icon, Spinner, SegmentedControl } = DS;

const api = () => window.devkit.aimon;

export const SCALES = [
  { value: '3600000', label: '1 h', tick: 10 * 60e3 },
  { value: '21600000', label: '6 h', tick: 3600e3 },
  { value: '86400000', label: '24 h', tick: 4 * 3600e3 },
];
const STATE = {
  working: { label: 'Trabalhando', icon: 'loader' },
  waiting: { label: 'Esperando você', icon: 'hand' },
};
const ROW_H = 26;
const LABEL_W = 210;

/** 3 min 20 s · 1 h 05 min · 45 s */
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Raízes (a atividade mais recente primeiro), cada uma seguida dos seus subagentes. Subagente sem pai na lista vira raiz. */
export function arrange(lanes) {
  const last = (l) => l.segments[l.segments.length - 1].to;
  const has = new Set(lanes.map((l) => l.provider + ':' + l.sessionId));
  const kids = new Map();
  const roots = [];
  for (const l of lanes) {
    if (l.parentId && has.has(l.provider + ':' + l.parentId)) { const k = l.provider + ':' + l.parentId; (kids.get(k) || kids.set(k, []).get(k)).push(l); } else roots.push(l);
  }
  roots.sort((a, b) => last(b) - last(a));
  return roots.flatMap((r) => [{ lane: r, depth: 0 }, ...(kids.get(r.provider + ':' + r.sessionId) || []).sort((a, b) => a.segments[0].from - b.segments[0].from).map((k) => ({ lane: k, depth: 1 }))]);
}

export function Lanes({ provider, scale, onScale, sel, onPick, onCommit, rev, toast }) {
  const [data, setData] = React.useState(null);
  const [tip, setTip] = React.useState(null);
  const plotRef = React.useRef(null);
  const plotW = Math.max(60, useWidth(plotRef, 600));

  const load = React.useCallback(() => {
    api().lanes({ provider, since: Date.now() - Number(scale) }).then(setData, (e) => toast('Monitor de IA', errText(e), 'error'));
  }, [provider, scale]);
  React.useEffect(() => { load(); }, [load, rev]);
  React.useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]); // a linha de "agora" anda sozinha

  const step = (SCALES.find((s) => s.value === scale) || SCALES[0]).tick;
  const rows = React.useMemo(() => (data ? arrange(data.lanes) : []), [data]);
  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>;

  const span = data.now - data.since;
  const x = (t) => ((t - data.since) / span) * plotW;
  const ticks = [];
  for (let t = Math.ceil(data.since / step) * step; t <= data.now; t += step) ticks.push(t);
  const st = data.stats;
  const showCommit = (e, lane, commit) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTip({ lane, commit, left: Math.min(Math.max(4, e.clientX - r.left - 70), plotW - 190) });
  };
  const showTip = (e, lane, seg) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTip({ lane, seg, left: Math.min(Math.max(4, e.clientX - r.left - 70), plotW - 190) });
  };

  return (
    <div className="am-lanes">
      <div className="am-lanes__bar">
        <div className="lg-stats am-lanes__stats">
          <Stat label="Esperando você" value={dur(st.waitingMs)} note="somado, todas as sessões" tone={st.waitingMs > 0 ? 'warn' : undefined} />
          <Stat label="Trabalhando agora" value={String(st.active)} note="sessões e subagentes" />
          <Stat label="Pico em paralelo" value={String(st.peak)} note={`na janela de ${(SCALES.find((s) => s.value === scale) || SCALES[0]).label}`} />
        </div>
        <div className="am-lanes__ctl">
          <span className="am-legend"><span className="am-key is-working" /><Icon name="loader" size={12} />Trabalhando</span>
          <span className="am-legend"><span className="am-key is-waiting" /><Icon name="hand" size={12} />Esperando você (heurística)</span>
          <SegmentedControl size="sm" options={SCALES.map(({ value, label }) => ({ value, label }))} value={scale} onChange={onScale} />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="lg-muted lg-pad">Nenhuma atividade neste período.</div>
      ) : (
        <div className="am-lanes__grid tk-scroll">
          <div className="am-lane am-lane--axis">
            <span />
            <div ref={plotRef} className="am-lane__plot">
              <svg width={plotW} height={20} aria-hidden="true">
                {ticks.map((t) => <text key={t} x={x(t)} y={14} textAnchor="middle" className="lg-tick">{fmtTick(t, 60e3)}</text>)}
                <text x={plotW} y={14} textAnchor="end" className="lg-tick am-now">agora</text>
              </svg>
            </div>
          </div>
          {rows.map(({ lane, depth }, idx) => {
            // Subagente: liga o início do bloco dele à raia da sessão que o criou (as raias dos irmãos ficam no meio do caminho).
            let up = 0;
            if (depth) { let p = idx - 1; while (p >= 0 && rows[p].depth) p--; up = p >= 0 ? idx - p : 0; }
            const born = lane.segments[0].from;
            const title = lane.label || lane.title || (depth ? 'Subagente' : 'Sessão sem título');
            return (
              <div key={lane.key} className={'am-lane' + (sel === lane.key ? ' is-sel' : '') + (depth ? ' is-sub' : '')}>
                <button type="button" className="am-lane__label" onClick={() => onPick(lane.key)} title="Abrir a timeline desta sessão">
                  {depth > 0 && <Icon name="corner-down-right" size={12} />}
                  <span className="am-lane__title am-priv">{title}</span>
                  {lane.partial && <span title="Arquivo grande: só o final foi lido — a raia pode estar incompleta"><Icon name="info" size={11} /></span>}
                  <span className="lg-pill">{lane.provider}</span>
                </button>
                <div className="am-lane__plot">
                  <svg width={plotW} height={ROW_H} onPointerLeave={() => setTip(null)} role="img" aria-label={`${title}: ${lane.segments.length} bloco(s) de atividade`}>
                    <defs>
                      <pattern id="am-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" className="am-stripe__bg" />
                        <rect width="3" height="6" className="am-stripe__fg" />
                      </pattern>
                    </defs>
                    {ticks.map((t) => <line key={t} x1={x(t) + 0.5} x2={x(t) + 0.5} y1={0} y2={ROW_H} className="lg-grid" />)}
                    {up > 0 && (
                      <g className="am-link" aria-hidden="true">
                        <line x1={x(born) + 0.5} x2={x(born) + 0.5} y1={ROW_H / 2 - up * (ROW_H + 1)} y2={ROW_H / 2} />
                        <circle cx={x(born) + 0.5} cy={ROW_H / 2 - up * (ROW_H + 1)} r={2.5} />
                      </g>
                    )}
                    {lane.segments.map((s, i) => (
                      <rect key={i} x={x(s.from)} y={4} width={Math.max(2, x(s.to) - x(s.from))} height={ROW_H - 8} rx={3}
                        className={'am-seg is-' + s.state} fill={s.state === 'waiting' ? 'url(#am-stripe)' : undefined}
                        onPointerMove={(e) => showTip(e, lane, s)} onClick={() => onPick(lane.key)} />
                    ))}
                    <line x1={plotW - 0.5} x2={plotW - 0.5} y1={0} y2={ROW_H} className="am-nowline" />
                    {(lane.commits || []).map((c) => (
                      <polygon key={c.hash + c.ts} className="am-cmark" points={`${x(c.ts)},${ROW_H / 2 - 6} ${x(c.ts) + 6},${ROW_H / 2} ${x(c.ts)},${ROW_H / 2 + 6} ${x(c.ts) - 6},${ROW_H / 2}`}
                        onPointerMove={(e) => showCommit(e, lane, c)} onClick={() => (lane.repo ? onCommit(lane, c) : onPick(lane.key))} />
                    ))}
                  </svg>
                  {tip && tip.lane === lane && tip.commit && (
                    <div className="lg-tip am-tip" style={{ left: tip.left, top: ROW_H }}>
                      <div className="lg-tip__when"><Icon name="git-commit-horizontal" size={11} /> Commit da sessão · {fmtTime(tip.commit.ts, { millis: false })}</div>
                      <div className="lg-tip__row"><code>{tip.commit.hash.slice(0, 7)}</code>{tip.commit.branch && <span>{tip.commit.branch}</span>}</div>
                      <div className="lg-tip__row"><span className="am-priv">{tip.commit.subject}</span></div>
                    </div>
                  )}
                  {tip && tip.lane === lane && tip.seg && (
                    <div className="lg-tip am-tip" style={{ left: tip.left, top: ROW_H }}>
                      <div className="lg-tip__when"><Icon name={STATE[tip.seg.state].icon} size={11} /> {STATE[tip.seg.state].label}</div>
                      <div className="lg-tip__row"><b>{dur(tip.seg.to - tip.seg.from)}</b><span>{fmtTime(tip.seg.from, { millis: false })} – {fmtTime(tip.seg.to, { millis: false })}</span></div>
                      {tip.seg.tool && <div className="lg-tip__row"><span className="am-priv">{tip.seg.tool}</span></div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
