// Gera as imagens e GIFs do README com dados fictícios.
// Uso: node scripts/docs-capture/capture.mjs [pasta-de-trabalho] [pasta-de-saída]
//   (padrões: .capture-tmp e docs/img). Precisa de `npm run build` feito e do ffmpeg no PATH.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, connect, pageTarget, sleep } from './cdp.mjs';
import { VAULT_PASSWORD } from './config.mjs';

const repo = path.resolve('.');
const work = path.resolve(process.argv[2] || '.capture-tmp');
const out = path.resolve(process.argv[3] || 'docs/img');
await fs.mkdir(out, { recursive: true });

// 1) dados fictícios, sempre do zero
const seedOut = execFileSync('node', [path.join(repo, 'scripts/docs-capture/seed.mjs'), path.join(work, 'data')], { encoding: 'utf8' });
const data = JSON.parse(seedOut.trim().split('\n').pop());

const app = await launch({ userData: data.userData, notes: data.notes, root: repo });
const main = await connect((await pageTarget(app.port, /index\.html/)).webSocketDebuggerUrl);
const pal = await connect((await pageTarget(app.port, /palette\.html/)).webSocketDebuggerUrl);
await main.send('Page.enable');
await pal.send('Page.enable');
await sleep(2500);

/* ─────────────── utilidades ─────────────── */
const png = (name) => path.join(out, name + '.png');
const still = (name) => main.shot(png(name), fs);

/** Clica no menor elemento visível cujo texto (1ª linha) é `text`. */
async function clickText(text, { within = 'body', nth = 0, dx = 0, dy = 0, prefix = false } = {}) {
  const pos = await main.eval(`(() => {
    const root = document.querySelector(${JSON.stringify(within)}) || document.body;
    const want = ${JSON.stringify(text)};
    const ok = (t) => ${prefix} ? t.startsWith(want) : t === want;
    const hits = [...root.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const t = (el.innerText || '').trim().split('\\n')[0].trim();
      return ok(t) && ![...el.children].some((c) => ok((c.innerText || '').trim().split('\\n')[0].trim()));
    });
    const el = hits[${nth}];
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!pos) throw new Error('não achei: ' + text);
  await main.click(pos.x + dx, pos.y + dy);
}

const nav = async (k) => { await main.key(k, { ctrl: true }); await sleep(900); };

/** Frames de GIF: guarda PNG numerado + duração; `gif(nome)` monta com o ffmpeg. */
function recorder(dir) {
  const frames = [];
  return {
    async add(shooter, seconds = 1) {
      await fs.mkdir(dir, { recursive: true });
      const f = path.join(dir, String(frames.length).padStart(3, '0') + '.png');
      await shooter(f);
      frames.push({ f, seconds });
    },
    async gif(name, width = 900) {
      const list = frames.map((x) => `file '${x.f.replace(/\\/g, '/')}'\nduration ${x.seconds}`).join('\n') + `\nfile '${frames.at(-1).f.replace(/\\/g, '/')}'\n`;
      const listFile = path.join(dir, 'list.txt');
      await fs.writeFile(listFile, list);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-vf', `fps=12,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0', path.join(out, name + '.gif')]);
    },
  };
}

/** A janela da palette é transparente: captura com fundo transparente e compõe sobre uma captura da janela principal. */
async function palShot(file) {
  await pal.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await pal.shot(file, fs);
}
async function composite(backFile, palFile, outFile, y = 120) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', backFile, '-i', palFile,
    '-filter_complex', `[0:v]eq=brightness=-0.12:saturation=0.85[b];[b][1:v]overlay=(W-w)/2:${y}`, outFile]);
}

