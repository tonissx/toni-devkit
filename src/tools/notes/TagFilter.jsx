import { DS } from '../../lib/ds.js';
import { normalize } from '../../commands/search.js';

const { Icon, SegmentedControl } = DS;
const MODES = [
  { value: 'all', label: 'Todas' },
  { value: 'any', label: 'Qualquer' },
];
const LIMIT = 10;

/**
 * Filtro de tags: campo com sugestões das tags que existem (↑/↓ e Enter), tags escolhidas como chips removíveis e,
 * com duas ou mais, o modo — Todas (a nota tem todas) ou Qualquer (basta uma).
 * `tags` = [{ tag, count }] (mais usadas primeiro); `selected` = ['api', …].
 */
export function TagFilter({ tags, selected, mode, onChange, onMode, innerRef }) {
  const [text, setText] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const q = normalize(text.replace(/^#/, '')).trim();
  const options = React.useMemo(() => {
    const pool = tags.filter((t) => !selected.includes(t.tag));
    if (!q) return pool.slice(0, LIMIT);
    const starts = pool.filter((t) => normalize(t.tag).startsWith(q));
    const rest = pool.filter((t) => !normalize(t.tag).startsWith(q) && normalize(t.tag).includes(q));
    return [...starts, ...rest].slice(0, LIMIT);
  }, [tags, selected, q]);
  const at = Math.min(hi, Math.max(options.length - 1, 0));

  const add = (tag) => { onChange([...selected, tag]); setText(''); setHi(0); if (inputRef.current) inputRef.current.focus(); };
  const remove = (tag) => { onChange(selected.filter((t) => t !== tag)); if (inputRef.current) inputRef.current.focus(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setHi((at + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      if (options[at]) { e.preventDefault(); add(options[at].tag); }
    } else if (e.key === 'Backspace' && !text && selected.length) {
      remove(selected[selected.length - 1]);
    } else if (e.key === 'Escape' && text) {
      e.stopPropagation(); // primeiro limpa o campo; o segundo Esc recolhe o painel
      setText('');
    }
  };

  return (
    <div className="nts-tagf" ref={innerRef}>
      {selected.length > 0 && (
        <div className="nts-tagf__sel" aria-label="Tags escolhidas">
          {selected.map((t) => (
            <button key={t} type="button" className="nts-chip is-tag is-on nts-tagf__chip" aria-label={`Remover a tag ${t}`} onClick={() => remove(t)}>
              #{t} <Icon name="x" size={10} />
            </button>
          ))}
        </div>
      )}
      {selected.length > 1 && (
        <div className="nts-tagf__mode">
          <span>Notas com</span>
          <SegmentedControl size="sm" options={MODES} value={mode} onChange={onMode} />
        </div>
      )}
      <input ref={inputRef} className="nts-tagf__input" type="text" value={text} placeholder="Buscar tag…" spellCheck={false} autoComplete="off"
        role="combobox" aria-expanded={options.length > 0} aria-controls="nts-tagf-list" aria-autocomplete="list" aria-label="Buscar tag"
        aria-activedescendant={options[at] ? `nts-tagf-${options[at].tag}` : undefined}
        onChange={(e) => { setText(e.target.value); setHi(0); }} onKeyDown={onKeyDown} />
      <ul id="nts-tagf-list" className="nts-tagf__list tk-scroll" role="listbox" aria-label="Tags">
        {options.map((t, i) => (
          <li key={t.tag} id={`nts-tagf-${t.tag}`} role="option" aria-selected={i === at} className={'nts-tagf__opt' + (i === at ? ' is-hi' : '')}
            onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setHi(i)} onClick={() => add(t.tag)}>
            <span>#{t.tag}</span><small>{t.count}</small>
          </li>
        ))}
        {options.length === 0 && (
          <li className="nts-tagf__none" role="presentation">
            {q ? `Nenhuma tag “${text.replace(/^#/, '').trim()}”.` : tags.length ? 'Todas as tags já foram escolhidas.' : 'Nenhuma tag ainda.'}
          </li>
        )}
      </ul>
    </div>
  );
}
