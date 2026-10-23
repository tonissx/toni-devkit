// Monitor de IA — sinais de "vida" no card da sessão: o pulso (consumo dos últimos 30 min) e o anel de contexto.
// Só desenho: os números vêm do processo principal (electron/aimon/vitals.js e state.js → context).
import { fmtCompact } from '../../lib/fmt.jsx';

const W = 84;
const H = 18;

/** Linha suave do consumo (tokens por minuto) nos últimos 30 min. `live`: sessão trabalhando — a ponta pulsa. */
export function Pulse({ data, live }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(1, ...data);
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => [i * step, H - 2 - (v / max) * (H - 5)]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const mx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <span className={'am-pulse' + (live ? ' is-live' : '')} title={`Consumo nos últimos 30 min: ~${fmtCompact(total)} tokens (sem contar leitura de cache)`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Consumo de tokens nos últimos 30 minutos">
        <path className="am-pulse__area" d={`${d} L${W},${H} L0,${H} Z`} />
        <path className="am-pulse__line" d={d} />
        <circle className="am-pulse__dot" cx={last[0]} cy={last[1]} r={2.2} />
      </svg>
    </span>
  );
}

const R = 8;
const C = 2 * Math.PI * R;

/** Anel de contexto: quanto da janela de contexto a última chamada ocupou (estimativa). Verde < 60 %, âmbar até 85 %, depois vermelho. */
export function ContextRing({ ctx }) {
  if (!ctx || !Number.isFinite(ctx.pct)) return null;
  const pct = Math.max(0, Math.min(100, ctx.pct));
  const tone = pct >= 85 ? 'is-hot' : pct >= 60 ? 'is-warn' : 'is-ok';
  return (
    <span className={'am-ring ' + tone} title={`Contexto ~${pct}% ocupado: ${fmtCompact(ctx.tokens)} de uns ${fmtCompact(ctx.limit)} tokens (estimativa). Perto do limite a sessão perde qualidade ou compacta sozinha.`}>
      <svg width={22} height={22} viewBox="0 0 22 22" role="img" aria-label={`Contexto ${pct}% ocupado`}>
        <circle className="am-ring__bg" cx={11} cy={11} r={R} />
        <circle className="am-ring__arc" cx={11} cy={11} r={R} strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 11 11)" />
      </svg>
      <b>{pct}%</b>
    </span>
  );
}
