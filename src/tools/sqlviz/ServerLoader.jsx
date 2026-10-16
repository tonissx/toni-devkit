import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { fromMetadata } from '../../db/schema.js';

const { Button, Alert, Select } = DS;

export const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * Barra "Do servidor": escolhe um servidor salvo na aba Banco e um banco, e carrega só o catálogo (tabelas, colunas,
 * chaves). A senha vem do Vault no processo principal. onLoaded(schema, label) recebe o modelo já convertido.
 * `extra` aceita botões adicionais (ex.: "Voltar ao texto").
 */
export function ServerLoader({ toast, onLoaded, extra, hint = true }) {
  const [pick, setPick] = usePersisted('sqlviz.src', { server: '', database: '' });
  const [servers, setServers] = React.useState([]);
  const [dbs, setDbs] = React.useState([]);
  const [busy, setBusy] = React.useState(null); // 'dbs' | 'schema' | null
  const [err, setErr] = React.useState('');
  const serverId = pick.server || '';
  const database = pick.database || '';

  React.useEffect(() => {
    let alive = true;
    window.devkit.db.list().then((l) => { if (alive) setServers(l); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  React.useEffect(() => {
    setDbs([]); setErr('');
    if (!serverId || !servers.some((x) => x.id === serverId)) return undefined;
    let alive = true;
    setBusy('dbs');
    window.devkit.db.schemaDbs(serverId)
      .then((l) => { if (alive) setDbs(l); })
      .catch((e) => { if (alive) setErr(errText(e)); })
      .finally(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
  }, [serverId, servers.length]);

  const load = async () => {
    setBusy('schema'); setErr('');
    try {
      const r = await window.devkit.db.schema(serverId, database);
      const schema = fromMetadata(r.json);
      const srv = servers.find((x) => x.id === serverId);
      onLoaded(schema, `${srv ? srv.name || srv.label : 'servidor'} · ${database}`);
      toast('Schema carregado', `${schema.tables.length} tabela(s), ${schema.fks.length} FK(s)`, 'ok');
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="sqv__srv">
        <span className="sqv__muted">Do servidor</span>
        <Select size="sm" options={servers.map((x) => ({ value: x.id, label: x.name || x.label }))} value={serverId} placeholder={servers.length ? 'Servidor…' : 'Nenhum servidor na aba Banco'} disabled={!servers.length} onChange={(v) => setPick({ server: v, database: '' })} style={{ width: 200 }} />
        <Select size="sm" options={dbs.map((d) => ({ value: d, label: d }))} value={database} placeholder={busy === 'dbs' ? 'Buscando bancos…' : 'Banco…'} disabled={!dbs.length} onChange={(v) => setPick({ ...pick, database: v })} style={{ width: 200 }} />
        <Button variant="secondary" size="sm" icon="database-zap" disabled={!serverId || !database || busy === 'schema'} onClick={load}>{busy === 'schema' ? 'Carregando…' : 'Carregar'}</Button>
        {extra}
        {hint && <span className="sqv__muted">Só lê o catálogo (tabelas, colunas, chaves) — nenhum dado das tabelas.</span>}
      </div>
      {err && <Alert variant="error" title="Não foi possível ler do servidor">{err}</Alert>}
    </>
  );
}
