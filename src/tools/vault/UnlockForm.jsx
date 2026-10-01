import { DS } from '../../lib/ds.js';
import { cleanError } from '../../vault/client.js';

const { Button, Input, Field, Alert } = DS;
const MIN = 8;

/**
 * Criar o cofre (1ª vez) ou desbloqueá-lo com a senha mestra. Usado pela tela do Vault e pelo cartão
 * ```secret``` das notas. onDone() depois de abrir; onForgot() abre o "Esqueci a senha".
 */
export function UnlockForm({ status, onDone, onForgot, autoFocus = true }) {
  const creating = !status.exists;
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const formRef = React.useRef(null);
  // O Input do DS não repassa ref: foca o 1º campo pelo formulário.
  const focusFirst = () => requestAnimationFrame(() => { const el = formRef.current && formRef.current.querySelector('input'); if (el) el.focus(); });
  React.useEffect(() => { if (autoFocus) focusFirst(); }, []);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy) return;
    setError(null);
    if (creating) {
      if (pw.length < MIN) { setError(`Use pelo menos ${MIN} caracteres`); return; }
      if (pw !== pw2) { setError('As senhas não conferem'); return; }
    } else if (!pw) return;
    setBusy(true);
    try {
      await (creating ? window.devkit.vault.create(pw) : window.devkit.vault.unlock(pw));
      setPw(''); setPw2('');
      onDone && onDone();
    } catch (err) {
      setError(cleanError(err));
      setPw('');
      focusFirst();
    } finally { setBusy(false); }
  };

  if (status.broken) {
    return (
      <div className="vlt-unlock">
        <Alert variant="error" title="O arquivo do cofre está ilegível">{status.broken}</Alert>
        {onForgot && <Button variant="secondary" onClick={onForgot}>Guardar o arquivo de lado e começar outro</Button>}
      </div>
    );
  }

  return (
    <form ref={formRef} className="vlt-unlock" onSubmit={submit}>
      <Field label={creating ? 'Nova senha mestra' : 'Senha mestra'} hint={creating ? `Pelo menos ${MIN} caracteres. Uma frase longa é melhor que uma senha curta e complexa.` : undefined}>
        <Input type="password" icon="key-round" value={pw} autoComplete="off" spellCheck={false}
          onChange={(e) => { setPw(e.target.value); setError(null); }} invalid={!!error} disabled={busy} />
      </Field>
      {creating && (
        <Field label="Confirme a senha">
          <Input type="password" icon="key-round" value={pw2} autoComplete="off" spellCheck={false}
            onChange={(e) => { setPw2(e.target.value); setError(null); }} disabled={busy} />
        </Field>
      )}
      {error && <div className="vlt-unlock__error" role="alert">{error}</div>}
      {creating && (
        <Alert variant="warn" title="Não há como recuperar a senha mestra">
          Sem ela, o conteúdo do cofre fica ilegível — nem o Devkit consegue abrir. Guarde-a num lugar seguro.
        </Alert>
      )}
      <div className="vlt-unlock__actions">
        {!creating && onForgot && <button type="button" className="vlt-link" onClick={onForgot}>Esqueci a senha</button>}
        <Button type="submit" variant="primary" icon={creating ? 'shield-check' : 'lock-open'} loading={busy}
          disabled={creating ? !pw || !pw2 : !pw}>{creating ? 'Criar cofre' : 'Desbloquear'}</Button>
      </div>
    </form>
  );
}
