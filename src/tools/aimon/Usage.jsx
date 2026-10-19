// Monitor de IA — "Uso": quanto, quando e onde a IA foi usada (tokens, custo estimado, tempo trabalhando e tempo esperando
// por você). As métricas diárias são só números, guardadas em %APPDATA%\Toni Devkit\aimon-usage.json (electron/aimon/usage.js);
// o custo é uma ESTIMATIVA a partir dos tokens e de uma tabela de preços que você pode ajustar. Nada sai da máquina.
import { DS } from '../../lib/ds.js';
import { Stat, useWidth, niceTicks } from '../../lib/charts.jsx';
import { errText, fmtCompact, fmtNum } from '../../lib/fmt.jsx';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';
import { dur } from './Lanes.jsx';
import { diaryInput } from './aiInput.js';

const { Icon, Spinner, EmptyState, SegmentedControl } = DS;

const api = () => window.devkit.aimon;

const RANGES = [{ value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }];
const METRICS = [{ value: 'cost', label: 'Custo' }, { value: 'tokens', label: 'Tokens' }, { value: 'wait', label: 'Espera' }];
const H = 150;
const PAD = { l: 44, r: 8, t: 8, b: 22 };

const usd = (v) => (v == null || !Number.isFinite(v) ? '—' : 'US$ ' + v.toFixed(v < 100 ? 2 : 0).replace('.', ','));
const pct = (v) => Math.round(v * 100) + '%';
const dayLabel = (day) => { const [, m, d] = day.split('-'); return `${d}/${m}`; };
const longDay = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }); };
const metricOf = (r, metric) => (metric === 'cost' ? r.cost : metric === 'tokens' ? r.tokens : r.waitMs);
const fmtMetric = (v, metric) => (metric === 'cost' ? usd(v) : metric === 'tokens' ? fmtCompact(v) + ' tok' : dur(v));
const tickMetric = (v, metric) => (metric === 'cost' ? '$' + (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) : metric === 'tokens' ? fmtCompact(v) : v >= 3600e3 ? (v / 3600e3).toFixed(1).replace('.', ',') + ' h' : Math.round(v / 60e3) + ' min');

/** Barras por dia (SVG próprio, no padrão dos gráficos do devkit: grade fina, barras com ponta arredondada). */
function DayBars({ series, metric }) {
  const ref = React.useRef(null);
  const w = Math.max(240, useWidth(ref, 600));
  const [tip, setTip] = React.useState(null);
  const max = Math.max(0, ...series.map((r) => metricOf(r, metric)));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = w - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const slot = plotW / series.length;
  const bw = Math.min(24, Math.max(2, slot * 0.7));
  const y = (v) => PAD.t + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotW / 54))));
  return (
    <div className="am-us__chart" ref={ref}>
      <svg width={w} height={H} role="img" aria-label={`${METRICS.find((m) => m.value === metric).label} por dia`} onPointerLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t) + 0.5} y2={y(t) + 0.5} className="lg-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="lg-tick">{tickMetric(t, metric)}</text>
          </g>
        ))}
        {series.map((r, i) => {
          const v = metricOf(r, metric);
          const cx = PAD.l + slot * i + slot / 2;
          const bh = Math.max(v > 0 ? 2 : 0, (v / top) * plotH);
          return (
            <g key={r.day} onPointerMove={() => setTip({ r, left: Math.min(Math.max(4, cx - 70), w - 190) })}>
              <rect x={cx - slot / 2} y={PAD.t} width={slot} height={plotH} fill="transparent" />
              <rect x={cx - bw / 2} y={PAD.t + plotH - bh} width={bw} height={bh} rx={3} className={'am-us__col' + (metric === 'wait' ? ' is-wait' : '')} />
              {i % every === 0 && <text x={cx} y={H - 6} textAnchor="middle" className="lg-tick">{dayLabel(r.day)}</text>}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="lg-tip am-tip" style={{ left: tip.left, top: 0 }}>
          <div className="lg-tip__when">{longDay(tip.r.day)}</div>
          <div className="lg-tip__row"><b>{fmtMetric(metricOf(tip.r, metric), metric)}</b><span>{tip.r.sessions} sessão(ões)</span></div>
          <div className="lg-tip__row"><span>{usd(tip.r.cost)} · {fmtCompact(tip.r.tokens)} tok</span></div>
          <div className="lg-tip__row"><span>trabalhando {dur(tip.r.workMs)} · esperando {dur(tip.r.waitMs)}</span></div>
        </div>
      )}
    </div>
  );
}

