import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Invalid manifest version');
const dist = join(root, 'dist');
const archive = join(dist, `route-lens-${manifest.version}.zip`);
await mkdir(dist, { recursive: true });
const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: join(root, 'extension'), stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(archive);
