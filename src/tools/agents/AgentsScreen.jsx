// Agentes — monte e gerencie subagentes do Claude Code sem editar arquivo na mão. Cada agente é um .md em ~/.claude/agents
// (formato nativo da ferramenta: funciona também no terminal). Cada um declara o que pode fazer; a tela mostra isso em palavras.
import { DS } from '../../lib/ds.js';
import { errText } from '../../lib/fmt.jsx';
import { MODELS, PRESETS, TEMPLATES, TOOL_CHOICES, describePermissions, draftOf, permissions, presetOf, sameDraft, toolsForPreset } from './agentForm.js';

const { PageHeader, Button, Input, Field, Textarea, Select, SegmentedControl, Modal, EmptyState, Badge, Icon, Spinner, Alert, Checkbox } = DS;

const api = () => window.devkit.agents;
const TONE_VARIANT = { ok: 'ok', warn: 'warn', danger: 'error' };
const TONE_ICON = { ok: 'shield-check', warn: 'shield-alert', danger: 'shield-alert' };

function PermBadge({ perms }) {
  const d = describePermissions(perms);
  return <Badge size="sm" variant={TONE_VARIANT[d.tone]} title={d.text}>{d.title}</Badge>;
}

export function AgentsScreen({ toast }) {
  const [rows, setRows] = React.useState(null);
  const [dir, setDir] = React.useState('');
  const [sel, setSel] = React.useState(null);      // nome salvo em edição, ou null
  const [saved, setSaved] = React.useState(null);  // versão em disco do agente aberto (null = novo)
  const [draft, setDraft] = React.useState(null);  // o que está no formulário
  const [busy, setBusy] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [raw, setRaw] = React.useState(null);      // arquivo inválido aberto como texto cru: { id, text, orig, rev, error }

  const fail = (title) => (e) => toast(title, errText(e), 'error');
  const reload = React.useCallback(() => api().list().then(setRows, fail('Não foi possível listar os agentes')), []);
  React.useEffect(() => { reload(); api().dir().then(setDir, () => {}); }, []);
  // A lista reflete o disco: relê ao voltar para a janela (arquivos criados, editados ou apagados fora do devkit).
  React.useEffect(() => {
    const on = () => { if (document.visibilityState !== 'hidden') reload(); };
    window.addEventListener('focus', on); document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('focus', on); document.removeEventListener('visibilitychange', on); };
  }, [reload]);

  const rawDirty = !!raw && raw.text !== raw.orig;
  const dirty = rawDirty || (!!draft && (!saved || !sameDraft(draft, saved)));
  const guard = () => !dirty || window.confirm('Há alterações não salvas neste agente. Descartar?');

  const open = (row) => {
    const name = row.name;
    if (name === sel && (saved || raw)) return;
    if (!guard()) return;
    if (row.invalid) {
      api().rawGet(row.id).then((r) => { setSel(name); setSaved(null); setDraft(null); setRaw({ ...r, orig: r.text }); }, fail('Não foi possível abrir o arquivo'));
      return;
    }
    api().get(name).then((a) => { setSel(name); setRaw(null); setSaved(a); setDraft(draftOf(a)); }, fail('Não foi possível abrir o agente'));
  };
  const startNew = (tpl = TEMPLATES[0]) => {
    if (!guard()) return;
    setSel(null); setSaved(null); setRaw(null); setDraft(draftOf(tpl.agent));
  };
  const saveRaw = async (force) => {
    setBusy(true);
    try {
      const r = await api().rawSave(raw.id, raw.text, { rev: raw.rev, force });
      if (r && r.conflict) { if (window.confirm('Este arquivo mudou no disco desde que você o abriu. Sobrescrever com o seu texto?')) return saveRaw(true); return; }
      toast('Arquivo salvo', raw.id + '.md', 'ok');
      setSel(null); setRaw(null); reload();
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };
  const removeRaw = () => api().remove(raw.id).then(() => { toast('Arquivo excluído', raw.id + '.md'); setConfirmDel(false); setSel(null); setRaw(null); reload(); }, fail('Não foi possível excluir'));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (force) => {
    setBusy(true);
    try {
      const a = await api().save(draft, saved ? saved.name : null, { rev: saved ? saved.rev : '', force: force === true });
      if (a && a.conflict) {
        if (window.confirm('Este agente mudou no disco desde que você o abriu (edição fora do devkit). Sobrescrever com a sua versão?')) return save(true);
        return;
      }
      setSel(a.name); setSaved(a); setDraft(draftOf(a));
      toast('Agente salvo', a.name + '.md', 'ok');
      reload();
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };
  const duplicate = () => api().duplicate(saved.name).then((a) => { toast('Agente duplicado', a.name, 'ok'); setSel(a.name); setSaved(a); setDraft(draftOf(a)); reload(); }, fail('Não foi possível duplicar'));
  const remove = () => api().remove(saved.name).then(() => { toast('Agente excluído', saved.name); setConfirmDel(false); setSel(null); setSaved(null); setDraft(null); reload(); }, fail('Não foi possível excluir'));
  const launch = () => api().launch(saved.name).then((r) => { if (r && r.launched) toast('Terminal aberto', `claude --agent ${saved.name} em ${r.cwd}`, 'ok'); }, fail('Não foi possível abrir o agente'));

  const invalidCount = (rows || []).filter((a) => a.invalid).length;
  const list = (rows || []).filter((a) => !filter.trim() || (a.name + ' ' + a.description).toLowerCase().includes(filter.trim().toLowerCase()));
  const perms = draft ? permissions(draft.tools) : null;
  const pd = describePermissions(perms);
  const preset = draft ? presetOf(draft.tools) : 'all';
  const extraLines = draft && draft.extra ? draft.extra.split('\n').filter(Boolean).length : 0;

  return (
    <div className="ag">
      <PageHeader icon="sparkles" title="Agentes" subtitle={rows ? `${rows.length - invalidCount} agente(s)${invalidCount ? ` + ${invalidCount} arquivo(s) inválido(s)` : ''} em ${dir || '~/.claude/agents'}` : 'Carregando…'}
        actions={<Button variant="primary" icon="plus" onClick={() => startNew()}>Novo agente</Button>} />
      {!rows ? <div className="ag-center"><Spinner size={18} /></div> : (
        <div className="ag-body">
          <aside className="ag-side">
            <div className="ag-side__search"><Input size="sm" type="search" placeholder="Buscar agente…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
            <div className="ag-list">
              {list.map((a) => (
                <button key={a.name} type="button" className={'ag-card' + (a.name === sel ? ' is-sel' : '')} onClick={() => open(a)}>
                  <span className="ag-card__top"><b>{a.name}</b>{a.invalid ? <Badge size="sm" variant="error" title={a.error}>inválido</Badge> : <PermBadge perms={a.permissions} />}</span>
                  <span className="ag-card__desc">{a.invalid ? a.error : (a.description || 'Sem descrição')}</span>
                  {a.model && <span className="ag-card__meta"><Icon name="cpu" size={11} /> {a.model}</span>}
                </button>
              ))}
              {!list.length && <p className="ag-muted ag-pad">{rows.length ? 'Nenhum agente com esse texto.' : 'Nenhum agente ainda.'}</p>}
            </div>
          </aside>
          <main className="ag-main">
            {raw ? (
              <div className="ag-form">
                <Alert variant="error" title={`${raw.id}.md não é um agente válido`} icon="shield-alert">{raw.error || 'Corrigido? Salve para o agente voltar à lista.'}</Alert>
                <Field label="Texto do arquivo" hint="Frontmatter entre linhas “---” (name e description obrigatórios), depois o prompt.">
                  <Textarea rows={22} className="ag-prompt" value={raw.text} onChange={(e) => setRaw((r) => ({ ...r, text: e.target.value }))} />
                </Field>
                <div className="ag-actions">
                  <Button variant="primary" icon="save" disabled={busy || !rawDirty} onClick={() => saveRaw(false)}>{busy ? 'Salvando…' : 'Salvar arquivo'}</Button>
                  <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDel(true)}>Excluir</Button>
                  {rawDirty && <span className="ag-muted">Alterações não salvas</span>}
                </div>
              </div>
            ) : !draft ? (
              <div className="ag-start">
                <EmptyState icon="sparkles" title="Monte um agente" description="Um agente é um especialista com prompt, ferramentas e regras próprias. Comece por um modelo ou em branco." />
                <div className="ag-tpls">
                  {TEMPLATES.map((t) => <button key={t.id} type="button" className="ag-tpl" onClick={() => startNew(t)}><Icon name={t.icon} size={16} /><span>{t.label}</span></button>)}
                </div>
              </div>
            ) : (
              <div className="ag-form">
                {!saved && (
                  <div className="ag-tpls is-inline">
                    <span className="ag-muted">Começar de:</span>
                    {TEMPLATES.map((t) => <button key={t.id} type="button" className="ag-tpl is-sm" onClick={() => setDraft(draftOf(t.agent))}><Icon name={t.icon} size={13} /><span>{t.label}</span></button>)}
                  </div>
                )}
                <div className="ag-row">
                  <Field label="Nome" hint="Minúsculas, números e hífens. É o nome do arquivo.">
                    <Input value={draft.name} placeholder="ex.: revisor-fluig" onChange={(e) => set({ name: e.target.value })} />
                  </Field>
                  <Field label="Modelo">
                    <Select options={MODELS.some((m) => m.value === draft.model) ? MODELS : [...MODELS, { value: draft.model, label: draft.model }]} value={draft.model} style={{ width: 190 }}
                      onChange={(v) => set({ model: v })} />
                  </Field>
                </div>
                <Field label="Quando usar" hint="O Claude escolhe chamar o agente com base nesta frase. Seja específico.">
                  <Textarea rows={2} value={draft.description} placeholder="ex.: Revisa datasets do Fluig antes do deploy" onChange={(e) => set({ description: e.target.value })} />
                </Field>

                <Field label="O que ele pode fazer">
                  <SegmentedControl size="sm" options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} value={preset} onChange={(v) => set({ tools: toolsForPreset(v, draft.tools) })} />
                </Field>
                {draft.tools && (
                  <div className="ag-tools">
                    {TOOL_CHOICES.map((t) => (
                      <Checkbox key={t.name} label={`${t.name} — ${t.hint}`} checked={draft.tools.includes(t.name)}
                        onChange={(v) => { const on = typeof v === 'boolean' ? v : !draft.tools.includes(t.name); set({ tools: on ? [...draft.tools, t.name] : draft.tools.filter((x) => x !== t.name) }); }} />
                    ))}
                  </div>
                )}
                <Alert variant={TONE_VARIANT[pd.tone]} title={pd.title} icon={TONE_ICON[pd.tone]}>{pd.text}</Alert>

                <Field label="Prompt" hint="As instruções do agente. Pode citar skills, regras e o jeito de responder.">
                  <Textarea rows={14} className="ag-prompt" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                </Field>
                {extraLines > 0 && <p className="ag-muted"><Icon name="info" size={12} /> {extraLines} linha(s) extras do arquivo (como cor ou skills) são preservadas ao salvar.</p>}

                <div className="ag-actions">
                  <Button variant="primary" icon="save" disabled={busy || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</Button>
                  {saved && <>
                    <Button variant="secondary" icon="terminal" disabled={dirty} title={dirty ? 'Salve antes de chamar' : 'Abre um terminal numa pasta que você escolhe, já com este agente'} onClick={launch}>Chamar no terminal</Button>
                    <Button variant="ghost" icon="copy" onClick={duplicate}>Duplicar</Button>
                    <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDel(true)}>Excluir</Button>
                  </>}
                  {dirty && <span className="ag-muted">Alterações não salvas</span>}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
      {confirmDel && (saved || raw) && (
        <Modal open onClose={() => setConfirmDel(false)} icon="trash-2" title={`Excluir “${(saved || raw).name || raw.id}”?`} width={440}
          description={`O arquivo ${saved ? saved.name : raw.id}.md sai de ${dir || '~/.claude/agents'}. Não há como desfazer.`}
          footer={<><Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancelar</Button><Button variant="destructive" icon="trash-2" onClick={saved ? remove : removeRaw}>Excluir</Button></>} />
      )}
    </div>
  );
}
