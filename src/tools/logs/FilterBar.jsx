// Logs — barra de filtros: chips de nível (com contagem), busca com a mini-linguagem (src/logs/query.js),
// intervalo de tempo escolhido no gráfico e filtros salvos. Uma linha só, acima de tudo o que ela filtra.
import { DS } from '../../lib/ds.js';
import { suggestions } from '../../logs/query.js';
import { pushRecent } from '../../logs/recent.js';
import { usePersisted } from '../../lib/store.js';
import { LEVEL_META, levelColor, fmtTime, fmtCompact, sameDay } from './shared.jsx';

const { Icon } = DS;

const HELP = [
  ['timeout', 'texto em qualquer lugar (stack incluído)'],
  ['"conexão recusada"', 'frase exata'],
  ['/time(d)?out \\d+/i', 'expressão regular'],
  ['-heartbeat', 'esconde o que tiver o termo'],
  ['level:error+', 'nível (warn+, error,fatal, >=info)'],
  ['logger:com.fluig  thread:task-12', 'campos da linha'],
  ['status:5xx  ms:>500  path:/api/*', 'logs de acesso (IIS, Nginx)'],
  ['user.id:42  campo:*', 'campos de JSON ou chave=valor'],
  ['has:stack  lines:>20', 'entradas com stack trace / grandes'],
  ['exception:NullPointer', 'pela exceção do grupo'],
];

function useOutside(ref, onClose, open) {
  React.useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
}

export function LevelChips({ counts, levels, onChange }) {
  const on = (id) => !levels || levels.includes(id);
  const toggle = (id, only) => {
    const all = LEVEL_META.map((l) => l.id);
    if (only) return onChange(levels && levels.length === 1 && levels[0] === id ? null : [id]);
    const cur = levels || all;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange(next.length === all.length ? null : next);
  };
  const problems = levels && levels.length === 3 && [4, 5, 6].every((x) => levels.includes(x));
  return (
    <div className="lg-chips" role="group" aria-label="Níveis">
      {/* Níveis que não aparecem no log ficam de fora (a não ser que estejam desligados — aí precisam do botão). */}
      {LEVEL_META.filter((l) => !counts || counts[l.id] > 0 || !on(l.id) || l.id === 5).map((l) => {
        const n = counts ? counts[l.id] : 0;
        return (
          <button key={l.id} type="button" className={'lg-chip is-' + l.key + (on(l.id) ? ' is-on' : '')} aria-pressed={on(l.id)} aria-label={`${l.name}: ${n}`}
            title={`${l.name}: ${n} — clique liga/desliga, Ctrl+clique mostra só este`}
            onClick={(e) => toggle(l.id, e.ctrlKey || e.metaKey)}>
            <span className="lg-chip__dot" style={{ background: levelColor(l.id) }} />
            <span className="lg-chip__label">{l.label}</span>
            <span className="lg-chip__n">{fmtCompact(n)}</span>
          </button>
        );
      })}
      <button type="button" className={'lg-chip is-quick' + (problems ? ' is-on' : '')} onClick={() => onChange(problems ? null : [4, 5, 6])} title="Só avisos, erros e fatais">
        <Icon name="flame" size={12} /><span className="lg-chip__label">Problemas</span>
      </button>
    </div>
  );
}

