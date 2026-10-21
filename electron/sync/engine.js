'use strict';
/**
 * Motor de sincronização das Notes com um armazenamento remoto (hoje o Google Drive), sem servidor nosso.
 * Não conhece o provedor: recebe um objeto com `list / get / put / del` (ver providers/gdrive.js).
 *
 * Três vias: compara o que há no disco (local), o que há no provedor (remoto) e o que as duas pontas tinham
 * na última sincronização (base: chave → hash). Cada chave é um caminho relativo à pasta das notas:
 * `.md` (inclusive os da Lixeira, `.trash/…`), `.folder.json` e os anexos de `.assets/`.
 * `.devkit` (histórico, links) e pastas vazias não sincronizam.
 *
 * Regras (L = local, R = remoto, B = base):
 *   L = R                       → nada a fazer (só anota na base)
 *   só L mudou / só R mudou     → sobe / baixa (ausente em um lado = exclusão, propagada para o outro)
 *   os dois mudaram             → .md: a versão local fica na nota e a remota vira um arquivo de conflito ao
 *                                 lado (o serviço de notas a transforma em "… (conflito)"); nada é perdido.
 *                                 Outros arquivos: o mais recente vence. Excluído de um lado e editado do
 *                                 outro: a edição vence (o arquivo volta).
 *   sem base e só de um lado    → cópia nova
 * Trava de segurança: mais exclusões que o limite numa rodada (ex.: o remoto veio vazio por engano) aborta tudo.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('../lib/fsx.js');

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const ASSET_RE = /^[\w-][\w.-]*$/;
const MD_RE = /\.md$/i;
const META = '.folder.json';
const CONCURRENCY = 4;
const DELETE_GUARD = { min: 5, ratio: 0.3 };

/** O caminho relativo (com "/") é uma chave que sincronizamos? Também valida o que vem do remoto: nada de "..", "C:" ou "\". */
function validKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.includes(':') || key.startsWith('/')) return false;
  const parts = key.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.endsWith('.tmp'))) return false;
  const name = parts[parts.length - 1];
  if (parts[0] === '.assets') return parts.length === 2 && ASSET_RE.test(name);
  const dirs = parts.slice(0, -1);
  if (dirs.some((d, i) => d.startsWith('.') && !(i === 0 && d === '.trash'))) return false; // .devkit, .git… não
  if (name.startsWith('.') && name !== META) return false;
  return MD_RE.test(name) || name === META;
}

/** Percorre a pasta das notas e devolve Map(chave → { hash, mtimeMs, size }); reaproveita o hash se mtime e tamanho não mudaram. */
async function scan(root, prev = {}) {
  const out = new Map();
  const walk = async (rel) => {
    let entries;
    try { entries = await fs.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async (e) => {
      if (e.isSymbolicLink()) return;
      const key = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') && !(e.name === '.trash' && !rel) && !(e.name === '.assets' && !rel)) return;
        if (rel === '.assets') return; // anexos: um nível só
        await walk(key);
        return;
      }
      if (!e.isFile() || !validKey(key)) return;
      try {
        const file = path.join(root, ...key.split('/'));
        const st = await fs.stat(file);
        const old = prev[key];
        const hash = old && old.mtimeMs === st.mtimeMs && old.size === st.size ? old.hash : md5(await fs.readFile(file));
        out.set(key, { hash, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* sumiu no meio da varredura: a próxima rodada vê */ }
    }));
  };
  await walk('');
  return out;
}

/**
 * Decide o que fazer com cada chave. local/remote: Map(chave → { hash, … }); base: objeto chave → { hash }.
 * Devolve [{ type: 'upload' | 'download' | 'delLocal' | 'delRemote' | 'conflict' | 'adopt' | 'forget', key }].
 */
function plan(local, remote, base) {
  const actions = [];
  const keys = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)]);
  for (const key of keys) {
    const l = local.get(key), r = remote.get(key), b = base[key];
    const lh = l && l.hash, rh = r && r.hash, bh = b && b.hash;
    const add = (type) => actions.push({ type, key });
    if (lh === rh) { if (lh) { if (bh !== lh) add('adopt'); } else if (b) add('forget'); continue; }
    if (!b) { if (l && !r) add('upload'); else if (!l && r) add('download'); else add('conflict'); continue; }
    const lc = lh !== bh, rc = rh !== bh;
    if (!lc && rc) add(r ? 'download' : 'delLocal');
    else if (lc && !rc) add(l ? 'upload' : 'delRemote');
    else if (!l) add('download');
    else if (!r) add('upload');
    else add('conflict');
  }
  return actions;
}

const stampOf = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Executa `jobs` (funções async) com no máximo CONCURRENCY ao mesmo tempo. */
async function pool(jobs) {
  let i = 0;
  const worker = async () => { while (i < jobs.length) await jobs[i++](); };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
}

class GuardError extends Error {}

