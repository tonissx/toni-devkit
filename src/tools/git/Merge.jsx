// Git — mesclar uma branch na atual, com prévia: o que entra, se dá para só avançar e quais arquivos vão conflitar
// (git merge-tree, sem tocar em nada). Só depois de ver a prévia o usuário escolhe mesclar.
import { DS } from '../../lib/ds.js';
import { gitApi, errText, short, ago, FilePath, preview, RiskBadge } from './shared.jsx';

const { Icon, Spinner, Modal, Button, SegmentedControl } = DS;

const MODES = [
  { value: 'auto', label: 'Automático' },
  { value: 'noff', label: 'Sempre criar commit de merge' },
];

export function MergeModal({ repo, branch, current, run, onClose, onDone }) {
  const [pv, setPv] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [mode, setMode] = React.useState('auto');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { gitApi().mergePreview(repo, branch).then(setPv, (e) => setError(errText(e))); }, [repo, branch]);
  const op = { op: 'merge', branch, mode };
  const p = preview(op);
  const go = async () => {
    setBusy(true);
    const ok = await run(op, { confirmed: true });
    setBusy(false);
    if (ok) { onClose(); onDone && onDone(); }
  };
  const blocked = pv && (pv.upToDate || pv.operation);
  return (
    <Modal title={`Mesclar ${branch} em ${current}`} icon="git-merge" onClose={onClose} width={620}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{pv && pv.upToDate ? 'Fechar' : 'Cancelar'}</Button>
        {!blocked && <Button variant="primary" loading={busy} disabled={!pv} onClick={go}>{pv && pv.conflicts.length ? 'Mesclar e resolver os conflitos' : 'Mesclar'}</Button>}
      </>}>
      {error && <div className="gt-msg is-error">{error}</div>}
      {!pv && !error && <div className="gt-msg"><Spinner size={14} /> Simulando o merge…</div>}
      {pv && (
        <div className="gt-merge">
          {pv.operation && <div className="gt-verdict is-bad"><Icon name="triangle-alert" size={18} /><span>Já há um <b>{pv.operation}</b> em andamento. Termine ou cancele antes de mesclar.</span></div>}
          {!pv.operation && pv.upToDate && <div className="gt-verdict is-ok"><Icon name="circle-check" size={18} /><span><b>Nada a fazer:</b> tudo o que {branch} tem já está em {current}.</span></div>}
          {!pv.operation && pv.ff && <div className="gt-verdict is-ok"><Icon name="fast-forward" size={18} /><span><b>Avanço direto (fast-forward):</b> {current} só precisa andar até {branch}. Sem conflito, sem commit de merge.</span></div>}
          {!pv.operation && !pv.upToDate && !pv.ff && !pv.conflicts.length && <div className="gt-verdict is-ok"><Icon name="circle-check" size={18} /><span><b>Sem conflitos.</b> O git junta sozinho e cria um commit de merge.</span></div>}
          {!pv.operation && pv.conflicts.length > 0 && (
            <div className="gt-verdict is-warn">
              <Icon name="triangle-alert" size={18} />
              <span><b>{pv.conflicts.length} arquivo{pv.conflicts.length === 1 ? '' : 's'} vai{pv.conflicts.length === 1 ? '' : 'o'} conflitar</b> — os dois lados mudaram as mesmas linhas. Ao mesclar, o git para e você escolhe, bloco a bloco, o que fica (editor em Mudanças). Dá para cancelar no meio.</span>
            </div>
          )}
          {pv.conflicts.length > 0 && <div className="gt-merge__conf">{pv.conflicts.map((f) => <div key={f} className="gt-file"><span className="gt-kind is-conf">!</span><FilePath path={f} /></div>)}</div>}
          {!pv.upToDate && (
            <>
              <div className="gt-files__head"><span className="gt-files__title">Commits que entram</span><span className="gt-files__n">{pv.commits.length}</span></div>
              <div className="gt-merge__list tk-scroll">
                {pv.commits.slice(0, 30).map((c) => <div key={c.hash} className="gt-mini"><code>{short(c.hash)}</code> {c.subject} <span className="gt-mini__meta">{c.author} · {ago(c.time)}</span></div>)}
              </div>
              <div className="gt-files__head"><span className="gt-files__title">Arquivos alterados</span><span className="gt-files__n">{pv.files.length}</span></div>
              {pv.dirty > 0 && <div className="gt-hint"><Icon name="info" size={12} /> Você tem {pv.dirty} mudança(s) não commitada(s). Se elas mexerem nos mesmos arquivos, o git recusa o merge — guarde-as num stash antes.</div>}
              {!pv.ff && <div className="gt-merge__mode"><span className="gt-hint">Como mesclar:</span><SegmentedControl size="sm" options={MODES} value={mode} onChange={setMode} /></div>}
              <div className="gt-confirm__cmd"><span>Comando equivalente <RiskBadge risk={p.risk} /></span><code>{p.display}</code></div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
