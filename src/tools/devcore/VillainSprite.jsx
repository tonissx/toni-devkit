// "Pets do mal" — vilões originais dos incidentes, em SVG (viewBox 64×64), animados por CSS (.v-*).
// Estados: active (ameaçando) · blocked (barrado pela defesa, recua) · defeated (Hotfix) · locked (silhueta).

const VOID = '#07060C';
const EYE = '#FFE9F3';

/** Leaky — gosma que pinga e deixa poça (Memory Leak). */
function Leaky({ c, eye, locked }) {
  return (
    <g>
      <ellipse className="v-puddle" cx="32" cy="57" rx="19" ry="2.8" fill={c} opacity=".45" />
      <g className="v-body">
        <path d="M13 51 Q9 30 22 19 Q32 10 42 19 Q55 30 51 51 Z" fill={c} />
        {!locked && <>
          <ellipse cx="25" cy="32" rx="4.6" ry="4" fill={eye} />
          <ellipse cx="39" cy="32" rx="4.6" ry="4" fill={eye} />
          <circle cx="26" cy="33" r="1.9" fill={VOID} />
          <circle cx="38" cy="33" r="1.9" fill={VOID} />
          <path d="M19 25 L29 28.5 M45 25 L35 28.5" stroke={VOID} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M23 41 q9 7 18 0" stroke={VOID} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M27 42.6 l1.6 2.6 l1.6 -2.2 M33 43.2 l1.6 2.4 l1.6 -2.8" fill={EYE} />
        </>}
      </g>
      <path className="v-drip" d="M20 51 q2.5 5 0 8 q-2.5 -3 0 -8 z" fill={c} />
      <path className="v-drip v-drip--b" d="M42 51 q2.5 5 0 8 q-2.5 -3 0 -8 z" fill={c} />
    </g>
  );
}

/** Flicker — criatura glitchada com um olho só, que treme em RGB (Flaky Pipeline). */
function Flicker({ c, eye, locked }) {
  const pts = '32,7 46,17 40,24 51,34 41,40 47,55 31,48 18,57 22,42 12,34 22,26 16,15';
  return (
    <g>
      {!locked && <>
        <polygon className="v-glitch v-glitch--a" points={pts} fill="#00E5FF" opacity=".45" transform="translate(-2.5 0)" />
        <polygon className="v-glitch v-glitch--b" points={pts} fill="#FF2BD6" opacity=".45" transform="translate(2.5 0)" />
      </>}
      <g className="v-body">
        <polygon points={pts} fill={c} />
        {!locked && <>
          <circle cx="32" cy="30" r="7.5" fill={eye} />
          <rect className="v-eye" x="30.6" y="24.5" width="2.8" height="11" rx="1.4" fill={VOID} />
          <path d="M24 42 l3 -2 l3 2 l3 -2 l3 2 l3 -2" stroke={VOID} strokeWidth="1.8" fill="none" strokeLinejoin="round" />
        </>}
      </g>
    </g>
  );
}

/** Swarm — enxame de mini-bots de olhos vermelhos (Traffic Spike). */
function Swarm({ c, locked }) {
  const bots = [[18, 22], [38, 14], [48, 32], [26, 40], [40, 49], [12, 44]];
  return (
    <g>
      {bots.map(([x, y], i) => (
        <g key={i} className={'v-bot v-bot--' + i}>
          <line x1={x} y1={y - 5} x2={x + 2} y2={y - 9} stroke={c} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx={x} cy={y} r="5.6" fill={c} />
          {!locked && <>
            <circle cx={x + 1} cy={y - 0.5} r="2.2" fill="#FFE0E0" />
            <circle className="v-eye" cx={x + 1.4} cy={y - 0.5} r="1" fill="#B00020" />
          </>}
        </g>
      ))}
    </g>
  );
}

