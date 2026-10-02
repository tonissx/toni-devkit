/**
 * Desenho de cada peça de Blueprint, para montar na estação da cena. Grade 12×12, traço em currentColor
 * e detalhes em var(--tk-accent). Chave = id da peça ("<gen>:mk<N>:<i>"); sem desenho cai no FALLBACK.
 */
const A = 'var(--tk-accent)';

const ART = {
  // Terminal Worker · Mk II
  'terminal-worker:mk2:0': <><rect x="1" y="3.5" width="10" height="5.5" rx="1" /><path d="M3 5.5h.01M5 5.5h.01M7 5.5h.01M9 5.5h.01M3.5 7.5h5" stroke={A} /></>,
  'terminal-worker:mk2:1': <><path d="M3 1.5h4l2.5 2.5v6.5h-6.5z" /><circle cx="6" cy="8" r="1" fill={A} stroke="none" /></>,
  'terminal-worker:mk2:2': <><rect x="1" y="2" width="10" height="8" rx="1" /><path d="M6 2v8M6 6h5" stroke={A} /></>,
  'terminal-worker:mk2:3': <><path d="M2 3l3 3-3 3" /><path d="M6.5 9.5h4" stroke={A} /><path d="M7 4.5c.7-.8 1.3.8 2 0s1.3-.8 2 0" /></>,

  // Script Runner · Mk II
  'script-runner:mk2:0': <><circle cx="6" cy="6" r="4.5" /><path d="M6 3v3l2 1.5" stroke={A} /></>,
  'script-runner:mk2:1': <><path d="M10 6a4 4 0 1 1-1.2-2.8" /><path d="M9.5 1v2.5H7" stroke={A} /></>,
  'script-runner:mk2:2': <><rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /><circle cx="6" cy="8" r=".8" fill={A} stroke="none" /></>,
  'script-runner:mk2:3': <><circle cx="6" cy="6" r="4.5" /><path d="M4 5h4M4 7h4" stroke={A} /></>,

  // Index Worker · Mk II
  'index-worker:mk2:0': <><rect x="1.5" y="1.5" width="9" height="2.5" rx=".8" /><rect x="1.5" y="4.8" width="9" height="2.5" rx=".8" stroke={A} /><rect x="1.5" y="8.1" width="9" height="2.5" rx=".8" /></>,
  'index-worker:mk2:1': <><path d="M6 3.5L3 8.5M6 3.5l3 5" /><circle cx="6" cy="2.5" r="1.5" fill={A} stroke="none" /><circle cx="3" cy="9" r="1.5" /><circle cx="9" cy="9" r="1.5" /></>,
  'index-worker:mk2:2': <><circle cx="5" cy="5" r="3.2" /><path d="M7.5 7.5l3.2 3.2" stroke={A} strokeWidth="1.8" /></>,
  'index-worker:mk2:3': <><path d="M6 1c1.8 3 4 3.8 4 7a4 4 0 0 1-8 0c0-1.8 1.2-3 2.2-4C5 5.2 5.5 3 6 1z" stroke={A} /><path d="M6 11V8" /></>,

  // Automation Worker · Mk II
  'automation-worker:mk2:0': <><circle cx="2" cy="6" r="1.4" /><circle cx="6" cy="6" r="1.4" stroke={A} /><circle cx="10" cy="6" r="1.4" /><path d="M3.4 6h1.2M7.4 6h1.2" /></>,
  'automation-worker:mk2:1': <><path d="M6 1l4.5 2.5v5L6 11 1.5 8.5v-5z" /><path d="M1.5 3.5L6 6l4.5-2.5M6 6v5" stroke={A} /></>,
  'automation-worker:mk2:2': <><path d="M1 3h8.5M1 6h8.5M1 9h8.5" /><path d="M8 1.8L10 3 8 4.2M8 4.8L10 6 8 7.2M8 7.8L10 9 8 10.2" stroke={A} /></>,
  'automation-worker:mk2:3': <><rect x="1.5" y="1.5" width="3" height="3" /><rect x="7.5" y="1.5" width="3" height="3" /><rect x="1.5" y="7.5" width="3" height="3" /><rect x="7.5" y="7.5" width="3" height="3" fill={A} /></>,

  // Agent · Mk II
  'agent:mk2:0': <><path d="M3 2H1.5v8H3M9 2h1.5v8H9" /><path d="M4 4h4M4 6h4M4 8h2.5" stroke={A} /></>,
  'agent:mk2:1': <><circle cx="3.8" cy="3.8" r="2.3" /><path d="M5.5 5.5l5 5" stroke={A} strokeWidth="1.8" /></>,
  'agent:mk2:2': <><path d="M1.5 3.5l1.2 1.2 2-2.2" stroke={A} /><path d="M6.5 3.5h4M1.5 8h1.2M6.5 8h4" /><path d="M1.5 8l1.2 1.2 2-2.2" /></>,
  'agent:mk2:3': <><rect x="1" y="3" width="10" height="5" rx=".8" /><path d="M3 8v2M5 8v2M7 8v2M9 8v2" stroke={A} /><path d="M3 5.5h2" /></>,

  // Local Cluster · Mk II
  'local-cluster:mk2:0': <><circle cx="6" cy="2.2" r="1.3" fill={A} stroke="none" /><path d="M6 3.5L2 9.5M6 3.5v6M6 3.5l4 6" /></>,
  'local-cluster:mk2:1': <path d="M1 6h2.5l1.2-3 2.2 6 1.3-3H11" stroke={A} />,
  'local-cluster:mk2:2': <><circle cx="2.5" cy="2.5" r="1.3" /><circle cx="9.5" cy="2.5" r="1.3" /><circle cx="2.5" cy="9.5" r="1.3" /><circle cx="9.5" cy="9.5" r="1.3" /><path d="M2.5 3.8v4.4M9.5 3.8v4.4M3.8 2.5h4.4M3.8 9.5h4.4M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6" stroke={A} /></>,
  'local-cluster:mk2:3': <><rect x="1" y="4" width="2.6" height="4" fill="currentColor" /><rect x="4.7" y="4" width="2.6" height="4" fill="currentColor" /><rect x="8.4" y="4" width="2.6" height="4" stroke={A} /></>,

  // Terminal Worker · Mk III
  'terminal-worker:mk3:0': <><rect x="3.5" y="3.5" width="5" height="5" rx=".8" /><path d="M5 1.5v2M7 1.5v2M5 8.5v2M7 8.5v2M1.5 5h2M1.5 7h2M8.5 5h2M8.5 7h2" /><circle cx="6" cy="6" r="1" fill={A} stroke="none" /></>,
  'terminal-worker:mk3:1': <path d="M7 1L3 6.7h3L5 11l4-5.7H6z" stroke={A} />,
  'terminal-worker:mk3:2': <><path d="M1.5 4.5h5M1.5 8h2.5" /><path d="M5 8h5.5" strokeDasharray="1.2 1.2" stroke={A} /><path d="M9.5 1v3M8 2.5h3" stroke={A} /></>,
  'terminal-worker:mk3:3': <><ellipse cx="6" cy="6" rx="5" ry="2" /><ellipse cx="6" cy="6" rx="5" ry="2" transform="rotate(60 6 6)" /><ellipse cx="6" cy="6" rx="5" ry="2" transform="rotate(-60 6 6)" /><circle cx="6" cy="6" r="1" fill={A} stroke="none" /></>,

  // Script Runner · Mk III
  'script-runner:mk3:0': <><circle cx="6" cy="6" r="4.5" /><path d="M6 3.5v5M3.5 6h5" stroke={A} /></>,
  'script-runner:mk3:1': <><circle cx="1.8" cy="6" r="1" /><circle cx="10.2" cy="6" r="1" /><path d="M2.8 6h1M8.2 6h1" /><rect x="3.8" y="6" width="4.4" height="4" rx=".8" /><path d="M5 6V4.8a1 1 0 0 1 2 0V6" stroke={A} /></>,
  'script-runner:mk3:2': <><path d="M5 1.5a1 1 0 0 1 2 0V7a2.2 2.2 0 1 1-2 0z" /><circle cx="6" cy="8.8" r="1" fill={A} stroke="none" /></>,
  'script-runner:mk3:3': <><path d="M3 8.5V6a3 3 0 0 1 6 0v2.5l1 1H2z" /><path d="M5 11h2" stroke={A} /></>,

  // Index Worker · Mk III
  'index-worker:mk3:0': <><rect x="1.5" y="5" width="1.8" height="5.5" /><rect x="4.2" y="2" width="1.8" height="8.5" /><rect x="6.9" y="4" width="1.8" height="6.5" stroke={A} /><rect x="9.6" y="6.5" width="1.2" height="4" /></>,
  'index-worker:mk3:1': <><path d="M1.5 1.5v9h9" /><path d="M3 9L10 2.5M6.8 2.5H10v3.2" stroke={A} /></>,
  'index-worker:mk3:2': <><path d="M1.5 3h9M1.5 6h9M1.5 9h9" /><circle cx="4" cy="3" r="1.2" fill={A} stroke="none" /><circle cx="8" cy="6" r="1.2" fill={A} stroke="none" /><circle cx="5" cy="9" r="1.2" fill={A} stroke="none" /></>,
  'index-worker:mk3:3': <><path d="M1 6c2-3.5 8-3.5 10 0-2 3.5-8 3.5-10 0z" /><circle cx="6" cy="6" r="1.5" fill={A} stroke="none" /></>,

  // Automation Worker · Mk III
  'automation-worker:mk3:0': <><rect x="4" y="4" width="4" height="4" rx=".6" /><path d="M1 6h2.5M1 6l1.2-1.2M1 6l1.2 1.2M11 6H8.5M11 6l-1.2-1.2M11 6l-1.2 1.2" stroke={A} /></>,
  'automation-worker:mk3:1': <><path d="M3.5 9.5a2.5 2.5 0 0 1 .3-5 3 3 0 0 1 5.6.8A2 2 0 0 1 9 9.5z" /><path d="M6 6v2.5M5 7.5l1 1 1-1" stroke={A} /></>,
  'automation-worker:mk3:2': <><path d="M4.5 1.5h3M5 1.5v3.5L2.5 9.5a1 1 0 0 0 .9 1.5h5.2a1 1 0 0 0 .9-1.5L7 5V1.5" /><circle cx="6" cy="8.6" r=".8" fill={A} stroke="none" /></>,
  'automation-worker:mk3:3': <><circle cx="3" cy="2.5" r="1.2" /><circle cx="3" cy="9.5" r="1.2" /><circle cx="9" cy="6.2" r="1.2" fill={A} stroke="none" /><path d="M3 3.7v4.6M3 5c3 0 6 0 6 .1" stroke={A} /></>,

  // Agent · Mk III
  'agent:mk3:0': <><circle cx="6" cy="2.5" r="1.4" /><circle cx="2.5" cy="9" r="1.4" /><circle cx="9.5" cy="9" r="1.4" /><path d="M5.3 3.8L3.2 7.7M6.7 3.8l2.1 3.9M4 9h4" stroke={A} /></>,
  'agent:mk3:1': <><path d="M2 6a4 4 0 0 1 7-2.6M10 6a4 4 0 0 1-7 2.6" /><path d="M9.5 1v2.6H7M2.5 11V8.4H5" stroke={A} /></>,
  'agent:mk3:2': <><rect x="1.5" y="3" width="2.3" height="7.5" /><rect x="4.4" y="2" width="2.3" height="8.5" /><path d="M8 3.5l2.2-.6 1.6 7-2.2.6z" stroke={A} /></>,
  'agent:mk3:3': <><circle cx="6" cy="5" r="3.5" /><path d="M4.8 9.5h2.4M5 11h2" /><path d="M5 6l1-1.5L7 6" stroke={A} /></>,

  // Local Cluster · Mk III
  'local-cluster:mk3:0': <><path d="M6 1l4 2.3v4.6L6 10.2 2 7.9V3.3z" /><path d="M6 4.5v3M4.5 6h3" stroke={A} /></>,
  'local-cluster:mk3:1': <><circle cx="6" cy="6" r="4.5" /><ellipse cx="6" cy="6" rx="2" ry="4.5" /><path d="M1.5 6h9" stroke={A} /></>,
  'local-cluster:mk3:2': <><circle cx="2.2" cy="5" r="1.3" /><circle cx="9.8" cy="5" r="1.3" /><circle cx="6" cy="6.3" r="3.5" /><ellipse cx="6" cy="7.6" rx="1.6" ry="1.1" /><path d="M4.7 5.4h.01M7.3 5.4h.01" stroke={A} strokeWidth="1.6" /></>,
  'local-cluster:mk3:3': <><rect x="1" y="3" width="3" height="6" rx=".6" /><rect x="8" y="3" width="3" height="6" rx=".6" /><path d="M4.8 6h2.4M6.2 4.8L7.4 6 6.2 7.2" stroke={A} /></>,
};

const FALLBACK = <><rect x="2" y="2" width="8" height="8" rx="1.5" /><circle cx="6" cy="6" r="1.4" fill={A} stroke="none" /></>;

/** Ícone de uma peça de Blueprint (usa a cor do texto: acende quando obtida, apaga quando falta). */
export function PartIcon({ id, size = 16 }) {
  return (
    <svg className="dc-part__art" viewBox="0 0 12 12" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ART[id] || FALLBACK}</svg>
  );
}
