// Logs — arrastar a borda de uma bandeja para ajustar o tamanho (mesmo padrão do Git e das Notes): durante o arraste o
// tamanho é "ao vivo" e só é gravado ao soltar; duplo clique alterna padrão/ampliada; as setas ajustam de 16 em 16.
//
// axis 'x': bandeja colada na borda direita de rootRef (borda arrastável à esquerda dela);
// axis 'y': bandeja colada na borda de baixo (borda arrastável em cima); `offset` = altura do que não conta (cabeçalho).
export function useSplit({ value, onCommit, rootRef, axis, offset = 0, norm, maxOf, def, wide }) {
  const [live, setLive] = React.useState(null);
  const rect = () => (rootRef.current ? rootRef.current.getBoundingClientRect() : null);
  const max = () => { const r = rect(); return r ? maxOf(r) : undefined; };
  const size = norm(value, max());
  const commit = (v) => onCommit(norm(v, max()));
  const rawOf = (e) => {
    const r = rect();
    if (!r) return size;
    return axis === 'x' ? r.right - e.clientX : r.bottom - e.clientY - offset;
  };
  const grow = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
  const shrink = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
  const grip = {
    onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setLive(size); },
    onPointerMove: (e) => { if (live != null) setLive(norm(rawOf(e), max())); },
    onPointerUp: () => { if (live != null) { commit(live); setLive(null); } },
    onLostPointerCapture: () => setLive(null),
    onDoubleClick: () => commit(size >= wide - 8 ? def : wide),
    onKeyDown: (e) => {
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      commit(size === 0 ? (e.key === grow ? def : 0) : size + (e.key === grow ? 16 : -16)); // recolhido: ↑ abre no padrão
    },
  };
  return { size: live ?? size, dragging: live != null, grip };
}
