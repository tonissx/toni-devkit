import { renderInline } from '../../notes/markdown.js';

/** Texto de uma tarefa com o markdown em linha formatado (negrito, itálico, código, riscado). */
export function TaskText({ text }) {
  const html = React.useMemo(() => renderInline(text), [text]);
  if (!text) return '(sem texto)';
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
