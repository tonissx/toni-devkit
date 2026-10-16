import { DS } from '../../lib/ds.js';
import { notesApi, cleanError } from '../../notes/client.js';
import { FOLDER_COLORS, FOLDER_ICONS, SORTS, SORT_LABELS, cleanTag } from '../../notes/foldermeta.js';
import { baseName } from '../../notes/folders.js';

const { Modal, Input, Button, Icon, Select, Toggle } = DS;

/**
 * "Configurações da pasta": cor e ícone (também colorem a pasta no Grafo), template padrão e tags padrão
 * (toda nota nova nasce com eles), ordem das notas e fixar no topo. Guardado em `.folder.json` na própria pasta.
 */
export function FolderSettingsModal({ path, meta = {}, onSaved, onClose }) {
  const [color, setColor] = React.useState(meta.color || '');
  const [icon, setIcon] = React.useState(meta.icon || 'folder');
  const [filled, setFilled] = React.useState(!meta.outline);
  const [template, setTemplate] = React.useState(meta.template || '');
  const [tags, setTags] = React.useState((meta.tags || []).join(', '));
  const [sort, setSort] = React.useState(meta.sort || 'updated');
  const [pinned, setPinned] = React.useState(!!meta.pinned);
  const [templates, setTemplates] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    notesApi().templates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const parsedTags = tags.split(/[,\s]+/).map(cleanTag).filter(Boolean);
  // O template escolhido pode ter sido apagado: mostra mesmo assim até o usuário trocar.
  const tplOptions = [{ value: '', label: 'Nenhum (nota em branco)', icon: 'file' },
    ...((templates || []).map((t) => ({ value: t.id, label: t.title, icon: 'layout-template' }))),
    ...(template && templates && !templates.some((t) => t.id === template) ? [{ value: template, label: '(template removido)', icon: 'triangle-alert' }] : [])];

  const save = async () => {
    setBusy(true);
    try {
      const saved = await notesApi().setFolderMeta(path, {
        color: color || null, icon: icon === 'folder' ? null : icon, outline: filled ? null : true, template: template || null,
        tags: parsedTags, sort: sort === 'updated' ? null : sort, pinned: pinned || null,
      });
      if (onSaved) onSaved(saved);
      onClose();
    } catch (e) { setError(cleanError(e)); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon="settings-2" title={`Configurações de “${baseName(path)}”`} description={path} width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Salvar</Button>
      </>}>
      <div className="nts-fset">
        <div className="nts-fset__row">
          <span className="nts-fset__label">Cor</span>
          <div className="nts-fset__swatches" role="radiogroup" aria-label="Cor da pasta">
            <button type="button" role="radio" aria-checked={!color} className={'nts-swatch is-none' + (!color ? ' is-on' : '')} title="Sem cor" onClick={() => setColor('')}><Icon name="slash" size={11} /></button>
            {Object.entries(FOLDER_COLORS).map(([id, hex]) => (
              <button key={id} type="button" role="radio" aria-checked={color === id} title={id} aria-label={id}
                className={'nts-swatch' + (color === id ? ' is-on' : '')} style={{ background: hex }} onClick={() => setColor(id)} />
            ))}
          </div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Ícone</span>
          <div className="nts-fset__icons" role="radiogroup" aria-label="Ícone da pasta">
            {FOLDER_ICONS.map((name) => (
              <button key={name} type="button" role="radio" aria-checked={icon === name} title={name} aria-label={name}
                className={'nts-iconpick' + (icon === name ? ' is-on' : '')} onClick={() => setIcon(name)}>
                <Icon name={name} size={15} style={color ? { color: FOLDER_COLORS[color] } : undefined}
                  {...(filled ? { fill: 'currentColor', fillOpacity: 0.3 } : {})} />
              </button>
            ))}
          </div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Estilo</span>
          <div className="nts-fset__field"><Toggle checked={filled} onChange={setFilled} label="Ícone preenchido" /></div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Template padrão</span>
          <div className="nts-fset__field">
            <Select size="sm" options={tplOptions} value={template} onChange={setTemplate} disabled={templates === null} />
            <small>Nova nota nesta pasta (Ctrl+N, “Nova nota aqui”) nasce desse template. Crie templates na pasta “Templates”.</small>
          </div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Tags padrão</span>
          <div className="nts-fset__field">
            <Input size="sm" value={tags} placeholder="ex.: fluig, rm" aria-label="Tags padrão" onChange={(e) => setTags(e.target.value)} />
            <small>{parsedTags.length ? parsedTags.map((t) => '#' + t).join(' ') + ' — entram em toda nota nova da pasta.' : 'Separe por vírgula. Entram em toda nota nova da pasta.'}</small>
          </div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Ordem das notas</span>
          <div className="nts-fset__field">
            <Select size="sm" options={SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))} value={sort} onChange={setSort} />
          </div>
        </div>
        <div className="nts-fset__row">
          <span className="nts-fset__label">Atalho</span>
          <div className="nts-fset__field"><Toggle checked={pinned} onChange={setPinned} label="Fixar esta pasta no topo do explorador" /></div>
        </div>
        {error && <div className="nts-dialog__error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
