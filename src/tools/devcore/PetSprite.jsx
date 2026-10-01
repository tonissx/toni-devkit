// DevPets — criaturas originais em SVG (viewBox 64×64), animadas por CSS (classes .pet-*).
// Aparência: cor do corpo e dos olhos vêm do visual escolhido; o estágio (0 Base · 1 Veterano ·
// 2 Mestre) acrescenta acessórios próprios da espécie e, no Mestre, uma aura.

const DARK = 'var(--tk-bg)';
const GEAR = 'var(--tk-text-2)'; // acessórios metálicos (fone, armação, jetpack)

/** Byte — "lobo-terminal": cabeça angular, orelhas pontudas e um visor de terminal. */
function Byte({ c, eye, stage }) {
  return (
    <g>
      <path className="pet-tail" d="M50 44 q10 -2 9 -12 q-4 6 -10 6 z" fill={c} opacity=".8" />
      <g className="pet-body">
        <path d="M17 22 L22 7 L29 19 Z M35 19 L42 7 L47 22 Z" fill={c} />
        {stage >= 2 && (
          <g className="pet-acc">
            <line x1="44" y1="11" x2="50" y2="2" stroke={GEAR} strokeWidth="1.8" strokeLinecap="round" />
            <circle className="pet-signal" cx="50" cy="2" r="2.2" fill={eye} />
          </g>
        )}
        <rect x="14" y="17" width="36" height="31" rx="8" fill={c} />
        <rect className="pet-visor" x="19" y="25" width="26" height="12" rx="3" fill={DARK} />
        <rect className="pet-eye" x="23" y="29" width="6" height="3" rx="1" fill={eye} />
        <rect className="pet-eye" x="35" y="29" width="6" height="3" rx="1" fill={eye} />
        <rect x="28" y="40" width="8" height="4" rx="2" fill={DARK} opacity=".55" />
        {stage >= 1 && (
          <g className="pet-acc" fill="none" stroke={GEAR} strokeWidth="2.4" strokeLinecap="round">
            <path d="M13 27 Q32 8 51 27" />
            <rect x="9.5" y="25" width="6" height="11" rx="2.5" fill={GEAR} stroke="none" />
            <rect x="48.5" y="25" width="6" height="11" rx="2.5" fill={GEAR} stroke="none" />
            <path d="M12 35 q1 8 11 8" strokeWidth="1.6" />
            <circle cx="24" cy="43" r="1.8" fill={GEAR} stroke="none" />
          </g>
        )}
      </g>
      <rect className="pet-leg pet-leg--l" x="20" y="47" width="7" height="8" rx="3" fill={c} />
      <rect className="pet-leg pet-leg--r" x="37" y="47" width="7" height="8" rx="3" fill={c} />
    </g>
  );
}

/** Noxi — "robô-cápsula": corpo de cápsula, antena e um olho-scanner que percorre a faixa. */
function Noxi({ c, eye, stage }) {
  return (
    <g>
      {stage >= 2 && (
        <g className="pet-acc">
          <rect x="11" y="27" width="7" height="16" rx="3" fill={GEAR} />
          <rect x="46" y="27" width="7" height="16" rx="3" fill={GEAR} />
          <path className="pet-flame" d="M12.5 43 q2 6 2 8 q0 -2 2 -8 z M47.5 43 q2 6 2 8 q0 -2 2 -8 z" fill="#FF9F43" />
        </g>
      )}
      <g className="pet-body">
        <line x1="32" y1="6" x2="32" y2="14" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        <circle className="pet-antenna" cx="32" cy="6" r="3" fill={eye} />
        {stage >= 1 && (
          <g className="pet-acc">
            <line x1="40" y1="15" x2="45" y2="7" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
            <circle className="pet-antenna" cx="45" cy="7" r="2.3" fill={eye} />
          </g>
        )}
        <rect x="17" y="13" width="30" height="38" rx="15" fill={c} />
        <rect x="21" y="24" width="22" height="9" rx="4.5" fill={DARK} />
        <circle className="pet-scan" cx="27" cy="28.5" r="2.6" fill={eye} />
        <rect x="26" y="39" width="12" height="3" rx="1.5" fill={DARK} opacity=".45" />
      </g>
      <rect className="pet-arm pet-arm--l" x="11" y="28" width="7" height="4" rx="2" fill={c} />
      <rect className="pet-arm pet-arm--r" x="46" y="28" width="7" height="4" rx="2" fill={c} />
      <rect className="pet-leg pet-leg--l" x="23" y="50" width="6" height="6" rx="3" fill={c} />
      <rect className="pet-leg pet-leg--r" x="35" y="50" width="6" height="6" rx="3" fill={c} />
    </g>
  );
}

