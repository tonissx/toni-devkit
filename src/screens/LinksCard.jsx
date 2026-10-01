import { DS } from '../lib/ds.js';
import { needsValue, shortUrl } from '../links/link.js';
import { cleanError } from '../notes/client.js';

const { Card, Button, IconButton, Input, Field, Badge } = DS;

const EMPTY = { alias: '', name: '', url: '', param: '' };

/**
 * Configurações → Links rápidos: alias → URL com {q} (ver src/links/link.js). Ficam em
 * Documentos\Devkit Notes\.devkit\links.json; na palette, alias + Tab fixa o chip e o texto vira o {q}.
 */
export function LinksCard({ toast }) {
  const [links, setLinks] = React.useState(null);
  const [edit, setEdit] = React.useState(null);   // { ...link } em edição (id null = novo)
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [test, setTest] = React.useState(null);   // { id, value } do "Testar"
  const api = window.devkit.links;

  const load = () => api.list().then(setLinks, () => setLinks([]));
  React.useEffect(() => { load(); return api.onChanged(load); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const l = await api.save(edit);
      setEdit(null);
      toast && toast('Link salvo', needsValue(l) ? `Na palette: “${l.alias}” + Tab` : `Na palette: “${l.alias}” + Enter`);
    } catch (err) { setError(cleanError(err)); } finally { setBusy(false); }
  };
  const remove = async (l) => {
    try { await api.remove(l.id); toast && toast('Link excluído', l.alias); } catch (err) { toast && toast('Não foi possível excluir', cleanError(err), 'error'); }
  };
  const open = async (l, value) => {
    try { await api.open(l.id, value); setTest(null); } catch (err) { toast && toast('Não foi possível abrir', cleanError(err), 'error'); }
  };

  const form = edit && (
    <form className="lnk-form" onSubmit={save}>
      <div className="lnk-form__row">
        <Field label="Alias"><Input size="sm" mono value={edit.alias} placeholder="solic" autoFocus onChange={(e) => { setEdit({ ...edit, alias: e.target.value }); setError(null); }} /></Field>
        <Field label="Nome"><Input size="sm" value={edit.name} placeholder="Solicitação do Fluig" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Rótulo do valor"><Input size="sm" value={edit.param} placeholder="Número da solicitação" onChange={(e) => setEdit({ ...edit, param: e.target.value })} /></Field>
      </div>
      <Field label="URL" hint="Use {q} onde entra a parte variável. Sem {q}, o link abre direto (favorito).">
        <Input size="sm" mono value={edit.url} placeholder="https://fluig.navship.com.br/portal/p/001/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID={q}"
          onChange={(e) => { setEdit({ ...edit, url: e.target.value }); setError(null); }} />
      </Field>
      {error && <div className="lnk-form__error" role="alert">{error}</div>}
      <div className="lnk-form__actions">
        <Button size="sm" variant="ghost" onClick={() => { setEdit(null); setError(null); }}>Cancelar</Button>
        <Button size="sm" type="submit" variant="primary" icon="check" loading={busy} disabled={!edit.alias.trim() || !edit.url.trim()}>Salvar</Button>
      </div>
    </form>
  );

  return (
    <Card padding={24}>
      <div className="lnk-head">
        <div className="tk-card__title">Links rápidos</div>
        {!edit && <Button size="sm" variant="secondary" icon="plus" onClick={() => setEdit({ ...EMPTY, id: null })}>Novo link</Button>}
      </div>
      <div className="set-row__hint lnk-help">
        Na palette, digite o alias e aperte <b>Tab</b>: ele vira um chip e o que você digitar depois entra no <code>{'{q}'}</code> da URL —
        Enter abre, Ctrl+Enter copia. Também dá para criar pela palette: <code>link: solic https://…{'{q}'} Solicitação</code>.
      </div>
      {edit && !edit.id && form}
      {links && links.length === 0 && !edit && <div className="lnk-empty">Nenhum link ainda.</div>}
      {links && links.map((l) => (edit && edit.id === l.id ? <div key={l.id}>{form}</div> : (
        <div key={l.id} className="lnk-row">
          <Badge size="sm" mono>{l.alias}</Badge>
          <div className="lnk-row__main">
            <div className="lnk-row__name">{l.name || (needsValue(l) ? 'Link com valor' : 'Favorito')}{l.param && <span className="lnk-row__param"> · {l.param}</span>}</div>
            <div className="lnk-row__url" title={l.url}>{shortUrl(l.url)}</div>
          </div>
          {test && test.id === l.id ? (
            <form className="lnk-test" onSubmit={(e) => { e.preventDefault(); open(l, test.value); }}>
              <Input size="sm" mono autoFocus value={test.value} placeholder={l.param || 'valor'} onChange={(e) => setTest({ id: l.id, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTest(null); } }} />
              <Button size="sm" type="submit" variant="primary" icon="external-link" disabled={!test.value.trim()}>Abrir</Button>
            </form>
          ) : (
            <Button size="sm" variant="ghost" icon="external-link" onClick={() => (needsValue(l) ? setTest({ id: l.id, value: '' }) : open(l, ''))}>Testar</Button>
          )}
          <IconButton size="sm" icon="pencil" label="Editar" onClick={() => { setEdit({ ...l }); setError(null); setTest(null); }} />
          <IconButton size="sm" icon="trash-2" label="Excluir" onClick={() => remove(l)} />
        </div>
      )))}
    </Card>
  );
}
