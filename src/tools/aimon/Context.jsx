// Monitor de IA — Contexto: do que é feito o contexto de uma sessão. O tamanho em cada chamada é exato (vem do usage); a divisão
// entre base fixa, pedidos, respostas, resultados de ferramentas e anexos é ESTIMADA pelo tamanho do que passou pelo transcrito
// (cálculo em electron/aimon/context.js). Só números: o texto das mensagens não é guardado.
import { DS } from '../../lib/ds.js';
import { Stat, useWidth, niceTicks } from '../../lib/charts.jsx';
import { errText, fmtNum, fmtTime } from '../../lib/fmt.jsx';

const { Icon, Spinner, EmptyState } = DS;

const api = () => window.devkit.aimon;

const H = 150;
const PAD = { l: 46, r: 10, t: 8, b: 22 };
// Cores só reforçam: cada fatia tem nome e valor na legenda.
const COLORS = { base: 'var(--tk-text-3)', prompts: 'var(--tk-accent)', assistant: 'var(--tk-green, #3fb27f)', tools: 'var(--tk-amber)', summary: 'var(--tk-blue, #4f8cff)', other: 'var(--tk-surface-3)' };

const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1000 ? Math.round(n / 1000) + ' mil' : String(Math.round(n)));
const tail = (p) => { const s = String(p).split('\\').join('/').split('/').filter(Boolean); return s.length > 2 ? '…/' + s.slice(-2).join('/') : s.join('/'); };
const pctOf = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Contexto ao longo do tempo: linha com a janela como teto e uma marca em cada compactação. */
function Growth({ series, window: win, compactions }) {
  const ref = React.useRef(null);
  const w = Math.max(260, useWidth(ref, 600));
  const [tip, setTip] = React.useState(null);
  const max = Math.max(win, ...series.map((p) => p.ctx));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const t0 = series[0].ts; const t1 = Math.max(series[series.length - 1].ts, t0 + 1);
  const plotW = w - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const x = (t) => PAD.l + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v) => PAD.t + plotH - (v / top) * plotH;
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.ctx).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series[series.length - 1].ts).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;
  const near = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - PAD.l) / plotW) * (t1 - t0);
    let best = series[0];
    for (const p of series) if (Math.abs(p.ts - t) < Math.abs(best.ts - t)) best = p;
    setTip({ p: best, left: Math.min(Math.max(4, x(best.ts) - 60), w - 170) });
  };
  return (
    <div className="am-cx__chart" ref={ref}>
      <svg width={w} height={H} role="img" aria-label="Tamanho do contexto ao longo da sessão" onPointerMove={near} onPointerLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t) + 0.5} y2={y(t) + 0.5} className="lg-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="lg-tick">{kTok(t)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={w - PAD.r} y1={y(win) + 0.5} y2={y(win) + 0.5} className="am-cx__limit" />
        <text x={w - PAD.r} y={y(win) - 4} textAnchor="end" className="lg-tick">janela {kTok(win)}</text>
        <path d={area} className="am-cx__area" />
        <path d={line} className="am-cx__line" />
        {compactions.filter((c) => c.ts >= t0 && c.ts <= t1).map((c) => (
          <g key={c.ts} className="am-cx__mark"><line x1={x(c.ts)} x2={x(c.ts)} y1={PAD.t} y2={PAD.t + plotH} /><text x={x(c.ts) + 3} y={PAD.t + 10}>compactou</text></g>
        ))}
        <text x={PAD.l} y={H - 6} className="lg-tick">{fmtTime(t0, { millis: false })}</text>
        <text x={w - PAD.r} y={H - 6} textAnchor="end" className="lg-tick">{fmtTime(t1, { millis: false })}</text>
        {tip && <circle cx={x(tip.p.ts)} cy={y(tip.p.ctx)} r={3.5} className="am-cx__dot" />}
      </svg>
      {tip && <div className="lg-tip am-tip" style={{ left: tip.left, top: 0 }}><div className="lg-tip__when">{fmtTime(tip.p.ts, { millis: false })}</div><div className="lg-tip__row"><b>{kTok(tip.p.ctx)}</b><span>{pctOf(tip.p.ctx, win)}% da janela</span></div></div>}
    </div>
  );
}

/** Barra empilhada com a composição atual; a legenda traz nome, tokens e % (a cor só reforça). */
function Composition({ items, ctx }) {
  return (
    <div className="am-cx__comp">
      <div className="am-cx__stack" role="img" aria-label="Composição do contexto atual">
        {items.map((c) => <i key={c.key} style={{ width: Math.max(0.5, pctOf(c.tokens, ctx)) + '%', background: COLORS[c.key] }} title={`${c.name}: ${kTok(c.tokens)}`} />)}
      </div>
      <ul className="am-cx__legend">
        {items.map((c) => <li key={c.key}><span className="am-cx__sw" style={{ background: COLORS[c.key] }} /><span>{c.name}</span><b>{kTok(c.tokens)}</b><span className="lg-muted">{pctOf(c.tokens, ctx)}%</span></li>)}
      </ul>
    </div>
  );
}