/**
 * Uma rodada de sincronização.
 *   dir        pasta das notas
 *   provider   { list(), get(key, ref), put(key, bytes, ref), del(key, ref) }
 *   state      { base: { chave: { hash, mtimeMs, size } } } — mutado e devolvido; o chamador grava em disco
 *   exclusive  (fn) => Promise — roda fn sem gravações concorrentes do app (service.exclusive)
 *   force      ignora a trava de exclusões em massa
 * Devolve { uploaded, downloaded, deletedLocal, deletedRemote, conflicts, errors: [{ key, error }], changedLocal }.
 */
async function sync({ dir, provider, state, exclusive = (fn) => fn(), force = false, now = () => new Date() }) {
  const base = state.base || (state.base = {});
  const remote = await provider.list(); // Map(chave → { hash, ref, modified })
  for (const k of [...remote.keys()]) if (!validKey(k)) remote.delete(k); // ignora o que não é nota/anexo (ou é suspeito)
  const local = await scan(dir, base);
  const actions = plan(local, remote, base);

  const res = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, errors: [], changedLocal: false };
  const limit = Math.max(DELETE_GUARD.min, Math.ceil(Object.keys(base).length * DELETE_GUARD.ratio));
  const dl = actions.filter((a) => a.type === 'delLocal').length, dr = actions.filter((a) => a.type === 'delRemote').length;
  if (!force && (dl > limit || dr > limit)) {
    throw new GuardError(`A sincronização apagaria ${Math.max(dl, dr)} arquivos de ${dl > limit ? 'este computador' : 'o Drive'} de uma vez — parece um engano. Nada foi alterado.`);
  }

  const fileOf = (key) => path.join(dir, ...key.split('/'));
  const remember = async (key) => {
    const st = await fs.stat(fileOf(key));
    base[key] = { hash: md5(await fs.readFile(fileOf(key))), mtimeMs: st.mtimeMs, size: st.size };
  };
  /** Grava `bytes` em `key` só se o arquivo local ainda é o que o plano viu (`expect` = hash, ou undefined = não existia). */
  const writeLocal = (key, bytes, expect) => exclusive(async () => {
    const cur = await fs.readFile(fileOf(key)).then(md5, () => undefined);
    if (cur !== expect) return false; // o app mexeu enquanto baixava: fica para a próxima rodada
    await atomicWrite(fileOf(key), bytes);
    res.changedLocal = true;
    return true;
  });
  const upload = async (key) => {
    const bytes = await fs.readFile(fileOf(key));
    const st = await fs.stat(fileOf(key));
    const r = remote.get(key);
    await provider.put(key, bytes, r && r.ref);
    base[key] = { hash: md5(bytes), mtimeMs: st.mtimeMs, size: st.size };
    res.uploaded++;
  };
  const download = async (key) => {
    const r = remote.get(key), l = local.get(key);
    const bytes = await provider.get(key, r.ref);
    if (r.hash && md5(bytes) !== r.hash) throw new Error('arquivo baixado não confere com o do Drive (tente de novo)');
    if (!(await writeLocal(key, bytes, l && l.hash))) return;
    await remember(key);
    res.downloaded++;
  };

  const jobs = actions.map((a) => async () => {
    const { key } = a;
    try {
      switch (a.type) {
        case 'adopt': { const l = local.get(key); base[key] = { hash: l.hash, mtimeMs: l.mtimeMs, size: l.size }; break; }
        case 'forget': delete base[key]; break;
        case 'upload': await upload(key); break;
        case 'download': await download(key); break;
        case 'delRemote': await provider.del(key, remote.get(key).ref); delete base[key]; res.deletedRemote++; break;
        case 'delLocal':
          if (await exclusive(async () => {
            const cur = await fs.readFile(fileOf(key)).then(md5, () => undefined);
            if (cur !== local.get(key).hash) return false; // editada nesse meio-tempo: fica
            await fs.rm(fileOf(key), { force: true });
            res.changedLocal = true;
            return true;
          })) { delete base[key]; res.deletedLocal++; }
          break;
        case 'conflict': {
          const l = local.get(key), r = remote.get(key);
          if (!MD_RE.test(key)) { // configuração de pasta etc.: o mais recente vence
            if (r.modified > l.mtimeMs) await download(key); else await upload(key);
            break;
          }
          const copy = key.replace(MD_RE, ` (conflito de sync ${stampOf(now())}).md`);
          const bytes = await provider.get(key, r.ref);
          if (await writeLocal(copy, bytes, undefined)) { res.changedLocal = true; res.conflicts++; }
          await upload(key); // a versão local segue como a nota; a remota está guardada na cópia
          break;
        }
        default: break;
      }
    } catch (e) { res.errors.push({ key, error: String((e && e.message) || e) }); }
  });
  await pool(jobs);
  return res;
}

module.exports = { sync, plan, scan, validKey, md5, GuardError };
