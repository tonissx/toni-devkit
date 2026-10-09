/**
 * Pico Production — a terceira área: o cume nevado no topo do pipeline, com o datacenter cravado na rocha e uma
 * tempestade permanente (a nuvem, literalmente). Pinheiros nevados, rochas, cristais de gelo, torres de resfriamento,
 * torres de energia, blocos do datacenter e lagos congelados; neve caindo e relâmpagos ao longe. SVG puro. Ver docs §4.5.
 */

const SNOW = '#EEF6FB';
const ROCK = '#5B6474';

/** Pinheiro nevado: camadas escuras com neve acumulada nas pontas. */
export const SnowPine = React.memo(({ s = 1, v = 0 }) => {
  const j = (k) => ((((v + 1) * (k * 2 + 3) * 7919) % 7) - 3) * 0.5;
  return (
    <svg width={34 * s} height={58 * s} viewBox="0 0 34 58" aria-hidden="true">
      <rect x="15" y="48" width="4" height="10" fill="#3B2A1E" />
      <path d={`M17 3 L${5 + j(1)} 22 L${29 + j(2)} 22 Z`} fill="#1C3A3E" />
      <path d={`M17 13 L${3 + j(3)} 36 L${31 + j(4)} 36 Z`} fill="#20444A" />
      <path d={`M17 25 L${1 + j(5)} 50 L${33 + j(6)} 50 Z`} fill="#245058" />
      <path d={`M17 3 L12 12 Q17 10 22 12 Z M${5 + j(1)} 22 Q10 18 14 21 Q17 18 20 21 Q25 18 ${29 + j(2)} 22 Z`} fill={SNOW} />
      <path d={`M${3 + j(3)} 36 Q9 31 14 35 Q18 31 22 35 Q27 31 ${31 + j(4)} 36 Z M${1 + j(5)} 50 Q8 45 13 49 Q18 45 23 49 Q28 45 ${33 + j(6)} 50 Z`} fill={SNOW} opacity=".92" />
    </svg>
  );
});

/** Rocha com neve no topo. */
export const SnowRock = ({ s = 1 }) => (
  <svg width={48 * s} height={34 * s} viewBox="0 0 48 34" aria-hidden="true">
    <path d="M3 34 L8 16 L18 8 L30 10 L40 6 L46 20 L45 34 Z" fill={ROCK} stroke="#2E3440" strokeWidth="1" strokeLinejoin="round" />
    <path d="M30 10 L40 6 L46 20 L45 34 L34 34 Z" fill="#000" opacity=".2" />
    <path d="M8 16 L18 8 L30 10 L40 6 L43 13 Q36 12 31 15 Q24 12 17 15 Q12 14 8 18 Z" fill={SNOW} />
  </svg>
);

/** Cristal de gelo: lâminas azuladas brilhando. */
export const IceCrystal = ({ s = 1 }) => (
  <svg width={30 * s} height={40 * s} viewBox="0 0 30 40" aria-hidden="true">
    <path d="M15 2 L20 22 L15 38 L10 22 Z" fill="#9FD8F5" stroke="#3E7CA3" strokeWidth=".9" />
    <path d="M6 14 L11 26 L8 38 L3 26 Z M24 12 L28 26 L23 38 L20 25 Z" fill="#BEE6FA" stroke="#3E7CA3" strokeWidth=".8" />
    <path d="M15 2 L15 38" stroke="#fff" strokeWidth=".8" opacity=".6" />
    <circle cx="15" cy="10" r="1.4" fill="#fff" className="dc-led" />
  </svg>
);

/** Torre de resfriamento do datacenter, soltando vapor. */
export const CoolingTower = ({ s = 1 }) => (
  <svg width={44 * s} height={60 * s} viewBox="0 0 44 60" aria-hidden="true">
    <path className="dc-prop__steam" d="M16 14 q-6 -6 0 -12 M24 14 q5 -6 0 -12 M30 14 q4 -5 0 -9" stroke="#DCE4EA" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".55" />
    <path d="M8 60 Q14 38 10 16 L34 16 Q30 38 36 60 Z" fill="#8C96A6" stroke="#3A4250" strokeWidth="1.2" />
    <path d="M22 16 L34 16 Q30 38 36 60 L26 60 Q24 38 22 16 Z" fill="#000" opacity=".15" />
    <path d="M10 16 h24" stroke={SNOW} strokeWidth="3" strokeLinecap="round" />
    <path d="M12 44 h21" stroke="#5B6474" strokeWidth="1" />
  </svg>
);

/** Bloco do datacenter cravado na rocha: janelas com luzes de status. */
export const DataBlock = ({ s = 1, v = 0 }) => (
  <svg width={50 * s} height={46 * s} viewBox="0 0 50 46" aria-hidden="true">
    <path d="M2 46 L4 18 L14 10 L46 12 L48 46 Z" fill="#4A5262" stroke="#262C38" strokeWidth="1.2" />
    <path d="M14 10 L46 12 L48 46 L36 46 Z" fill="#000" opacity=".18" />
    <path d="M4 18 L14 10 L46 12 L46 15 L14 13 L5 21 Z" fill={SNOW} />
    {[[10, 24], [20, 24], [30, 24], [10, 34], [20, 34], [30, 34]].map(([x, y], i) => (
      <rect key={i} x={x} y={y} width="6" height="5" rx="1" fill={(v + i) % 4 === 0 ? '#FF5C5C' : '#5EE7A0'} className={(v + i) % 3 === 0 ? 'dc-led' : undefined} opacity=".9" />
    ))}
  </svg>
);