/** Forky — bicho de duas cabeças que brigam entre si (Merge Conflict). */
function Forky({ c, eye, locked }) {
  return (
    <g>
      <g className="v-body">
        <path d="M27 38 Q24 28 18 22 M37 38 Q40 28 46 22" stroke={c} strokeWidth="6" fill="none" strokeLinecap="round" />
        <ellipse cx="32" cy="45" rx="14" ry="10.5" fill={c} />
        <rect x="23" y="53" width="5" height="6" rx="2" fill={c} />
        <rect x="36" y="53" width="5" height="6" rx="2" fill={c} />
      </g>
      <g className="v-head v-head--l">
        <circle cx="17" cy="18" r="8.5" fill={c} />
        {!locked && <>
          <circle cx="20" cy="16.5" r="2.4" fill={eye} /><circle cx="21" cy="16.8" r="1.2" fill={VOID} />
          <path d="M16 12.5 L22.5 14.5" stroke={VOID} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="20" cy="22" rx="2.6" ry="1.8" fill={VOID} />
        </>}
      </g>
      <g className="v-head v-head--r">
        <circle cx="47" cy="18" r="8.5" fill={c} />
        {!locked && <>
          <circle cx="44" cy="16.5" r="2.4" fill={eye} /><circle cx="43" cy="16.8" r="1.2" fill={VOID} />
          <path d="M48 12.5 L41.5 14.5" stroke={VOID} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="44" cy="22" rx="2.6" ry="1.8" fill={VOID} />
        </>}
      </g>
    </g>
  );
}

/** Zero — sombra encapuzada de olhos vermelhos, o chefe (Zero-day). */
function Zero({ c, locked }) {
  return (
    <g>
      <g className="v-body">
        <path className="v-wisp" d="M15 44 q3 10 8 6 q3 8 9 3 q6 5 9 -3 q5 4 8 -6 z" fill={c} opacity=".85" />
        <path d="M32 5 Q53 13 50 40 Q48 50 32 52 Q16 50 14 40 Q11 13 32 5 Z" fill={c} stroke="#6B5CA5" strokeWidth="1.2" />
        <ellipse cx="32" cy="31" rx="11" ry="13" fill={VOID} />
        {!locked && <>
          <ellipse className="v-glow" cx="27" cy="30" rx="3.2" ry="1.9" fill="#FF2B4E" opacity=".35" />
          <ellipse className="v-glow" cx="37" cy="30" rx="3.2" ry="1.9" fill="#FF2B4E" opacity=".35" />
          <ellipse className="v-eye" cx="27" cy="30" rx="2" ry="1.1" fill="#FF5C77" />
          <ellipse className="v-eye" cx="37" cy="30" rx="2" ry="1.1" fill="#FF5C77" />
        </>}
      </g>
    </g>
  );
}

/** Bug — besouro de antenas e pernas inquietas (inimigo comum do mapa). */
function Bug({ c, eye, locked }) {
  return (
    <g>
      <g className="v-body">
        <path d="M24 16 Q20 8 15 7 M40 16 Q44 8 49 7" stroke={c} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M16 30 L7 26 M16 38 L6 40 M18 46 L9 52 M48 30 L57 26 M48 38 L58 40 M46 46 L55 52" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="32" cy="38" rx="17" ry="18" fill={c} />
        <circle cx="32" cy="20" r="9" fill={c} />
        <path d="M32 22 V55" stroke={VOID} strokeWidth="1.6" opacity=".55" />
        {!locked && <>
          <circle cx="28" cy="19" r="2.8" fill={eye} /><circle cx="36" cy="19" r="2.8" fill={eye} />
          <circle cx="28.6" cy="19.4" r="1.3" fill={VOID} /><circle cx="35.4" cy="19.4" r="1.3" fill={VOID} />
          <circle cx="24" cy="36" r="2.2" fill={VOID} opacity=".5" /><circle cx="40" cy="44" r="2.6" fill={VOID} opacity=".5" />
        </>}
      </g>
    </g>
  );
}

/** Typo — um "e" torto e apressado, com olhos (inimigo comum do mapa). */
function Typo({ c, eye, locked }) {
  return (
    <g>
      <g className="v-body">
        <path d="M46 36 H18 Q18 16 32 16 Q46 16 46 32 Z M19 38 Q22 52 34 52 Q42 52 46 46" stroke={c} strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-10 32 34)" />
        {!locked && <>
          <circle cx="27" cy="27" r="3" fill={eye} /><circle cx="37" cy="25.5" r="3" fill={eye} />
          <circle cx="27.6" cy="27.4" r="1.4" fill={VOID} /><circle cx="37.6" cy="25.9" r="1.4" fill={VOID} />
        </>}
      </g>
    </g>
  );
}

