// Entrada do bundle separado renderer/dist/mermaid.js (carregado sob demanda por src/diagrams/render.js).
// Expõe window.DevkitMermaid.render(source, themeVariables) → { svg } | { error }.
import mermaid from 'mermaid';

let seq = 0;

async function render(source, themeVariables) {
  // Reinicializa a cada render: o tema acompanha as variáveis --tk-* do momento.
  // htmlLabels: false → rótulos em <text> puro (sem <foreignObject>): o SVG exportado abre em qualquer ferramenta
  // e o PNG não "suja" o canvas.
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables, fontFamily: themeVariables.fontFamily,
    flowchart: { htmlLabels: false }, htmlLabels: false,
    // Com rótulos em <text>, o CSS do Mermaid pinta fundo e texto do rótulo da aresta com `nodeBorder` (escuro no nosso
    // tema) e o texto some. Aqui cada um recebe a sua cor. themeCSS entra no próprio SVG: vale também no arquivo exportado.
    themeCSS: `.edgeLabel .label rect.background { fill: ${themeVariables.background}; stroke: none; opacity: 0.9; } `
      + `.edgeLabel .label text { fill: ${themeVariables.textColor}; }`,
  });
  const id = `dgm-svg-${++seq}`;
  try {
    await mermaid.parse(source); // falha cedo e sem deixar nó de erro solto no DOM
    const { svg } = await mermaid.render(id, source);
    return { svg };
  } catch (e) {
    document.getElementById(`d${id}`)?.remove();
    return { error: String((e && e.message) || e).split('\n').slice(0, 4).join('\n') };
  }
}

window.DevkitMermaid = { render };
