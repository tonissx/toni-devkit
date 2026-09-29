import { DS } from '../../lib/ds.js';
import { validFolderName, buildTree, flattenTree } from '../../notes/folders.js';
import { cleanError } from '../../notes/client.js';

const { Modal, Input, Button, Icon } = DS;

/** Criar / renomear pasta: valida o nome enquanto digita; erros do serviço (ex.: já existe) aparecem no próprio modal. */
export function NameModal({ title, description, initial = '', confirmLabel = 'Criar', onSubmit, onClose }) {
  const [name, setName] = React.useState(initial);
  const [serverError, setServerError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const error = serverError || (name.length ? validFolderName(name) : null);

  const submit = async () => {
    if (busy) return;
    if (validFolderName(name)) { setServerError(validFolderName(name)); return; }
    if (initial && name === initial) { onClose(); return; } // renomear para o mesmo nome: nada a fazer
    setBusy(true);
    try { await onSubmit(name); onClose(); } catch (e) { setServerError(cleanError(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon="folder" title={title} description={description} width={420}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>{confirmLabel}</Button>
      </>}>
      <Input
        autoFocus
        value={name}
        invalid={!!error}
        placeholder="Nome da pasta"
        aria-label="Nome da pasta"
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setName(e.target.value); setServerError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {error && <div className="nts-dialog__error" role="alert">{error}</div>}
    </Modal>
  );
}

/** Confirmação de exclusão de pasta (as notas vão para .trash e dá para desfazer logo depois). */
export function DeleteFolderModal({ name, notes, subfolders, onConfirm, onClose }) {
  const parts = [];
  if (notes) parts.push(notes + (notes === 1 ? ' nota' : ' notas'));
  if (subfolders) parts.push(subfolders + (subfolders === 1 ? ' subpasta' : ' subpastas'));
  return (
    <Modal open onClose={onClose} icon="trash-2" title={`Excluir a pasta “${name}”?`}
      description={parts.length ? `Contém ${parts.join(' e ')}. As notas vão para a pasta .trash e você pode desfazer logo em seguida.` : 'A pasta está vazia.'}
      width={440}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="trash-2" onClick={() => { onConfirm(); onClose(); }}>Excluir</Button>
      </>} />
  );
}

/** "Mover para…": lista de pastas (árvore achatada) + "Sem pasta". */
export function MoveNoteModal({ folders, current, onPick, onClose }) {
  const flat = React.useMemo(() => flattenTree(buildTree(folders)), [folders]);
  const item = (path, label, depth, icon) => (
    <button key={path} type="button" className={'nts-move__item' + (path === current ? ' is-on' : '')} style={{ paddingLeft: 10 + depth * 16 }}
      onClick={() => { onPick(path); onClose(); }}>
      <Icon name={icon} size={14} /> <span>{label}</span>{path === current && <Icon name="check" size={13} className="nts-move__check" />}
    </button>
  );
  return (
    <Modal open onClose={onClose} icon="folder-input" title="Mover para…" width={420}>
      <div className="nts-move tk-scroll" role="listbox" aria-label="Pastas">
        {item('', 'Sem pasta', 0, 'inbox')}
        {flat.map((f) => item(f.path, f.name, f.depth, 'folder'))}
        {flat.length === 0 && <div className="nts-list__msg">Nenhuma pasta ainda — crie uma em “Pastas”.</div>}
      </div>
    </Modal>
  );
}
