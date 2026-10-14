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
        <g transform="translate(0 10.5)">{/* braços de pedra em blocos (atrás do corpo): o esquerdo pendurado, o direito à frente, punhos de pedregulho */}
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
          <path className="v-crack" d="M9 20 L11 24 L9 27 M57 39 L59 42" stroke="#FFA526" strokeWidth="1.2" fill="none" strokeLinecap="round" />
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
        {!locked && <path className="v-crack" d="M27 10 L29 15 L26 19 M24 30 L27 33 L24 37 M44 30 L39 38 L43 45 L39 54 M17 44 L23 46 L21 52" stroke="#FFA526" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
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
          <path className="v-glow" d="M21 24 L30 26.5 L22 27.5 Z" fill="#FFD24A" />
          <path className="v-glow" d="M43 24 L34 26.5 L42 27.5 Z" fill="#FFD24A" />
          <ellipse cx="25.5" cy="26" rx="6" ry="3" fill="#FF7A00" opacity=".4" />
          <ellipse cx="38.5" cy="26" rx="6" ry="3" fill="#FF7A00" opacity=".4" />
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

/* ─────────────── Área 2 — Pântano Staging ─────────────── */

/** Flaky Test — fogo-fátuo do pântano que pisca verde (✓) e vermelho (✗): passa ou falha sem motivo. */
function Flaky({ c, locked }) {
  return (
    <g>
      {!locked && <ellipse className="v-wisp-glow" cx="32" cy="30" rx="22" ry="22" fill={c} opacity=".18" />}
      <g className="v-body v-wisp">
        <path d="M32 6 C40 16 47 22 46 34 C45 46 38 52 32 52 C26 52 19 46 18 34 C17 22 24 16 32 6 Z" fill={c} opacity=".9" />
        <path d="M32 14 C37 21 41 26 40 34 C39 42 35 46 32 46 C29 46 25 42 24 34 C23 26 27 21 32 14 Z" fill="#E9FFF4" opacity=".55" />
        {!locked && <>
          {/* rosto: um olho aberto, outro fechado (passa / falha) */}
          <circle cx="27" cy="32" r="3.4" fill="#07130C" />
          <circle cx="28" cy="31" r="1.1" fill="#E9FFF4" />
          <path d="M34 32 h6" stroke="#07130C" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M27 40 q5 3 10 -1" stroke="#07130C" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          {/* ✓ e ✗ piscando em volta */}
          <path className="v-pass" d="M9 18 l3 3 l6 -7" stroke="#7CF5B0" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path className="v-fail" d="M47 12 l7 7 M54 12 l-7 7" stroke="#FF5C5C" strokeWidth="2.4" strokeLinecap="round" />
        </>}
      </g>
      {/* cauda de luz até a água */}
      <path d="M28 52 q4 4 2 7 M36 52 q-3 4 -1 6" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  );
}

/** Race Condition — duas libélulas gêmeas trançando o voo, cada uma querendo chegar primeiro. */
function Race({ c, locked }) {
  const fly = (dx, dy, flip, cls) => (
    <g className={'v-fly ' + cls} transform={`translate(${dx} ${dy}) scale(${flip} 1)`}>
      <ellipse cx="-6" cy="-5" rx="9" ry="3.4" fill="#DDF6FF" opacity=".55" transform="rotate(-22 -6 -5)" />
      <ellipse cx="-6" cy="3" rx="8" ry="3" fill="#DDF6FF" opacity=".45" transform="rotate(18 -6 3)" />
      <path d="M-2 0 L-24 1.5" stroke={c} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M-10 0 h1.5 M-15 0.5 h1.5 M-20 1 h1.5" stroke="#0B2230" strokeWidth="1.2" />
      <circle cx="2" cy="0" r="4.6" fill={c} />
      {!locked && <><circle cx="4" cy="-1.5" r="2" fill="#0B2230" /><circle cx="4.6" cy="-2" r=".7" fill="#fff" /></>}
    </g>
  );
  return (
    <g>
      <path d="M8 40 C20 20 30 52 44 30 S58 26 60 18" stroke={c} strokeWidth="1.2" fill="none" strokeDasharray="2 3" opacity=".5" />
      {fly(40, 24, 1, 'v-fly--a')}
      {fly(26, 40, -1, 'v-fly--b')}
      {!locked && <text x="44" y="54" fontSize="8" fontFamily="monospace" fontWeight="700" fill={c} opacity=".8">1º?</text>}
    </g>
  );
}

/** Config Drift — tronco à deriva coberto de musgo, com um arquivo .env pregado que nunca é igual. */
function Drift({ c, locked }) {
  return (
    <g>
      <ellipse className="v-ripple" cx="32" cy="54" rx="26" ry="4" fill="none" stroke="#5EC8FF" strokeWidth="1" opacity=".5" />
      <g className="v-body v-bob">
        <path d="M6 44 Q6 34 16 33 L50 31 Q60 31 60 40 Q60 49 50 49 L16 51 Q6 52 6 44 Z" fill={c} stroke="#2B1D10" strokeWidth="1.4" />
        <ellipse cx="54" cy="40" rx="5" ry="7.5" fill="#B8925F" stroke="#2B1D10" strokeWidth="1.2" />
        <path d="M54 35 a4 5 0 1 0 0.1 0 M54 38 a1.6 2.2 0 1 0 0.1 0" stroke="#6E4F2E" strokeWidth=".9" fill="none" />
        <path d="M14 38 q8 -3 16 -1 M18 46 q10 2 20 -1" stroke="#6E4F2E" strokeWidth="1.1" fill="none" />
        <path d="M8 40 Q14 30 26 33 Q34 29 42 33 L40 37 Q30 34 22 37 Q14 37 9 44 Z" fill="#3E7A3A" />
        {!locked && <>
          {/* arquivo .env pregado, com valores trocando */}
          <g transform="rotate(-8 28 20)">
            <rect x="18" y="8" width="20" height="24" rx="2" fill="#F2EEDF" stroke="#2B1D10" strokeWidth="1.2" />
            <path d="M33 8 l5 5 h-5 Z" fill="#CFC8B0" />
            <text x="21" y="17" fontSize="5" fontFamily="monospace" fontWeight="700" fill="#2B1D10">.env</text>
            <path className="v-drift-a" d="M21 22 h13" stroke="#E0533D" strokeWidth="2" strokeLinecap="round" />
            <path className="v-drift-b" d="M21 27 h9" stroke="#3E7A3A" strokeWidth="2" strokeLinecap="round" />
            <circle cx="28" cy="9" r="1.4" fill="#5B6270" />
          </g>
          {/* olhos no tronco */}
          <ellipse cx="44" cy="41" rx="2.6" ry="2.2" fill="#FFE9B0" /><circle cx="44.6" cy="41.4" r="1.1" fill="#2B1D10" />
          <path d="M40 37.5 l6 1.5" stroke="#2B1D10" strokeWidth="1.6" strokeLinecap="round" />
        </>}
      </g>
    </g>
  );
}

/**
 * The Merge Conflict — dragão de duas cabeças. Cada cabeça é uma unidade, e cada sprite é METADE do dragão (asa, perna,
 * pescoço e cabeça), com o corpo encostando na borda: lado a lado, main (roxa, à esquerda) e feature (laranja, espelhada)
 * formam um só dragão — duas cores, duas versões do mesmo código. Os marcadores de conflito ficam no peito.
 */
function Hydra({ c, locked, side }) {
  const flip = side === 'feature';
  const S = '#120B1E';
  return (
    <g>
      <g transform={flip ? 'translate(64 0) scale(-1 1)' : undefined}><g className="v-body">
        {/* asa de morcego atrás do corpo */}
        <path d="M58 30 L46 2 Q36 8 22 10 Q28 15 27 21 Q35 19 39 24 Q47 25 58 30 Z" fill={c} stroke={S} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M58 30 L46 2 Q36 8 22 10 Q28 15 27 21 Q35 19 39 24 Q47 25 58 30 Z" fill="#000" opacity=".35" />
        <path d="M46 2 L27 21 M46 2 L39 24 M46 2 L52 28" stroke={S} strokeWidth="1" opacity=".7" />
        {/* perna dianteira com garras */}
        <path d="M42 44 Q35 50 36 58 L45 58 Q45 52 50 48 Z" fill={c} stroke={S} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M36 58 l-2 2 M39 58 l-1 2.4 M42 58 l0 2.4" stroke="#F2EEDF" strokeWidth="1.1" strokeLinecap="round" />
        {/* corpo (encosta na borda direita: a outra metade continua dali) */}
        <path d="M64 24 Q48 22 39 33 Q33 44 41 52 Q50 59 64 59 Z" fill={c} stroke={S} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M64 42 Q52 42 46 49 Q53 56 64 56 Z" fill="#F2D9A8" opacity=".55" />
        <path d="M50 46 Q56 45 64 46 M48 50 Q56 50 64 51" stroke={S} strokeWidth=".8" opacity=".5" fill="none" />
        {/* pescoço longo e espinhos */}
        <path d="M46 34 Q33 31 29 22 Q26 15 21 13 L17 19 Q22 21 24 27 Q28 38 41 41 Z" fill={c} stroke={S} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M30 20 l2 -4 l1 4 M35 26 l3 -3 l0 4 M41 30 l3 -3 l0 4 M48 25 l2 -4 l1 4 M55 24 l2 -4 l1 4" fill={c} stroke={S} strokeWidth="1" strokeLinejoin="round" />
        {/* cabeça de dragão olhando para fora */}
        <path d="M23 11 Q15 8 7 12 L1 16 Q3 20 9 20 L15 23 Q23 22 24 16 Z" fill={c} stroke={S} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M2 17 Q8 18 14 21" stroke={S} strokeWidth="1" fill="none" />
        <path d="M20 10 L29 3 L24 12 M17 9 L21 1 L20 10" fill="#F2EEDF" stroke={S} strokeWidth="1" strokeLinejoin="round" />
        <path d="M3 17 l1 2 l1 -2 l1 2 l1 -2 l1 2" stroke="#F2EEDF" strokeWidth=".9" fill="none" />
        <circle cx="4" cy="14.5" r=".8" fill={S} />
        {!locked && <>
          <path className="v-glow" d="M11 13 L17 14 L11 15.6 Z" fill="#FFD24A" />
          <path d="M9 11.5 L18 12.6" stroke={S} strokeWidth="1.6" strokeLinecap="round" />
        </>}
      </g></g>
      {!locked && <text x={flip ? 4 : 41} y="54" fontSize="5" fontFamily="monospace" fontWeight="700" fill={S} opacity=".55">{flip ? '>>>>>>>' : '<<<<<<<'}</text>}
    </g>
  );
}
const HydraMain = (p) => <Hydra {...p} side="main" />;
const HydraFeature = (p) => <Hydra {...p} side="feature" />;

/* ─────────────── Área 3 — Pico Production ─────────────── */

/** Cold Start — golem de gelo ainda "carregando": cristais, olhos azuis e uma barra de progresso no peito. */
function ColdStart({ c, locked }) {
  return (
    <g>
      <g className="v-body">
        {/* pernas e braços de gelo */}
        <path d="M21 46 L20 58 L28 58 L28 46 Z M36 46 L36 58 L44 58 L43 46 Z" fill="#7FB8D8" stroke="#1E3A52" strokeWidth="1.3" />
        <path d="M14 26 L6 40 L12 44 L19 32 Z M50 26 L58 40 L52 44 L45 32 Z" fill="#9FD8F5" stroke="#1E3A52" strokeWidth="1.3" strokeLinejoin="round" />
        {/* corpo facetado */}
        <path d="M18 18 L32 10 L46 18 L48 40 L38 48 L26 48 L16 40 Z" fill={c} stroke="#1E3A52" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M32 10 L46 18 L48 40 L38 48 L32 30 Z" fill="#1E3A52" opacity=".18" />
        <path d="M18 18 L32 10 L32 30 Z" fill="#fff" opacity=".35" />
        {/* cristais no topo */}
        <path d="M24 15 L22 4 L28 12 Z M33 11 L34 1 L38 12 Z M41 15 L46 6 L45 17 Z" fill="#DDF3FF" stroke="#1E3A52" strokeWidth="1" strokeLinejoin="round" />
        {!locked && <>
          <path d="M23 25 h7 M34 25 h7" stroke="#1E3A52" strokeWidth="2.6" strokeLinecap="round" />
          <circle className="v-glow" cx="26.5" cy="27" r="1.6" fill="#5EC8FF" /><circle className="v-glow" cx="37.5" cy="27" r="1.6" fill="#5EC8FF" />
          {/* "carregando..." */}
          <rect x="22" y="35" width="20" height="5" rx="2" fill="#1E3A52" />
          <rect className="v-load" x="23" y="36" width="18" height="3" rx="1.5" fill="#7CF5B0" />
        </>}
      </g>
      {!locked && <path d="M8 14 l2 2 M10 14 l-2 2 M54 10 l2 2 M56 10 l-2 2 M58 30 l2 2 M60 30 l-2 2" stroke="#DDF3FF" strokeWidth="1.1" strokeLinecap="round" opacity=".8" />}
    </g>
  );
}

/** DDoS — bando de corvos da tempestade, cada um com o olho vermelho, uma ponta de raio no meio do bando. */
function Ddos({ c, locked }) {
  const crow = (x, y, s, i) => (
    <g key={i} className={'v-bot v-bot--' + (i % 3)} transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-12 -2 Q-6 -10 0 -3 Q6 -10 12 -2 Q6 -4 3 2 L0 4 L-3 2 Q-6 -4 -12 -2 Z" fill={c} stroke="#0B0D16" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M0 4 L-1.5 8 L1.5 8 Z" fill="#0B0D16" />
      {!locked && <circle cx="1.5" cy="-0.5" r="1" fill="#FF4A3D" />}
    </g>
  );
  return (
    <g>
      {[[32, 22, 1.5], [14, 32, 1.1], [50, 34, 1.15], [24, 46, 0.95], [44, 50, 0.9], [36, 8, 0.8]].map(([x, y, s], i) => crow(x, y, s, i))}
      {!locked && <path className="v-glow" d="M30 30 L26 38 L31 38 L28 46 L36 35 L31 35 L34 30 Z" fill="#FFE27A" opacity=".85" />}
    </g>
  );
}

/** Memory Leak gigante — a gosma do Leaky, adulta: transbordando, com objetos presos dentro e a poça crescendo. */
function LeakGiant({ c, eye, locked }) {
  return (
    <g>
      <ellipse className="v-puddle" cx="32" cy="57" rx="28" ry="4" fill={c} opacity=".5" />
      <g className="v-body">
        <path d="M5 56 Q2 34 14 22 Q22 6 34 8 Q48 8 54 22 Q63 34 59 56 Z" fill={c} />
        <path d="M14 22 Q22 6 34 8 Q30 12 26 24 Q18 22 14 22 Z" fill="#fff" opacity=".18" />
        {/* objetos que nunca foram liberados */}
        <rect x="14" y="40" width="7" height="7" rx="1" fill="#000" opacity=".25" transform="rotate(-12 17 43)" />
        <text x="40" y="49" fontSize="6" fontFamily="monospace" fontWeight="700" fill="#000" opacity=".3">{'{…}'}</text>
        <circle cx="47" cy="38" r="3" fill="#000" opacity=".22" />
        {!locked && <>
          <ellipse cx="24" cy="28" rx="5.4" ry="4.6" fill={eye} /><ellipse cx="40" cy="28" rx="5.4" ry="4.6" fill={eye} />
          <circle cx="25" cy="29" r="2.2" fill={VOID} /><circle cx="39" cy="29" r="2.2" fill={VOID} />
          <path d="M17 20 L29 24 M47 20 L35 24" stroke={VOID} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M20 39 q12 9 24 0" stroke={VOID} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M25 41 l2 3 l2 -2.6 M33 42 l2 2.8 l2 -3" fill={EYE} />
        </>}
      </g>
      <path className="v-drip" d="M12 54 q3 5 0 8 q-3 -3 0 -8 z" fill={c} />
      <path className="v-drip v-drip--b" d="M52 54 q3 5 0 8 q-3 -3 0 -8 z" fill={c} />
    </g>
  );
}

/**
 * Production Outage — titã de tempestade: corpo de nuvem carregada, coroa de pára-raios, olhos de relâmpago e um
 * status vermelho no peito. Raios saem das mãos.
 */
function Titan({ c, locked }) {
  return (
    <g>
      <g className="v-body">
        {/* braços de nuvem com raios */}
        <path d="M14 30 Q4 32 3 42 Q6 46 10 44 Q12 36 18 36 Z M50 30 Q60 32 61 42 Q58 46 54 44 Q52 36 46 36 Z" fill={c} stroke="#121726" strokeWidth="1.3" />
        {!locked && <path className="v-glow" d="M5 44 L2 52 L6 51 L3 60 M59 44 L62 52 L58 51 L61 60" stroke="#FFE27A" strokeWidth="1.6" fill="none" strokeLinejoin="round" />}
        {/* corpo de nuvem */}
        <path d="M16 54 Q8 52 10 44 Q6 36 14 32 Q12 20 24 18 Q28 10 36 12 Q46 12 48 22 Q58 24 54 34 Q60 42 52 48 Q52 56 44 56 Z" fill={c} stroke="#121726" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M24 18 Q28 10 36 12 Q34 16 30 20 Q26 18 24 18 Z M14 32 Q12 24 18 22 Q18 28 20 32 Z" fill="#fff" opacity=".12" />
        {/* coroa de pára-raios */}
        <path d="M22 18 L20 6 L24 14 M32 12 L32 0 L34 12 M42 16 L46 5 L44 17" stroke="#9AA3B2" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="20" cy="6" r="1.4" fill="#FFE27A" /><circle cx="32" cy="0.5" r="1.4" fill="#FFE27A" /><circle cx="46" cy="5" r="1.4" fill="#FFE27A" />
        {!locked && <>
          {/* olhos de relâmpago e testa franzida */}
          <path d="M20 27 L30 30 M44 27 L34 30" stroke="#121726" strokeWidth="2.6" strokeLinecap="round" />
          <path className="v-glow" d="M22 31 L29 32.5 L23 34.5 Z M42 31 L35 32.5 L41 34.5 Z" fill="#FFE27A" />
          <path d="M25 41 L28 39 L31 42 L34 39 L37 42 L40 39" stroke="#121726" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
          {/* status no peito */}
          <circle className="v-glow" cx="32" cy="49" r="3" fill="#FF4A3D" />
        </>}
      </g>
    </g>
  );
}

const VILLAINS = { leaky: Leaky, flicker: Flicker, swarm: Swarm, forky: Forky, zero: Zero, bug: Bug, typo: Typo, dep: Dep, monolith: Monolith,
  flaky: Flaky, race: Race, drift: Drift, 'hydra-main': HydraMain, 'hydra-feature': HydraFeature,
  coldstart: ColdStart, ddos: Ddos, leakgiant: LeakGiant, titan: Titan };

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
