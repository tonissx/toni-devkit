import { NOTE_DRAG } from './FolderTree.jsx';

/**
 * Barra de abas do Notes = contexto geral: todas as notas abertas, estejam ou não na visão. A bolinha cheia marca as que
 * aparecem em algum painel. Clicar traz a nota para a visão (ou foca o painel dela); arrastar uma aba para a visão a
 * posiciona na grade. Não há ✕ aqui: tirar uma nota da visão é só pelo botão do próprio painel.
 */
export function NoteTabs({ tabs, activeId, visible, rows, fallbacks, onSelect }) {
  const ref = React.useRef(null);
  const byId = React.useMemo(() => new Map((rows || []).map((r) => [r.id, r])), [rows]);

  // Mantém a aba ativa à vista quando há mais abas do que cabe na barra.
  React.useEffect(() => {
    const el = ref.current && ref.current.querySelector('[aria-selected="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const key = (e, i) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      if (n) { onSelect(n.id); const el = ref.current && ref.current.querySelectorAll('[role="tab"]')[tabs.indexOf(n)]; if (el) el.focus(); }
    } else if (e.key === 'Enter') onSelect(tabs[i].id);
  };

  return (
    <div className="nts-tabs tk-scroll" role="tablist" aria-label="Notas abertas" ref={ref}>
      {tabs.map((t, i) => {
        const r = byId.get(t.id) || (fallbacks && fallbacks.find((f) => f.id === t.id)) || null;
        const title = (r && r.title) || 'Sem título';
        const on = t.id === activeId;
        const vis = visible.has(t.id);
        return (
          <div key={t.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} draggable
            className={'nts-tab' + (on ? ' is-on' : '') + (vis ? ' is-vis' : '')}
            title={(r && r.folder ? r.folder + ' / ' : '') + title + (vis ? '' : ' — fora da visão (clique para mostrar)')}
            onDragStart={(e) => { e.dataTransfer.setData(NOTE_DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => key(e, i)}>
            <span className="nts-tab__mark" aria-hidden="true" />
            <span className="nts-tab__title">{title}</span>
          </div>
        );
      })}
    </div>
  );
}
