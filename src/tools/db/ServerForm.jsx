// Banco — adicionar/editar servidor. A credencial é uma entrada do Vault (a senha nunca fica aqui); dá para colar
// uma connection string (ADO.NET ou JDBC) que preenche o resto — e, se ela trouxer usuário e senha, guardá-los no
// Vault num clique. "Testar conexão" mostra versão, edição e se o login pode ver as sessões dos outros.
import { DS } from '../../lib/ds.js';
import { parseConnectionString, fromVaultFields } from '../../db/connstr.js';
import { dbApi, errText, fmtMs } from './shared.jsx';

const { Icon, Modal, Button, Checkbox, Spinner } = DS;

const isDbEntry = (e) => e.kind === 'db' || ((e.fields || []).some((f) => /servidor|server|host/i.test(f.name)) && (e.fields || []).some((f) => /usu|user|login/i.test(f.name)));

function Field({ label, children, hint }) {
  return (
    <label className="db-field">
      <span className="db-field__label">{label}</span>
      {children}
      {hint && <small className="db-field__hint">{hint}</small>}
    </label>
  );
}

export function ServerForm({ initial, onClose, onSaved, toast }) {
  const [f, setF] = React.useState(() => ({ name: '', host: '', instance: '', port: '', database: '', vaultEntryId: '', encrypt: true, trustCert: true, intervalSec: 5, background: false, ...(initial || {}) }));
  const [entries, setEntries] = React.useState(null); // null = carregando; [] ; 'locked'
  const [conn, setConn] = React.useState('');
  const [parsed, setParsed] = React.useState(null);
  const [test, setTest] = React.useState(null); // { busy } | { ok, info, ms } | { error }
  const [saving, setSaving] = React.useState(false);
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setTest(null); };

  const loadVault = React.useCallback(async () => {
    const st = await window.devkit.vault.status().catch(() => null);
    if (!st || !st.exists) { setEntries('none'); return; }
    if (!st.unlocked) { setEntries('locked'); return; }
    const list = await window.devkit.vault.list();
    setEntries((list || []).filter(isDbEntry));
  }, []);
  React.useEffect(() => { loadVault(); return window.devkit.vault.onChanged(() => loadVault()); }, [loadVault]);

  // Escolheu a entrada do Vault: preenche o que estiver vazio com os campos dela (os não secretos).
  const pickEntry = (id) => {
    set('vaultEntryId')(id);
    const e = Array.isArray(entries) && entries.find((x) => x.id === id);
    if (!e) return;
    const v = fromVaultFields(e.fields.map((x) => ({ name: x.name, value: x.secret ? '' : x.value })));
    setF((x) => ({ ...x, vaultEntryId: id, name: x.name || e.name, host: x.host || v.host, instance: x.instance || v.instance, port: x.port || v.port || '', database: x.database || v.database }));
  };

  const applyConn = (s) => {
    setConn(s);
    const p = parseConnectionString(s);
    if (!p.host) { setParsed(null); return; }
    setParsed(p);
    setF((x) => ({ ...x, host: p.host, instance: p.instance, port: p.port || '', database: p.database || x.database, encrypt: p.encrypt, trustCert: p.trustCert || x.trustCert }));
    setTest(null);
  };

  // Usuário e senha da connection string → nova entrada do Vault (e já escolhida aqui).
  const saveToVault = async () => {
    if (!parsed || !parsed.user) return;
    try {
      const name = `SQL ${parsed.host}${parsed.instance ? '\\' + parsed.instance : ''}${parsed.database ? ' · ' + parsed.database : ''}`.slice(0, 80);
      const e = await window.devkit.vault.save({
        name, kind: 'db', tags: ['banco', 'monitor'],
        fields: [
          { name: 'Servidor', value: parsed.host + (parsed.instance ? '\\' + parsed.instance : ''), secret: false },
          { name: 'Porta', value: parsed.port ? String(parsed.port) : '', secret: false },
          { name: 'Banco', value: parsed.database || '', secret: false },
          { name: 'Usuário', value: parsed.user, secret: false },
          { name: 'Senha', value: parsed.password || '', secret: true },
        ],
        notes: 'Criada pelo Banco (monitor de SQL Server).',
      });
      await loadVault();
      setF((x) => ({ ...x, vaultEntryId: e.id, name: x.name || name }));
      setConn(''); setParsed((p) => ({ ...p, user: '', password: '' }));
      toast('Credencial guardada no Vault', e.name, 'ok');
    } catch (err) { toast('Não foi possível guardar no Vault', errText(err), 'error'); }
  };

  const draft = () => ({ ...f, port: f.port ? Number(f.port) : null });
  const doTest = async () => {
    setTest({ busy: true });
    try { setTest(await dbApi().test(draft())); } catch (e) { setTest({ error: errText(e) }); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const s = initial && initial.id ? await dbApi().update(initial.id, draft()) : await dbApi().add(draft());
      onSaved(s);
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setSaving(false); }
  };

  const info = test && test.info;
  return (
    <Modal title={initial && initial.id ? 'Editar servidor' : 'Adicionar servidor'} icon="database-zap" onClose={onClose} width={620}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="secondary" onClick={doTest} disabled={!f.host || !f.vaultEntryId || (test && test.busy)}>{test && test.busy ? 'Testando…' : 'Testar conexão'}</Button>
        <Button variant="primary" onClick={save} disabled={!f.host || !f.vaultEntryId || saving}>Salvar</Button>
      </>}>
      <div className="db-form">
        <Field label="Colar uma connection string (opcional)" hint="ADO.NET (Server=…;Database=…) ou JDBC (jdbc:sqlserver://…) — preenche os campos abaixo.">
          <input className="db-input is-mono" value={conn} onChange={(e) => applyConn(e.target.value)} placeholder="Server=srv-sql01,1433;Database=fluig;User Id=…;Password=…" spellCheck={false} />
        </Field>
        {parsed && parsed.integrated && <div className="db-note is-warn"><Icon name="triangle-alert" size={13} /> Login integrado do Windows não é suportado — use um login SQL.</div>}
        {parsed && parsed.user && (
          <div className="db-note">
            <Icon name="key-round" size={13} />
            <span>A connection string tem usuário <b>{parsed.user}</b>{parsed.password ? ' e senha' : ''}. A senha não fica no servidor cadastrado — ela mora no Vault.</span>
            <button type="button" className="lg-btn is-accent" onClick={saveToVault} disabled={!Array.isArray(entries)}><Icon name="lock-keyhole" size={12} /><span>Guardar no Vault</span></button>
          </div>
        )}
        <div className="db-form__grid">
          <Field label="Servidor"><input className="db-input" value={f.host} onChange={(e) => set('host')(e.target.value)} placeholder="srv-sql01 ou 10.0.0.5" /></Field>
          <Field label="Instância" hint="Vazio = instância padrão"><input className="db-input" value={f.instance} onChange={(e) => set('instance')(e.target.value)} placeholder="SQL2019" /></Field>
          <Field label="Porta" hint="Vazio = 1433 (ou SQL Browser)"><input className="db-input" value={f.port || ''} onChange={(e) => set('port')(e.target.value.replace(/\D/g, ''))} placeholder="1433" /></Field>
          <Field label="Banco ao conectar" hint="Vazio = master"><input className="db-input" value={f.database} onChange={(e) => set('database')(e.target.value)} placeholder="master" /></Field>
        </div>
        <Field label="Credencial (Vault)" hint="Uma entrada do tipo Banco com usuário e senha de um login SQL.">
          {entries === null ? <span className="lg-muted"><Spinner size={12} /> Lendo o Vault…</span>
            : entries === 'none' ? <span className="db-note is-warn"><Icon name="lock-keyhole" size={13} /> Crie o Vault (ferramenta Vault) para guardar a credencial.</span>
              : entries === 'locked' ? <span className="db-note is-warn"><Icon name="lock-keyhole" size={13} /> O Vault está trancado — desbloqueie na ferramenta Vault para escolher a credencial.</span>
                : (
                  <select className="db-input" value={f.vaultEntryId} onChange={(e) => pickEntry(e.target.value)}>
                    <option value="">{entries.length ? 'Escolha…' : 'Nenhuma entrada de banco no Vault — cole uma connection string acima'}</option>
                    {entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
        </Field>
        <Field label="Nome"><input className="db-input" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="Produção RM" /></Field>
        <div className="db-form__row">
          <Checkbox label="Criptografar a conexão (TLS)" checked={f.encrypt} onChange={(v) => set('encrypt')(typeof v === 'boolean' ? v : !f.encrypt)} />
          <Checkbox label="Confiar no certificado do servidor" checked={f.trustCert} onChange={(v) => set('trustCert')(typeof v === 'boolean' ? v : !f.trustCert)} />
        </div>
        <div className="db-form__row">
          <Checkbox label="Monitorar em segundo plano (guarda o histórico mesmo com a tela fechada)" checked={f.background} onChange={(v) => set('background')(typeof v === 'boolean' ? v : !f.background)} />
        </div>
        <Field label={`Atualizar a cada ${f.intervalSec} s com a tela aberta`} hint="Em segundo plano, no mínimo a cada 15 s. Cada ciclo custa poucos milissegundos de CPU no servidor.">
          <input type="range" min="2" max="30" step="1" value={f.intervalSec} onChange={(e) => set('intervalSec')(Number(e.target.value))} />
        </Field>
        {test && test.error && <div className="db-note is-error"><Icon name="circle-alert" size={13} /> {test.error}</div>}
        {info && (
          <div className="db-note is-ok">
            <Icon name="circle-check" size={13} />
            <span>
              Conectou em {fmtMs(test.ms)} · <b>{info.edition}</b> {info.product_version} {info.product_level}
              {info.has_view_server_state ? ' · vê todas as sessões' : ' · sem VIEW SERVER STATE (só vê as próprias sessões)'}
              {info.can_kill ? '' : ' · não pode encerrar sessões'}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