/** Torre de energia (pilone) com cabos. */
export const Pylon = ({ s = 1 }) => (
  <svg width={34 * s} height={64 * s} viewBox="0 0 34 64" aria-hidden="true">
    <path d="M9 64 L15 8 L19 8 L25 64 M11 48 L23 48 M12 34 L22 34 M13 22 L21 22 M10 56 L22 40 M24 56 L12 40" stroke="#5B6474" strokeWidth="1.8" fill="none" />
    <path d="M2 12 H32 M5 20 H29" stroke="#5B6474" strokeWidth="2" />
    <path d="M2 12 v4 M32 12 v4 M5 20 v4 M29 20 v4" stroke="#9AA3B2" strokeWidth="1.4" />
    <circle cx="17" cy="6" r="1.8" fill="#FF5C5C" className="dc-led" />
  </svg>
);

/** Neve acumulada (deitada). */
export const SnowPatch = ({ s = 1 }) => (
  <svg width={80 * s} height={34 * s} viewBox="0 0 80 34" aria-hidden="true">
    <path d="M4 18 Q6 6 26 7 Q44 2 62 8 Q78 12 76 22 Q70 32 44 30 Q12 32 4 18 Z" fill="#DCE8F0" opacity=".9" />
    <path d="M14 16 Q24 11 36 13" stroke="#fff" strokeWidth="1.4" opacity=".7" fill="none" />
  </svg>
);

/** Lago congelado (deitado), com rachaduras no gelo. */
export const FrozenPond = ({ s = 1 }) => (
  <svg width={86 * s} height={38 * s} viewBox="0 0 86 38" aria-hidden="true">
    <ellipse cx="43" cy="19" rx="41" ry="17" fill="#C9E6F5" />
    <ellipse cx="43" cy="19" rx="35" ry="13" fill="#A7D3EC" />
    <path d="M24 14 L34 20 L30 28 M34 20 L48 17 L56 24 M48 17 L52 9" stroke="#fff" strokeWidth=".9" fill="none" opacity=".8" />
  </svg>
);

/**
 * Peça de um lugar do Pico, sorteada pelo hash: pinheiros nevados e rochas na maior parte, com cristais, torres de
 * resfriamento, blocos do datacenter e torres de energia aqui e ali; neve e lagos congelados no chão.
 */
export function peakPiece(h) {
  const r = h % 100;
  const s = 0.75 + ((h >>> 8) % 30) / 100;
  const v = (h >>> 16) % 1000;
  if (r < 44) return { C: SnowPine, upright: true, w: 34 * s * 1.15, props: { s: s * 1.15, v } };
  if (r < 58) return { C: SnowRock, upright: true, w: 48 * s * 0.8, props: { s: s * 0.8 } };
  if (r < 65) return { C: IceCrystal, upright: true, w: 30, props: { s: 0.95 } };
  if (r < 70) return { C: CoolingTower, upright: true, w: 44 * 0.85, props: { s: 0.85 } };
  if (r < 75) return { C: DataBlock, upright: true, w: 50 * 0.8, props: { s: 0.8, v } };
  if (r < 79) return { C: Pylon, upright: true, w: 34 * 0.85, props: { s: 0.85 } };
  if (r < 92) return { C: SnowPatch, upright: false, props: { s: 0.7 + ((h >>> 5) % 30) / 100 } };
  return { C: FrozenPond, upright: false, props: { s: 0.75 } };
}

/** Neve caindo (no tabuleiro ou na arena). */
export function Snowfall({ n = 30, seed = 's' }) {
  const hash = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619); return x >>> 0; };
  return (
    <div className="dc-snow" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ left: `${hash(seed + 'x' + i) % 100}%`, animationDelay: `${-((hash(seed + 'd' + i) % 900) / 100)}s`, animationDuration: `${6 + (hash(seed + 't' + i) % 50) / 10}s`, '--sz': `${2 + (hash(seed + 'z' + i) % 3)}px` }} />
      ))}
    </div>
  );
}

/** Fundo da arena: plataforma de pedra no cume, montanhas, a tempestade e relâmpagos ao longe. */
export function PeakBackdrop() {
  return (
    <div className="dc-arena__backdrop is-peak" aria-hidden="true">
      <svg className="dc-peak__range" viewBox="0 0 400 120" preserveAspectRatio="none">
        <path d="M0 120 L0 80 L40 50 L70 70 L110 30 L150 64 L190 20 L230 58 L270 36 L310 70 L350 40 L400 74 L400 120 Z" fill="#232B3A" />
        <path d="M110 30 L124 44 L116 46 L104 40 Z M190 20 L206 36 L196 38 L182 30 Z M270 36 L284 48 L272 50 Z M350 40 L362 52 L352 52 Z" fill="#C9D6E2" opacity=".7" />
        <path d="M0 120 L0 96 L60 80 L120 98 L180 76 L250 96 L320 82 L400 98 L400 120 Z" fill="#1A2130" />
      </svg>
      <i className="dc-arena__lightning" />
      <span style={{ left: '2%', bottom: 28 }}><SnowPine s={1.7} v={2} /></span>
      <span style={{ left: '17%', bottom: 30, opacity: 0.7 }}><CoolingTower s={1.2} /></span>
      <span style={{ right: '16%', bottom: 30, opacity: 0.7 }}><DataBlock s={1.3} v={3} /></span>
      <span style={{ right: '2%', bottom: 28 }}><SnowPine s={1.8} v={5} /></span>
      <Snowfall n={26} seed="arena" />
    </div>
  );
}
