import { DS } from '../../lib/ds.js';
import { highlight } from '../../notes/markdown.js';
import { extOf, formatSize, visualKind, KIND_ICON } from '../../notes/attachments.js';
import { notesApi, cleanError } from '../../notes/client.js';

const { Modal, Button, Icon, Spinner } = DS;

/**
 * Pré-visualização de um anexo da nota (arquivo de .assets\). Imagem, PDF, áudio e vídeo vêm direto do
 * protocolo devkit-note://; texto/código vem lido pelo processo principal (readAsset, truncado se grande).
 * Executáveis e tipos desconhecidos só mostram nome e tamanho. "Abrir" usa o programa padrão do sistema
 * (executáveis pedem confirmação no processo principal).
 */
export function AttachmentModal({ asset, label, onClose }) {
  const [info, setInfo] = React.useState(null); // { name, size, kind, text?, truncated? }
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    setInfo(null); setError('');
    notesApi().readAsset(asset).then((r) => { if (alive) setInfo(r); }, (e) => { if (alive) setError(cleanError(e)); });
    return () => { alive = false; };
  }, [asset]);

  const url = `devkit-note://asset/${encodeURIComponent(asset)}`;
  const shown = label || (info && info.name) || asset;
  const kind = info ? info.kind : 'other';
  const icon = KIND_ICON[visualKind(asset)];

  let body;
  if (error) body = <div className="nts-attach__card"><Icon name="triangle-alert" size={28} /><strong>Não foi possível abrir</strong><span>{error}</span></div>;
  else if (!info) body = <div className="nts-attach__card"><Spinner size={16} /></div>;
  else if (kind === 'image') body = <div className="nts-attach__stage"><img src={url} alt={shown} className="nts-attach__img" /></div>;
  else if (kind === 'pdf') body = <iframe className="nts-attach__frame" src={url} title={shown} />;
  else if (kind === 'video') body = <div className="nts-attach__stage"><video className="nts-attach__media" src={url} controls preload="metadata" /></div>;
  else if (kind === 'audio') body = <div className="nts-attach__stage"><audio className="nts-attach__audio" src={url} controls preload="metadata" /></div>;
  else if (kind === 'text') {
    body = (<>
      {/* highlight() escapa o texto e só adiciona spans tk-syn-* */}
      <pre className="nts-attach__text tk-scroll" dangerouslySetInnerHTML={{ __html: highlight(info.text || ' ', extOf(info.name)) }} />
      {info.truncated && <div className="nts-attach__note">Mostrando só o começo do arquivo (o arquivo todo tem {formatSize(info.size)}). Use Abrir para ver tudo.</div>}
    </>);
  } else {
    body = (
      <div className="nts-attach__card">
        <Icon name={icon} size={32} />
        <strong>{shown}</strong>
        <span>{formatSize(info.size)}</span>
        <span>{kind === 'exec' ? 'Arquivo executável: não é pré-visualizado. Abrir pede confirmação.' : 'Sem pré-visualização para este tipo de arquivo.'}</span>
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} icon={icon} title={shown} width={1040}
      description={info ? `${formatSize(info.size)} · ${info.name}` : undefined}
      footer={<>
        <Button variant="ghost" icon="folder-open" disabled={!info} onClick={() => notesApi().revealAsset(asset)}>Mostrar na pasta</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button variant="primary" icon="external-link" disabled={!info} onClick={() => notesApi().openAsset(asset)}>Abrir</Button>
      </>}>
      <div className="nts-attach">{body}</div>
    </Modal>
  );
}