/* ─────────────── 1) Palette: GIF + still ─────────────── */
{
  await main.key('1', { ctrl: true });
  await nav('1');
  await main.eval('document.querySelector("body").focus()');
  const rec = recorder(path.join(work, 'frames-palette'));
  const back = path.join(work, 'back.png');
  await still('_tmp'); await fs.rename(png('_tmp'), back);
  const step = async (seconds, label) => {
    await sleep(500);
    const p = path.join(work, `pal-${label}.png`);
    await palShot(p);
    await rec.add((f) => composite(back, p, f), seconds);
    return p;
  };
  await main.key('k', { ctrl: true }); await sleep(700);
  await step(1.4, 'a');
  await pal.type('dep'); await step(0.9, 'b');
  await pal.type('loy'); await step(1.6, 'c');
  const full = path.join(work, 'pal-c.png');
  await composite(back, full, png('palette-search'));
  await pal.key('Escape'); await sleep(400);
  // alias + Tab: o chip fixa e o que vem depois vira o {q}
  await main.key('k', { ctrl: true }); await sleep(700);
  await pal.type('ticket'); await step(1.0, 'd');
  await pal.key('Tab'); await step(1.0, 'e');
  await pal.type('4821'); await step(1.8, 'f');
  await pal.key('Escape'); await sleep(300);
  await rec.gif('palette', 860);
}

/* ─────────────── 2) JSON como grafo ─────────────── */
{
  await nav('6');
  const doc = JSON.stringify({
    pedido: 10482,
    status: 'pago',
    cliente: { id: 42, nome: 'Ana Souza', cidade: 'Campinas' },
    itens: [
      { sku: 'TEC-001', nome: 'Teclado mecânico', qtd: 1, preco: 349.9 },
      { sku: 'MOU-014', nome: 'Mouse sem fio', qtd: 2, preco: 129 },
      { sku: 'CAB-USB', nome: 'Cabo USB-C', qtd: 3, preco: 29.9 },
    ],
    pagamento: { metodo: 'pix', parcelas: 1, confirmado: true },
    entrega: { transportadora: 'Rápido Log', prazoDias: 4, rastreio: null },
  }, null, 2);
  await main.eval('document.querySelector("textarea.tk-code__input").focus()');
  await main.key('a', { ctrl: true });
  await main.send('Input.insertText', { text: doc });
  await sleep(700);
  await main.key('\\', { ctrl: true }); await sleep(600);
  await main.eval('document.querySelector("button[aria-label=Enquadrar]").click()');
  await sleep(900);
  await still('json-graph');
  await main.key('\\', { ctrl: true }); await sleep(400);
}

/* ─────────────── 3) Notes (editor lado a lado) ─────────────── */
{
  await nav('4');
  await sleep(600);
  await clickText('Índices no PostgreSQL', { prefix: true });
  await sleep(900);
  await main.key('e', { ctrl: true }); // Editar → Lado a lado
  await sleep(1400);
  await still('notes');
  await clickText('Grafo').catch((e) => console.log(e.message));
  await sleep(2500);
  await still('notes-graph');
}

/* ─────────────── 4) Vault ─────────────── */
{
  await nav('7');
  await sleep(600);
  await main.type(VAULT_PASSWORD);
  await main.key('Enter');
  await sleep(2500);
  await clickText('Banco de homologação (demo)');
  await sleep(900);
  await still('vault');
}

/* ─────────────── 5) DevCore ─────────────── */
{
  await nav('5');
  await sleep(3500);
  await still('devcore');
}

/* ─────────────── 6) Git: GIF ─────────────── */
{
  await nav('8');
  await sleep(1200);
  await clickText('loja-api');
  await sleep(1500);
  const rec = recorder(path.join(work, 'frames-git'));
  const shot = (f) => main.shot(f, fs);
  await rec.add(shot, 2.2);                 // visão geral
  await clickText('Mudanças', { within: 'main' }).catch(() => clickText('Mudanças'));
  await sleep(1200); await rec.add(shot, 2.2);
  await clickText('Histórico'); await sleep(1500); await rec.add(shot, 2.6);
  await clickText('Branches'); await sleep(1200); await rec.add(shot, 2.2);
  await clickText('Reorganizar'); await sleep(1500);
  await clickText('Últimos 5'); await sleep(500);
  await clickText('Últimos 3'); await sleep(700);
  await sleep(1200); await rec.add(shot, 2.8);
  await rec.gif('git-graph', 900);
}

main.close(); pal.close();
app.stop();
console.log('ok →', out);
