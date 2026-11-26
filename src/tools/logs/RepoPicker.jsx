// Logs — seletor dos repositórios ligados a um log (cabeçalho): botão compacto que abre uma lista com caixas de
// marcar (todos os repositórios cadastrados no Git + "Nenhum"). Mostra "(automático)" quando o Devkit ligou sozinho
// e, no empate das pastas, até dois botões "Ligar a X?".
import { DS } from '../../lib/ds.js';
import { useDismiss } from './MilestoneMenu.jsx';
import { baseName } from './useMilestones.js';

const { Icon } = DS;
const MAX = 10;
const AUTO_HINT = 'Ligado automaticamente: as pastas batem com as widgets publicadas neste log. Mude aqui quando quiser.';

/**
 * props: repos [{ path, name }] (cadastrados), linked string[], auto (ligado sozinho), error (texto|null),
 * suggestions string[] (no empate), onChange(repos[])
 */
export function RepoPicker({ repos = [], linked = [], auto = false, error = null, suggestions = [], onChange }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const menuRef = React.useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  React.useEffect(() => {
    if (!open || !menuRef.current) return;
    const b = menuRef.current.querySelector('button');
    if (b) b.focus();
  }, [open]);

  const isOn = (p) => linked.some((l) => l.toLowerCase() === p.toLowerCase());
  // Ligados que saíram da lista do Git continuam aparecendo (para dar para desligar).
  const rows = [...repos, ...linked.filter((l) => !repos.some((r) => r.path.toLowerCase() === l.toLowerCase())).map((l) => ({ path: l, name: baseName(l), gone: true }))];
  const toggle = (p) => onChange(isOn(p) ? linked.filter((l) => l.toLowerCase() !== p.toLowerCase()) : [...linked, p].slice(0, MAX));
  const label = !linked.length ? 'Nenhum' : linked.length === 1 ? baseName(linked[0]) : String(linked.length);
  const title = (linked.length ? 'Repositórios Git ligados a este log: ' + linked.map(baseName).join(', ') : 'Repositórios Git usados para mostrar os merges da main na linha do tempo')
    + (auto ? '\n' + AUTO_HINT : '') + (error ? '\n' + error : '');
  const nameOf = (p) => (repos.find((r) => r.path === p) || { name: baseName(p) }).name;

  const keys = (e) => {
    e.stopPropagation(); // os atalhos da lista não valem com o menu em foco
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll('button:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    const k = items.indexOf(document.activeElement);
    items[e.key === 'ArrowDown' ? (k + 1) % items.length : (k <= 0 ? items.length - 1 : k - 1)].focus();
  };

  return (
    <>
      <div className="lg-pop-wrap" ref={ref}>
        <button type="button" className={'lg-select lg-repo' + (error ? ' is-warn' : '')} onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded={open} title={title}>
          <span className="lg-repo__label">Repositórios: {label}</span>
          {auto && <small className="lg-repo__auto">(automático)</small>}
          <Icon name="chevron-down" size={11} />
        </button>
        {open && (
          <div ref={menuRef} className="lg-pop lg-menu lg-mmenu lg-repo__menu" role="menu" aria-label="Repositórios ligados" onKeyDown={keys}>
            {rows.map((r) => {
              const on = isOn(r.path);
              const full = !on && linked.length >= MAX;
              return (
                <button key={r.path} type="button" role="menuitemcheckbox" aria-checked={on} disabled={full} onClick={() => toggle(r.path)}
                  title={r.path + (r.gone ? ' — não está mais na lista do Git' : '') + (full ? ' — no máximo ' + MAX + ' por log' : '')}>
                  <Icon name={on ? 'square-check' : 'square'} size={14} className={on ? 'lg-mmenu__on' : ''} />
                  <span className="lg-mmenu__txt">{r.name}</span>
                  {on && auto && <small title={AUTO_HINT}>automático</small>}
                  {r.gone && <small>fora do Git</small>}
                </button>
              );
            })}
            {!rows.length && <div className="lg-mmenu__note">Nenhum repositório cadastrado na ferramenta Git.</div>}
            <button type="button" role="menuitemcheckbox" aria-checked={!linked.length} onClick={() => onChange([])}>
              <Icon name={!linked.length ? 'square-check' : 'square'} size={14} className={!linked.length ? 'lg-mmenu__on' : ''} />
              <span>Nenhum</span>
            </button>
            {error && <div className="lg-mmenu__note lg-repo__err">{error}</div>}
            <div className="lg-mmenu__note">Os merges da main de cada repositório marcado entram na linha do tempo.</div>
          </div>
        )}
      </div>
      {error && <span className="lg-repo__warn" title={linked.join('\n')}>{error}</span>}
      {!linked.length && suggestions.slice(0, 2).map((p) => (
        <button key={p} type="button" className="lg-repo__suggest" onClick={() => onChange([p])}
          title={p + ' — tem pastas com o nome dos artefatos publicados (estimativa)'}>Ligar a {nameOf(p)}?</button>
      ))}
    </>
  );
}
