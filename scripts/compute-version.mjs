// Calcula a versão do próximo release: node scripts/compute-version.mjs
// Lê major.minor do package.json local, usa GITHUB_RUN_NUMBER como candidato a patch,
// e nunca deixa a versão regredir em relação à última tag publicada no GitHub.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(tag) {
  const m = SEMVER.exec(String(tag ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Maior versão entre uma lista de tags (ignora tags que não parseiam como semver). */
export function latestOf(tags) {
  let best = null;
  for (const t of tags) {
    const v = parseSemver(t);
    if (!v) continue;
    if (!best || v.major > best.major || (v.major === best.major && v.minor > best.minor) ||
        (v.major === best.major && v.minor === best.minor && v.patch > best.patch)) {
      best = v;
    }
  }
  return best;
}

/**
 * Decide a versão do próximo release sem nunca regredir em relação à última publicada.
 * @param {{pkgMajor:number, pkgMinor:number, runNumber:number, latest:{major,minor,patch}|null}} input
 * @returns {{major:number, minor:number, patch:number, warning:string|null}}
 */
export function decideVersion({ pkgMajor, pkgMinor, runNumber, latest }) {
  if (!latest) return { major: pkgMajor, minor: pkgMinor, patch: runNumber, warning: null };

  const pkgIsNewer = pkgMajor > latest.major || (pkgMajor === latest.major && pkgMinor > latest.minor);
  if (pkgIsNewer) return { major: pkgMajor, minor: pkgMinor, patch: runNumber, warning: null };

  const pkgIsSame = pkgMajor === latest.major && pkgMinor === latest.minor;
  if (pkgIsSame) {
    return { major: pkgMajor, minor: pkgMinor, patch: Math.max(runNumber, latest.patch + 1), warning: null };
  }

  // pkgMajor.pkgMinor é menor que o da última release publicada — não regride.
  return {
    major: latest.major,
    minor: latest.minor,
    patch: latest.patch + 1,
    warning: `package.json (${pkgMajor}.${pkgMinor}.x) está atrás da última release publicada ` +
      `(${latest.major}.${latest.minor}.${latest.patch}) — ignorando major.minor do package.json.`,
  };
}

async function fetchAllTags(owner, repo, token) {
  const tags = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'toni-devkit-release', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    tags.push(...batch.map((t) => t.name));
    if (batch.length < 100) break;
    page++;
  }
  return tags;
}

async function main() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const [pkgMajor, pkgMinor] = pkg.version.split('.').map(Number);
  const runNumber = Number(process.env.GITHUB_RUN_NUMBER || 0);
  const owner = process.env.RELEASE_OWNER || 'tonissx';
  const repo = process.env.RELEASE_REPO || 'toni-devkit';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN (ou GITHUB_TOKEN) não definido — necessário para listar as tags existentes.');

  const tags = await fetchAllTags(owner, repo, token);
  const latest = latestOf(tags);
  const { major, minor, patch, warning } = decideVersion({ pkgMajor, pkgMinor, runNumber, latest });
  if (warning) console.error(`::warning::${warning}`);
  console.log(`version=${major}.${minor}.${patch}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
