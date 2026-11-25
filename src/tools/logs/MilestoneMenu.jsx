// Logs — menu de um marco (deploy, merge ou manual): ir até a linha, abrir no Git, filtrar a partir dali e, se for
// manual, editar/excluir. Reaproveitado pela Linha do tempo e pela aba Problemas (que passa itens extras).
// Os textos nunca afirmam causa: os commits de um deploy são uma estimativa.
import { DS } from '../../lib/ds.js';
import { fmtTime } from './shared.jsx';
import { kindGroup, shortLabel, isMergeCommit } from '../../logs/milestones.js';

const { Icon } = DS;

export const KIND_LABEL = { deploy: 'Deploy', undeploy: 'Undeploy', restart: 'Restart do servidor', merge: 'Merge na main', manual: 'Marco manual' };

/** Nome do tipo do marco. A main vem com --first-parent: commit direto (sem PR, sem "Merge ") é "Commit na main". */
export function kindLabel(m) {
  if (!m) return 'Marco';
  if (m.kind === 'merge' && !isMergeCommit(m)) return 'Commit na main';
  return KIND_LABEL[m.kind] || 'Marco';
}

/** Enquanto os commits do repositório ligado não chegaram (ou não deu para ler), não dá para dizer "nenhum commit". */
export function commitsPending(commitsState) {
  if (commitsState === 'loading') return 'carregando commits…';
  if (commitsState === 'error') return 'repositório indisponível';
  return null;
}

/** Ícone do marco (▲ deploy, ◆ merge, ✎ manual), na cor do tipo. */
export function MilestoneIcon({ kind }) {
  const g = kindGroup(kind);
  if (g === 'manual') return <Icon name="pencil" size={10} strokeWidth={2.25} className="lg-mico is-manual" />;
  return <i className={'lg-mico is-' + g} aria-hidden="true" />;
}

/** Abre o commit no Histórico do Git. */
export function openInGit(repo, hash) {
  if (!repo || !hash) return;
  window.devkit.app.command({ type: 'go', route: 'git', params: { repo, tab: 'history', hash } });
}

/** Fecha um popover com Esc ou clique fora. Cliques em `[data-mm-anchor]` (quem abre) não contam como "fora". */
export function useDismiss(ref, onClose, active = true) {
  const cb = React.useRef(onClose);
  cb.current = onClose;
  React.useEffect(() => {
    if (!active) return undefined;
    const down = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-mm-anchor]')) return;
      cb.current();
    };
    const key = (e) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [active]);
}

/** ↑/↓ andam entre os itens do menu; Esc fecha sem chegar a quem está atrás (lista, linha do tempo). */
function menuKeys(e, onClose) {
  e.stopPropagation(); // os atalhos da lista (n, m, i, setas…) não valem com o menu em foco
  if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.target.tagName === 'INPUT') return;
  const items = [...e.currentTarget.querySelectorAll('button:not(:disabled)')];
  if (!items.length) return;
  e.preventDefault();
  const k = items.indexOf(document.activeElement);
  const n = e.key === 'ArrowDown' ? (k + 1) % items.length : (k <= 0 ? items.length - 1 : k - 1);
  items[n].focus();
}

/** Campo de texto dentro de um menu (marcar deploy aqui, editar marco). Enter salva, Esc cancela. */
export function LabelInput({ initial = '', placeholder = 'Ex.: publiquei o formulário de férias', submitLabel = 'Salvar', onSubmit, onCancel }) {
  const [v, setV] = React.useState(initial);
  const ok = v.trim().length > 0;
  return (
    <div className="lg-mmenu__form">
      <input autoFocus value={v} maxLength={200} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label="Texto do marco"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ok) { e.preventDefault(); onSubmit(v.trim()); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }} />
      <button type="button" className="lg-btn is-accent" disabled={!ok} onClick={() => onSubmit(v.trim())}>{submitLabel}</button>
    </div>
  );
}

