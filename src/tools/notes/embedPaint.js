// Desenha o resultado de um ![[Diagrama]] dentro do marcador `.md-embed` que o renderer de markdown deixou no preview.
// Só APIs do DOM (createElement/textContent), nunca innerHTML: o nome e a legenda vêm do texto da nota.

const painted = new WeakMap(); // marcador → url já desenhada (evita recriar a <img> à toa)

const chip = (text, title) => {
  const c = document.createElement('span');
  c.className = 'md-embed__chip';
  c.textContent = text;
  if (title) c.title = title;
  return c;
};

/**
 * r: { url } miniatura pronta · { empty } diagrama em branco · { error } falha ao desenhar ·
 *    { state: 'missing' } a nota sumiu · { state: 'notdiagram' } o alvo existe mas não é um diagrama.
 * Estados: is-ready (imagem; clicável) · is-bad (alvo inválido: etiqueta inerte, não abre nada).
 */
export function paintEmbed(span, r) {
  const name = span.dataset.embed || '';
  const caption = span.dataset.caption || '';
  span.classList.remove('is-ready', 'is-bad', 'is-empty', 'is-error');
  if (r.url) {
    if (painted.get(span) !== r.url) {
      painted.set(span, r.url);
      const img = document.createElement('img');
      img.className = 'md-embed__img';
      img.src = r.url; // data: URL: o SVG roda isolado
      img.alt = caption || name;
      img.draggable = false;
      const nodes = [img];
      if (caption) {
        const c = document.createElement('span');
        c.className = 'md-embed__caption';
        c.textContent = caption;
        nodes.push(c);
      }
      span.replaceChildren(...nodes);
    }
    span.classList.add('is-ready');
    span.title = 'Abrir em Diagramas';
    return;
  }
  painted.delete(span);
  if (r.state === 'missing') { span.classList.add('is-bad'); span.title = 'Diagrama não encontrado'; span.replaceChildren(chip(`Diagrama não encontrado: ${name}`)); return; }
  if (r.state === 'notdiagram') { span.classList.add('is-bad'); span.title = 'Só diagramas podem ser embutidos'; span.replaceChildren(chip(`“${name}” não é um diagrama`)); return; }
  if (r.empty) { span.classList.add('is-empty'); span.title = 'Abrir em Diagramas'; span.replaceChildren(chip(`Diagrama em branco: ${caption || name}`)); return; }
  span.classList.add('is-error');
  span.title = r.error || 'Não foi possível mostrar o diagrama';
  span.replaceChildren(chip(`Não foi possível mostrar “${name}”`));
}
