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
function Monolith({ c, locked }) {
  return (
    <g>
      <g className="v-body">
        <path d="M17 58 L19 10 Q32 4 45 10 L47 58 Z" fill={c} stroke="#3C4656" strokeWidth="1.4" />
        <path d="M24 14 L27 24 L23 31 M41 40 L37 47 L40 55 M19 36 L26 38" stroke="#3C4656" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <rect x="22" y="44" width="20" height="3" rx="1.5" fill="#3C4656" opacity=".7" />
        {!locked && <>
          <rect x="23" y="25" width="7" height="4" rx="1.5" fill="#FFD27A" className="v-glow" />
          <rect x="34" y="25" width="7" height="4" rx="1.5" fill="#FFD27A" className="v-glow" />
          <path d="M22 22 L31 24 M42 22 L33 24" stroke="#2A3240" strokeWidth="2.4" strokeLinecap="round" />
        </>}
      </g>
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
