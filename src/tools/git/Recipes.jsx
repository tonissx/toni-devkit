// Git — "Quero…": situações comuns em linguagem de gente (src/git/recipes.js), cada uma levando ao fluxo certo — uma
// aba, uma operação (com a confirmação de sempre) ou um assistente pequeno.
import { DS } from '../../lib/ds.js';
import { RECIPES } from '../../git/recipes.js';
import { validBranchName } from '../../git/ops.js';
import { normalize } from '../../commands/search.js';
import { gitApi, preview, RiskBadge } from './shared.jsx';

const { Icon, Modal, Button, Select, Spinner } = DS;

function Cmd({ op }) {
  const p = preview(op);
  if (p.error) return null;
  return <div className="gt-confirm__cmd"><span>Comando equivalente <RiskBadge risk={p.risk} /></span><code>{p.display}</code></div>;
}

/** "Commitei na branch errada": cria a branch com os últimos N commits e tira-os da atual. */
function MoveToBranchModal({ status, run, onClose }) {
  const [name, setName] = React.useState('');
  const [count, setCount] = React.useState(1);
  const op = { op: 'moveToNewBranch', name: name || 'nova-branch', count };
  const ok = validBranchName(name);
  return (
    <Modal title="Mover commits para uma branch nova" icon="git-branch-plus" onClose={onClose} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} onClick={async () => { if (await run({ ...op, name })) onClose(); }}>Mover</Button></>}>
      <div className="gt-wizard">
        <p>Os últimos commits de <b>{status.branch.head}</b> vão para a branch nova, e <b>{status.branch.head}</b> volta para antes deles. Mudanças não commitadas ficam onde estão.</p>
        <label>Nome da branch nova<input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))} placeholder="feature/minha-tarefa" /></label>
        {name && !ok && <span className="gt-err">Nome inválido</span>}
        <label>Quantos commits mover<Select size="sm" options={[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: `${n} (os ${n} mais recentes)` }))} value={String(count)} onChange={(v) => setCount(+v)} /></label>
        <Cmd op={op} />
      </div>
    </Modal>
  );
}

/** "Trazer um arquivo de outra branch". */
function FileFromBranchModal({ repo, run, onClose }) {
  const [branches, setBranches] = React.useState(null);
  const [branch, setBranch] = React.useState('');
  const [files, setFiles] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [file, setFile] = React.useState('');
  React.useEffect(() => { gitApi().branches(repo).then((b) => { setBranches(b.branches); const other = b.branches.find((x) => !x.current); setBranch(other ? other.name : ''); }); }, [repo]);
  React.useEffect(() => { setFiles(null); setFile(''); if (branch) gitApi().files(repo, branch).then(setFiles, () => setFiles([])); }, [branch]);
  const nq = normalize(q);
  const shown = files ? files.filter((f) => !nq || normalize(f).includes(nq)).slice(0, 200) : [];
  const op = { op: 'file.fromBranch', branch: branch || 'x', path: file || 'arquivo' };
  return (
    <Modal title="Trazer um arquivo de outra branch" icon="file-input" onClose={onClose} width={600}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!file || !branch} onClick={async () => { if (await run({ op: 'file.fromBranch', branch, path: file })) onClose(); }}>Trazer</Button></>}>
      <div className="gt-wizard">
        {!branches ? <div className="gt-msg"><Spinner size={14} /></div> : (
          <label>De qual branch<Select size="sm" options={branches.map((b) => ({ value: b.name, label: b.name + (b.current ? ' (atual)' : '') }))} value={branch} onChange={setBranch} /></label>
        )}
        <label>Arquivo<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="digite parte do caminho" /></label>
        <div className="gt-wizard__files tk-scroll">
          {files === null && branch ? <div className="gt-msg"><Spinner size={14} /></div> : shown.map((f) => (
            <button type="button" key={f} className={'gt-wizard__file' + (f === file ? ' is-sel' : '')} onClick={() => setFile(f)}>{f}</button>
          ))}
          {files && !shown.length && <div className="gt-msg">Nenhum arquivo com esse nome.</div>}
        </div>
        <Cmd op={op} />
      </div>
    </Modal>
  );
}

/** "Juntar meus últimos commits": quantos? Depois abre a reorganização já marcada. */
function SquashModal({ go, onClose }) {
  const [n, setN] = React.useState(2);
  return (
    <Modal title="Juntar os últimos commits" icon="combine" onClose={onClose} width={460}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => { onClose(); go('rebase', { squash: n }); }}>Continuar</Button></>}>
      <div className="gt-wizard">
        <p>Os commits escolhidos viram um só. A próxima tela mostra a prévia antes de aplicar.</p>
        <label>Quantos commits juntar<Select size="sm" options={[2, 3, 4, 5, 6, 8, 10].map((x) => ({ value: String(x), label: `Os últimos ${x}` }))} value={String(n)} onChange={(v) => setN(+v)} /></label>
      </div>
    </Modal>
  );
}

export function Recipes({ repo, status, run, go, openMerge, focus }) {
  const [q, setQ] = React.useState('');
  const [wizard, setWizard] = React.useState(null);
  const start = async (r) => {
    const a = r.action;
    if (a.tab) return go(a.tab);
    if (a.op) return run(a.op);
    if (a.wizard === 'amendMessage') return go('changes', { amend: true });
    if (a.wizard === 'updateFromBase') {
      try {
        const b = await gitApi().branches(repo);
        if (!b.base || b.base === status.branch.head) return go('branches');
        return openMerge(b.base);
      } catch { return null; }
    }
    return setWizard(a.wizard);
  };
  // Vindo da palette com uma receita escolhida: já começa.
  React.useEffect(() => { if (focus && focus.recipe) { const r = RECIPES.find((x) => x.id === focus.recipe); if (r) start(r); } }, [focus && focus.nonce]);
  const nq = normalize(q);
  const list = RECIPES.filter((r) => !nq || normalize([r.title, r.when, ...(r.keywords || [])].join(' ')).includes(nq));
  return (
    <div className="gt-recipes tk-scroll">
      <div className="gt-recipes__head">
        <h2><Icon name="sparkles" size={18} /> O que você quer fazer?</h2>
        <label className="gt-search is-wide"><Icon name="search" size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: desfazer commit, branch errada, juntar commits…" /></label>
      </div>
      <div className="gt-recipes__grid">
        {list.map((r) => (
          <button type="button" key={r.id} className="gt-recipe" onClick={() => start(r)} disabled={status.unborn && r.id !== 'stash' && r.id !== 'partial'}>
            <span className="gt-recipe__icon"><Icon name={r.icon} size={18} /></span>
            <span className="gt-recipe__title">{r.title}</span>
            <span className="gt-recipe__when">{r.when}</span>
            <span className="gt-recipe__how">{r.how}</span>
            <code className="gt-recipe__cmd">{r.cmd}</code>
          </button>
        ))}
        {!list.length && <div className="gt-msg">Nada com esse texto. Tente outras palavras.</div>}
      </div>
      {wizard === 'moveToBranch' && <MoveToBranchModal status={status} run={run} onClose={() => setWizard(null)} />}
      {wizard === 'fileFromBranch' && <FileFromBranchModal repo={repo} run={run} onClose={() => setWizard(null)} />}
      {wizard === 'squashLast' && <SquashModal go={go} onClose={() => setWizard(null)} />}
    </div>
  );
}
