import { DS } from '../../lib/ds.js';
import { isDescendant, parentOf } from '../../notes/folders.js';

const { Icon } = DS;

export const NOTE_DRAG = 'application/x-devkit-note';
export const FOLDER_DRAG = 'application/x-devkit-folder';

const hasType = (e, t) => Array.from(e.dataTransfer.types || []).includes(t);

/**
 * Arrastar e soltar de notas e pastas. `dropProps(path, key)` vai em qualquer elemento que aceite soltar
 * (path = pasta de destino, '' = raiz); `over` é a chave sob o cursor, para o destaque.
 * O evento não sobe: o alvo mais interno vence (pasta > nota > fundo da lista = raiz).
 */
export function useFolderDnD({ onDropNote, onDropFolder }) {
  const [over, setOver] = React.useState(null);
  const accepts = (e) => hasType(e, NOTE_DRAG) || hasType(e, FOLDER_DRAG);
  const dropProps = (path, key = path) => ({
    onDragOver: (e) => {
      if (!accepts(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget) && over === key) setOver(null); },
    onDrop: (e) => {
      if (!accepts(e)) return;
      e.preventDefault(); e.stopPropagation(); setOver(null);
      const note = e.dataTransfer.getData(NOTE_DRAG), folder = e.dataTransfer.getData(FOLDER_DRAG);
      if (note) onDropNote(note, path);
      else if (folder && folder !== path && parentOf(folder) !== path && !isDescendant(path, folder)) onDropFolder(folder, path);
    },
  });
  return { over, dropProps, clearOver: () => setOver(null) };
}

/**
 * Linha de uma pasta na lista de notas. Clique expande/recolhe (e marca a pasta como destino de novas notas);
 * a setinha só expande/recolhe. Arrastável e alvo de soltar; botão direito abre o menu.
 */
export function FolderRow({ path, name, total, isOpen, hasKids, active, isOver, dropProps, onClick, onToggle, onContext }) {
  return (
    <div
      role="treeitem"
      aria-expanded={isOpen}
      className={'nts-folder' + (active ? ' is-on' : '') + (isOver ? ' is-drop' : '')}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, path); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onContext(path, e.clientX, e.clientY); }}
      {...dropProps}
    >
      <button type="button" className="nts-folder__chev" tabIndex={-1} aria-label={isOpen ? 'Recolher' : 'Expandir'}
        onClick={(e) => { e.stopPropagation(); onToggle(path); }}>
        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      <Icon name={isOpen ? 'folder-open' : 'folder'} size={14} className="nts-folder__icon" />
      <span className="nts-folder__name" title={path}>{name}</span>
      <span className="nts-folder__count" title="Notas nesta pasta e nas subpastas">{total || ''}</span>
    </div>
  );
}
