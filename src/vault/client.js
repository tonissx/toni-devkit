// Lado do renderer do Vault: hooks que acompanham o estado do cofre (processo principal → 'vault:changed').
import { cleanError } from '../notes/client.js';

const api = () => window.devkit.vault;

/** Status do cofre ({ exists, unlocked, count, … }), atualizado a cada mudança. */
export function useVaultStatus() {
  const [status, setStatus] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => api().status().then((s) => { if (alive) setStatus(s); }, () => {});
    load();
    const off = api().onChanged(load);
    return () => { alive = false; off(); };
  }, []);
  return status;
}

/** Notas: metadados das entradas referenciadas por ```secret <nome>``` (null enquanto carrega). */
export function useVaultRefs(names) {
  const key = names.join('\u0000');
  const [refs, setRefs] = React.useState(null);
  React.useEffect(() => {
    if (!names.length) { setRefs(null); return undefined; }
    let alive = true;
    const load = () => api().resolve(names).then((r) => { if (alive) setRefs(r); }, () => {});
    load();
    const off = api().onChanged(load);
    return () => { alive = false; off(); };
  }, [key]);
  return names.length ? refs : null;
}

/** Senha aleatória forte (sem caracteres ambíguos), para o botão "Gerar". */
export function generatePassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@_';
  const out = [];
  const buf = new Uint32Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const n of buf) {
      // Rejeição: evita viés do módulo.
      if (n < Math.floor(0x100000000 / chars.length) * chars.length) out.push(chars[n % chars.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Copia um campo pelo processo principal (clipboard protegido, apaga sozinho) → mensagem para o usuário. */
export async function copyFromVault(id, what) {
  const r = await api().copy(id, what);
  return `${r.label} de “${r.name}” copiado — some do clipboard em ${r.clearsIn} s`;
}

export { cleanError };
