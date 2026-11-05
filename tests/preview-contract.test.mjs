import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

test('前端说明的滑块范围与 Popup 和后台约束一致', async () => {
  const html = await readFile(resolve(root, 'extension/ui/popup/index.html'), 'utf8');
  const worker = await readFile(resolve(root, 'extension/background/service-worker.js'), 'utf8');
  const docs = await readFile(resolve(root, 'docs/frontend.md'), 'utf8');
  const expected = {
    railWidthPx: [64, 112],
    railHeightPercent: [40, 90],
    railPositionPercent: [0, 100],
    railFontSizePx: [9, 14],
    railOpacityPercent: [55, 100]
  };
  for (const [key, [min, max]] of Object.entries(expected)) {
    const popup = html.match(new RegExp(`data-appearance-setting="${key}"[^>]*min="(\\d+)" max="(\\d+)"`));
    const backend = worker.match(new RegExp(`${key}:\\s*boundedNumber\\("${key}",\\s*(\\d+),\\s*(\\d+),`));
    assert.ok(popup && backend, `${key} control and backend constraint exist`);
    assert.deepEqual(popup.slice(1).map(Number), [min, max]);
    assert.deepEqual(backend.slice(1).map(Number), [min, max]);
  }
  for (const line of ['64–112 px', '40–90%', '0–100%', '9–14 px', '55–100%']) assert.ok(docs.includes(line), `docs include ${line}`);
});

test('本地预览明确加载真实 bridge，并不包含旧的静态侧栏替身', async () => {
  const fixture = await readFile(resolve(root, 'tests/fixtures/chatgpt-page.html'), 'utf8');
  const script = await readFile(resolve(root, 'scripts/ui-preview.mjs'), 'utf8');
  assert.match(fixture, /src="\/extension\/content\/bridge\.js"/);
  assert.match(script, /rail-narrow-scroll\.png/);
  assert.match(script, /intersectsComposer/);
  assert.match(script, /Target\.closeTarget/);
  assert.doesNotMatch(script, /takeWebpageMockScreenshot|\.probe\s*\{/);
});

test('项目文档与预览工具不含个人绝对路径', async () => {
  const paths = [
    resolve(root, 'README.md'),
    resolve(root, 'MAINTENANCE.md'),
    resolve(root, 'docs/frontend.md'),
    resolve(root, 'scripts/ui-preview.mjs'),
    resolve(root, 'scripts/ui-verify.mjs')
  ];
  const contents = await Promise.all(paths.map((file) => readFile(file, 'utf8')));
  for (const [index, content] of contents.entries()) {
    assert.doesNotMatch(content, /\/Users\/|\/home\/[A-Za-z0-9._-]+\//, `${paths[index]} has no personal absolute path`);
  }
});