export function SearchBox({ value, onChange, error, fields, inputRef }) {
  const [text, setText] = React.useState(value);
  const [sug, setSug] = React.useState({ list: [], i: 0 });
  const [help, setHelp] = React.useState(false);
  const helpRef = React.useRef(null);
  useOutside(helpRef, () => setHelp(false), help);
  React.useEffect(() => { setText(value); }, [value]);
  const t = React.useRef(null);
  // Últimos filtros usados (valem para qualquer log): aparecem quando o campo está vazio e em foco.
  const [recent, setRecent] = usePersisted('logs.recent', { list: [] });
  const remember = (v) => setRecent((r) => { const list = pushRecent(r.list, v); return list === r.list ? r : { list }; });
  const showRecent = () => { if (recent.list.length) setSug({ list: recent.list, i: -1, recent: true }); };
  const commit = (v) => { clearTimeout(t.current); remember(v); onChange(v); };
  const pickRecent = (s) => { setText(s); setSug({ list: [], i: 0 }); commit(s); if (inputRef && inputRef.current) inputRef.current.focus(); };
  const lastWord = (v) => { const m = /(?:^|\s)-?([\w.@()-]*)$/.exec(v); return m ? m[1] : ''; };
  const change = (v) => {
    setText(v);
    if (!v.trim()) { showRecent(); clearTimeout(t.current); t.current = setTimeout(() => onChange(v), 280); return; }
    const w = lastWord(v);
    setSug({ list: w.length >= 1 ? suggestions(w, fields || []) : [], i: 0 });
    clearTimeout(t.current);
    t.current = setTimeout(() => onChange(v), 280);
  };
  const accept = (s) => {
    const w = lastWord(text);
    const v = text.slice(0, text.length - w.length) + s + (s.endsWith(':') ? '' : ' ');
    setText(v); setSug({ list: [], i: 0 });
    if (!s.endsWith(':')) commit(v);
    if (inputRef && inputRef.current) inputRef.current.focus();
  };
  const onKey = (e) => {
    if (sug.recent && sug.list.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSug((s) => ({ ...s, i: Math.min(s.list.length - 1, s.i + 1) })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSug((s) => ({ ...s, i: Math.max(-1, s.i - 1) })); return; }
      if (e.key === 'Enter' && sug.i >= 0) { e.preventDefault(); pickRecent(sug.list[sug.i]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setSug({ list: [], i: 0 }); return; }
    } else if (sug.list.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSug((s) => ({ ...s, i: (s.i + 1) % s.list.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSug((s) => ({ ...s, i: (s.i - 1 + s.list.length) % s.list.length })); return; }
      if (e.key === 'Tab') { e.preventDefault(); accept(sug.list[sug.i]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setSug({ list: [], i: 0 }); return; }
    }
    if (e.key === 'Enter') { setSug({ list: [], i: 0 }); commit(text); }
    if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); commit(''); }
  };
  return (
    <div className={'lg-search' + (error ? ' has-error' : '')}>
      <Icon name="search" size={14} />
      <input ref={inputRef} value={text} onChange={(e) => change(e.target.value)} onKeyDown={onKey} onFocus={() => { if (!text.trim()) showRecent(); }} onBlur={() => { remember(text); setTimeout(() => setSug({ list: [], i: 0 }), 150); }}
        placeholder='Buscar: timeout -heartbeat level:error+ logger:fluig status:5xx "frase" /regex/' spellCheck={false} aria-label="Filtro" />
      {text && <button type="button" className="lg-search__x" onClick={() => { setText(''); commit(''); }} title="Limpar (Esc)"><Icon name="x" size={13} /></button>}
      <div className="lg-pop-wrap" ref={helpRef}>
        <button type="button" className="lg-search__help" onClick={() => setHelp((h) => !h)} title="Como filtrar" aria-expanded={help}><Icon name="circle-help" size={14} /></button>
        {help && (
          <div className="lg-pop lg-help" role="dialog" aria-label="Como filtrar">
            <b>Todos os termos precisam casar</b>
            <table><tbody>{HELP.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td>{b}</td></tr>)}</tbody></table>
            <small>Ctrl+F foca a busca · ↑↓ andam pela lista · n / N vão ao próximo/anterior erro · End segue o fim</small>
          </div>
        )}
      </div>
      {sug.recent && sug.list.length > 0 && (
        <div className="lg-pop lg-sug lg-recent" role="listbox" aria-label="Filtros recentes">
          <small className="lg-recent__title">Recentes</small>
          {sug.list.map((s, i) => <button key={s} type="button" role="option" aria-selected={i === sug.i} className={i === sug.i ? 'is-sel' : ''} onMouseDown={(e) => { e.preventDefault(); pickRecent(s); }} title={s}>{s}</button>)}
          <button type="button" className="lg-recent__clear" onMouseDown={(e) => { e.preventDefault(); setRecent({ list: [] }); setSug({ list: [], i: 0 }); }}>Limpar histórico</button>
        </div>
      )}
      {!sug.recent && sug.list.length > 0 && (
        <div className="lg-pop lg-sug" role="listbox">
          {sug.list.map((s, i) => <button key={s} type="button" role="option" aria-selected={i === sug.i} className={i === sug.i ? 'is-sel' : ''} onMouseDown={(e) => { e.preventDefault(); accept(s); }}>{s}</button>)}
        </div>
      )}
      {error && <span className="lg-search__err" title={error}><Icon name="triangle-alert" size={12} /> {error}</span>}
    </div>
  );
}

export function RangeChip({ range, onClear }) {
  if (!range) return null;
  const date = !sameDay(range.from, range.to) || !sameDay(range.from, Date.now());
  return (
    <span className="lg-range">
      <Icon name="clock" size={12} />
      {fmtTime(range.from, { date, millis: false })} – {fmtTime(range.to, { date: !sameDay(range.from, range.to), millis: false })}
      <button type="button" onClick={onClear} title="Tirar o intervalo de tempo" aria-label="Tirar o intervalo de tempo"><Icon name="x" size={12} /></button>
    </span>
  );
}

/** Filtros salvos: aplicar, salvar o atual, excluir. */
export function Presets({ presets, current, onApply, onSave }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const ref = React.useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const canSave = !!(current.q || current.levels);
  const save = () => {
    if (!name.trim()) return;
    onSave([...presets.filter((p) => p.name !== name.trim()), { id: Math.random().toString(36).slice(2, 10), name: name.trim(), q: current.q, levels: current.levels }]);
    setName('');
  };
  return (
    <div className="lg-pop-wrap" ref={ref}>
      <button type="button" className="lg-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Filtros salvos">
        <Icon name="bookmark" size={14} /><span>Salvos</span>{presets.length > 0 && <span className="lg-btn__n">{presets.length}</span>}
      </button>
      {open && (
        <div className="lg-pop lg-presets" role="dialog" aria-label="Filtros salvos">
          {presets.length === 0 && <div className="lg-muted">Nenhum filtro salvo ainda.</div>}
          {presets.map((p) => (
            <div key={p.id} className="lg-preset">
              <button type="button" className="lg-preset__main" onClick={() => { onApply(p); setOpen(false); }}>
                <b>{p.name}</b>
                <small>{[p.q, p.levels ? p.levels.map((l) => LEVEL_META.find((m) => m.id === l).label).join(',') : ''].filter(Boolean).join(' · ') || 'tudo'}</small>
              </button>
              <button type="button" className="lg-icon" title="Excluir" aria-label={`Excluir ${p.name}`} onClick={() => onSave(presets.filter((x) => x.id !== p.id))}><Icon name="trash-2" size={13} /></button>
            </div>
          ))}
          <div className="lg-preset__new">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder={canSave ? 'Nome do filtro atual' : 'Filtre algo para salvar'} disabled={!canSave} />
            <button type="button" className="lg-btn is-accent" onClick={save} disabled={!canSave || !name.trim()}><Icon name="plus" size={13} /><span>Salvar</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