/** Preços por modelo (US$ por 1 milhão de tokens). Vazio = padrão da estimativa. */
function Prices({ models, onSaved, toast }) {
  const [draft, setDraft] = React.useState(() => Object.fromEntries(models.map((m) => [m.model, m.price && m.price.custom ? { input: String(m.price.input), output: String(m.price.output) } : { input: '', output: '' }])));
  const [saving, setSaving] = React.useState(false);
  const set = (model, k, v) => setDraft((d) => ({ ...d, [model]: { ...d[model], [k]: v } }));
  const num = (s) => Number(String(s).replace(',', '.'));
  const save = async (reset) => {
    const prices = {};
    if (!reset) for (const [model, v] of Object.entries(draft)) if (v.input !== '' && v.output !== '' && Number.isFinite(num(v.input)) && Number.isFinite(num(v.output))) prices[model] = { input: num(v.input), output: num(v.output) };
    setSaving(true);
    try { await api().setPrices(prices); toast('Preços salvos', reset ? 'Voltaram os padrões da estimativa.' : 'A estimativa de custo foi recalculada.', 'ok'); onSaved(); } catch (e) { toast('Monitor de IA', errText(e), 'error'); } finally { setSaving(false); }
  };
  return (
    <div className="am-us__prices">
      <p className="lg-muted">US$ por 1 milhão de tokens. O cache lido custa 10% da entrada e o gravado 125% (regra da Anthropic). Deixe em branco para usar o padrão; modelos sem preço (ex.: Codex) ficam fora da soma.</p>
      {models.length === 0 ? <div className="lg-muted">Nenhum modelo no período.</div> : (
        <table className="am-us__table">
          <thead><tr><th>Modelo</th><th className="is-num">Entrada</th><th className="is-num">Saída</th><th>Padrão</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model}>
                <td className="am-us__model">{m.model}</td>
                <td className="is-num"><input className="am-us__in" inputMode="decimal" aria-label={`Preço de entrada de ${m.model}`} value={draft[m.model].input} onChange={(e) => set(m.model, 'input', e.target.value)} /></td>
                <td className="is-num"><input className="am-us__in" inputMode="decimal" aria-label={`Preço de saída de ${m.model}`} value={draft[m.model].output} onChange={(e) => set(m.model, 'output', e.target.value)} /></td>
                <td className="lg-muted">{m.price && !m.price.custom ? `${m.price.input} / ${m.price.output}` : m.price ? 'personalizado' : 'sem preço'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="am-us__row">
        <button type="button" className="lg-btn is-primary" disabled={saving} onClick={() => save(false)}><Icon name="check" size={12} /><span>Salvar preços</span></button>
        <button type="button" className="lg-btn" disabled={saving} onClick={() => save(true)}>Voltar aos padrões</button>
      </div>
    </div>
  );
}

/** Diário de bordo: o que as sessões de hoje fizeram, em texto para a sua daily, uma nota ou um PR. */
function Diary({ toast }) {
  const cfg = useAiMode();
  const diary = useAiTask('aimonDiary', cfg);
  const reason = aiOn(cfg) ? null : 'IA desligada';
  const gather = async () => {
    const [day, u] = await Promise.all([api().dayDigest(), api().usage(1)]);
    if (!day.sessions.length) { toast('Sem atividade hoje', 'Nenhuma sessão com atividade desde a meia-noite.', 'warn'); return null; }
    const t = (u && u.totals) || {};
    return diaryInput(day, { workMs: t.workMs, waitMs: t.waitMs, tokens: t.total, cost: t.cost });
  };
  const saveNote = async () => {
    const st = diary.st;
    if (!st || !st.text) return;
    try {
      const date = new Date().toLocaleDateString('pt-BR');
      await window.devkit.notes.create({ title: `Diário de bordo — ${date}`, content: st.text, tags: ['diario', 'ia'] });
      toast('Nota criada', `“Diário de bordo — ${date}” está nas Notes.`, 'ok');
    } catch (e) { toast('Não foi possível criar a nota', errText(e), 'error'); }
  };
  return (
    <div className="am-us__diary">
      <div className="am-ai__bar">
        <AiButton ai={diary} label="Diário de bordo de hoje" disabled={!!reason} reason={reason} onClick={() => diary.start(gather)}
          title="A IA resume o que as sessões de hoje fizeram (pedidos, arquivos, commits) em um texto para a daily, uma nota ou um PR" />
      </div>
      <div className="am-priv"><AiPanel ai={diary} actions={[{ label: 'Salvar como nota', icon: 'notebook-pen', onClick: saveNote }]} /></div>
    </div>
  );
}

export function Usage({ rev, toast }) {
  const [days, setDays] = React.useState('7');
  const [metric, setMetric] = React.useState('cost');
  const [data, setData] = React.useState(null);
  const [prices, setPrices] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const last = React.useRef(0);
  const dayRef = React.useRef('7');
  dayRef.current = days;

  const load = React.useCallback((force) => {
    const at = Date.now();
    if (!force && at - last.current < 8000) return; // o aviso do processo principal vem a cada 1,5 s: não recalcula a cada um
    last.current = at;
    api().usage(Number(dayRef.current)).then(setData, (e) => toast('Monitor de IA', errText(e), 'error'));
  }, []);
  React.useEffect(() => { load(true); }, [days]);
  React.useEffect(() => { load(false); }, [rev]);

  if (!data) return <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>;
  const t = data.totals;
  const empty = !t.total && !t.workMs && !t.waitMs;
  const clear = async () => { try { await api().usageClear(); setConfirm(false); toast('Métricas apagadas', 'O histórico de uso foi esquecido.', 'ok'); load(true); } catch (e) { toast('Monitor de IA', errText(e), 'error'); } };

  return (
    <div className="am-us tk-scroll">
      <div className="am-us__bar">
        <SegmentedControl size="sm" options={RANGES} value={days} onChange={setDays} />
        <div className="am-us__actions">
          <button type="button" className={'lg-btn' + (prices ? ' is-accent' : '')} aria-pressed={prices} onClick={() => setPrices((v) => !v)} title="Ajusta os preços usados na estimativa de custo"><Icon name="coins" size={12} /><span>Preços</span></button>
          {confirm
            ? <><button type="button" className="lg-btn is-accent" onClick={clear}>Apagar tudo?</button><button type="button" className="lg-btn" onClick={() => setConfirm(false)}>Cancelar</button></>
            : <button type="button" className="lg-btn" onClick={() => setConfirm(true)} title="Apaga o histórico de métricas guardado neste computador"><Icon name="trash-2" size={12} /><span>Esquecer métricas</span></button>}
        </div>
      </div>

      <Diary toast={toast} />

      {empty ? (
        <EmptyState title="Ainda não há métricas" animate="none" description="As métricas começam a ser guardadas quando o Monitor de IA acompanha as sessões (tela aberta, segundo plano ou avisos ligados). Volte depois de usar o Claude Code ou o Codex." />
      ) : (
        <>
          <div className="lg-stats">
            <Stat label="Custo estimado" value={usd(t.cost)} note={t.savings > 0.005 ? `cache poupou ${usd(t.savings)}` : 'a partir dos tokens'} />
            <Stat label="Tokens" value={fmtCompact(t.total)} note={`${fmtCompact(t.tokens.output)} de saída`} />
            <Stat label="Trabalhando" value={dur(t.workMs)} note="somado, todas as sessões" />
            <Stat label="Esperando você" value={dur(t.waitMs)} note={`${pct(t.waitShare)} do tempo · ${fmtNum(t.waitCount)} pausa(s)`} tone={t.waitShare >= 0.3 ? 'warn' : undefined} />
            <Stat label="Sessões" value={fmtNum(t.sessions)} note={`${fmtNum(t.agents)} subagente(s)`} />
          </div>
          {t.waitShare >= 0.3 && <div className="am-note"><Icon name="hand" size={12} />Os agentes passaram {pct(t.waitShare)} do tempo parados esperando por você. Aprovar permissões com mais frequência (allowlist) ou ligar os avisos do sistema reduz essa espera.</div>}
          {data.unpriced.length > 0 && <div className="am-note"><Icon name="info" size={12} />Sem preço para: {data.unpriced.join(', ')} — esses tokens ficam fora do custo. Defina o preço em “Preços”.</div>}

          <section className="lg-card am-us__card">
            <header className="lg-card__head">
              <div><h3>Por dia</h3><small>{data.series.length} dias · dia local</small></div>
              <SegmentedControl size="sm" options={METRICS} value={metric} onChange={setMetric} />
            </header>
            <DayBars series={data.series} metric={metric} />
          </section>

          <div className="am-us__cols">
            <section className="lg-card am-us__card">
              <header className="lg-card__head"><div><h3>Por modelo</h3><small>custo estimado</small></div></header>
              <table className="am-us__table">
                <thead><tr><th>Modelo</th><th className="is-num">Tokens</th><th className="is-num">Custo</th></tr></thead>
                <tbody>{data.byModel.map((m) => <tr key={m.model}><td className="am-us__model" title={m.model}>{m.model}</td><td className="is-num">{fmtCompact(m.total)}</td><td className="is-num">{m.cost == null ? 'sem preço' : usd(m.cost)}</td></tr>)}</tbody>
              </table>
            </section>
            <section className="lg-card am-us__card">
              <header className="lg-card__head"><div><h3>Por projeto</h3><small>onde a IA mais trabalhou</small></div></header>
              <table className="am-us__table">
                <thead><tr><th>Projeto</th><th className="is-num">Custo</th><th className="is-num">Trabalho</th><th className="is-num">Espera</th></tr></thead>
                <tbody>{data.byProject.slice(0, 12).map((p) => <tr key={p.project}><td className="am-us__model am-priv" title={p.project}>{p.project}</td><td className="is-num">{usd(p.cost)}</td><td className="is-num">{dur(p.workMs)}</td><td className="is-num">{dur(p.waitMs)}</td></tr>)}</tbody>
              </table>
            </section>
          </div>

          {(data.plans.approved + data.plans.rejected) > 0 && (
            <section className="lg-card am-us__card">
              <header className="lg-card__head"><div><h3>Planos</h3><small>respondidos no período</small></div></header>
              <div className="am-us__row">
                <span className="am-pstatus is-ok"><Icon name="circle-check" size={12} />{data.plans.approved} aprovado(s)</span>
                <span className="am-pstatus is-no"><Icon name="circle-x" size={12} />{data.plans.rejected} recusado(s)</span>
                <span className="lg-muted">{pct(data.plans.approved / (data.plans.approved + data.plans.rejected))} de aprovação</span>
              </div>
            </section>
          )}
        </>
      )}

      {prices && <section className="lg-card am-us__card"><header className="lg-card__head"><div><h3>Preços</h3><small>base da estimativa de custo</small></div></header><Prices key={data.byModel.map((m) => m.model).join('|')} models={data.byModel} onSaved={() => load(true)} toast={toast} /></section>}
    </div>
  );
}
