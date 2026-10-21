/** Fecha um painel flutuante ao apertar fora dele (e fora do botão que o abre, que alterna sozinho) ou com Esc. */
export function useDismiss(open, refs, close) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!refs.some((r) => r.current && r.current.contains(e.target))) closeRef.current(); };
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
}
