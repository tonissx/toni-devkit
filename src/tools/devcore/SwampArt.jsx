/**
 * Pântano Staging — a segunda área: brejo turvo de "quase produção". Mangues com raízes de cabo, ciprestes mortos
 * com barba-de-velho, juncos, servidores afundados, postes com lanterna de CI, vitórias-régias de badge e poças.
 * Os vaga-lumes da floresta viram fogos-fátuos do CI (verde ✓ / vermelho ✗). SVG puro, cores fixas da área. Ver docs §4.5.
 */

const MOSS = '#4E7A3A';
const MURK = '#1B3A3A';

/** Mangue: tronco curto sobre raízes arqueadas (algumas são cabos), copa baixa e larga. */
export const Mangrove = React.memo(({ s = 1, v = 0 }) => {
  const j = (k) => ((((v + 1) * (k * 2 + 5) * 7919) % 7) - 3) * 0.6;
  return (
    <svg width={56 * s} height={64 * s} viewBox="0 0 56 64" aria-hidden="true">
      {/* raízes: madeira e cabos */}
      <path d={`M28 40 Q16 46 ${8 + j(1)} 63 M28 40 Q22 50 ${18 + j(2)} 63 M28 40 Q36 50 ${40 + j(3)} 63 M28 40 Q42 46 ${49 + j(4)} 63`} stroke="#3B2A1E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d={`M28 42 Q30 52 ${30 + j(5)} 63`} stroke="#2B3240" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx={30 + j(5)} cy="62" r="1.4" fill="#5EE7A0" className="dc-led" />
      <path d="M25 42 L26 24 Q28 20 31 24 L32 42 Z" fill="#45311F" />
      {/* copa baixa e larga */}
      <ellipse cx="28" cy="22" rx="26" ry="12" fill="#1F4A35" />
      <ellipse cx={18 + j(6)} cy="17" rx="14" ry="9" fill="#2A5E44" />
      <ellipse cx={38 + j(7)} cy="16" rx="13" ry="8.5" fill="#2E6A4C" />
      <ellipse cx="28" cy="11" rx="11" ry="7" fill="#357A57" />
      {/* barba-de-velho pendurada */}
      <path d="M10 26 q1 6 -1 10 M20 29 q1 5 0 9 M40 28 q1 6 -1 9 M47 25 q1 5 0 8" stroke="#8FA88A" strokeWidth="1.1" fill="none" opacity=".75" />
    </svg>
  );
});

/** Cipreste morto: tronco fino e torto, galhos secos e musgo pendurado. */
export const Cypress = React.memo(({ s = 1, v = 0 }) => {
  const b = ((v % 5) - 2) * 1.5;
  return (
    <svg width={40 * s} height={78 * s} viewBox="0 0 40 78" aria-hidden="true">
      <path d={`M18 78 Q16 60 ${20 + b} 40 Q22 24 ${19 - b} 6 L22 6 Q25 24 ${23 + b} 40 Q21 60 23 78 Z`} fill="#4A3A2C" />
      <path d={`M${21 + b} 34 L6 24 M${20 - b * 0.5} 22 L33 12 M${21} 50 L34 42 M${20} 16 L9 9`} stroke="#4A3A2C" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 24 q1 7 -1 12 M9 9 q1 6 0 10 M33 12 q1 7 -1 12 M34 42 q1 6 0 9" stroke="#8FA88A" strokeWidth="1.3" fill="none" opacity=".8" />
      <path d="M18 74 q4 -3 8 0" stroke={MOSS} strokeWidth="2.4" fill="none" />
    </svg>
  );
});

/** Juncos/taboas: hastes com espigas marrons. */
export const Reeds = ({ s = 1 }) => (
  <svg width={36 * s} height={42 * s} viewBox="0 0 36 42" aria-hidden="true">
    {[[6, -8], [12, -3], [18, 2], [24, -2], [30, 7]].map(([x, a], i) => (
      <g key={i} transform={`rotate(${a} ${x} 42)`}>
        <path d={`M${x} 42 V${10 + (i % 2) * 6}`} stroke="#5E8A43" strokeWidth="1.6" />
        {i % 2 === 0 && <rect x={x - 1.8} y={8 + (i % 3) * 3} width="3.6" height="9" rx="1.8" fill="#7A4E2A" />}
      </g>
    ))}
    <path d="M2 42 q6 -14 10 -22 M34 42 q-5 -12 -8 -20" stroke="#6E9C4E" strokeWidth="1.2" fill="none" />
  </svg>
);

/** Servidor afundado: um rack meio submerso, inclinado, com um LED que ainda pisca. */
export const SunkenRack = ({ s = 1 }) => (
  <svg width={34 * s} height={40 * s} viewBox="0 0 34 40" aria-hidden="true">
    <g transform="rotate(-12 17 30)">
      <rect x="6" y="4" width="22" height="32" rx="2" fill="#2B3240" stroke="#141820" strokeWidth="1.2" />
      {[9, 15, 21, 27].map((y) => <rect key={y} x="9" y={y} width="16" height="3.6" rx="1" fill="#3A4354" />)}
      <circle cx="23" cy="10.8" r="1.2" fill="#FF5C5C" className="dc-led" />
      <circle cx="23" cy="16.8" r="1.2" fill="#5EE7A0" className="dc-led" style={{ animationDelay: '.8s' }} />
      <path d="M6 22 q6 -4 11 0 q5 4 11 0" stroke={MOSS} strokeWidth="2.2" fill="none" />
    </g>
    <ellipse cx="17" cy="37" rx="16" ry="3.4" fill="#1F4E52" opacity=".85" />
  </svg>
);

