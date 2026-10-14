/**
 * Floresta Localhost — a primeira área como uma floresta tecnológica: árvores de circuito, pinheiros de fibra óptica,
 * cogumelos-pendrive, tocos-capacitor, pedras-chip, samambaias de cabo, lagos de dados e vaga-lumes de LED.
 * SVG puro (cores fixas da área); "em pé" (upright) ou deitado no tabuleiro (flat). Ver docs §4.5.
 */

import { swampPiece, Wisps } from './SwampArt.jsx';
import { peakPiece, Snowfall } from './PeakArt.jsx';

const LED = '#7CF5B0';
const CYAN = '#5EE7FF';

/** Árvore de circuito: tronco com trilhas de placa e copa em camadas com LEDs. */
export const CircuitTree = ({ s = 1 }) => (
  <svg width={70 * s} height={96 * s} viewBox="0 0 70 96" aria-hidden="true">
    <path d="M30 96 L31 58 Q35 54 39 58 L40 96 Z" fill="#4A3426" />
    <path d="M33 92 V70 h3 V62 M37 88 v-8 h-3" stroke="#C9A227" strokeWidth="1.3" fill="none" opacity=".8" />
    <circle cx="36" cy="62" r="1.5" fill="#C9A227" />
    <ellipse cx="35" cy="44" rx="30" ry="22" fill="#1F5E3D" />
    <ellipse cx="26" cy="34" rx="20" ry="16" fill="#2A7A4F" />
    <ellipse cx="44" cy="30" rx="18" ry="15" fill="#2F8A59" />
    <ellipse cx="35" cy="20" rx="15" ry="13" fill="#38A066" />
    <path d="M18 44 h10 v-6 h8 M40 40 h12 v8 M30 26 h10 v-6" stroke="#9BF0C2" strokeWidth="1.2" fill="none" opacity=".55" />
    {[[18, 44], [52, 48], [36, 20], [28, 38], [46, 30]].map(([x, y], i) => <circle key={i} className="dc-led" style={{ animationDelay: `${i * 0.4}s` }} cx={x} cy={y} r="2.2" fill={LED} />)}
  </svg>
);

/** Pinheiro de fibra óptica: camadas escuras com pontas brilhando. */
export const FiberPine = ({ s = 1 }) => (
  <svg width={52 * s} height={92 * s} viewBox="0 0 52 92" aria-hidden="true">
    <rect x="23" y="72" width="6" height="20" fill="#3B2A1E" />
    <path d="M26 6 L44 36 H8 Z" fill="#17473A" /><path d="M26 22 L48 56 H4 Z" fill="#1B5444" /><path d="M26 40 L51 76 H1 Z" fill="#1F6150" />
    {[[26, 6], [8, 36], [44, 36], [4, 56], [48, 56], [1, 76], [51, 76]].map(([x, y], i) => <circle key={i} className="dc-led" style={{ animationDelay: `${i * 0.3}s` }} cx={x} cy={y} r="2" fill={CYAN} />)}
    <path d="M26 10 V70" stroke={CYAN} strokeWidth=".8" opacity=".35" />
  </svg>
);

/** Cogumelo-pendrive: chapéu vermelho com pontos-pixel, caule em forma de conector USB. */
export const UsbShroom = ({ s = 1 }) => (
  <svg width={34 * s} height={40 * s} viewBox="0 0 34 40" aria-hidden="true">
    <rect x="12" y="20" width="10" height="16" rx="1" fill="#C8CDD6" /><rect x="14" y="31" width="2" height="3" fill="#5B6270" /><rect x="18" y="31" width="2" height="3" fill="#5B6270" />
    <path d="M2 22 Q17 0 32 22 Z" fill="#D9443A" />
    <rect x="9" y="12" width="4" height="4" fill="#FFF3E0" /><rect x="19" y="9" width="4" height="4" fill="#FFF3E0" /><rect x="24" y="16" width="3" height="3" fill="#FFF3E0" />
  </svg>
);

