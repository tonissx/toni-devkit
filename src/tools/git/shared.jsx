// Git — peças compartilhadas pelos painéis: dados que se atualizam sozinhos, tempo relativo, caminho em duas partes,
// cores das raias e o botão de ação que mostra o comando git equivalente.
import { DS } from '../../lib/ds.js';
import { buildOp, RISK_LABEL } from '../../git/ops.js';

const { Icon, Badge } = DS;

export const gitApi = () => window.devkit.git;

/** Mensagem limpa de um erro de IPC. */
export const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * Carrega dados do repositório e recarrega quando ele muda (git:changed do serviço, com o watcher) ou quando deps mudam.
 * → { data, error, loading, reload }
 */
export function useRepoData(repo, load, deps = []) {
  const [st, setSt] = React.useState({ data: null, error: null, loading: true });
  const seq = React.useRef(0);
  const reload = React.useCallback(() => {
    if (!repo) return;
    const id = ++seq.current;
    setSt((s) => ({ ...s, loading: true }));
    Promise.resolve().then(() => load(repo)).then(
      (data) => { if (id === seq.current) setSt({ data, error: null, loading: false }); },
      (e) => { if (id === seq.current) setSt((s) => ({ data: s.data, error: errText(e), loading: false })); },
    );
  }, [repo, ...deps]);
  React.useEffect(() => { reload(); }, [reload]);
  React.useEffect(() => {
    let t = null;
    const off = gitApi().onChanged((evt) => {
      if (evt && evt.type === 'changed' && evt.repo === repo) { clearTimeout(t); t = setTimeout(reload, 120); }
    });
    return () => { off(); clearTimeout(t); };
  }, [reload, repo]);
  return { ...st, reload };
}

/** "agora" · "há 5 min" · "há 3 h" · "ontem" · "há 4 dias" · "12/03/2025". */
export function ago(sec) {
  if (!sec) return '';
  const d = Date.now() / 1000 - sec;
  if (d < 60) return 'agora';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  if (d < 172800) return 'ontem';
  if (d < 30 * 86400) return `há ${Math.floor(d / 86400)} dias`;
  return new Date(sec * 1000).toLocaleDateString('pt-BR');
}
export const fullDate = (sec) => (sec ? new Date(sec * 1000).toLocaleString('pt-BR') : '');
export const short = (hash) => String(hash || '').slice(0, 7);

/** Caminho com a pasta apagada e o nome em destaque. */
export function FilePath({ path }) {
  const p = String(path || '');
  const i = p.lastIndexOf('/');
  return (
    <span className="gt-path" title={p}>
      {i >= 0 && <span className="gt-path__dir">{p.slice(0, i + 1)}</span>}
      <span className="gt-path__name">{p.slice(i + 1)}</span>
    </span>
  );
}

/** Letra e cor de cada tipo de mudança. */
export const KIND = {
  modified: { l: 'M', label: 'Modificado', tone: 'mod' },
  added: { l: 'A', label: 'Adicionado', tone: 'add' },
  deleted: { l: 'D', label: 'Excluído', tone: 'del' },
  renamed: { l: 'R', label: 'Renomeado', tone: 'ren' },
  copied: { l: 'C', label: 'Copiado', tone: 'ren' },
  untracked: { l: 'U', label: 'Novo (fora do git)', tone: 'new' },
  nested: { l: 'G', label: 'Pasta com outro repositório git dentro', tone: 'ren' },
  conflict: { l: '!', label: 'Em conflito', tone: 'conf' },
};
export const KindBadge = ({ kind }) => { const k = KIND[kind] || KIND.modified; return <span className={'gt-kind is-' + k.tone} title={k.label}>{k.l}</span>; };

/** Cores das raias do grafo e das branches: a paleta do tema. */
export const LANE_COLORS = ['var(--tk-accent)', 'var(--tk-syn-keyword)', 'var(--tk-syn-string)', 'var(--tk-syn-number)', 'var(--tk-syn-bool)', 'var(--tk-syn-key)', 'var(--tk-red)', 'var(--tk-cyan)'];
export const laneColor = (i) => LANE_COLORS[i % LANE_COLORS.length];

/** Badges de refs (HEAD, branch, tag, remota). */
export function RefBadges({ refs }) {
  if (!refs || !refs.length) return null;
  return (
    <span className="gt-refs">
      {refs.filter((r) => r.type !== 'head').map((r) => (
        <span key={r.type + r.name} className={'gt-ref is-' + r.type + (r.current ? ' is-current' : '')} title={r.type === 'tag' ? 'Tag' : r.type === 'remote' ? 'Branch remota (como estava no último fetch)' : r.current ? 'Branch atual (HEAD)' : 'Branch'}>
          {r.type === 'tag' ? <Icon name="tag" size={10} /> : r.current ? <Icon name="circle-dot" size={10} /> : <Icon name="git-branch" size={10} />}
          {r.name}
        </span>
      ))}
    </span>
  );
}

/** Prévia de uma operação (comando, risco, explicação) sem executar — a mesma regra que o serviço usa. */
export function preview(op, ctx) { try { return buildOp(op, ctx); } catch (e) { return { error: errText(e) }; } }

export const RiskBadge = ({ risk }) => (risk ? <Badge size="sm" variant={risk === 'safe' ? 'ok' : risk === 'rewrite' ? 'warn' : 'error'}>{RISK_LABEL[risk]}</Badge> : null);

/**
 * Botão de uma operação git: o título mostra o comando equivalente. run(op) vem do GitScreen (confirma, executa,
 * mostra o resultado e o Desfazer).
 */
export function OpButton({ op, run, icon, children, variant = 'ghost', size = 'sm', className = '', disabled, ctx }) {
  const p = preview(op, ctx);
  return (
    <button type="button" className={'gt-op is-' + variant + ' is-' + size + (p.risk ? ' risk-' + p.risk : '') + ' ' + className}
      disabled={disabled || !!p.error} title={p.error || `${p.title}\n${p.display}`} onClick={(e) => { e.stopPropagation(); run(op); }}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 14} />}
      {children && <span>{children}</span>}
    </button>
  );
}
