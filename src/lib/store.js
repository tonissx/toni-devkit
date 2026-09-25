// Preferências locais (localStorage do Electron persiste no perfil do app).
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem('tk.' + key);
    return raw == null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try { localStorage.setItem('tk.' + key, JSON.stringify(value)); } catch { /* ignore */ }
}
/** useState persistido. */
export function usePersisted(key, fallback) {
  const [v, setV] = React.useState(() => load(key, fallback));
  React.useEffect(() => save(key, v), [key, v]);
  return [v, setV];
}