/** Toco-capacitor: cilindro azul com a faixa de polaridade. */
export const CapStump = ({ s = 1 }) => (
  <svg width={30 * s} height={34 * s} viewBox="0 0 30 34" aria-hidden="true">
    <rect x="5" y="8" width="20" height="24" fill="#22406B" /><rect x="5" y="8" width="5" height="24" fill="#C8CDD6" opacity=".8" />
    <ellipse cx="15" cy="8" rx="10" ry="4" fill="#335A93" /><path d="M10 6 L20 10 M20 6 L10 10" stroke="#9FB8DA" strokeWidth="1" />
    <path d="M3 32 Q8 28 12 32 M18 32 Q23 28 27 32" stroke="#3D7A4F" strokeWidth="2" fill="none" />
  </svg>
);

/** Samambaia de cabos: folhas verdes com terminais brilhando. */
export const CableFern = ({ s = 1 }) => (
  <svg width={46 * s} height={34 * s} viewBox="0 0 46 34" aria-hidden="true">
    {[-50, -25, 0, 25, 50].map((a, i) => (
      <g key={i} transform={`rotate(${a} 23 34)`}><path d="M23 34 Q20 18 23 4" stroke="#2F8A59" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="23" cy="4" r="2" className="dc-led" style={{ animationDelay: `${i * 0.25}s` }} fill={LED} /></g>
    ))}
  </svg>
);

/** Pedra-chip (deitada): um processador antigo coberto de musgo. */
export const ChipRock = ({ s = 1 }) => (
  <svg width={54 * s} height={40 * s} viewBox="0 0 54 40" aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => <rect key={'t' + i} x={9 + i * 7} y="1" width="2.5" height="6" fill="#9AA3B2" />)}
    {Array.from({ length: 6 }, (_, i) => <rect key={'b' + i} x={9 + i * 7} y="33" width="2.5" height="6" fill="#9AA3B2" />)}
    <rect x="5" y="6" width="44" height="28" rx="3" fill="#2B3240" /><rect x="15" y="12" width="24" height="16" rx="2" fill="#3A4354" />
    <path d="M5 26 Q14 20 22 30 Q30 24 40 34 L5 34 Z" fill="#2F7A4A" opacity=".85" />
  </svg>
);

/** Lago de dados (deitado): água azul brilhante com bits flutuando. */
export const DataPond = ({ s = 1 }) => (
  <svg width={86 * s} height={40 * s} viewBox="0 0 86 40" aria-hidden="true">
    <ellipse cx="43" cy="20" rx="42" ry="18" fill="#123A4F" /><ellipse cx="43" cy="20" rx="36" ry="14" fill="#1A5C7A" />
    <ellipse className="dc-ripple" cx="43" cy="20" rx="20" ry="7" fill="none" stroke={CYAN} strokeWidth="1" opacity=".6" />
    <text x="20" y="24" fontSize="8" fontFamily="monospace" fill={CYAN} opacity=".75">1011</text>
    <text x="50" y="18" fontSize="8" fontFamily="monospace" fill={CYAN} opacity=".6">01</text>
  </svg>
);

/**
 * Pinheiro low-poly leve (sem animação), como uma miniatura de papelão: três camadas de galhos com bordas irregulares,
 * ponta um pouco torta, duas faces de tons diferentes e textura de agulhas (riscos escuros e pontos de luz).
 * `v` (0–999) sorteia as irregularidades, então duas árvores vizinhas nunca são iguais.
 */
