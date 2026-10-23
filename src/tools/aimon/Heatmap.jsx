// Monitor de IA — mapa de calor da aba Uso: tokens por dia da semana × hora (hora local). A contagem por hora começou junto
// com este mapa (electron/aimon/usage.js → heat), então ele enche daqui para frente; o histórico anterior não tem hora.
import { fmtCompact } from '../../lib/fmt.jsx';

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const LONG = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 0 = vazio; 1…4 por faixa do maior valor (menos de 1/4, até 1/2, até 3/4, o resto). */
const level = (v, max) => (v > 0 && max > 0 ? Math.min(4, Math.ceil((v / max) * 4)) : 0);

export function Heatmap({ heat }) {
  if (!heat || !heat.total) {
    return <div className="lg-muted lg-pad">O mapa começa a encher a partir de agora: o histórico anterior não tem a hora de cada consumo. Use o Claude Code com o Monitor ativo e volte aqui.</div>;
  }
  return (
    <div className="am-heat">
      <div className="am-heat__grid" role="img" aria-label={`Consumo de tokens por dia da semana e hora. Pico: ${heat.peak ? LONG[heat.peak.dow] + ', ' + heat.peak.hour + 'h' : 'nenhum'}`}>
        <span />
        {HOURS.map((h) => <span key={h} className="am-heat__h">{h % 3 === 0 ? h : ''}</span>)}
        {heat.grid.map((row, dow) => (
          <React.Fragment key={dow}>
            <span className="am-heat__d">{DAYS[dow]}</span>
            {row.map((v, h) => (
              <i key={h} className={'am-heat__c is-l' + level(v, heat.max)} title={`${LONG[dow]}, ${String(h).padStart(2, '0')}h — ${v ? fmtCompact(v) + ' tok' : 'sem consumo'}`} />
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="am-heat__foot">
        {heat.peak && <span className="lg-muted">Pico: <b>{LONG[heat.peak.dow]}, {String(heat.peak.hour).padStart(2, '0')}h</b> · {fmtCompact(heat.max)} tok</span>}
        <span className="am-heat__legend lg-muted" aria-hidden="true">menos {[0, 1, 2, 3, 4].map((l) => <i key={l} className={'am-heat__c is-l' + l} />)} mais</span>
      </div>
    </div>
  );
}
