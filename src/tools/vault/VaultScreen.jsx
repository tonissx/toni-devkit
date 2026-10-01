import { DS, mod, isMod } from '../../lib/ds.js';
import { KINDS, kindOf, blankEntry, summary, isDbLike, secretBlock, norm } from '../../vault/entry.js';
import { useVaultStatus, generatePassword, copyFromVault, cleanError } from '../../vault/client.js';
import { UnlockForm } from './UnlockForm.jsx';

const { PageHeader, Button, IconButton, Input, Field, Textarea, Select, SegmentedControl, Modal, EmptyState, Badge, Icon, Spinner, Alert } = DS;

const vault = () => window.devkit.vault;
const MASK = '••••••••••';
const KIND_OPTIONS = KINDS.map((k) => ({ value: k.id, label: k.label }));

/**
 * Vault: cofre de senhas, tokens e credenciais de banco. Trancado, mostra só o desbloqueio; aberto, lista as
 * entradas (metadados — os segredos ficam no processo principal) e copia cada campo pelo clipboard protegido.
 * request (da palette/notas): { id } seleciona · { create: 'nome' } abre o editor de uma entrada nova.
 */
export function VaultScreen({ toast, request }) {
  const status = useVaultStatus();
  const [entries, setEntries] = React.useState([]);
  const [sel, setSel] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [draft, setDraft] = React.useState(null);       // entrada em edição (ou null)
  const [pending, setPending] = React.useState(null);   // pedido que espera o desbloqueio
  const [modal, setModal] = React.useState(null);       // 'settings' | 'forgot' | { remove: entry }
  const unlocked = !!(status && status.unlocked);

  const reload = React.useCallback(() => vault().list().then((l) => setEntries(l || []), () => setEntries([])), []);
  React.useEffect(() => { if (unlocked) reload(); else { setEntries([]); setDraft(null); } }, [unlocked, status && status.count]);
  React.useEffect(() => vault().onChanged(() => reload()), []);

  React.useEffect(() => { if (request) setPending(request); }, [request && request.nonce]);
  React.useEffect(() => {
    if (!pending || !unlocked) return;
    if (pending.create) startNew('db', pending.create);
    else if (pending.id) { setSel(pending.id); setDraft(null); }
    setPending(null);
  }, [pending, unlocked]);

  const startNew = (kind = 'db', name = '') => setDraft({ ...blankEntry(kind), name, tags: '' });
  const current = entries.find((e) => e.id === sel) || null;

  // Ctrl+N: nova entrada (com um rascunho aberto, não descarta o que está sendo editado).
  React.useEffect(() => {
    if (!unlocked) return undefined;
    const h = (e) => {
      if (!isMod(e) || e.shiftKey || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      setDraft((d) => d || { ...blankEntry('db'), tags: '' });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [unlocked]);

  const shown = React.useMemo(() => {
    const q = norm(query);
    if (!q) return entries;
    return entries.filter((e) => norm([e.name, kindOf(e.kind).label, e.tags.join(' '), summary(e)].join(' ')).includes(q));
  }, [entries, query]);

  const copy = async (id, what) => {
    try { toast('Copiado', await copyFromVault(id, what)); } catch (e) { toast('Não foi possível copiar', cleanError(e), 'error'); }
  };
  const copyRef = async (name) => {
    await window.devkit.clipboard.write(secretBlock(name));
    toast('Referência copiada', 'Cole numa nota: ela mostra o cartão com os campos escondidos');
  };

  if (!status) return <div className="vlt-screen"><PageHeader icon="vault" title="Vault" /><div className="vlt-center"><Spinner size={18} /></div></div>;

  const subtitle = unlocked
    ? `${entries.length} ${entries.length === 1 ? 'entrada' : 'entradas'} · bloqueia após ${status.autoLockMin} min sem uso · cópias somem em ${status.clearSeconds} s`
    : status.exists ? 'Bloqueado' : 'Cofre local para senhas, tokens e credenciais de banco';

  return (
    <div className="vlt-screen">
      <PageHeader icon="vault" title="Vault" subtitle={subtitle} actions={unlocked && (<>
        <Button variant="primary" icon="plus" kbd={mod('N')} onClick={() => startNew()}>Nova entrada</Button>
        <IconButton icon="settings" label="Configurações do cofre" onClick={() => setModal('settings')} />
        <Button variant="secondary" icon="lock" onClick={() => vault().lock()}>Bloquear</Button>
      </>)} />

      {!unlocked ? (
        <div className="vlt-center">
          <div className="vlt-lockcard">
            <span className="vlt-lockcard__icon"><Icon name={status.exists ? 'lock-keyhole' : 'vault'} size={22} /></span>
            <div className="vlt-lockcard__title">{status.exists ? 'Cofre bloqueado' : 'Criar o cofre'}</div>
            <div className="vlt-lockcard__desc">
              {status.exists
                ? 'Digite a senha mestra para ver e copiar as entradas.'
                : 'Tudo fica criptografado (AES-256) neste computador, fora da pasta das notas. Nas notas, um bloco ```secret nome``` mostra os campos escondidos com botão de copiar.'}
            </div>
            <UnlockForm status={status} onForgot={() => setModal('forgot')} />
          </div>
        </div>
      ) : (
        <div className="vlt">
          <aside className="vlt__side">
            <Input size="sm" type="search" placeholder="Buscar no cofre…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="vlt-list tk-scroll" role="listbox" aria-label="Entradas do cofre">
              {shown.map((e) => (
                <div key={e.id} role="option" aria-selected={e.id === sel && !draft}
                  className={'vlt-row' + (e.id === sel && !draft ? ' is-sel' : '')}
                  onClick={() => { setSel(e.id); setDraft(null); }}>
                  <span className="vlt-row__icon"><Icon name={kindOf(e.kind).icon} size={15} /></span>
                  <span className="vlt-row__main">
                    <span className="vlt-row__name">{e.name}</span>
                    <span className="vlt-row__sub">{summary(e) || kindOf(e.kind).label}</span>
                  </span>
                  {e.tags.length > 0 && <span className="vlt-row__tags">{e.tags.slice(0, 2).map((t) => '#' + t).join(' ')}</span>}
                </div>
              ))}
              {!shown.length && <div className="vlt-list__msg">{entries.length ? 'Nada encontrado.' : 'O cofre está vazio.'}</div>}
            </div>
          </aside>
          <main className="vlt__main tk-scroll">
            {draft ? (
              <EntryEditor key={draft.id || 'new'} draft={draft} onCancel={() => setDraft(null)} toast={toast}
                onSaved={(saved) => { setDraft(null); setSel(saved.id); reload(); }} />
            ) : current ? (
              <EntryView key={current.id} entry={current} onCopy={copy} onCopyRef={copyRef}
                onEdit={() => setDraft({ ...current, tags: current.tags.join(', '), fields: current.fields.map((f, i) => ({ ...f, from: i })) })}
                onRemove={() => setModal({ remove: current })} toast={toast} />
            ) : (
              <EmptyState animate="none" title={entries.length ? 'Selecione uma entrada' : 'Nenhuma entrada ainda'}
                description={entries.length ? 'Ou busque pelo nome, tipo ou tag. Na palette, digite o nome e Enter copia a senha.' : 'Comece pela credencial que você mais digita — um banco, um login, um token.'}
                action={!entries.length && <Button variant="primary" icon="plus" onClick={() => startNew()}>Nova entrada</Button>} />
            )}
          </main>
        </div>
      )}

      {modal === 'settings' && <SettingsModal status={status} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'forgot' && <ForgotModal onClose={() => setModal(null)} toast={toast} />}
      {modal && modal.remove && (
        <Modal open onClose={() => setModal(null)} icon="trash-2" title={`Excluir “${modal.remove.name}”?`} width={440}
          description="A entrada sai do cofre de vez. Notas que a referenciam passam a mostrar “não existe no cofre”."
          footer={<>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant="destructive" icon="trash-2" onClick={async () => {
              try { await vault().remove(modal.remove.id); setSel(null); setModal(null); toast('Entrada excluída', modal.remove.name); } catch (e) { toast('Não foi possível excluir', cleanError(e), 'error'); }
            }}>Excluir</Button>
          </>} />
      )}
    </div>
  );
}

/** Detalhe de uma entrada: campos com copiar; segredos mascarados com "mostrar" sob clique. */
function EntryView({ entry, onCopy, onCopyRef, onEdit, onRemove, toast }) {
  const [shownSecrets, setShownSecrets] = React.useState({}); // índice → valor revelado
  const toggle = async (i) => {
    if (shownSecrets[i] !== undefined) { setShownSecrets((s) => { const n = { ...s }; delete n[i]; return n; }); return; }
    try { const v = await vault().reveal(entry.id, i); setShownSecrets((s) => ({ ...s, [i]: v })); } catch (e) { toast('Não foi possível mostrar', cleanError(e), 'error'); }
  };
  const k = kindOf(entry.kind);
  return (
    <div className="vlt-view">
      <div className="vlt-view__head">
        <span className="vlt-view__icon"><Icon name={k.icon} size={18} /></span>
        <div className="vlt-view__titles">
          <div className="vlt-view__name">{entry.name}</div>
          <div className="vlt-view__meta">
            <Badge size="sm">{k.label}</Badge>
            {entry.tags.map((t) => <span key={t} className="vlt-tag">#{t}</span>)}
          </div>
        </div>
        <div className="vlt-view__actions">
          <Button size="sm" variant="secondary" icon="pencil" onClick={onEdit}>Editar</Button>
          <IconButton size="sm" icon="trash-2" label="Excluir" onClick={onRemove} />
        </div>
      </div>

      <div className="vlt-fields">
        {entry.fields.map((f, i) => (
          <div key={i} className="vlt-field">
            <span className="vlt-field__name">{f.name}{f.secret && <Icon name="lock" size={11} />}</span>
            <span className={'vlt-field__value' + (f.secret && shownSecrets[i] === undefined ? ' is-masked' : '')}>
              {f.secret ? (shownSecrets[i] !== undefined ? shownSecrets[i] || '—' : f.set ? MASK : '—') : f.value || '—'}
            </span>
            <span className="vlt-field__actions">
              {f.secret && f.set && <IconButton size="sm" icon={shownSecrets[i] !== undefined ? 'eye-off' : 'eye'} label={shownSecrets[i] !== undefined ? 'Esconder' : 'Mostrar'} onClick={() => toggle(i)} />}
              <IconButton size="sm" icon="copy" label="Copiar" disabled={f.secret ? !f.set : !f.value} onClick={() => onCopy(entry.id, i)} />
            </span>
          </div>
        ))}
      </div>

      <div className="vlt-view__extra">
        {isDbLike(entry) && <>
          <Button size="sm" variant="secondary" icon="plug" onClick={() => onCopy(entry.id, 'connstr')}>Connection string</Button>
          <Button size="sm" variant="secondary" icon="coffee" onClick={() => onCopy(entry.id, 'jdbc')}>URL JDBC</Button>
        </>}
        <Button size="sm" variant="ghost" icon="notebook-pen" onClick={() => onCopyRef(entry.name)}>Copiar referência para nota</Button>
      </div>

      {entry.notes && <div className="vlt-view__notes">{entry.notes}</div>}
      <div className="vlt-view__stamp">Atualizada em {new Date(entry.updated).toLocaleString('pt-BR')}</div>
    </div>
  );
}

/** Editor: campos livres (nome, valor, secreto), gerador de senha; segredo não tocado não sai do processo principal. */
function EntryEditor({ draft: initial, onCancel, onSaved, toast }) {
  const [d, setD] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const isNew = !initial.id;
  const formRef = React.useRef(null);
  React.useEffect(() => { requestAnimationFrame(() => { const el = formRef.current && formRef.current.querySelector('input'); if (el) el.focus(); }); }, []);

  const set = (patch) => { setD((x) => ({ ...x, ...patch })); setError(null); };
  const setField = (i, patch) => set({ fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const changeKind = (kind) => {
    // Só em entrada nova: troca o modelo de campos mantendo o que já foi digitado nos de mesmo nome.
    const tpl = blankEntry(kind).fields.map((f) => { const old = d.fields.find((o) => o.name === f.name); return old && old.value ? { ...f, value: old.value } : f; });
    set({ kind, fields: tpl });
  };
  const reveal = async (i) => {
    const f = d.fields[i];
    if (f.value !== null) { setField(i, { show: !f.show }); return; }
    try { setField(i, { value: await vault().reveal(initial.id, f.from), show: true }); } catch (e) { setError(cleanError(e)); }
  };

  const save = async (e) => {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const saved = await vault().save({
        id: d.id, name: d.name, kind: d.kind, notes: d.notes,
        tags: String(d.tags || '').split(/[,\s]+/).filter(Boolean),
        fields: d.fields.map(({ name, value, secret, from }) => ({ name, value, secret, from })),
      });
      toast(isNew ? 'Entrada criada' : 'Entrada salva', saved.name);
      onSaved(saved);
    } catch (err) { setError(cleanError(err)); } finally { setBusy(false); }
  };

  return (
    <form ref={formRef} className="vlt-edit" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      <div className="vlt-edit__title">{isNew ? 'Nova entrada' : 'Editar entrada'}</div>
      <div className="vlt-edit__row">
        <Field label="Nome" hint="Único. É como as notas e a palette encontram a entrada.">
          <Input value={d.name} placeholder="ex.: RM Produção" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Tipo">
          {isNew
            ? <Select options={KIND_OPTIONS} value={d.kind} onChange={changeKind} style={{ width: 180 }} />
            : <Badge>{kindOf(d.kind).label}</Badge>}
        </Field>
      </div>

      <div className="vlt-edit__fields">
        <div className="vlt-edit__label">Campos</div>
        {d.fields.map((f, i) => {
          const untouched = f.secret && f.value === null;
          return (
            <div key={i} className="vlt-edit__field">
              <Input size="sm" className="vlt-edit__fname" value={f.name} aria-label="Nome do campo" onChange={(e) => setField(i, { name: e.target.value })} />
              <Input size="sm" mono className="vlt-edit__fvalue" aria-label={'Valor de ' + f.name}
                type={f.secret && !f.show ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                value={untouched ? '' : f.value}
                placeholder={untouched ? (f.set ? 'inalterada — digite para trocar' : 'vazia') : ''}
                onChange={(e) => setField(i, { value: e.target.value })} />
              {f.secret && <IconButton size="sm" icon={f.show ? 'eye-off' : 'eye'} label={f.show ? 'Esconder' : 'Mostrar'} disabled={untouched && !f.set}
                onClick={() => reveal(i)} />}
              {f.secret && <IconButton size="sm" icon="dices" label="Gerar senha forte (20 caracteres)" onClick={() => setField(i, { value: generatePassword(), show: true })} />}
              <IconButton size="sm" icon={f.secret ? 'lock' : 'lock-open'} active={f.secret} label={f.secret ? 'Secreto (clique para tornar visível)' : 'Visível (clique para tornar secreto)'}
                onClick={() => setField(i, { secret: !f.secret })} disabled={untouched} />
              <IconButton size="sm" icon="x" label="Remover campo" onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })} />
            </div>
          );
        })}
        <div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ fields: [...d.fields, { name: '', value: '', secret: false }] })}>Campo</Button>
          <Button size="sm" variant="ghost" icon="lock" onClick={() => set({ fields: [...d.fields, { name: '', value: '', secret: true }] })}>Campo secreto</Button>
        </div>
      </div>

      <Field label="Tags" hint="Separadas por vírgula ou espaço — entram na busca">
        <Input value={d.tags} placeholder="rm, producao" onChange={(e) => set({ tags: e.target.value })} />
      </Field>
      <Field label="Observações" hint="Criptografadas junto com o resto, mas aparecem sem máscara — não guarde segredos aqui">
        <Textarea rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      {error && <div className="vlt-unlock__error" role="alert">{error}</div>}
      <div className="vlt-edit__actions">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" icon="check" loading={busy} disabled={!d.name.trim()}>Salvar</Button>
      </div>
    </form>
  );
}

/** Tempo de auto-lock, limpeza do clipboard, trocar senha e exportar backup. */
function SettingsModal({ status, onClose, toast }) {
  const [cur, setCur] = React.useState('');
  const [next, setNext] = React.useState('');
  const [next2, setNext2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const setting = (patch) => vault().setSettings(patch).catch((e) => toast('Não foi possível salvar', cleanError(e), 'error'));

  const changePw = async (e) => {
    e.preventDefault();
    setError(null);
    if (next !== next2) { setError('As senhas novas não conferem'); return; }
    setBusy(true);
    try {
      await vault().changePassword(cur, next);
      setCur(''); setNext(''); setNext2('');
      toast('Senha mestra trocada', 'O cofre foi criptografado de novo com a senha nova');
    } catch (err) { setError(cleanError(err)); } finally { setBusy(false); }
  };
  const exportBackup = async () => {
    try { const r = await vault().exportBackup(); if (r) toast('Backup exportado', r.name + ' — continua criptografado com a senha mestra'); } catch (e) { toast('Não foi possível exportar', cleanError(e), 'error'); }
  };

  return (
    <Modal open onClose={onClose} icon="settings" title="Configurações do cofre" width={520}
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="vlt-settings">
        <div className="set-row">
          <div><div className="set-row__label">Bloquear automaticamente</div><div className="set-row__hint">Depois desse tempo sem usar o cofre. Também bloqueia ao travar a tela ou suspender o PC.</div></div>
          <Select size="sm" options={status.autoLockOptions.map((m) => ({ value: m, label: m + ' min' }))} value={status.autoLockMin} onChange={(v) => setting({ autoLockMin: v })} style={{ width: 110 }} />
        </div>
        <div className="set-row">
          <div><div className="set-row__label">Apagar do clipboard após</div><div className="set-row__hint">Só se o que estiver lá ainda for o que o cofre copiou</div></div>
          <Select size="sm" options={status.clearOptions.map((s) => ({ value: s, label: s + ' s' }))} value={status.clearSeconds} onChange={(v) => setting({ clearSeconds: v })} style={{ width: 110 }} />
        </div>
        <div className="set-row">
          <div><div className="set-row__label">Backup</div><div className="set-row__hint">Cópia do arquivo do cofre, ainda criptografada — só abre com a senha mestra</div></div>
          <Button size="sm" variant="secondary" icon="download" onClick={exportBackup}>Exportar</Button>
        </div>
        <form className="vlt-settings__pw" onSubmit={changePw}>
          <div className="set-row__label">Trocar a senha mestra</div>
          <Input size="sm" type="password" placeholder="Senha atual" value={cur} autoComplete="off" onChange={(e) => { setCur(e.target.value); setError(null); }} />
          <Input size="sm" type="password" placeholder="Nova senha (mín. 8)" value={next} autoComplete="off" onChange={(e) => { setNext(e.target.value); setError(null); }} />
          <Input size="sm" type="password" placeholder="Confirme a nova senha" value={next2} autoComplete="off" onChange={(e) => { setNext2(e.target.value); setError(null); }} />
          {error && <div className="vlt-unlock__error" role="alert">{error}</div>}
          <div><Button size="sm" type="submit" variant="primary" icon="key-round" loading={busy} disabled={!cur || !next || !next2}>Trocar senha</Button></div>
        </form>
        <div className="vlt-settings__file">Arquivo: <code>{status.file}</code></div>
      </div>
    </Modal>
  );
}

/** Esqueci a senha: o arquivo atual vai para vault-<data>.bak.json (ainda criptografado) e começa outro cofre. */
function ForgotModal({ onClose, toast }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    setBusy(true);
    try { await vault().reset(text); toast('Cofre guardado de lado', 'Crie um cofre novo. O antigo continua no arquivo .bak.json, se você lembrar a senha.'); onClose(); } catch (e) { toast('Não foi possível', cleanError(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} icon="triangle-alert" title="Esqueceu a senha mestra?" width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="destructive" loading={busy} disabled={text !== 'APAGAR'} onClick={go}>Começar um cofre novo</Button>
      </>}>
      <Alert variant="warn" title="Não dá para recuperar o conteúdo sem a senha">
        O arquivo atual é renomeado para <code>vault-&lt;data&gt;.bak.json</code> na mesma pasta (continua criptografado) e você cria um cofre vazio.
      </Alert>
      <Field label="Digite APAGAR para confirmar">
        <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
    </Modal>
  );
}
