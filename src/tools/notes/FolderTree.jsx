import { DS } from '../../lib/ds.js';
import { buildTree, isDescendant, parentOf } from '../../notes/folders.js';

const { Icon, IconButton } = DS;

export const NOTE_DRAG = 'application/x-devkit-note';
export const FOLDER_DRAG = 'application/x-devkit-folder';

const hasType = (e, t) => Array.from(e.dataTransfer.types || []).includes(t);

/**
 * Árvore de pastas da sidebar das Notes. Cada pasta é um diretório real.
 * - Clique seleciona (de novo desseleciona) · seta recolhe/expande · botão direito abre o menu (onContext).
 * - Aceita soltar notas e pastas em cima de uma pasta (ou de "Sem pasta" = raiz).
 * Props: folders [{ path, count }] · rootCount · selected (null | '' | caminho) · open { caminho: true }
 *        onSelect(path|null) · onToggle(path) · onCreate(parent) · onContext(path, x, y)
 *        onDropNote(noteId, folder) · onDropFolder(path, parent)
 */
export function FolderTree({ folders, rootCount, selected, open, onSelect, onToggle, onCreate, onContext, onDropNote, onDropFolder }) {
  const [over, setOver] = React.useState(null); // caminho sob o cursor durante o arrasto ('' = raiz)
  const tree = React.useMemo(() => buildTree(folders), [folders]);

  const accepts = (e) => hasType(e, NOTE_DRAG) || hasType(e, FOLDER_DRAG);
  const dropProps = (path) => ({
    onDragOver: (e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== path) setOver(path); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget) && over === path) setOver(null); },
    onDrop: (e) => {
      e.preventDefault(); setOver(null);
      const note = e.dataTransfer.getData(NOTE_DRAG), folder = e.dataTransfer.getData(FOLDER_DRAG);
      if (note) onDropNote(note, path);
      else if (folder && folder !== path && parentOf(folder) !== path && !isDescendant(path, folder)) onDropFolder(folder, path);
    },
  });

  const renderNode = (node, depth) => {
    const isOpen = !!open[node.path];
    const hasKids = node.children.length > 0;
    return (
      <div key={node.path} role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={selected === node.path}>
        <div
          className={'nts-folder' + (selected === node.path ? ' is-on' : '') + (over === node.path ? ' is-drop' : '')}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, node.path); e.dataTransfer.effectAllowed = 'move'; }}
          onClick={() => onSelect(selected === node.path ? null : node.path)}
          onContextMenu={(e) => { e.preventDefault(); onContext(node.path, e.clientX, e.clientY); }}
          {...dropProps(node.path)}
        >
          <button type="button" className={'nts-folder__chev' + (hasKids ? '' : ' is-empty')} tabIndex={-1} aria-label={isOpen ? 'Recolher' : 'Expandir'}
            onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.path); }}>
            <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
          <Icon name={isOpen && hasKids ? 'folder-open' : 'folder'} size={14} className="nts-folder__icon" />
          <span className="nts-folder__name" title={node.path}>{node.name}</span>
          <span className="nts-folder__count" title="Notas nesta pasta e nas subpastas">{node.total || ''}</span>
        </div>
        {hasKids && isOpen && <div role="group">{node.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="nts-folders" aria-label="Pastas">
      <div className="nts-folders__head">
        <span>Pastas</span>
        <IconButton size="sm" icon="folder-plus" label="Nova pasta" onClick={() => onCreate('')} />
      </div>
      {folders.length > 0 && (
        <div className="nts-folders__tree tk-scroll" role="tree">
          <div
            className={'nts-folder' + (selected === '' ? ' is-on' : '') + (over === '' ? ' is-drop' : '')}
            style={{ paddingLeft: 6 }}
            onClick={() => onSelect(selected === '' ? null : '')}
            {...dropProps('')}
          >
            <span className="nts-folder__chev is-empty" />
            <Icon name="inbox" size={14} className="nts-folder__icon" />
            <span className="nts-folder__name">Sem pasta</span>
            <span className="nts-folder__count">{rootCount || ''}</span>
          </div>
          {tree.map((n) => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
