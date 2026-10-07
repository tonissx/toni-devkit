/**
 * Ilustração de cada upgrade do DevCore. Grade 24×24, traço em currentColor e detalhes em var(--tk-accent)
 * (mesmo estilo das peças de Blueprint em PartArt.jsx).
 * - GEN: glifo de cada gerador (base das ilustrações e dos combos);
 * - ART: desenho próprio de cada upgrade (chave = id);
 * - combos são montados a partir dos glifos: fonte → seta → alvo, então um combo novo já nasce ilustrado.
 */
const A = 'var(--tk-accent)';

const GEN = {
  'terminal-worker': <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10l3 2.5L7 15" stroke={A} /><path d="M12 15h5" /></>,
  'script-runner': <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M10.5 11.5v5l4-2.5z" stroke={A} fill={A} /></>,
  'index-worker': <><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" /><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" stroke={A} /></>,
  'automation-worker': <><circle cx="12" cy="12" r="3" stroke={A} /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  agent: <><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 8V5" /><circle cx="12" cy="4" r="1.2" fill={A} stroke="none" /><circle cx="9.5" cy="13" r="1.2" fill={A} stroke="none" /><circle cx="14.5" cy="13" r="1.2" fill={A} stroke="none" /><path d="M9.5 16.5h5" /></>,
  'local-cluster': <><rect x="4" y="3.5" width="16" height="5" rx="1.2" /><rect x="4" y="9.5" width="16" height="5" rx="1.2" /><rect x="4" y="15.5" width="16" height="5" rx="1.2" /><path d="M7 6h.01M7 12h.01M7 18h.01" stroke={A} strokeWidth="2.2" /><path d="M11 6h6M11 12h6M11 18h6" /></>,
};

/** Glifo de gerador reposicionado (x, y, escala) — para compor ilustrações. */
const place = (gen, x, y, k) => <g transform={`translate(${x} ${y}) scale(${k})`}>{GEN[gen]}</g>;

const ART = {
  // Gerador
  'terminal-optimization': <>{place('terminal-worker', 0, 3, 0.75)}<path d="M18.5 2l-3 6h3l-2 6 5-8h-3l2-4z" stroke={A} fill={A} /></>,
  'script-caching': <>{place('script-runner', 0, 3, 0.75)}<ellipse cx="18" cy="16" rx="4" ry="1.6" stroke={A} /><path d="M14 16v3.5c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6V16" stroke={A} /></>,
  'index-sharding': <><ellipse cx="12" cy="4.5" rx="7" ry="2.3" /><path d="M5 4.5v3c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3v-3" /><path d="M5 11v3c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3v-3" stroke={A} /><path d="M5 17.5v2c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3v-2" /><path d="M3 9.5l2 1.5M21 9.5l-2 1.5M3 16l2 1.5M21 16l-2 1.5" /></>,
  'pipeline-tuning': <><circle cx="4" cy="8" r="2" /><circle cx="12" cy="8" r="2" stroke={A} /><circle cx="20" cy="8" r="2" /><path d="M6 8h4M14 8h4" /><path d="M4 18h16" /><circle cx="14" cy="18" r="2" fill={A} stroke={A} /></>,
  'agent-memory': <>{place('agent', 0, 3, 0.75)}<rect x="15" y="12" width="7" height="7" rx="1" stroke={A} /><path d="M17 12v-1.5M20 12v-1.5M17 19v1.5M20 19v1.5M15 14.5h-1.5M15 17h-1.5M22 14.5h1.5M22 17h1.5" stroke={A} /></>,

  // Global
  'parallel-execution': <><path d="M3 6h15M3 12h15M3 18h15" /><path d="M15 3l3 3-3 3M15 9l3 3-3 3M15 15l3 3-3 3" stroke={A} /></>,
  'hot-reload': <><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M19 3v4.5h-4.5" /><path d="M12 9c1.8 2 2.6 3 2.6 4.4a2.6 2.6 0 0 1-5.2 0c0-.9.5-1.6 1.1-2.2.3 1 .8 1.3 1.5 1.3-.3-1.3 0-2.4 0-3.5z" stroke={A} fill={A} /></>,

  // Mecânica
  'distributed-runtime': <><circle cx="12" cy="12" r="2.4" fill={A} stroke={A} /><circle cx="4.5" cy="6" r="2" /><circle cx="19.5" cy="6" r="2" /><circle cx="4.5" cy="18" r="2" /><circle cx="19.5" cy="18" r="2" /><path d="M6.3 7.3l3.8 3M17.7 7.3l-3.8 3M6.3 16.7l3.8-3M17.7 16.7l-3.8-3" /></>,
  'task-scheduler': <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><path d="M8.5 14.5l2.3 2.3 4.7-4.6" stroke={A} /></>,
  'offline-daemon': <><path d="M15 3.5a8.5 8.5 0 1 0 5.5 13 7 7 0 0 1-5.5-13z" /><circle cx="17.5" cy="7.5" r="1.6" stroke={A} /><path d="M17.5 4.5v1.4M17.5 9.1v1.4M14.5 7.5h1.4M19.1 7.5h1.4" stroke={A} /></>,

  // DevPet
  'specialized-training': <><path d="M7 8v8M17 8v8" /><rect x="3.5" y="9.5" width="3.5" height="5" rx="1" /><rect x="17" y="9.5" width="3.5" height="5" rx="1" /><path d="M7 12h10" stroke={A} strokeWidth="2" /><path d="M12 3.5l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z" stroke={A} fill={A} /></>,
  'pair-programming': <><rect x="5" y="3.5" width="14" height="9" rx="1.5" /><path d="M9 7l-1.5 1.5L9 10M15 7l1.5 1.5L15 10" stroke={A} /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="17.5" r="2.5" /><path d="M10 17.5h4" stroke={A} /></>,
};

/** Combo: fonte (pequena, embaixo) → seta → alvo (em cima). */
function comboArt(from, to) {
  return (
    <>
      {place(from, 1, 12.5, 0.45)}
      {place(to, 10.5, 1.5, 0.52)}
      <path d="M7 12.5c0-3.6 1.2-5.6 3.6-6.1" stroke={A} />
      <path d="M9.4 4.7l1.7 1.7-1.6 1.8" stroke={A} />
      <path d="M17.5 17v4M15.5 19h4" stroke={A} />
    </>
  );
}

const FALLBACK = <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" stroke={A} /></>;
const LOCKED = <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><circle cx="12" cy="15.5" r="1.3" fill={A} stroke="none" /></>;

/**
 * Ilustração de um upgrade. u: { id, combo?: { from, to } } · locked: desenho de cadeado (upgrade ainda secreto).
 */
export function UpgradeArt({ u, locked = false, size = 40, className = '' }) {
  const art = locked ? LOCKED : u.combo ? comboArt(u.combo.from, u.combo.to) : ART[u.id] || FALLBACK;
  return (
    <span className={'dc-upg-art ' + className} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.72} height={size * 0.72} fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round">{art}</svg>
    </span>
  );
}
