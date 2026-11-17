// Seletor múltiplo com busca para listas de nomes (skills, servidores MCP, ferramentas). Aceita também um nome que não está na lista:
// digite e tecle Enter (ou vírgula). `options`: [{ name, hint? }] — só sugestões; o valor é sempre uma lista de strings.
import { DS } from '../../lib/ds.js';

const { Input, Icon } = DS;

export function TagPicker({ value, onChange, options = [], placeholder = 'Buscar ou digitar…', max, emptyHint }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const list = Array.isArray(value) ? value : [];
  const full = max != null && list.length >= max;

  const add = (raw) => {
    const name = String(raw || '').trim().replace(/,$/, '').trim();
    if (!name || list.includes(name) || full) { setQ(''); return; }
    onChange([...list, name]);
    setQ('');
  };
  const needle = q.trim().toLowerCase();
  const sugg = options
    .filter((o) => !list.includes(o.name) && (!needle || (o.name + ' ' + (o.hint || '')).toLowerCase().includes(needle)))
    .slice(0, 8);
  const known = new Set(options.map((o) => o.name));

  return (
    <div className="ag-tags">
      {list.length > 0 && (
        <div className="ag-tags__chips">
          {list.map((t) => (
            <span key={t} className={'ag-chip' + (options.length && !known.has(t) ? ' is-free' : '')} title={options.length && !known.has(t) ? 'Não está na lista encontrada nesta máquina (mantido como digitado).' : undefined}>
              {t}
              <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(list.filter((x) => x !== t))}><Icon name="x" size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="ag-tags__box">
        <Input size="sm" value={q} placeholder={full ? `Máximo de ${max} atingido` : placeholder} disabled={full}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) add(v); else { setQ(v); setOpen(true); } }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(q); } else if (e.key === 'Backspace' && !q && list.length) onChange(list.slice(0, -1)); }} />
        {open && !full && (sugg.length > 0 || (q.trim() && !list.includes(q.trim()))) && (
          <div className="ag-tags__menu">
            {sugg.map((o) => (
              <button key={o.name} type="button" onMouseDown={(e) => { e.preventDefault(); add(o.name); }}>
                <b>{o.name}</b>{o.hint && <span>{o.hint}</span>}
              </button>
            ))}
            {q.trim() && !known.has(q.trim()) && <button type="button" onMouseDown={(e) => { e.preventDefault(); add(q); }}><b>Adicionar “{q.trim()}”</b><span>nome digitado</span></button>}
          </div>
        )}
      </div>
      {!list.length && emptyHint && <p className="ag-muted">{emptyHint}</p>}
    </div>
  );
}
