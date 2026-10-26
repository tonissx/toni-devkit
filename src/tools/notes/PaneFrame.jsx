import { NOTE_DRAG } from './FolderTree.jsx';
import { zoneAt } from '../../notes/grid.js';

const LABEL = {
  center: (full) => (full ? 'Trocar / substituir a nota' : 'Adicionar à grade'),
  left: () => 'Entra antes deste painel',
  top: () => 'Entra antes deste painel',
  right: () => 'Entra depois deste painel',
  bottom: () => 'Entra depois deste painel',
};

/**
 * Moldura de um painel da grade: marca o painel ativo e recebe notas arrastadas (da lista ou das abas).
 * Mostra onde a nota vai cair: no centro ocupa/entra na grade, nas bordas escolhe a posição.
 */
export function PaneFrame({ active, multi, full, onActivate, onDropNote, children }) {
  const [zone, setZone] = React.useState(null);
  const accepts = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes(NOTE_DRAG);

  return (
    <div className={'nts-pane' + (active ? ' is-active' : '') + (multi ? ' is-multi' : '')}
      onMouseDownCapture={onActivate} onFocusCapture={onActivate}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        setZone(full ? 'center' : zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setZone(null); }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault(); e.stopPropagation();
        const id = e.dataTransfer.getData(NOTE_DRAG);
        const z = zone || 'center';
        setZone(null);
        if (id) onDropNote(id, z);
      }}>
      {children}
      {zone && <div className={'nts-dz is-' + zone} aria-hidden="true">{LABEL[zone](full)}</div>}
    </div>
  );
}