/** Poste com lanterna de CI: luz verde ou vermelha (o status do último build). */
export const CiLantern = ({ s = 1, ok = true }) => (
  <svg width={22 * s} height={56 * s} viewBox="0 0 22 56" aria-hidden="true">
    <path d="M10 56 L11 14 L12 56 Z" fill="#4A3A2C" />
    <path d="M11 14 q6 0 6 6" stroke="#4A3A2C" strokeWidth="1.6" fill="none" />
    <rect x="13" y="20" width="8" height="10" rx="2" fill="#2B3240" />
    <rect x="14.5" y="21.5" width="5" height="7" rx="1.5" fill={ok ? '#5EE7A0' : '#FF5C5C'} className="dc-led" />
    <circle cx="17" cy="25" r="8" fill={ok ? '#5EE7A0' : '#FF5C5C'} opacity=".14" />
  </svg>
);

/** Vitória-régia (deitada): folha redonda com um badge ✓ de status. */
export const LilyPad = ({ s = 1, ok = true }) => (
  <svg width={46 * s} height={30 * s} viewBox="0 0 46 30" aria-hidden="true">
    <ellipse cx="23" cy="15" rx="21" ry="13" fill="#2E6A4C" />
    <path d="M23 15 L44 13 A21 13 0 0 0 40 7 Z" fill={MURK} />
    <path d="M23 15 L6 9 M23 15 L10 25 M23 15 L33 26" stroke="#3E8A5E" strokeWidth=".9" />
    <circle cx="16" cy="14" r="4.6" fill={ok ? '#5EE7A0' : '#FF5C5C'} opacity=".9" />
    <path d={ok ? 'M13.8 14 l1.6 1.6 l3 -3.2' : 'M14 12 l4 4 M18 12 l-4 4'} stroke="#0E1D19" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);

/** Poça de água turva (deitada), com reflexo. */
export const Puddle = ({ s = 1 }) => (
  <svg width={90 * s} height={40 * s} viewBox="0 0 90 40" aria-hidden="true">
    <path d="M6 20 Q4 6 30 6 Q52 2 74 8 Q90 14 84 26 Q76 38 46 36 Q12 38 6 20 Z" fill="#163636" />
    <path d="M12 20 Q12 10 32 10 Q52 7 70 12 Q82 17 78 25 Q70 33 46 31 Q18 32 12 20 Z" fill="#1F4E52" />
    <ellipse className="dc-ripple" cx="43" cy="20" rx="20" ry="6" fill="none" stroke="#7FD9E0" strokeWidth=".8" opacity=".5" />
    <path d="M26 15 q8 -2 14 0" stroke="#9FE6EA" strokeWidth=".9" opacity=".35" />
  </svg>
);

/**
 * Peça de um lugar do pântano, sorteada pelo hash: mangues e ciprestes (bem mais espaçados que a floresta), juncos,
 * vitórias-régias e poças entre eles; às vezes um servidor afundado ou uma lanterna de CI.
 */
export function swampPiece(h) {
  const r = h % 100;
  const s = 0.75 + ((h >>> 8) % 30) / 100;
  const v = (h >>> 16) % 1000;
  if (r < 30) return { C: Mangrove, upright: true, w: 56 * s * 0.85, props: { s: s * 0.85, v } };
  if (r < 46) return { C: Cypress, upright: true, w: 40 * s * 0.9, props: { s: s * 0.9, v } };
  if (r < 62) return { C: Reeds, upright: true, w: 36, props: { s: 0.95 } };
  if (r < 68) return { C: SunkenRack, upright: true, w: 34, props: { s: 0.95 } };
  if (r < 72) return { C: CiLantern, upright: true, w: 22, props: { s: 1, ok: (h & 1) === 0 } };
  if (r < 86) return { C: LilyPad, upright: false, props: { s: 0.8, ok: (h >>> 3) % 3 !== 0 } };
  return { C: Puddle, upright: false, props: { s: 0.7 + ((h >>> 5) % 30) / 100 } };
}

/** Fogos-fátuos do CI (no tabuleiro ou na arena): luzes que flutuam e alternam verde/vermelho. */
export function Wisps({ n = 14, seed = 'w', band = null }) {
  const hash = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619); return x >>> 0; };
  return (
    <div className="dc-wisps" aria-hidden="true" style={band ? { height: band } : undefined}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={hash(seed + 'c' + i) % 3 === 0 ? 'is-fail' : ''}
          style={{ left: `${(hash(seed + 'x' + i) % 94) + 3}%`, top: `${(hash(seed + 'y' + i) % 86) + 6}%`, animationDelay: `${(i * 0.9) % 6}s` }} />
      ))}
    </div>
  );
}

/** Fundo da arena: clareira alagada no Pântano Staging à noite (mangues, ciprestes, névoa e fogos-fátuos). */
export function SwampBackdrop() {
  return (
    <div className="dc-arena__backdrop is-swamp" aria-hidden="true">
      <span style={{ left: '1%', bottom: 28 }}><Mangrove s={1.9} v={3} /></span>
      <span style={{ left: '20%', bottom: 34, opacity: 0.6 }}><Cypress s={1.6} v={1} /></span>
      <span style={{ right: '18%', bottom: 34, opacity: 0.6 }}><Cypress s={1.8} v={4} /></span>
      <span style={{ right: '1%', bottom: 28 }}><Mangrove s={2} v={7} /></span>
      <span style={{ left: '44%', bottom: 30, opacity: 0.5 }}><CiLantern s={1.3} ok={false} /></span>
      <i className="dc-arena__fog" />
      <Wisps n={10} seed="arena" />
    </div>
  );
}
