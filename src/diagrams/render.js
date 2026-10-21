// Renderiza Mermaid → SVG. O Mermaid é pesado e só a ferramenta Diagramas usa, então o bundle
// (renderer/dist/mermaid.js) é injetado por <script> na primeira renderização, não no início do app.
import { readColors } from '../tools/json-visualizer/exportImage.js';
import { themeFromColors } from './theme.js';

let loading = null;

function loadMermaid() {
  if (window.DevkitMermaid) return Promise.resolve(window.DevkitMermaid);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'dist/mermaid.js';
      s.onload = () => (window.DevkitMermaid ? resolve(window.DevkitMermaid) : reject(new Error('Mermaid não inicializou')));
      s.onerror = () => reject(new Error('Não foi possível carregar o Mermaid'));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** { svg } | { error }. Renderizações são serializadas: o Mermaid usa estado global. */
let chain = Promise.resolve();
export function renderDiagram(source) {
  const job = chain.then(async () => {
    try {
      const m = await loadMermaid();
      // O body não define fonte; a do app vem de um contêiner interno — lê da própria tela de Diagramas.
      const font = getComputedStyle(document.querySelector('.dgm-screen') || document.body).fontFamily;
      return await m.render(String(source || ''), themeFromColors({ ...readColors(), font }));
    } catch (e) {
      return { error: e.message };
    }
  });
  chain = job.then(() => {}, () => {});
  return job;
}
