import { access, constants, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error(`Invalid manifest version: ${manifest.version}`);

const candidateDir = path.join(root, 'outputs', `route-lens-${manifest.version}`);
const generated = {
  extension: path.join(candidateDir, 'extension'),
  zip: path.join(candidateDir, `route-lens-${manifest.version}.zip`),
  source: path.join(candidateDir, 'source'),
  sourceZip: path.join(candidateDir, `route-lens-${manifest.version}-source.zip`)
};
const replace = process.argv.includes('--replace');

await mkdir(candidateDir, { recursive: true });
const existing = [];
for (const [name, target] of Object.entries(generated)) {
  try { await access(target, constants.F_OK); existing.push(name); } catch {}
}
if (existing.length && !replace) {
  throw new Error(`Candidate artifacts already exist (${existing.join(', ')}). Review outputs/${path.basename(candidateDir)} before rerunning; use --replace only to replace these generated paths.`);
}
if (replace) {
  for (const target of Object.values(generated)) await rm(target, { recursive: true, force: true });
}

await cp(path.join(root, 'extension'), generated.extension, { recursive: true });
const sourceItems = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => !['.git', 'dist', 'node_modules', 'outputs', '.DS_Store'].includes(entry.name));
await mkdir(generated.source, { recursive: true });
for (const entry of sourceItems) {
  await cp(path.join(root, entry.name), path.join(generated.source, entry.name), { recursive: true });
}

function zipDirectory(directory, archive) {
  const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: directory, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`zip failed for ${archive}: ${result.stderr || result.status}`);
}

zipDirectory(generated.extension, generated.zip);
zipDirectory(generated.source, generated.sourceZip);

const installGuide = [
  `# Route Lens ${manifest.version} candidate`,
  '',
  '- `extension/` is the unpacked extension directory for local review.',
  `- route-lens-${manifest.version}.zip contains extension files with the manifest at archive root; unzip it before using “Load unpacked”.`,
  `- source/ and route-lens-${manifest.version}-source.zip contain the local project sources and tests.`,
  '- `previews/` contains screenshots from the local mock-browser run using the real popup and content bridge.',
  '',
  'Local persistent folder: `~/Library/Application Support/Google/Chrome/Local Extensions/Route Lens`. Copy `extension/` there, then open Chrome Extensions, enable Developer mode, choose “Load unpacked”, and select that folder. Copying does not automatically enable the extension.',
  '',
  'This candidate has not been loaded into Chrome or published.',
  '',
  'Maintainer: xxkingstuggle.'
].join('\n') + '\n';
await writeFile(path.join(candidateDir, 'INSTALL.md'), installGuide);

console.log(`Extension folder: ${generated.extension}`);
console.log(`Extension archive: ${generated.zip}`);
console.log(`Source folder: ${generated.source}`);
console.log(`Source archive: ${generated.sourceZip}`);
