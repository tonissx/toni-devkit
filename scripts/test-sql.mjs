// Teste rápido do motor: node scripts/test-sql.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../electron/sql/engine.js');

const sql = `select a.id, a.nome, count(*) as total from pfunc a inner join psecao s on s.codigo = a.codsecao and s.codcoligada = a.codcoligada where a.codcoligada = 1 and a.codsituacao <> 'D' group by a.id, a.nome having count(*) > 1 order by total desc; -- fim
insert into t (a,b) values (1,'x');`;

const t0 = Date.now();
await engine.init();
console.log('init ms', Date.now() - t0);
for (const opts of [{}, { keywordCase: 'upper', indent: 4 }, { keywordCase: 'lower', indent: 'tab', stripComments: true }, { compact: true, keywordCase: 'upper' }]) {
  const r = await engine.format(sql, opts);
  console.log('---', JSON.stringify(r.options), r.ms.toFixed(1) + 'ms', 'sqlparse', r.sqlparse);
  console.log(r.result);
}