const PINE_TONES = [['#1C4A33', '#2C6B47'], ['#173F2C', '#24593D'], ['#1F5638', '#33794F'], ['#143826', '#21503A'], ['#22603E', '#3A8657']];
export const Pine = React.memo(({ s = 1, tone = 0, v = 0 }) => {
  const [dark, light] = PINE_TONES[tone % PINE_TONES.length];
  const j = (k) => ((((v + 1) * (k * 2 + 3) * 7919) % 9) - 4) * 0.45; // irregularidade −1,8…1,8
  const tip = 15 + j(0) * 0.8;                                         // ponta torta
  // Bordas das camadas (y da ponta de cada galho e y do recuo logo acima da camada seguinte).
  const L = [[7 + j(1), 18 + j(2) * 0.5], [10 + j(3) * 0.5, 16.5], [3.5 + j(4), 32 + j(5) * 0.5], [8 + j(6) * 0.5, 30.5], [0.8 + j(7) * 0.4, 46]];
  const R = [[23 + j(8), 18 + j(9) * 0.5], [20 + j(10) * 0.5, 16.5], [26.5 + j(11), 32 + j(12) * 0.5], [22 + j(13) * 0.5, 30.5], [29.2 + j(14) * 0.4, 46]];
  const face = (pts) => `M${tip} 2 ` + pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' L15 46 Z';
  return (
    <svg width={30 * s} height={52 * s} viewBox="0 0 30 52" aria-hidden="true">
      <path d={`M13.4 52 Q${14 + j(15) * 0.3} 47 13.8 42 H16.2 Q${16 + j(15) * 0.3} 47 16.6 52 Z`} fill="#3B2A1E" />
      <path d={face(L)} fill={dark} />
      <path d={face(R)} fill={light} />
      {/* sombra embaixo de cada camada de galhos */}
      <path d={`M${L[0][0].toFixed(1)} ${L[0][1].toFixed(1)} L${L[1][0].toFixed(1)} 16.5 L15 19 L${R[1][0].toFixed(1)} 16.5 L${R[0][0].toFixed(1)} ${R[0][1].toFixed(1)} L15 21.5 Z`} fill="#0B2015" opacity=".35" />
      <path d={`M${L[2][0].toFixed(1)} ${L[2][1].toFixed(1)} L${L[3][0].toFixed(1)} 30.5 L15 33 L${R[3][0].toFixed(1)} 30.5 L${R[2][0].toFixed(1)} ${R[2][1].toFixed(1)} L15 35.5 Z`} fill="#0B2015" opacity=".35" />
      {/* textura: agulhas (riscos) na face clara e pontos de luz na face escura */}
      <path d={`M17 ${11 + j(16) * 0.3} l3 3 M18 24 l4 3.5 M17.5 ${38 + j(17) * 0.3} l5 4 M21 35 l3 2.5 M19 20 l2 1.5`} stroke={dark} strokeWidth="1.1" strokeLinecap="round" opacity=".85" />
      <path d={`M13 12 l-2.5 3 M12 25 l-3.5 3.5 M12.5 39 l-4.5 4 M9 36 l-2.5 2.5`} stroke={light} strokeWidth="1" strokeLinecap="round" opacity=".6" />
      <path d={`M${tip} 2.5 L${(tip + 15) / 2 - 3} 20`} stroke={light} strokeWidth=".7" opacity=".3" />
    </svg>
  );
});

/** Fogueira do descanso: lenha cruzada, chamas tremulando e uma caneca de café fumegando ao lado. */
export const Campfire = ({ s = 1 }) => (
  <svg width={64 * s} height={56 * s} viewBox="0 0 64 56" aria-hidden="true">
    {/* pedras em volta */}
    {[[14, 50], [22, 53], [32, 54], [42, 53], [50, 50]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="5" ry="3.2" fill={i % 2 ? '#5B6270' : '#6E7684'} />)}
    {/* lenha */}
    <path d="M16 50 L44 40" stroke="#5A3B26" strokeWidth="5" strokeLinecap="round" />
    <path d="M48 50 L20 40" stroke="#6B4630" strokeWidth="5" strokeLinecap="round" />
    <path d="M18 41 l3 1 M42 41 l-3 1" stroke="#3B2A1E" strokeWidth="1.2" />
    {/* chamas */}
    <g transform="translate(32 46) scale(.7) translate(-32 -46)"><g className="dc-flame">
      <path d="M32 6 C40 18 44 26 41 36 Q38 46 32 46 Q26 46 23 36 C21 27 27 22 28 14 C30 20 31 22 33 20 C34 15 33 11 32 6 Z" fill="#F2702E" />
      <path d="M32 18 C37 26 38 32 36 38 Q34 44 32 44 Q29 44 28 38 C27 33 30 30 30 25 C31 28 33 28 32 18 Z" fill="#FFB547" />
      <path d="M32 30 C34 34 34 38 33 41 Q32 43 31 41 C30 38 31 35 32 30 Z" fill="#FFF0B8" />
    </g></g>
    {/* caneca de café com vapor */}
    <g transform="translate(50 30)">
      <path className="dc-prop__steam" d="M4 2 q-2 -4 0 -7 q2 -3 0 -6 M8 2 q-2 -4 0 -7" stroke="#E8EEF5" strokeWidth="1.2" fill="none" opacity=".7" strokeLinecap="round" />
      <rect x="0" y="4" width="11" height="13" rx="2" fill="#E8EEF5" />
      <path d="M11 7 h2.5 a2.5 2.5 0 0 1 0 6 H11" stroke="#E8EEF5" strokeWidth="1.8" fill="none" />
      <rect x="1.5" y="5.5" width="8" height="2.5" fill="#6B4630" />
      <path d="M3 11 h5" stroke="#7CF5B0" strokeWidth="1.2" />
    </g>
  </svg>
);

