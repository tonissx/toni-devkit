// Carrega o Excalidraw sob demanda: o bundle (renderer/dist/excalidraw.js + .css, ~4,7 MB com React próprio) só vem
// do disco na primeira vez que um diagrama é aberto, não no início do app.
let loading = null;

/** Promise de window.DevkitExcalidraw (ver excalidraw-entry.jsx). */
export function loadExcalidraw() {
  if (window.DevkitExcalidraw) return Promise.resolve(window.DevkitExcalidraw);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      // Fontes locais (copiadas por scripts/build-renderer.mjs): sem isto o Excalidraw as pediria a um CDN.
      // Tem que existir ANTES do script, e ser absoluto (o pacote resolve as fontes com new URL).
      window.EXCALIDRAW_ASSET_PATH = new URL('vendor/excalidraw-assets/', document.baseURI).href;
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'dist/excalidraw.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'dist/excalidraw.js';
      s.onload = () => (window.DevkitExcalidraw ? resolve(window.DevkitExcalidraw) : reject(new Error('O Excalidraw não inicializou')));
      s.onerror = () => reject(new Error('Não foi possível carregar o Excalidraw'));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
