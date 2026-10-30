// Entrada da janela destacada (renderer/popout.html → dist/popout.js). Mostra o detalhe de uma entrada do Log ou de um commit
// do Git, conforme o `kind` do estado; a tela de origem continua dona do estado: aqui só se exibe o que ela manda (popout:state) e se devolvem as ações (popout:action).
import { resolveTheme } from './lib/themes.js';
import { Detail } from './tools/logs/Detail.jsx';
import { toRegexes } from './tools/logs/shared.jsx';
import { useExplainEntry } from './tools/logs/explain.jsx';
import { CommitDetail } from './tools/git/History.jsx';

const applyTheme = (pref) => { document.documentElement.dataset.theme = resolveTheme(pref || 'dark'); };
try { applyTheme((JSON.parse(localStorage.getItem('tk.prefs')) || {}).theme); } catch { applyTheme('dark'); }
window.devkit.theme.onChanged(applyTheme);

// Commit do Git: o CommitDetail busca os dados por { repo, hash }; operações (criar branch, reset…) rodam na janela principal,
// que é onde ficam a confirmação e o registro do resultado.
function GitCommit({ state }) {
  const act = (type, payload) => window.devkit.popout.action({ type, ...payload });
  const run = (op) => { act('run', { op }); return Promise.resolve(true); };
  return (
    <div className="po-root po-git tk-scroll">
      <CommitDetail repo={state.repo} hash={state.hash} run={run} onPick={(hash) => act('pick', { hash })} onDock={() => window.devkit.popout.close()} />
    </div>
  );
}

function Popout() {
  const [state, setState] = React.useState(null); // { kind: 'logs-detail', id, i, highlight, http, pinned, inCase } | { kind: 'git-commit', repo, hash }
  const [toastMsg, setToastMsg] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.devkit.popout.self().then((s) => { if (alive && s) setState((cur) => cur || s); });
    const off = window.devkit.popout.onState(setState);
    return () => { alive = false; off(); };
  }, []);
  const timer = React.useRef(null);
  const toast = (title, text, kind) => {
    setToastMsg({ title, text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3500);
  };
  const explainer = useExplainEntry(state && state.id, state && state.formatLabel, state && state.i);
  const res = React.useMemo(() => toRegexes(state && state.highlight), [state && state.highlight]);
  const act = (type, payload) => window.devkit.popout.action({ type, ...payload });
  const dock = () => window.devkit.popout.close();

  if (state && state.kind === 'git-commit') return state.hash ? <GitCommit state={state} /> : <div className="po-root"><div className="po-empty">Escolha um commit na janela principal.</div></div>;
  if (!state || state.i == null) {
    return <div className="po-root"><div className="po-empty">Selecione uma linha do log na janela principal para ver o detalhe aqui.</div></div>;
  }
  return (
    <div className="po-root">
      <Detail id={state.id} i={state.i} res={res} http={state.http} toast={toast} onClose={dock} onDock={dock}
        pinned={state.pinned} onPin={() => act('pin', { i: state.i })}
        inCase={state.inCase} onCase={() => act('case', { i: state.i })}
        onFollow={(term) => act('follow', { term })}
        onAddFilter={(term, replace) => act('addFilter', { term, replace: !!replace })}
        onJump={(i) => act('jump', { i })}
        ai={explainer.ai} aiSlot={explainer.aiSlot} dbServers={state.dbServers} />
      {toastMsg && <div className={'po-toast' + (toastMsg.kind === 'error' ? ' is-error' : '')} role="status"><b>{toastMsg.title}</b>{toastMsg.text}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Popout />);
