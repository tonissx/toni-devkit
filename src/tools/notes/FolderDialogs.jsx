import { DS } from '../../lib/ds.js';
import { validFolderName, buildTree, flattenTree, isDescendant, baseName } from '../../notes/folders.js';
import { cleanError } from '../../notes/client.js';
import { normalize } from '../../commands/search.js';

const { Modal, Input, Button, Icon } = DS;

/**
 * Criar / renomear pasta: valida o nome enquanto digita; erros do serviço (ex.: já existe) aparecem no próprio modal.
 * `clashOf(name)` (opcional) devolve o caminho de uma pasta que já existe com esse nome: em vez de recusar,
 * o modal oferece mesclar as duas — o botão vira "Mesclar" e `onSubmit(name, { merge: true })` faz a junção.
 */
export function NameModal({ title, description, initial = '', confirmLabel = 'Criar', onSubmit, clashOf, onClose }) {
  const [name, setName] = React.useState(initial);
  const [serverError, setServerError] = React.useState(null);
  const [clash, setClash] = React.useState(null);   // pasta existente que seria mesclada
  const [busy, setBusy] = React.useState(false);
  const error = serverError || (name.length ? validFolderName(name) : null);

  const submit = async () => {
    if (busy) return;
    if (validFolderName(name)) { setServerError(validFolderName(name)); return; }
    if (initial && name === initial) { onClose(); return; } // renomear para o mesmo nome: nada a fazer
    setBusy(true);
    try {
      if (clashOf && !clash) {
        const other = await clashOf(name);
        if (other) { setClash(other); setBusy(false); return; } // pede confirmação antes de juntar
      }
      await onSubmit(name, { merge: !!clash });
      onClose();
    } catch (e) { setServerError(cleanError(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon="folder" title={title} description={description} width={420}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon={clash ? 'merge' : undefined} onClick={submit} disabled={busy || !name.trim()}>{clash ? 'Mesclar' : confirmLabel}</Button>
      </>}>
      <Input
        autoFocus
        value={name}
        invalid={!!error}
        placeholder="Nome da pasta"
        aria-label="Nome da pasta"
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setName(e.target.value); setServerError(null); setClash(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {error && <div className="nts-dialog__error" role="alert">{error}</div>}
      {clash && !error && (
        <div className="nts-dialog__warn" role="alert">
          <Icon name="triangle-alert" size={13} /> Já existe a pasta “{clash}”. Mesclar junta as notas e subpastas das duas
          (nome de nota repetido ganha “(2)”).
        </div>
      )}
    </Modal>
  );
}

/** Confirmação genérica (ex.: mesclar pastas ao arrastar uma sobre outra de mesmo nome). */
export function ConfirmModal({ title, description, confirmLabel = 'Confirmar', icon = 'circle-help', onConfirm, onClose }) {
  return (
    <Modal open onClose={onClose} icon={icon} title={title} description={description} width={440}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" autoFocus onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </>} />
  );
}

/** Confirmação de exclusão de pasta (as notas vão para .trash e dá para desfazer logo depois). */
export function DeleteFolderModal({ name, notes, subfolders, onConfirm, onClose }) {
  const parts = [];
  if (notes) parts.push(notes + (notes === 1 ? ' nota' : ' notas'));
  if (subfolders) parts.push(subfolders + (subfolders === 1 ? ' subpasta' : ' subpastas'));
  return (
    <Modal open onClose={onClose} icon="trash-2" title={`Excluir a pasta “${name}”?`}
      description={parts.length ? `Contém ${parts.join(' e ')}. As notas vão para a Lixeira (dá para restaurar a pasta inteira de lá) e você pode desfazer logo em seguida.` : 'A pasta está vazia.'}
      width={440}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="trash-2" autoFocus onClick={() => { onConfirm(); onClose(); }}>Excluir</Button>
      </>} />
  );
}

/**
 * Escolher uma pasta (mover nota ou pasta): árvore achatada + raiz, com busca por nome. `exclude` esconde uma
 * pasta e tudo dentro dela (não dá para mover uma pasta para dentro de si mesma).
 */
export function PickFolderModal({ title = 'Mover para…', rootLabel = 'Sem pasta', folders, current, exclude, onPick, onClose }) {
  const [q, setQ] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const flat = React.useMemo(() => flattenTree(buildTree(folders)).filter((f) => !exclude || (f.path !== exclude && !isDescendant(f.path, exclude))), [folders, exclude]);
  const words = normalize(q).split(/\s+/).filter(Boolean);
  const hits = words.length ? flat.filter((f) => words.every((w) => normalize(f.path).includes(w))) : flat;
  const rows = [...(!words.length || words.every((w) => normalize(rootLabel).includes(w)) ? [{ path: '', name: rootLabel, depth: 0, root: true }] : []), ...hits.map((f) => ({ ...f, depth: words.length ? 0 : f.depth }))];
  React.useEffect(() => { setHi(0); }, [q]);
  const pick = (path) => { onPick(path); onClose(); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && rows[hi]) { e.preventDefault(); pick(rows[hi].path); }
  };
  return (
    <Modal open onClose={onClose} icon="folder-input" title={title} width={420}>
      {flat.length > 6 && (
        <Input autoFocus size="sm" value={q} placeholder="Buscar pasta…" aria-label="Buscar pasta" onChange={(e) => setQ(e.target.value)} onKeyDown={key} />
      )}
      <div className="nts-move tk-scroll" role="listbox" aria-label="Pastas" tabIndex={flat.length > 6 ? -1 : 0} onKeyDown={key} ref={(el) => { if (el && flat.length <= 6) el.focus(); }}>
        {rows.map((f, i) => (
          <button key={f.path || '/'} type="button" role="option" aria-selected={i === hi}
            className={'nts-move__item' + (f.path === current ? ' is-on' : '') + (i === hi ? ' is-hi' : '')}
            style={{ paddingLeft: 10 + f.depth * 16 }} title={f.path || undefined}
            onMouseEnter={() => setHi(i)} onClick={() => pick(f.path)}>
            <Icon name={f.root ? 'inbox' : 'folder'} size={14} />
            <span>{words.length && !f.root ? f.path : f.name}</span>
            {f.path === current && <Icon name="check" size={13} className="nts-move__check" />}
          </button>
        ))}
        {!rows.length && <div className="nts-list__msg">Nenhuma pasta para “{q}”.</div>}
        {flat.length === 0 && <div className="nts-list__msg">Nenhuma pasta ainda — crie uma em “Nova pasta”.</div>}
      </div>
    </Modal>
  );
}

/** "Mover para…" de uma nota: lista de pastas + "Sem pasta". */
export function MoveNoteModal({ folders, current, onPick, onClose }) {
  return <PickFolderModal title="Mover nota para…" folders={folders} current={current} onPick={onPick} onClose={onClose} />;
}

/** "Mover para…" de uma pasta: a raiz vira o destino "Raiz" e a própria pasta (e o que há nela) sai da lista. */
export function MoveFolderModal({ path, folders, onPick, onClose }) {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (
    <PickFolderModal title={`Mover “${baseName(path)}” para…`} rootLabel="Raiz (nenhuma pasta acima)" folders={folders} current={parent}
      exclude={path} onPick={onPick} onClose={onClose} />
  );
}
