// Notes no renderer: atalhos para a API do processo principal e o auto-save.
//
// Auto-save: cada alteração é salva com debounce e também na hora em que a janela perde o foco,
// fecha, troca de nota (desmontagem) ou o app vai sair (notes:flush). Enquanto uma alteração não
// foi confirmada pelo disco, uma cópia fica no localStorage — se a gravação falhar ou o app cair,
// nada se perde: recoverUnsaved() regrava na próxima abertura.

export const notesApi = () => window.devkit.notes;

export const cleanError = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const BACKUP_KEY = 'tk.notes.unsaved';
const readBackup = () => { try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch { return {}; } };
const writeBackups = (b) => { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(b)); } catch { /* cheio/indisponível */ } };
const backup = (note) => writeBackups({ ...readBackup(), [note.id]: note });
const dropBackup = (id) => { const b = readBackup(); if (b[id]) { delete b[id]; writeBackups(b); } };

/** Regrava alterações que ficaram só no backup local (queda do app, erro de disco). */
export async function recoverUnsaved() {
  const b = readBackup();
  let n = 0;
  for (const [id, note] of Object.entries(b)) {
    try { await notesApi().save(note); dropBackup(id); n++; } catch { /* continua no backup */ }
  }
  return n;
}

/**
 * Estado de uma nota em edição com auto-save.
 * Monte com key={note.id} para trocar de nota (a desmontagem grava o que estiver pendente).
 * status: 'idle' (nova, nada digitado) | 'dirty' | 'saving' | 'saved' | 'error'
 * flush() grava já o que estiver pendente e resolve true (gravado/nada a gravar) ou false (erro).
 */
export function useAutosave(initial, { isNew = false, delay = 400, onSaved } = {}) {
  const [note, setNote] = React.useState(initial);
  const [status, setStatus] = React.useState(isNew ? 'idle' : 'saved');
  const [error, setError] = React.useState(null);
  const r = React.useRef({ note: initial, dirty: false, timer: null, inflight: null, onSaved });
  r.current.onSaved = onSaved;

  const flush = React.useCallback(async () => {
    const s = r.current;
    clearTimeout(s.timer);
    s.timer = null;
    if (s.inflight) await s.inflight.catch(() => {}); // uma gravação por vez, em ordem
    if (!s.dirty) return true;
    s.dirty = false;
    const snapshot = s.note;
    setStatus('saving');
    s.inflight = notesApi().save(snapshot);
    try {
      const saved = await s.inflight;
      if (!s.dirty) { setStatus('saved'); dropBackup(snapshot.id); }
      setError(null);
      if (s.onSaved) s.onSaved(saved);
      return true;
    } catch (e) {
      s.dirty = true; // a próxima digitação (ou "Tentar de novo") grava de novo
      setStatus('error');
      setError(cleanError(e));
      return false;
    } finally {
      s.inflight = null;
    }
  }, []);

  const update = React.useCallback((patch) => {
    const s = r.current;
    s.note = { ...s.note, ...(typeof patch === 'function' ? patch(s.note) : patch) };
    s.dirty = true;
    backup(s.note);
    setNote(s.note);
    setStatus('dirty');
    clearTimeout(s.timer);
    s.timer = setTimeout(flush, delay);
  }, [flush, delay]);

  React.useEffect(() => {
    const now = () => { flush(); };
    window.addEventListener('blur', now);
    window.addEventListener('beforeunload', now);
    const off = notesApi().onFlush(now);
    return () => {
      window.removeEventListener('blur', now);
      window.removeEventListener('beforeunload', now);
      off();
      flush(); // desmontou (trocou de nota / fechou a Quick Note)
    };
  }, [flush]);

  return { note, update, status, error, flush };
}

/** Texto discreto do indicador de auto-save. */
export const statusLabel = (status) => ({ idle: '', dirty: 'Editando…', saving: 'Salvando…', saved: 'Salvo', error: 'Não salvo' }[status] || '');

/** "14:21" hoje, "ontem 14:21", senão "26/09 14:21". */
export function shortTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return hm;
  if (d.toDateString() === y.toDateString()) return 'ontem ' + hm;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}