/** Dependência quebrada — caixa de pacote rachada, com uma fita solta (inimigo comum do mapa). */
function Dep({ c, eye, locked }) {
  return (
    <g>
      <g className="v-body">
        <path d="M32 9 L53 19 V45 L32 56 L11 45 V19 Z" fill={c} />
        <path d="M11 19 L32 29 L53 19 M32 29 V56" stroke={VOID} strokeWidth="1.6" fill="none" opacity=".45" />
        <path d="M38 33 L34 40 L40 44 L35 52" stroke={VOID} strokeWidth="2" fill="none" strokeLinejoin="round" />
        {!locked && <>
          <ellipse cx="20" cy="33" rx="3" ry="3.4" fill={eye} /><ellipse cx="27" cy="36" rx="3" ry="3.4" fill={eye} />
          <circle cx="20.6" cy="34" r="1.4" fill={VOID} /><circle cx="27.6" cy="37" r="1.4" fill={VOID} />
          <path d="M19 44 q4 -3 8 1" stroke={VOID} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </>}
      </g>
      <path className="v-drip" d="M53 22 q6 3 4 10" stroke={c} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Legacy Monolith — bloco de pedra antigo, rachado, de olhos pesados (chefe do Localhost). */
/**
 * Legacy Monolith: pedra antiga da Floresta Localhost com o topo quebrado, musgo e cipós, rachaduras de código antigo
 * brilhando em vermelho, olhos em fenda, névoa escura na base e fragmentos de código legado (GOTO, <td>) em volta.
 */
function Monolith({ c, locked }) {
  return (
    <g>
      {!locked && <ellipse className="v-mist" cx="32" cy="57" rx="22" ry="5" fill="#1A0B1E" opacity=".75" />}
      {/* pernas: dois blocos de pedra atarracados, plantados no chão */}
      <path d="M20 46 L29 46 L30 60 L18.5 60 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M35 46 L44 46 L45.5 60 L34 60 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M18.8 57 H30 M34.2 57 H45.4" stroke="#0D0F14" strokeWidth="1" opacity=".6" />
      <path d="M35 46 L44 46 L45.5 60 L40 60 Z" fill="#000" opacity=".3" />
      <g className="v-body">
        <g transform="translate(0 1.5)">{/* braços de pedra em blocos (atrás do corpo): o esquerdo pendurado, o direito à frente, punhos de pedregulho */}
        <path d="M18 13 L10 16 L6.5 28 L13 29.5 L18 21 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6.5 28 L13 29.5 L13.5 39 L5.5 39.5 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M3.5 39 L14.5 38 L16 46 L11.5 50 L5 49.5 L2.5 44.5 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M46 13 L54 15 L58.5 26.5 L52 28.5 L46 21 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M52 28.5 L58.5 26.5 L61 37 L53.5 38.5 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M51 37.5 L62 36 L64 43 L60 47.5 L53.5 47 L50 42.5 Z" fill={c} stroke="#0D0F14" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M46 13 L54 15 L58.5 26.5 L56 27 Z M52 28.5 L58.5 26.5 L61 37 L58 37.5 Z M51 37.5 L62 36 L64 43 L60 47.5 L57 47.2 Z" fill="#000" opacity=".3" />
        <path d="M6 44 l3 0.5 M8 47 l3 -0.5 M54 42 l3 0.5 M56 45 l3 -0.5" stroke="#0D0F14" strokeWidth="1" strokeLinecap="round" />
        {!locked && <>
          <path d="M10 16 Q13 11.5 18 13 L17.5 17 Q13.5 15 10 18.5 Z" fill="#3E7A3A" />
          <path d="M46 13 Q51 11 54 15 Q50 15 46.5 17.5 Z" fill="#35692F" />
          <path d="M3.5 39 Q8 36 14.5 38 L14 40 Q9 38.5 4 41 Z" fill="#4E8F45" />
          {/* rachaduras brilhando também nos braços */}
          <path className="v-crack" d="M9 20 L11 24 L9 27 M57 39 L59 42" stroke="#FF3B3B" strokeWidth=".9" fill="none" strokeLinecap="round" />
        </>}
        </g>
        <g transform="translate(0 -8)">
        {/* corpo: topo quebrado e irregular, face sombreada à direita */}
        <path d="M15 58 L17 13 L22 8 L25 11 L30 5 L35 9 L40 6 L44 12 L47 11 L49 58 Z" fill={c} stroke="#0D0F14" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M37 9 L40 6 L44 12 L47 11 L49 58 L38 58 Z" fill="#000" opacity=".32" />
        <path d="M17 13 L22 8 L25 11 L22 20 Z" fill="#fff" opacity=".07" />
        {/* runas/linhas de código gravadas */}
        <path d="M21 34 h6 M21 37 h9 M21 40 h4 M41 46 h4 M40 49 h6" stroke="#0D0F14" strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
        {/* rachaduras: escuras e, por dentro, brilho vermelho pulsando */}
        <path d="M27 10 L29 15 L26 19 M24 30 L27 33 L24 37 M44 30 L39 38 L43 45 L39 54 M17 44 L23 46 L21 52" stroke="#0D0F14" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {!locked && <path className="v-crack" d="M27 10 L29 15 L26 19 M24 30 L27 33 L24 37 M44 30 L39 38 L43 45 L39 54 M17 44 L23 46 L21 52" stroke="#FF3B3B" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {!locked && <>
          {/* musgo: no topo quebrado, escorrendo pelas bordas e nas saliências */}
          <path d="M17 14 L22 8 L25 11 L30 5 L35 9 L40 6 L44 12 L47 11 L47.3 15 Q44 17 41 14 Q38 18 34 14 Q31 17 28 13 Q24 17 21 15 Q19 18 17 17 Z" fill="#3E7A3A" />
          <path d="M22 9.5 L25 12 L30 6.5 L33 9 Q30 11 27 10.5 Q24 13 22 9.5 Z" fill="#5FA04E" />
          <path d="M17 16 Q15.5 24 17.5 30 Q19 25 18.6 17 Z" fill="#3E7A3A" />
          <path d="M47.2 15 Q49.5 21 47.6 27 Q46.4 22 46.6 16 Z" fill="#35692F" />
          <path d="M15.5 52 Q20 47 26 51 Q22 54 15.3 55 Z" fill="#3E7A3A" />
          <path d="M40 53 Q45 49 49 51 L49.2 56 Q44 56 40 53 Z" fill="#35692F" />
          {/* cipós descendo pela face */}
          <path d="M33 14 Q34 17 32.5 20 M44.5 14 Q46.5 22 46.2 30 Q46 35 45.2 39" stroke="#4E8F45" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <circle cx="32.5" cy="20" r="1.2" fill="#5FA04E" /><circle cx="46.3" cy="30" r="1.2" fill="#5FA04E" /><circle cx="45.2" cy="39" r="1.3" fill="#5FA04E" />
          {/* sobrancelha pesada e olhos em fenda */}
          <path d="M19 19 L31 23.5 M45 19 L33 23.5" stroke="#0D0F14" strokeWidth="3.2" strokeLinecap="round" />
          <path className="v-glow" d="M21 24 L30 26.5 L22 27.5 Z" fill="#FF4A3D" />
          <path className="v-glow" d="M43 24 L34 26.5 L42 27.5 Z" fill="#FF4A3D" />
          <ellipse cx="25.5" cy="26" rx="6" ry="3" fill="#FF3B3B" opacity=".22" />
          <ellipse cx="38.5" cy="26" rx="6" ry="3" fill="#FF3B3B" opacity=".22" />
          {/* boca: fenda serrilhada */}
          <path d="M25 42 L28 44 L31 42 L34 44 L37 42 L40 44" stroke="#0D0F14" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
        </>}
        </g>
      </g>
      {!locked && <g>
        {/* grama e um cogumelo na base */}
        <path d="M12 58 l1.5 -5 l1 5 l1.5 -4 l1 4 M48 58 l1.5 -4.5 l1 4.5 l1.5 -5.5 l1 5.5" stroke="#4E8F45" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
        <rect x="53.6" y="55" width="1.6" height="3.5" fill="#E8E1CF" /><path d="M51.5 55.5 Q54.4 51 57.3 55.5 Z" fill="#B8453A" />
      </g>}
      {!locked && <g className="v-debris" fontFamily="monospace" fontWeight="700" fill="#FF6B5E">
        <text x="0" y="7" fontSize="6" opacity=".7">GOTO</text>
        <text x="50" y="6" fontSize="6" opacity=".6">{'<td>'}</text>
      </g>}
    </g>
  );
}

const VILLAINS = { leaky: Leaky, flicker: Flicker, swarm: Swarm, forky: Forky, zero: Zero, bug: Bug, typo: Typo, dep: Dep, monolith: Monolith };

/** Sprite de um vilão. state: active | blocked | defeated · locked = silhueta (nunca visto). */
export function VillainSprite({ id, color, state = 'active', size = 56, locked = false, className = '' }) {
  const Body = VILLAINS[id] || Leaky;
  return (
    <svg className={'villain-svg is-' + (locked ? 'locked' : state) + ' v-' + id + ' ' + className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <ellipse cx="32" cy="59" rx="15" ry="2.6" fill="#000" opacity=".3" />
      <Body c={locked ? 'var(--tk-surface-4)' : color} eye={EYE} locked={locked} />
    </svg>
  );
}
