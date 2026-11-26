import { readdir, readFile, access } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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
const testFiles = await walk(join(root, 'tests'), (name) => name.endsWith('.test.mjs'));
for (const file of testFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
for (const icon of Object.values(manifest.icons ?? {})) await access(join(extension, icon));
for (const icon of Object.values(manifest.action?.default_icon ?? {})) await access(join(extension, icon));

const forbiddenSinks = [
  { name: 'innerHTML', pattern: /\.innerHTML\b/ },
  { name: 'outerHTML', pattern: /\.outerHTML\b/ },
  { name: 'insertAdjacentHTML', pattern: /\.insertAdjacentHTML\s*\(/ },
  { name: 'eval()', pattern: /\beval\s*\(/ },
  { name: 'new Function()', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'document.write()', pattern: /\bdocument\.write(?:ln)?\s*\(/ }
];
for (const file of jsFiles) {
  const source = await readFile(file, 'utf8');
  for (const sink of forbiddenSinks) {
    if (sink.pattern.test(source)) {
      throw new Error(`Forbidden sink "${sink.name}" found in ${relative(root, file)}`);
    }
  }
}

const localesDir = join(extension, '_locales');
const localeEntries = (await readdir(localesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
if (localeEntries.length < 10) {
  throw new Error(`Expected at least 10 locales under extension/_locales, found ${localeEntries.length}`);
}
for (const entry of localeEntries) {
  const messagesPath = join(localesDir, entry.name, 'messages.json');
  const messages = JSON.parse(await readFile(messagesPath, 'utf8'));
  for (const key of ['extensionName', 'extensionDescription']) {
    if (typeof messages?.[key]?.message !== 'string' || !messages[key].message.trim()) {
      throw new Error(`Locale "${entry.name}" missing non-empty "${key}.message"`);
    }
  }
}

const uiDir = join(extension, 'ui');
const uiSurfaces = (await readdir(uiDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
  .map((entry) => entry.name)
  .sort();
let checkedI18nKeys = 0;
for (const surface of uiSurfaces) {
  const htmlPath = join(uiDir, surface, 'index.html');
  const jsPath = join(uiDir, surface, 'index.js');
  const [html, js] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(jsPath, 'utf8')]);
  const { zhKeys, enKeys } = extractBilingualKeys(js, relative(root, jsPath));
  const htmlKeys = new Set(
    [...html.matchAll(/\bdata-i18n(?:-(?:aria-label|title))?="([^"]+)"/g)].map((match) => match[1])
  );
  for (const key of htmlKeys) {
    if (!zhKeys.has(key)) throw new Error(`${relative(root, htmlPath)} references key "${key}" missing from zh dictionary in ${relative(root, jsPath)}`);
    if (!enKeys.has(key)) throw new Error(`${relative(root, htmlPath)} references key "${key}" missing from en dictionary in ${relative(root, jsPath)}`);
    checkedI18nKeys++;
  }
}

console.log(
  `Checked ${jsFiles.length} extension JS files (zero forbidden sinks), ${toolFiles.length} tool scripts, ${testFiles.length} test files, ${new Set(jsonFiles).size} JSON files, ${localeEntries.length} locales, ${uiSurfaces.length} UI surfaces (${checkedI18nKeys} i18n bindings), ${Object.keys(manifest.icons ?? {}).length} icons; permissions unchanged.`
);

function extractObjectBody(source, regex) {
  const match = regex.exec(source);
  if (!match) return null;
  const openBrace = match.index + match[0].length - 1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openBrace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  return null;
}

function extractKeysFromBody(body) {
  return new Set([...body.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]));
}

function extractBilingualKeys(source, label) {
  let zhBody = extractObjectBody(source, /\b(?:const|var|let)\s+zh\s*=\s*\{/);
  let enBody = extractObjectBody(source, /\b(?:const|var|let)\s+en\s*=\s*\{/);
  if (!zhBody || !enBody) {
    const copyBody = extractObjectBody(source, /\b(?:const|var|let)\s+COPY\s*=\s*\{/);
    if (copyBody) {
      zhBody = zhBody ?? extractObjectBody(copyBody, /\bzh\s*:\s*\{/);
      enBody = enBody ?? extractObjectBody(copyBody, /\ben\s*:\s*\{/);
    }
  }
  if (!zhBody || !enBody) {
    throw new Error(`Could not locate zh/en dictionaries in ${label}`);
  }
  return { zhKeys: extractKeysFromBody(zhBody), enKeys: extractKeysFromBody(enBody) };
}

async function walk(directory, predicate) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path, predicate));
    else if (predicate(entry.name)) result.push(path);
  }
  return result;
}
