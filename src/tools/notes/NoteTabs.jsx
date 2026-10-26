import { DS } from '../../lib/ds.js';

const { Icon } = DS;

/**
 * Abas das notas abertas (acima do editor). `tabs` = [{ id, pinned }]; o título vem de `rows` (renomear reflete sozinho).
 * Aba em itálico = prévia (a próxima nota aberta pela lista a substitui). Duplo clique fixa; clique do meio ou ✕ fecha.
 */
export function NoteTabs({ tabs, activeId, rows, fallback, onSelect, onClose, onPin, onMenu }) {
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
    } else if (e.key === 'Delete') { e.preventDefault(); onClose(tabs[i].id); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      onMenu(tabs[i].id, r.left + 12, r.bottom - 4);
    }
  };

  return (
    <div className="nts-tabs tk-scroll" role="tablist" aria-label="Notas abertas" ref={ref}>
      {tabs.map((t, i) => {
        const r = byId.get(t.id) || (fallback && fallback.id === t.id ? fallback : null);
        const title = (r && r.title) || 'Sem título';
        const on = t.id === activeId;
        return (
          <div key={t.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            className={'nts-tab' + (on ? ' is-on' : '') + (t.pinned ? '' : ' is-preview')}
            title={r && r.folder ? r.folder + ' / ' + title : title}
            onClick={() => onSelect(t.id)}
            onDoubleClick={() => onPin(t.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}
            onContextMenu={(e) => { e.preventDefault(); onMenu(t.id, e.clientX, e.clientY); }}
            onKeyDown={(e) => key(e, i)}>
            <span className="nts-tab__title">{title}</span>
            <button type="button" className="nts-tab__x" aria-label={'Fechar ' + title} tabIndex={-1}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
