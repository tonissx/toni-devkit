import { DS } from '../../lib/ds.js';
import { ddlToMermaid } from '../../diagrams/ddlToMermaid.js';

const { Modal, Button } = DS;

/**
 * Cola o DDL (T-SQL) ou o JSON de metadados do SQL Visualizer e gera um diagrama ER.
 * O resultado é conferido enquanto se digita: erro ou "N tabelas, M avisos" antes de criar.
 * `onCreate(code, title)` cria a nota; o modal fecha quando ela termina.
 */
export function ImportDdlModal({ onCreate, onClose }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState('');

  const parsed = React.useMemo(() => {
    if (!text.trim()) return null;
    try { return { ok: ddlToMermaid(text) }; } catch (e) { return { error: String((e && e.message) || e) }; }
  }, [text]);

  const submit = async () => {
    if (!parsed || !parsed.ok || busy) return;
    setBusy(true);
    setFailure('');
    try { await onCreate(parsed.ok.code, 'Diagrama ER importado'); onClose(); } catch (e) { setFailure(String((e && e.message) || e)); setBusy(false); }
  };

  const status = !parsed ? null
    : parsed.error ? { cls: 'is-error', text: parsed.error }
      : { cls: 'is-ok', text: `${parsed.ok.tables} tabela(s) encontrada(s)` + (parsed.ok.warnings.length ? ` · ${parsed.ok.warnings.length} aviso(s): ${parsed.ok.warnings[0]}` : '') };

  return (
    <Modal open onClose={onClose} icon="database" title="Importar DDL" width={640}
      description="Cole CREATE TABLE / ALTER TABLE do SQL Server (ou o JSON de metadados do SQL Visualizer). Nada é executado."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="workflow" onClick={submit} disabled={busy || !parsed || !parsed.ok}>Gerar diagrama</Button>
      </>}>
      <textarea
        className="dgm-import"
        autoFocus
        spellCheck={false}
        value={text}
        placeholder={'CREATE TABLE dbo.Cliente (Id INT PRIMARY KEY, Nome NVARCHAR(100));\nCREATE TABLE dbo.Pedido (Id INT PRIMARY KEY, ClienteId INT NOT NULL REFERENCES dbo.Cliente(Id));'}
        aria-label="DDL"
        onChange={(e) => setText(e.target.value)}
      />
      {(status || failure) && <div className={'dgm-import__status ' + (failure ? 'is-error' : status.cls)} role="status">{failure || status.text}</div>}
    </Modal>
  );
}