/** Query — "polvo-índice": cabeça em cúpula com marcas de índice e quatro tentáculos. */
function Query({ c, eye, stage }) {
  const marks = stage >= 2 ? eye : DARK;
  return (
    <g>
      <g className="pet-tentacles" fill="none" stroke={c} strokeWidth="4.5" strokeLinecap="round">
        <path className="pet-tentacle" d="M20 40 q-4 8 -2 14" />
        <path className="pet-tentacle" d="M27 42 q-1 8 -4 13" />
        <path className="pet-tentacle" d="M37 42 q1 8 4 13" />
        <path className="pet-tentacle" d="M44 40 q4 8 2 14" />
      </g>
      <g className="pet-body">
        <path d="M14 34 a18 18 0 0 1 36 0 v6 h-36 z" fill={c} />
        <g className={stage >= 2 ? 'pet-glow' : ''} opacity={stage >= 2 ? 1 : 0.35}>
          <rect x="24" y="13" width="3" height="6" rx="1.5" fill={marks} />
          <rect x="30.5" y="11" width="3" height="8" rx="1.5" fill={marks} />
          <rect x="37" y="13" width="3" height="6" rx="1.5" fill={marks} />
        </g>
        <circle cx="25" cy="30" r="5" fill={DARK} />
        <circle cx="39" cy="30" r="5" fill={DARK} />
        <circle className="pet-eye" cx="26" cy="29" r="2" fill={eye} />
        <circle className="pet-eye" cx="40" cy="29" r="2" fill={eye} />
        {stage >= 1 && (
          <g className="pet-acc" fill="none" stroke="#E6C15A" strokeWidth="1.6">
            <circle cx="39" cy="30" r="7" />
            <path d="M46 31 q4 6 1 12" strokeWidth="1" />
          </g>
        )}
      </g>
    </g>
  );
}