/** Loja: barraca de mercador com toldo listrado, balcão, monitor com o cifrão e caixotes de peças. */
export const ShopStall = ({ s = 1 }) => (
  <svg width={70 * s} height={64 * s} viewBox="0 0 70 64" aria-hidden="true">
    {/* postes */}
    <rect x="9" y="14" width="3" height="48" fill="#4A3426" /><rect x="58" y="14" width="3" height="48" fill="#4A3426" />
    {/* toldo listrado com borda em ondas */}
    <path d="M4 16 L10 4 H60 L66 16 Z" fill="#2A3A55" />
    {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${10 + i * 10} 4 h5 l${i < 2 ? -1.5 : i > 2 ? 1.5 : 0} 12 h-5 Z`} fill="#7CF5B0" opacity=".85" />)}
    <path d="M4 16 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 q3.5 5 7 0 Z" fill="#2A3A55" />
    {/* monitor com o cifrão */}
    <rect x="26" y="24" width="18" height="13" rx="1.5" fill="#1B212C" stroke="#9AA3B2" strokeWidth="1.2" />
    <text x="35" y="34.5" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="monospace" fill="#FFD166" className="dc-led">$</text>
    <rect x="33" y="37" width="4" height="4" fill="#9AA3B2" />
    {/* balcão */}
    <rect x="6" y="41" width="58" height="6" rx="1" fill="#8A5A3A" />
    <rect x="8" y="47" width="54" height="15" fill="#6B4630" />
    <path d="M8 52 H62 M8 57 H62" stroke="#4A3426" strokeWidth="1" />
    {/* produtos no balcão: pendrive, poção-café, chip */}
    <rect x="13" y="35" width="5" height="6" rx="1" fill="#C8CDD6" /><rect x="14" y="33" width="3" height="2" fill="#5B6270" />
    <path d="M49 35 h6 v6 h-6 Z" fill="#2B3240" /><path d="M48 37 h1 M48 39 h1 M55 37 h1 M55 39 h1" stroke="#9AA3B2" />
    {/* caixote ao lado */}
    <rect x="58" y="50" width="11" height="12" fill="#A0703F" /><path d="M58 50 l11 12 M69 50 l-11 12" stroke="#6B4630" strokeWidth="1" />
  </svg>
);

/** Hash estável (escolha da peça por lugar). */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Peça de um lugar da floresta, sorteada pelo hash: quase sempre pinheiro; às vezes uma peça tecnológica. */
function pieceFor(h) {
  const r = h % 100;
  const s = 0.72 + ((h >>> 8) % 34) / 100;            // tamanho 0,72–1,05
  if (r < 74) return { C: Pine, upright: true, w: 30 * s * 1.45, props: { s: s * 1.45, tone: (h >>> 4) % 5, v: (h >>> 16) % 1000 } };
  if (r < 82) return { C: FiberPine, upright: true, w: 52 * s * 0.95, props: { s: s * 0.95 } };
  if (r < 89) return { C: CircuitTree, upright: true, w: 70 * s * 0.9, props: { s: s * 0.9 } };
  if (r < 93) return { C: UsbShroom, upright: true, w: 34, props: { s: 1 } };
  if (r < 96) return { C: CapStump, upright: true, w: 30, props: { s: 1.05 } };
  if (r < 98) return { C: CableFern, upright: true, w: 46, props: { s: 1 } };
  return { C: (h & 1) ? ChipRock : DataPond, upright: false, props: { s: 0.75 } };
}

/**
 * A mata no tabuleiro (densa, como a do mapa do Inscryption): uma peça em cada lugar livre (`spots`, longe dos pontos e
 * das trilhas). Cada lugar tem uma zona — floresta ou pântano (sp.zone) — e o desenho segue a zona. Por cima, vaga-lumes
 * de LED (floresta) e/ou fogos-fátuos do CI (pântano; wisps: altura da faixa ou 'all').
 * Memorizada: só redesenha quando o traçado ou a largura mudam.
 */
const PIECE = { swamp: swampPiece, peak: peakPiece };
export const ForestProps = React.memo(function ForestProps({ spots, w, h, fireflies = true, wisps = null, snow = false }) {
  const pieces = spots.map((sp) => ({ sp, P: (PIECE[sp.zone] || pieceFor)(sp.h) }));
  return (
    <>
      {/* Sombras no chão (uma camada só, barata): elipse suave projetada para o lado de cada peça em pé, mais o contato com o chão. */}
      <svg className="dc-board__shadows" width={w} height={h} aria-hidden="true">
        <defs>
          <radialGradient id="dc-shadow-grad">
            <stop offset="0" stopColor="#000" stopOpacity=".75" />
            <stop offset=".6" stopColor="#000" stopOpacity=".4" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>
        {pieces.filter(({ P }) => P.upright).map(({ sp, P }) => (
          <g key={sp.id}>
            <ellipse cx={sp.x + P.w * 0.5} cy={sp.y + P.w * 0.08} rx={P.w * 0.75} ry={P.w * 0.3} fill="url(#dc-shadow-grad)" />
            <ellipse cx={sp.x} cy={sp.y - 1} rx={P.w * 0.34} ry={P.w * 0.2} fill="url(#dc-shadow-grad)" />{/* contato com o chão */}
          </g>
        ))}
      </svg>
      {pieces.map(({ sp, P }) => {
        return (
          <span key={sp.id} className={'dc-prop ' + (P.upright ? 'is-upright is-anchored is-dense' : 'is-flat is-centered')} style={{ left: sp.x, top: sp.y, zIndex: Math.round(sp.y), '--lean': P.upright ? (((sp.h >>> 20) % 13) - 6) + 'deg' : undefined }}>
            <P.C {...P.props} />
          </span>
        );
      })}
      {fireflies && <div className="dc-fireflies" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${(hashStr('ff' + i) % 96) + 2}%`, top: `${(hashStr('fy' + i) % 90) + 4}%`, animationDelay: `${(i * 0.7) % 5}s` }} />)}
      </div>}
      {wisps === 'all' && <Wisps n={18} seed="board" />}
      {typeof wisps === 'number' && <Wisps n={6} seed="tease" band={wisps} />}
      {snow && <Snowfall n={40} seed="board" />}
    </>
  );
}, (a, b) => a.spots === b.spots && a.w === b.w && a.h === b.h && a.wisps === b.wisps && a.snow === b.snow);

/** Fundo da arena: clareira na Floresta Localhost à noite (árvores de circuito, vaga-lumes). */
export function ForestBackdrop() {
  return (
    <div className="dc-arena__backdrop" aria-hidden="true">
      <span style={{ left: '2%', bottom: 30 }}><CircuitTree s={1.5} /></span>
      <span style={{ left: '16%', bottom: 34 }}><FiberPine s={1.3} /></span>
      <span style={{ right: '16%', bottom: 34 }}><FiberPine s={1.4} /></span>
      <span style={{ right: '2%', bottom: 30 }}><CircuitTree s={1.6} /></span>
      <span style={{ left: '40%', bottom: 36, opacity: 0.6 }}><CircuitTree s={1.1} /></span>
      <div className="dc-fireflies">
        {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ left: `${(hashStr('af' + i) % 94) + 3}%`, top: `${(hashStr('ay' + i) % 60) + 6}%`, animationDelay: `${(i * 0.6) % 5}s` }} />)}
      </div>
    </div>
  );
}