export function Context({ session, rev, toast }) {
  const [d, setD] = React.useState(null);
  const key = session.key;
  const last = React.useRef(0);
  const keyRef = React.useRef(key);
  keyRef.current = key;
  const load = React.useCallback((force) => {
    const at = Date.now();
    if (!force && at - last.current < 3000) return; // o aviso do processo principal vem a cada 1,5 s
    last.current = at;
    const k = keyRef.current;
    api().context(k).then((r) => { if (keyRef.current === k) setD(r); }, (e) => toast('Monitor de IA', errText(e), 'error'));
  }, []);
  React.useEffect(() => { setD(null); load(true); }, [key]);
  React.useEffect(() => { load(false); }, [rev]);

  if (!d) return <div className="lg-muted lg-pad"><Spinner size={12} /> Calculando…</div>;
  if (!d.found) return <div className="lg-muted lg-pad">Sessão não encontrada.</div>;
  if (!d.has) return <EmptyState title="Ainda sem dados de contexto" animate="none" description="O contexto é medido a cada resposta do modelo. Assim que esta sessão tiver a primeira resposta, a composição aparece aqui." />;

  const nonBase = d.composition.filter((c) => c.key !== 'base').reduce((n, c) => n + c.tokens, 0);
  return (
    <div className="am-cx tk-scroll">
      <div className="lg-stats">
        <Stat label="Contexto agora" value={kTok(d.ctx)} note={`${d.pct}% de ${kTok(d.window)}${d.windowKnown ? '' : ' (estimado)'}`} tone={d.pct >= 85 ? 'warn' : undefined} />
        <Stat label="Base fixa" value={d.base ? kTok(d.base.tokens) : '—'} note={d.base ? `${pctOf(d.base.tokens, d.ctx)}% do contexto` : 'início não lido'} />
        <Stat label="Cresce por chamada" value={d.growth ? kTok(d.growth) : '—'} note={d.callsLeft != null ? (d.callsLeft ? `enche em ~${fmtNum(d.callsLeft)} chamadas` : 'no limite') : 'média das últimas'} tone={d.callsLeft != null && d.callsLeft <= 15 ? 'warn' : undefined} />
        <Stat label="Compactações" value={fmtNum(d.compactions.length)} note={d.compactions.length ? `a última: ${kTok(d.compactions[d.compactions.length - 1].from)} → ${kTok(d.compactions[d.compactions.length - 1].to)}` : 'nenhuma'} />
      </div>
      {d.partial && <div className="am-note"><Icon name="info" size={12} />Arquivo grande: só o final foi lido, então a base fixa e o começo da conversa podem estar incompletos.</div>}
      <div className="am-note"><Icon name="info" size={12} />O tamanho do contexto é exato (vem do uso informado pelo modelo). A divisão entre as partes é uma estimativa pelo tamanho do que passou pelo transcrito.</div>

      {d.suggestions.length > 0 && (
        <section className="lg-card am-us__card">
          <header className="lg-card__head"><div><h3>Sugestões</h3><small>o que dá para fazer agora</small></div></header>
          <ul className="am-cx__tips">
            {d.suggestions.map((s) => <li key={s.id + s.text}><span className="am-cx__tip-t"><Icon name={s.icon} size={13} /><b className="am-priv">{s.text}</b></span><span className="lg-muted">{s.detail}</span></li>)}
          </ul>
        </section>
      )}

      <section className="lg-card am-us__card">
        <header className="lg-card__head"><div><h3>Contexto ao longo da sessão</h3><small>{d.calls} chamada(s) ao modelo</small></div></header>
        {d.series.length >= 2 ? <Growth series={d.series} window={d.window} compactions={d.compactions} /> : <div className="lg-muted">Poucas chamadas para desenhar o gráfico.</div>}
      </section>

      <section className="lg-card am-us__card">
        <header className="lg-card__head"><div><h3>Do que é feito agora</h3><small>estimativa</small></div></header>
        <Composition items={d.composition} ctx={d.ctx} />
        {d.others.length > 0 && (
          <div className="am-cx__sub"><span className="lg-muted">Em “Outros”:</span> {d.others.map((o) => <span key={o.name} className="lg-pill">{o.name} · {kTok(o.tokens)}</span>)}</div>
        )}
      </section>

      <div className="am-us__cols">
        <section className="lg-card am-us__card">
          <header className="lg-card__head"><div><h3>Base fixa</h3><small>entra em toda sessão, antes do 1º pedido</small></div></header>
          {d.base ? (
            <table className="am-us__table">
              <thead><tr><th>Parte</th><th className="is-num">Tokens</th></tr></thead>
              <tbody>{d.base.parts.map((p) => <tr key={p.name}><td className="am-priv">{p.name}</td><td className="is-num">{kTok(p.tokens)}</td></tr>)}</tbody>
            </table>
          ) : <div className="lg-muted">A base não foi lida (o começo da sessão não está no arquivo lido).</div>}
        </section>
        <section className="lg-card am-us__card">
          <header className="lg-card__head"><div><h3>Maiores consumidores</h3><small>resultados de ferramentas no contexto atual</small></div></header>
          {d.items.length === 0 && d.tools.length === 0 ? <div className="lg-muted">Nenhum resultado de ferramenta no contexto atual.</div> : (
            <>
              {d.tools.length > 0 && <div className="am-cx__sub">{d.tools.map((t) => <span key={t.tool} className="lg-pill">{t.tool} · {kTok(t.tokens)} · {t.n}×</span>)}</div>}
              {d.items.length > 0 && (
                <table className="am-us__table">
                  <thead><tr><th>Ferramenta · alvo</th><th className="is-num">Tokens</th><th className="is-num">Vezes</th></tr></thead>
                  <tbody>{d.items.map((it) => <tr key={it.tool + it.target}><td className="am-us__model am-priv" title={`${it.tool}: ${it.target}`}>{it.tool} · {tail(it.target)}</td><td className="is-num">{kTok(it.tokens)}</td><td className="is-num">{it.n}</td></tr>)}</tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
      {nonBase === 0 && <div className="lg-muted">Ainda não há nada além da base fixa neste contexto.</div>}
    </div>
  );
}