/** Memo — "coruja-caderno": olhos grandes, tufos e uma barriga de caderno pautado. */
function Memo({ c, eye, stage }) {
  return (
    <g>
      {stage >= 2 && (
        <g className="pet-acc">
          <rect className="pet-float" x="3" y="18" width="9" height="11" rx="1" fill="var(--tk-surface-1)" stroke={c} strokeWidth="1" />
          <rect className="pet-float pet-float--b" x="52" y="12" width="9" height="11" rx="1" fill="var(--tk-surface-1)" stroke={c} strokeWidth="1" />
        </g>
      )}
      <g className="pet-body">
        <path d="M18 16 L22 6 L28 14 Z M36 14 L42 6 L46 16 Z" fill={c} />
        <ellipse cx="32" cy="33" rx="18" ry="21" fill={c} />
        <circle cx="25" cy="25" r="7" fill={DARK} />
        <circle cx="39" cy="25" r="7" fill={DARK} />
        <circle className="pet-eye" cx="25" cy="25" r="3" fill={eye} />
        <circle className="pet-eye" cx="39" cy="25" r="3" fill={eye} />
        {stage >= 1 && (
          <g className="pet-acc" fill="none" stroke={GEAR} strokeWidth="1.8">
            <circle cx="25" cy="25" r="8.5" />
            <circle cx="39" cy="25" r="8.5" />
            <path d="M30 24 q2 -2 4 0" />
          </g>
        )}
        <path d="M29.5 31 L32 35 L34.5 31 Z" fill={DARK} opacity=".7" />
        <rect className="pet-page" x="23" y="38" width="18" height="13" rx="2" fill="var(--tk-surface-1)" />
        <g stroke={c} strokeWidth="1.2" opacity=".7">
          <line x1="26" y1="42" x2="38" y2="42" /><line x1="26" y1="45" x2="38" y2="45" /><line x1="26" y1="48" x2="34" y2="48" />
        </g>
      </g>
      <path className="pet-arm pet-arm--l" d="M14 34 q-4 6 1 10" stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path className="pet-arm pet-arm--r" d="M50 34 q4 6 -1 10" stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Relay — "corvo-orquestrador": ave coral de bico curto, asa de comando e cauda em leque. */
function Relay({ c, eye, stage }) {
  const BEAK = '#FFD27A';
  return (
    <g>
      <path className="pet-tail" d="M40 40 L57 45 L52 38 L58 34 Z" fill={c} opacity=".8" />
      {stage >= 2 && (
        <g className="pet-acc pet-signal" fill="none" stroke={eye} strokeWidth="1.6" strokeLinecap="round">
          <path d="M22 9 q5 -4 10 0" />
          <path d="M19 5 q8 -6 16 0" opacity=".6" />
        </g>
      )}
      <g className="pet-body">
        <ellipse cx="31" cy="38" rx="15" ry="13" fill={c} />
        <circle cx="26" cy="23" r="10" fill={c} />
        <path d="M17 22 L8 25 L17 28 Z" fill={BEAK} />
        <circle cx="23" cy="21" r="3.8" fill={DARK} />
        <circle className="pet-eye" cx="23.5" cy="20.5" r="1.9" fill={eye} />
        {stage >= 1 && (
          <g className="pet-acc" fill="none" stroke={GEAR} strokeWidth="1.8" strokeLinecap="round">
            <rect x="17.5" y="16.5" width="12" height="8" rx="2.5" />
            <path d="M30 20 q6 0 6 6" strokeWidth="1.4" />
          </g>
        )}
      </g>
      <path className="pet-arm pet-arm--r" d="M28 34 q11 -5 17 6 q-9 4 -17 -6 z" fill={DARK} opacity=".25" />
      <rect className="pet-leg pet-leg--l" x="25" y="49" width="3" height="7" rx="1.5" fill={BEAK} />
      <rect className="pet-leg pet-leg--r" x="33" y="49" width="3" height="7" rx="1.5" fill={BEAK} />
    </g>
  );
}

/** Armo — "tatu-servidor": casco em cúpula com gavetas de rack e LEDs piscando. */
function Armo({ c, eye, stage }) {
  return (
    <g>
      {stage >= 1
        ? <g className="pet-acc pet-tail" fill="none" stroke={GEAR} strokeWidth="2" strokeLinecap="round">
            <path d="M12 42 q-7 1 -8 -7" />
            <rect x="1.5" y="31" width="5" height="5" rx="1" fill={GEAR} stroke="none" />
          </g>
        : <path className="pet-tail" d="M12 42 q-6 0 -8 -6" stroke={c} strokeWidth="3" fill="none" strokeLinecap="round" />}
      {stage >= 2 && (
        <g className="pet-acc" fill="none" stroke={GEAR} strokeWidth="1.8" strokeLinecap="round">
          <line x1="31" y1="24" x2="31" y2="15" />
          <path d="M25 13 q6 7 12 0" />
          <circle className="pet-signal" cx="31" cy="11" r="1.6" fill={eye} stroke="none" />
        </g>
      )}
      <g className="pet-body">
        <path d="M11 43 a20 19 0 0 1 40 0 z" fill={c} />
        <g className={stage >= 2 ? 'pet-glow' : ''}>
          <rect x="17" y="29" width="28" height="3.2" rx="1.6" fill={stage >= 2 ? eye : DARK} opacity={stage >= 2 ? 0.55 : 0.45} />
          <rect x="15" y="35" width="32" height="3.2" rx="1.6" fill={stage >= 2 ? eye : DARK} opacity={stage >= 2 ? 0.55 : 0.45} />
        </g>
        <circle className="pet-led" cx="40" cy="30.6" r="1.1" fill={eye} />
        <circle className="pet-led pet-led--b" cx="43" cy="36.6" r="1.1" fill={eye} />
        {stage >= 1 && <circle className="pet-led pet-led--c" cx="20" cy="36.6" r="1.1" fill={eye} />}
        <ellipse cx="52" cy="40" rx="7" ry="6" fill={c} />
        <ellipse cx="50.5" cy="33.5" rx="2" ry="3.4" fill={c} />
        <path d="M57.5 38.5 L63 41 L57.5 43 Z" fill={c} />
        <circle cx="54" cy="38.5" r="1.7" fill={DARK} />
        <circle cx="54.5" cy="38" r=".6" fill={eye} />
      </g>
      <rect className="pet-leg pet-leg--l" x="16" y="42" width="5" height="6" rx="2" fill={c} />
      <rect className="pet-leg pet-leg--r" x="25" y="42" width="5" height="6" rx="2" fill={c} />
      <rect className="pet-leg pet-leg--l" x="34" y="42" width="5" height="6" rx="2" fill={c} />
      <rect className="pet-leg pet-leg--r" x="43" y="42" width="5" height="6" rx="2" fill={c} />
    </g>
  );
}

/** Git — "gato-ramificado": gato baixo e largo (cabeça em elipse, orelhas grandes), cauda em Y subindo pela esquerda com nós de commit. */
function Git({ c, eye, stage }) {
  return (
    <g>
      <g className="pet-tail" fill="none" stroke={c} strokeWidth="3.2" strokeLinecap="round" opacity=".9">
        <path d="M17 48 q-12 -2 -11 -16" />
        <path d="M6 32 q-1 -8 4 -13" />
        <path d="M6 32 q5 -3 9 -10" />
        <circle cx="6" cy="32" r="2.4" fill={eye} stroke="none" />
        <circle cx="10" cy="19" r="2.2" fill={eye} stroke="none" />
        <circle cx="15" cy="22" r="2.2" fill={eye} stroke="none" />
      </g>
      {stage >= 2 && (
        <g className="pet-acc pet-signal" fill="none" stroke={eye} strokeWidth="1.6" strokeLinecap="round">
          <path d="M24 6 h16" /><circle cx="24" cy="6" r="2" fill={eye} stroke="none" /><circle cx="40" cy="6" r="2" fill={eye} stroke="none" />
        </g>
      )}
      <g className="pet-body">
        <ellipse cx="34" cy="46" rx="19" ry="9" fill={c} />
        <path d="M17 24 L19 8 L30 18 Z M38 18 L49 8 L51 24 Z" fill={c} />
        <path d="M20 22 L21 13 L27 19 Z M41 19 L47 13 L48 22 Z" fill={DARK} opacity=".3" />
        <ellipse cx="34" cy="31" rx="17" ry="12" fill={c} />
        <ellipse cx="27" cy="29" rx="3.6" ry="4" fill={DARK} />
        <ellipse cx="41" cy="29" rx="3.6" ry="4" fill={DARK} />
        <ellipse className="pet-eye" cx="27.5" cy="29" rx="1.8" ry="2.6" fill={eye} />
        <ellipse className="pet-eye" cx="41.5" cy="29" rx="1.8" ry="2.6" fill={eye} />
        <path d="M32.5 34 L34 36 L35.5 34 Z" fill={DARK} opacity=".75" />
        <g stroke={DARK} strokeWidth="1" opacity=".5" strokeLinecap="round">
          <path d="M20 35 l-8 -1 M20 38 l-8 2" /><path d="M48 35 l8 -1 M48 38 l8 2" />
        </g>
        {stage >= 1 && (
          <g className="pet-acc">
            <path d="M24 42 q10 5 20 0" fill="none" stroke={GEAR} strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="34" cy="47" r="2.6" fill={eye} />
          </g>
        )}
      </g>
      <rect className="pet-leg pet-leg--l" x="25" y="52" width="8" height="5" rx="2.5" fill={c} />
      <rect className="pet-leg pet-leg--r" x="38" y="52" width="8" height="5" rx="2.5" fill={c} />
    </g>
  );
}

/** Lint — "esquilo-fiscal": esquilo em pé, cabeça redonda, focinho curto e uma cauda grande e fofa atrás. */
function Lint({ c, eye, stage }) {
  return (
    <g>
      <g className="pet-tail">
        <ellipse cx="47" cy="34" rx="12" ry="21" transform="rotate(14 47 34)" fill={c} opacity=".85" />
        <ellipse cx="48" cy="33" rx="6" ry="14" transform="rotate(14 48 33)" fill={DARK} opacity=".16" />
      </g>
      {stage >= 2 && (
        <g className="pet-acc pet-signal" fill="none" stroke={eye} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 l4 4 l9 -9" />
        </g>
      )}
      <g className="pet-body">
        <ellipse cx="30" cy="43" rx="11" ry="13" fill={c} />
        <ellipse cx="27" cy="45" rx="6" ry="9" fill="var(--tk-surface-1)" opacity=".8" />
        <path d="M18 17 L19 8 L26 14 Z M28 14 L35 8 L36 18 Z" fill={c} />
        <circle cx="27" cy="25" r="10.5" fill={c} />
        <ellipse cx="20" cy="29" rx="5" ry="4" fill={c} />
        <circle cx="16" cy="28" r="1.6" fill={DARK} />
        <circle cx="26" cy="23" r="3.3" fill={DARK} />
        <circle className="pet-eye" cx="26.5" cy="23" r="1.7" fill={eye} />
        <rect x="19" y="31" width="3.2" height="4" rx="1" fill="#FFF6D6" />
        {stage >= 1 && (
          <g className="pet-acc" fill="none" stroke={GEAR} strokeWidth="2" strokeLinecap="round">
            <circle cx="15" cy="46" r="5.5" fill="rgba(255,255,255,.14)" />
            <line x1="19" y1="50" x2="24" y2="55" />
          </g>
        )}
      </g>
      <rect className="pet-leg pet-leg--l" x="22" y="53" width="6" height="4" rx="2" fill={c} />
      <rect className="pet-leg pet-leg--r" x="32" y="53" width="6" height="4" rx="2" fill={c} />
    </g>
  );
}

const SPECIES = { byte: Byte, noxi: Noxi, query: Query, memo: Memo, relay: Relay, armo: Armo, git: Git, lint: Lint };

/**
 * Sprite de um DevPet.
 * color: corpo · eye: olhos (padrão do tema se ausente) · stage: 0/1/2 · aura: cor da aura (estágio Mestre)
 * locked = silhueta (ainda não descoberto).
 */
export function PetSprite({ id, color, eye, stage = 0, aura, size = 56, locked = false, className = '' }) {
  const Body = SPECIES[id] || Byte;
  const gid = 'aura-' + React.useId().replace(/:/g, '');
  const showAura = !locked && stage >= 2;
  return (
    <svg className={'pet-svg' + (locked ? ' is-locked' : '') + ' ' + className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {showAura && (
        <>
          <defs>
            <radialGradient id={gid}>
              <stop offset="0%" stopColor={aura || color} stopOpacity=".55" />
              <stop offset="70%" stopColor={aura || color} stopOpacity=".12" />
              <stop offset="100%" stopColor={aura || color} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="pet-aura" cx="32" cy="32" r="31" fill={`url(#${gid})`} />
        </>
      )}
      <ellipse className="pet-shadow" cx="32" cy="58" rx="16" ry="3" fill="#000" opacity=".25" />
      <Body c={locked ? 'var(--tk-surface-4)' : color} eye={locked ? 'var(--tk-surface-3)' : eye || 'var(--dc-eye, #CFFBE3)'} stage={locked ? 0 : stage} />
    </svg>
  );
}

/** Cor da aura: dourada nos épicos, a do próprio pet nos demais. */
export const auraOf = (pet) => (pet.rarity === 'epic' ? '#F5C542' : pet.color);
