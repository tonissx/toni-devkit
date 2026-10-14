/**
 * Cartão de detalhes do DevCore: o item mostra um resumo e o resto aparece ao passar o mouse.
 * Abre com hover (após um pequeno atraso) ou foco — Tab, clique e toque focam o gatilho; fecha ao sair, ao perder
 * o foco, com Escape ou ao rolar. Só informação: nenhuma ação dentro do cartão.
 * Vai para document.body (portal) com position: fixed — os overlays do DS usam position: absolute e seriam
 * cortados pelo painel com rolagem (.dc-panel). Abre embaixo do gatilho e vira para cima se não couber.
 */
const GAP = 6;
const EDGE = 8;
let seq = 0;

/** focusable=false quando o gatilho já é um botão: o foco fica nele (o evento sobe até aqui e abre o cartão). */
export function InfoCard({ content, children, className = '', label, delay = 250, focusable = true }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const [id] = React.useState(() => 'dc-info-' + ++seq);
  const anchor = React.useRef(null);
  const card = React.useRef(null);
  const timer = React.useRef(null);

  const show = (ms) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), ms); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); setPos(null); };
  React.useEffect(() => () => clearTimeout(timer.current), []);

  // Posição: medida depois de renderizar (invisível) para saber a altura do cartão.
  React.useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) return;
    const r = anchor.current.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = card.current;
    const below = r.bottom + GAP;
    const top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - GAP - h) : below;
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - w - EDGE);
    setPos({ top, left });
  }, [open, content]);

  // Rolar ou redimensionar deixa a posição velha: fecha.
  React.useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [open]);

  return (
    <span ref={anchor} className={'dc-info-anchor ' + className} tabIndex={focusable ? 0 : undefined} aria-label={label} aria-describedby={open ? id : undefined}
      onMouseEnter={() => show(delay)} onMouseLeave={hide} onFocus={() => show(0)} onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}>
      {children}
      {open && ReactDOM.createPortal(
        <div ref={card} id={id} role="tooltip" className="dc-info"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
