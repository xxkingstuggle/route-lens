import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extension = join(root, 'extension');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
const expectedHosts = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const sort = (values) => [...values].sort();

if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
if (JSON.stringify(sort(manifest.permissions ?? [])) !== JSON.stringify(['storage'])) {
  throw new Error(`Unexpected extension permissions: ${(manifest.permissions ?? []).join(', ')}`);
}
if (JSON.stringify(sort(manifest.host_permissions ?? [])) !== JSON.stringify(sort(expectedHosts))) {
  throw new Error(`Unexpected host permissions: ${(manifest.host_permissions ?? []).join(', ')}`);
}
const contentHosts = sort((manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []));
if (JSON.stringify(contentHosts) !== JSON.stringify(sort(expectedHosts.concat(expectedHosts)))) {
  throw new Error(`Unexpected content-script matches: ${contentHosts.join(', ')}`);
}

const jsonFiles = [
  join(extension, 'manifest.json'),
  ...await walk(extension, (name) => name.endsWith('.json'))
];
for (const file of new Set(jsonFiles)) JSON.parse(await readFile(file, 'utf8'));

const jsFiles = await walk(extension, (name) => name.endsWith('.js'));
for (const file of jsFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
const toolFiles = await walk(join(root, 'scripts'), (name) => name.endsWith('.mjs'));
for (const file of toolFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
for (const icon of Object.values(manifest.icons ?? {})) await access(join(extension, icon));
for (const icon of Object.values(manifest.action?.default_icon ?? {})) await access(join(extension, icon));

console.log(`Checked ${jsFiles.length} extension JavaScript files, ${toolFiles.length} tool scripts, ${new Set(jsonFiles).size} JSON files, ${Object.keys(manifest.icons ?? {}).length} icons; permissions unchanged.`);

async function walk(directory, predicate) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path, predicate));
    else if (predicate(entry.name)) result.push(path);
  }
  return result;
}
