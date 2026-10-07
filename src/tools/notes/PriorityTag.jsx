import { DS } from '../../lib/ds.js';
import { priorityInfo } from '../../notes/priority.js';

const { Icon } = DS;

/** Etiqueta de prioridade (bandeira + rótulo). Sem prioridade cadastrada, mostra a etiqueta padrão, discreta. */
export function PriorityTag({ priority }) {
  const p = priorityInfo(priority);
  return (
    <span className={'nts-pill nts-pri is-p' + p.level} title={p.title}>
      <Icon name="flag" size={11} /> {p.label}
    </span>
  );
}