const MAX_COMMITS = 5;

/**
 * props:
 *  - milestones: Milestone[] (um ou vários — vários = os da mesma coluna; primeiro escolhe-se qual)
 *  - repo: caminho do repositório ligado (sem ele não há "Abrir no Git")
 *  - commitsOf(m) → Commit[] (commits da main no widget desde o deploy anterior — estimativa)
 *  - commitsState: 'idle' | 'loading' | 'ok' | 'error' (de useMilestones) — sem 'ok', não mostra "nenhum commit"
 *  - onSeek(ts), onRange({ from, to }), onEdit(m, label), onDelete(m) — todos opcionais; sem o callback, o item some
 *  - extra: [{ icon, label, hint?, onClick(m) }] ou (m) => itens — entram depois dos itens fixos (ex.: investigação)
 *  - multiDay: mostra a data junto da hora
 *  - onClose(), style, className — o menu se posiciona por `style` (sem ele vale o `.lg-pop` padrão: abaixo, à direita)
 */
export function MilestoneMenu({ milestones, repo, commitsOf, commitsState = 'ok', onSeek, onRange, onEdit, onDelete, extra, multiDay = false, onClose, style, className = '' }) {
  const ref = React.useRef(null);
  const list = milestones || [];
  const [pick, setPick] = React.useState(list.length === 1 ? list[0] : null);
  const [editing, setEditing] = React.useState(false);
  useDismiss(ref, onClose);
  // Foco no primeiro item ao abrir e a cada troca de tela (teclado funciona sem mouse).
  React.useEffect(() => {
    if (editing) return;
    const b = ref.current && ref.current.querySelector('button:not(:disabled)');
    if (b) b.focus();
  }, [pick, editing]);

  const when = (m) => fmtTime(m.ts, { date: multiDay, millis: false });
  const run = (fn) => () => { onClose(); fn(); };

  let body;
  if (!pick) {
    body = (
      <>
        <div className="lg-mmenu__head"><b>{list.length} marcos nesta coluna</b></div>
        {list.map((m) => (
          <button key={m.id} type="button" role="menuitem" onClick={() => setPick(m)}>
            <MilestoneIcon kind={m.kind} /><span className="lg-mmenu__txt">{shortLabel(m, 32)}</span><small>{when(m)}</small>
          </button>
        ))}
      </>
    );
  } else if (editing) {
    body = (
      <>
        <div className="lg-mmenu__head"><MilestoneIcon kind="manual" /><b>Editar marco</b><small>{when(pick)}</small></div>
        <LabelInput initial={pick.label} onCancel={() => setEditing(false)} onSubmit={(label) => { onClose(); onEdit(pick, label); }} />
      </>
    );
  } else {
    const m = pick;
    const g = kindGroup(m.kind);
    const commits = g === 'deploy' && repo && commitsOf ? commitsOf(m) : [];
    const more = typeof extra === 'function' ? extra(m) : extra;
    const pending = commitsPending(commitsState);
    body = (
      <>
        <div className="lg-mmenu__head">
          {list.length > 1 && <button type="button" className="lg-mmenu__back" onClick={() => setPick(null)} title="Voltar à lista" aria-label="Voltar à lista de marcos"><Icon name="arrow-left" size={13} /></button>}
          <MilestoneIcon kind={m.kind} /><b>{kindLabel(m)}</b><small>{when(m)}</small>
        </div>
        <div className="lg-mmenu__label" title={m.label}>{m.label}{m.author ? ' · ' + m.author : ''}</div>
        {onSeek && (
          <button type="button" role="menuitem" onClick={run(() => onSeek(m.ts))}>
            <Icon name="corner-down-right" size={14} /><span>{m.i != null ? 'Ir para esta linha no log' : 'Ir até este momento no log'}</span>
          </button>
        )}
        {g === 'merge' && repo && m.hash && (
          <button type="button" role="menuitem" onClick={run(() => openInGit(repo, m.hash))}>
            <Icon name="git-merge" size={14} /><span>Abrir no Git</span><small>{m.pr ? '#' + m.pr : m.hash.slice(0, 7)}</small>
          </button>
        )}
        {g === 'deploy' && repo && (
          commits.length ? (
            <>
              <div className="lg-mmenu__sep">Abrir no Git — commits na main desde o deploy anterior (estimativa)</div>
              {commits.slice(-MAX_COMMITS).reverse().map((c) => (
                <button key={c.hash} type="button" role="menuitem" onClick={run(() => openInGit(repo, c.hash))} title={c.subject}>
                  <Icon name="git-commit-horizontal" size={14} /><span className="lg-mmenu__txt">{c.title || c.subject}</span><small>{c.pr ? '#' + c.pr : c.hash.slice(0, 7)}</small>
                </button>
              ))}
              {commits.length > MAX_COMMITS && <div className="lg-mmenu__note">+{commits.length - MAX_COMMITS} mais antigos</div>}
            </>
          ) : <div className="lg-mmenu__note">{pending ? 'Commits da main: ' + pending : 'Nenhum commit da main nas pastas deste deploy desde o anterior.'}</div>
        )}
        {onRange && (
          <button type="button" role="menuitem" onClick={run(() => onRange({ from: m.ts, to: null }))}>
            <Icon name="list-filter" size={14} /><span>Filtrar a partir daqui</span><small>até o fim</small>
          </button>
        )}
        {(more || []).filter(Boolean).map((it) => (
          <button key={it.label} type="button" role="menuitem" onClick={run(() => it.onClick(m))} disabled={it.disabled}>
            <Icon name={it.icon} size={14} /><span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
          </button>
        ))}
        {m.kind === 'manual' && onEdit && (
          <button type="button" role="menuitem" onClick={() => setEditing(true)}><Icon name="pencil" size={14} /><span>Editar…</span></button>
        )}
        {m.kind === 'manual' && onDelete && (
          <button type="button" role="menuitem" className="is-danger" onClick={run(() => onDelete(m))}><Icon name="trash-2" size={14} /><span>Excluir</span></button>
        )}
      </>
    );
  }

  return (
    <div ref={ref} className={'lg-pop lg-menu lg-mmenu ' + className} role="menu" aria-label="Ações do marco" style={style}
      onKeyDown={(e) => menuKeys(e, onClose)} onPointerDown={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}

/** Menu do botão direito nas colunas: "Marcar deploy aqui…" (pede o texto ali mesmo). */
export function MarkHereMenu({ ts, multiDay = false, onSubmit, onClose, style }) {
  const ref = React.useRef(null);
  const [typing, setTyping] = React.useState(false);
  useDismiss(ref, onClose);
  React.useEffect(() => {
    if (typing) return;
    const b = ref.current && ref.current.querySelector('button');
    if (b) b.focus();
  }, [typing]);
  const when = fmtTime(ts, { date: multiDay, millis: false });
  return (
    <div ref={ref} className="lg-pop lg-menu lg-mmenu" role="menu" aria-label="Marcar na linha do tempo" style={style}
      onKeyDown={(e) => menuKeys(e, onClose)} onPointerDown={(e) => e.stopPropagation()}>
      {typing ? (
        <>
          <div className="lg-mmenu__head"><MilestoneIcon kind="manual" /><b>Marco manual</b><small>{when}</small></div>
          <LabelInput submitLabel="Marcar" onCancel={onClose} onSubmit={(label) => { onClose(); onSubmit(label); }} />
          <div className="lg-mmenu__note">Fica salvo junto deste log.</div>
        </>
      ) : (
        <button type="button" role="menuitem" onClick={() => setTyping(true)}>
          <Icon name="pencil" size={14} /><span>Marcar deploy aqui…</span><small>{when}</small>
        </button>
      )}
    </div>
  );
}
