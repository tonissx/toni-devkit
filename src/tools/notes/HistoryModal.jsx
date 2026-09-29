import { DS } from '../../lib/ds.js';
import { notesApi, shortTime, cleanError } from '../../notes/client.js';
import { diffLines } from '../diff-checker/engine.js';
import { DiffView } from '../diff-checker/DiffView.jsx';

const { Modal, Button, Icon, Spinner, EmptyState } = DS;

const noop = () => {};

/**
 * Versões anteriores da nota: lista à esquerda, diff (versão → atual) à direita, com o mesmo
 * motor do Diff Checker. "Restaurar" volta título e conteúdo — e o estado atual vira uma versão,
 * então dá para voltar atrás.
 */
export function HistoryModal({ note, flush, onClose, toast }) {
  const [list, setList] = React.useState(null); // null = carregando
  const [sel, setSel] = React.useState(null);   // stamp
  const [version, setVersion] = React.useState(null); // { stamp, title, rawTitle, content }
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      await flush(); // o que está no editor entra como "atual"
      const h = await notesApi().history(note.id).catch(() => []);
      if (!alive) return;
      setList(h);
      if (h.length) setSel(h[0].stamp);
    })();
    return () => { alive = false; };
  }, [note.id]);

  React.useEffect(() => {
    if (!sel) { setVersion(null); return; }
    let alive = true;
    notesApi().version(note.id, sel).then((v) => { if (alive) setVersion(v); }).catch(() => alive && setVersion(null));
    return () => { alive = false; };
  }, [sel, note.id]);

  const result = React.useMemo(() => (version ? diffLines(version.content || '', note.content || '') : null), [version, note.content]);
  const st = result ? result.stats : null;

  const restore = async () => {
    if (!version) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      await notesApi().restoreVersion(note.id, version.stamp);
      toast('Versão restaurada', `de ${shortTime(list.find((v) => v.stamp === version.stamp).at)} — o estado anterior ficou no histórico`);
      onClose();
    } catch (e) { toast('Não foi possível restaurar', cleanError(e), 'error'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!version) return;
    await window.devkit.clipboard.write(version.content || '');
    toast('Copiado', 'Conteúdo da versão na área de transferência');
  };

  const titleChanged = version && (version.rawTitle || '') !== (note.title || '');

  return (
    <Modal open onClose={onClose} icon="history" title="Versões anteriores" width={1040}
      description="O Devkit guarda a versão anterior quando você edita (no máximo uma a cada 10 min por nota; as 50 mais recentes)."
      footer={<>
        <Button variant="ghost" icon="copy" disabled={!version} onClick={copy}>Copiar esta versão</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button variant="primary" icon="rotate-ccw" disabled={!version || busy} onClick={restore}>Restaurar esta versão</Button>
      </>}>
      <div className="nts-history">
        {list === null ? (
          <div className="nts-list__msg"><Spinner size={14} /> Carregando…</div>
        ) : !list.length ? (
          <EmptyState title="Nenhuma versão anterior ainda" animate="none"
            description="Assim que você editar esta nota, a versão de antes aparece aqui." />
        ) : (
          <>
            <div className="nts-history__list tk-scroll" role="listbox" aria-label="Versões">
              {list.map((v) => (
                <button key={v.stamp} type="button" role="option" aria-selected={v.stamp === sel}
                  className={'nts-history__item' + (v.stamp === sel ? ' is-sel' : '')} onClick={() => setSel(v.stamp)}>
                  <span className="nts-history__when">{shortTime(v.at)}</span>
                  <span className="nts-history__title">{v.title}</span>
                  <span className="nts-history__chars">{v.chars} caracteres</span>
                </button>
              ))}
            </div>
            <div className="nts-history__diff">
              {!version || !result ? (
                <div className="nts-list__msg"><Spinner size={14} /> Carregando versão…</div>
              ) : (
                <>
                  <div className="nts-history__bar">
                    <span><Icon name="git-compare" size={13} /> Esta versão → atual</span>
                    {st && <span className="nts-history__stats"><b className="is-add">+{st.added}</b> <b className="is-del">−{st.removed}</b></span>}
                    {titleChanged && <span className="nts-history__retitle" title="Restaurar volta também o título">título: “{version.title}”</span>}
                  </div>
                  {st && !st.added && !st.removed
                    ? <div className="nts-list__msg">Conteúdo igual ao atual{titleChanged ? ' (só o título muda)' : ''}.</div>
                    : <DiffView result={result} view="unified" granularity="smart" collapse compare={{}} lang="text" current={-1} onMerge={noop} onPick={noop} />}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
