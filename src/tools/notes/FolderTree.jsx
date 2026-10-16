import { DS } from '../../lib/ds.js';
import { isDescendant, parentOf, baseName } from '../../notes/folders.js';
import { FOLDER_COLORS } from '../../notes/foldermeta.js';

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
 * Linha de uma pasta na lista de notas. Clicar seleciona a pasta (destino das notas novas) e a abre se estava
 * fechada, mas nunca a recolhe; recolher é pela setinha ou ←. Arrastável e alvo de soltar;
 * botão direito (ou Shift+F10) abre o menu. Navegação por teclado: ver `onTreeKeyDown` em NotesScreen.
 * `meta` traz a configuração da pasta (cor, ícone, fixada).
 */
export function FolderRow({ path, name, total, level = 1, meta = {}, isOpen, hasKids, active, isOver, dropProps, onClick, onToggle, onContext }) {
  const color = meta.color ? FOLDER_COLORS[meta.color] : undefined;
  const icon = meta.icon && meta.icon !== 'folder' ? meta.icon : isOpen ? 'folder-open' : 'folder';
  return (
    <div
      role="treeitem"
      aria-expanded={isOpen}
      aria-selected={!!active}
      aria-level={level}
      data-nav={'f:' + path}
      tabIndex={-1}
      className={'nts-folder' + (active ? ' is-on' : '') + (isOver ? ' is-drop' : '')}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, path); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onContext(path, e.clientX, e.clientY); }}
      {...dropProps}
    >
      <button type="button" className="nts-folder__chev" tabIndex={-1} aria-hidden="true"
        title={isOpen ? 'Recolher' : 'Expandir'}
        onClick={(e) => { e.stopPropagation(); onToggle(path); }}>
        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      <Icon name={icon} size={14} className="nts-folder__icon" style={color ? { color } : undefined} />
      <span className="nts-folder__name" title={path}>{name}</span>
      {meta.pinned && <Icon name="pin" size={10} className="nts-folder__pin" />}
      <span className="nts-folder__count" title="Notas nesta pasta e nas subpastas">{total || ''}</span>
    </div>
  );
}

/** Atalho para uma pasta fixada (topo do explorador): clicar revela a pasta na árvore. */
export function PinnedFolderRow({ path, meta = {}, role = 'treeitem', onReveal, onContext }) {
  const color = meta.color ? FOLDER_COLORS[meta.color] : undefined;
  const parent = parentOf(path);
  return (
    <div role={role} aria-level={role === 'treeitem' ? 1 : undefined} data-nav={'pf:' + path} tabIndex={-1} className="nts-folder is-shortcut"
      onClick={() => onReveal(path)}
      onContextMenu={(e) => { e.preventDefault(); onContext(path, e.clientX, e.clientY); }}>
      <Icon name={meta.icon || 'folder'} size={14} className="nts-folder__icon" style={color ? { color } : undefined} />
      <span className="nts-folder__name" title={path}>{baseName(path)}</span>
      {parent && <span className="nts-folder__where" title={parent}>{parent}</span>}
    </div>
  );
}
