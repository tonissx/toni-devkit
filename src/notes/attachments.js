// Anexos das Notes (arquivos em .assets\): classificação por extensão, compartilhada entre o processo
// principal (confirmação ao abrir executáveis, Content-Type do protocolo) e o renderer (pré-visualização).

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const AUDIO_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac' };
const VIDEO_EXT = { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4' };
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'jsonc', 'csv', 'tsv', 'xml', 'html', 'htm', 'svg', 'yml', 'yaml', 'ini', 'cfg', 'conf',
  'toml', 'sql', 'mjs', 'ts', 'jsx', 'tsx', 'css', 'java', 'cs', 'py', 'sh', 'ftl', 'xsd', 'wsdl', 'properties',
]);

// Extensões que o Windows executa ao abrir: o clique no anexo pede confirmação antes (main.js) e elas nunca
// são pré-visualizadas como texto.
const EXECUTABLE_EXT = new Set(['exe', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'scr', 'pif', 'lnk', 'url', 'reg', 'hta', 'jar', 'cpl', 'dll']);

/** Extensão em minúsculas, sem o ponto ('' se não tiver). */
function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function isExecutableAsset(name) { return EXECUTABLE_EXT.has(extOf(name)); }

/** 'exec' | 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'other' — como a pré-visualização trata o arquivo. */
function previewKind(name) {
  const ext = extOf(name);
  if (EXECUTABLE_EXT.has(ext)) return 'exec';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (AUDIO_EXT[ext]) return 'audio';
  if (VIDEO_EXT[ext]) return 'video';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'other';
}

/** Content-Type de pdf/áudio/vídeo (o net.fetch de file:// não dá um para todos); '' = deixa o padrão. */
function mimeFor(name) {
  const ext = extOf(name);
  if (ext === 'pdf') return 'application/pdf';
  return AUDIO_EXT[ext] || VIDEO_EXT[ext] || '';
}

/** 1536 → '1,5 KB'. */
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace('.', ',')} ${units[i]}`;
}

const TEXT_PREVIEW_MAX = 512 * 1024;

module.exports = { extOf, isExecutableAsset, previewKind, mimeFor, formatSize, TEXT_PREVIEW_MAX, EXECUTABLE_EXT };
