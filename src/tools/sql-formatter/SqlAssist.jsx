// SQL Formatter — avisos de risco (regras, sem IA) e, com a IA ligada, "Explicar consulta" e "Escrever a partir de uma
// descrição". Fica entre as opções e o editor; nada muda a entrada sem clique (e "Colocar na entrada" tem Desfazer).
import { DS } from '../../lib/ds.js';
import { sqlRisks } from '../../sql/risks.js';
import { useAiTask, aiOn, AiButton, AiPanel } from '../../ai/ui.jsx';

const { Icon } = DS;
const SCHEMA_KEY = 'tk.sql.schema';
const ICON = { danger: 'octagon-alert', warn: 'triangle-alert', info: 'info' };

function Risks({ risks }) {
  const [open, setOpen] = React.useState(false);
  if (!risks.length) return null;
  const shown = open ? risks : risks.slice(0, 2);
  return (
    <div className="sqla__risks">
      {shown.map((r) => <div key={r.text} className={'sqla__risk is-' + r.level}><Icon name={ICON[r.level]} size={13} /><span>{r.text}</span></div>)}
      {risks.length > 2 && <button type="button" className="ai-panel__link" onClick={() => setOpen((v) => !v)}>{open ? 'Mostrar menos' : `+${risks.length - 2} aviso(s)`}</button>}
    </div>
  );
}

export function SqlAssist({ sql, cfg, setSql }) {
  const deferred = React.useDeferredValue(sql);
  const risks = React.useMemo(() => sqlRisks(deferred), [deferred]);
  const explain = useAiTask('sqlExplain', cfg);
  const write = useAiTask('sqlFromText', cfg);
  const [composing, setComposing] = React.useState(false);
  const [desc, setDesc] = React.useState('');
  const [schema, setSchema] = React.useState(() => { try { return localStorage.getItem(SCHEMA_KEY) || ''; } catch { return ''; } });
  const [showSchema, setShowSchema] = React.useState(false);
  const prev = React.useRef(null);
  React.useEffect(() => { try { localStorage.setItem(SCHEMA_KEY, schema); } catch { /* ignore */ } }, [schema]);
  const on = aiOn(cfg);

  const doWrite = () => write.start(() => ({ description: desc, schema }));
  if (!on && !risks.length) return null;
  const result = write.st && write.st.data;
  return (
    <div className="sqla">
      <div className="sqla__bar">
        <Risks risks={risks} />
        {on && (
          <div className="sqla__ai">
            {!explain.st && <AiButton ai={explain} label="Explicar consulta" onClick={() => explain.start(() => ({ sql, risks: risks.map((r) => r.text) }))} disabled={!sql.trim()} reason="Cole um SQL para explicar" />}
            {!write.st && <AiButton ai={write} label={composing ? 'Fechar' : 'Escrever a partir de uma descrição'} onClick={() => setComposing((v) => !v)} />}
          </div>
        )}
      </div>
      {on && <AiPanel ai={explain} className="sqla__panel" />}
      {on && composing && !write.st && (
        <form className="sqla__compose" onSubmit={(e) => { e.preventDefault(); if (desc.trim()) doWrite(); }}>
          <input autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ex.: clientes que compraram mais de 3 vezes em 2025, com o total gasto" aria-label="Descrição da consulta" />
          <button type="button" className={'ai-act' + (schema.trim() ? ' is-on' : '')} onClick={() => setShowSchema((v) => !v)} title="As tabelas e colunas que existem (CREATE TABLE ou uma lista) — a IA usa só elas">
            <Icon name="table" size={12} /><span>Esquema{schema.trim() ? ' ✓' : ''}</span>
          </button>
          <button type="submit" className="ai-act is-primary" disabled={!desc.trim()}><Icon name="sparkles" size={12} /><span>Escrever</span></button>
          {showSchema && <textarea value={schema} onChange={(e) => setSchema(e.target.value)} rows={5} spellCheck={false}
            placeholder={'Cole o esquema (fica salvo neste computador):\nCREATE TABLE clientes (id int, nome varchar(80), ...);\nou: pedidos(id, cliente_id, total, data)'} aria-label="Esquema" />}
        </form>
      )}
      {on && (
        <AiPanel ai={write} className="sqla__panel"
          body={(st) => <pre className="sqla__sql">{st.phase === 'done' && result != null ? result : st.text}</pre>}
          extraLinks={prev.current != null ? [{ label: 'Desfazer', onClick: () => { setSql(prev.current); prev.current = null; write.close(); } }] : []}
          actions={[{ label: 'Colocar na entrada', icon: 'arrow-down-to-line', primary: true, disabled: !result, onClick: () => { prev.current = sql; setSql(result); setComposing(false); } }]} />
      )}
    </div>
  );
}
