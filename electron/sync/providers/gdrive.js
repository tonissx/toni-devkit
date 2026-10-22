'use strict';
/**
 * Provedor do Google Drive para o motor de sync (engine.js). Usa só a API REST e a pasta privada do app
 * (`appDataFolder`, escopo `drive.appdata`): o usuário não vê esses arquivos no site do Drive e o app não
 * enxerga nada além deles. A pasta é plana — o nome de cada arquivo é o caminho relativo da nota
 * ("Trabalho/Fluig/x.md", ".assets/img.png").
 *
 * `getToken(forceRefresh)` devolve o access token (renovando quando preciso). Em 401 renova e tenta uma vez;
 * 429/5xx são tentados de novo com espera crescente. `fetchImpl` e `sleep` são injetáveis para os testes.
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,md5Checksum,modifiedTime';
const SMALL_MAX = 4 * 1024 * 1024; // acima disso o envio é "resumable"
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const TRIES = 4;

const enc = encodeURIComponent;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function errorOf(res) {
  let msg = '';
  try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch { /* corpo não é JSON */ }
  const e = new Error(`Google Drive: ${msg || res.statusText || 'erro'} (${res.status})`);
  e.status = res.status;
  return e;
}

function createGDriveProvider({ getToken, fetchImpl = fetch, sleep = defaultSleep }) {
  /** Requisição autenticada com renovação de token (401) e novas tentativas (429/5xx). */
  async function request(method, url, { headers = {}, body } = {}) {
    let refreshed = false, force = false;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(force);
      force = false;
      let res;
      try { res = await fetchImpl(url, { method, headers: { ...headers, Authorization: 'Bearer ' + token }, body }); } catch (e) {
        if (attempt >= TRIES - 1) throw new Error('Sem conexão com o Google Drive: ' + String((e && e.message) || e));
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 && !refreshed) { refreshed = true; force = true; attempt--; continue; }
      if (RETRY_STATUS.has(res.status) && attempt < TRIES - 1) { await sleep(500 * 2 ** attempt); continue; }
      return res;
    }
  }
  const json = async (res) => { if (!res.ok) throw await errorOf(res); return res.json(); };
  const info = (f) => ({ ref: f.id, hash: f.md5Checksum, modified: Date.parse(f.modifiedTime) });

  return {
    /** Map(nome → { ref, hash (md5), modified (ms) }). Nome repetido (duas PCs criaram ao mesmo tempo): fica o mais novo e o resto é apagado. */
    async list() {
      const byName = new Map();
      const extras = [];
      let pageToken = '';
      do {
        const url = `${API}/files?spaces=appDataFolder&pageSize=1000&q=${enc('trashed=false')}&fields=${enc('nextPageToken,files(id,name,md5Checksum,modifiedTime)')}${pageToken ? '&pageToken=' + enc(pageToken) : ''}`;
        const page = await json(await request('GET', url));
        for (const f of page.files || []) {
          const cur = byName.get(f.name);
          if (!cur) { byName.set(f.name, f); continue; }
          if (Date.parse(f.modifiedTime) > Date.parse(cur.modifiedTime)) { extras.push(cur); byName.set(f.name, f); } else extras.push(f);
        }
        pageToken = page.nextPageToken || '';
      } while (pageToken);
      for (const f of extras) request('DELETE', `${API}/files/${enc(f.id)}`).catch(() => {}); // limpeza, sem esperar
      return new Map([...byName].map(([name, f]) => [name, info(f)]));
    },

    async get(_key, ref) {
      const res = await request('GET', `${API}/files/${enc(ref)}?alt=media`);
      if (!res.ok) throw await errorOf(res);
      return Buffer.from(await res.arrayBuffer());
    },

    /** Cria (sem `ref`) ou atualiza o arquivo. Devolve { ref, hash, modified }. */
    async put(key, bytes, ref) {
      const meta = ref ? {} : { name: key, parents: ['appDataFolder'] };
      if (bytes.length > SMALL_MAX) {
        const start = await request(ref ? 'PATCH' : 'POST', `${UPLOAD}/files${ref ? '/' + enc(ref) : ''}?uploadType=resumable&fields=${FIELDS}`, {
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream' }, body: JSON.stringify(meta),
        });
        if (!start.ok) throw await errorOf(start);
        const session = start.headers.get('location');
        if (!session) throw new Error('Google Drive: sessão de envio sem endereço');
        const done = await request('PUT', session, { headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
        return info(await json(done));
      }
      if (ref) {
        const res = await request('PATCH', `${UPLOAD}/files/${enc(ref)}?uploadType=media&fields=${FIELDS}`, { headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
        return info(await json(res));
      }
      const boundary = 'devkit' + Math.random().toString(16).slice(2);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await request('POST', `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      return info(await json(res));
    },

    async del(_key, ref) {
      const res = await request('DELETE', `${API}/files/${enc(ref)}`);
      if (!res.ok && res.status !== 404) throw await errorOf(res);
    },
  };
}

module.exports = { createGDriveProvider };
