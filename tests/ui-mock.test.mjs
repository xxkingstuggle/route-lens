import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

test('Popup HTML 包含必需的无障碍属性与品牌要素', async () => {
  const html = await readFile(resolve(root, 'extension/ui/popup/index.html'), 'utf8');

  // Brand and maintainer attribution
  assert.match(html, /Route Lens/, '包含新品牌名称 Route Lens');
  assert.match(html, /https:\/\/github\.com\/xxkingstuggle/, '包含维护者 GitHub 链接');

  // Accessibility and tabs
  assert.match(html, /role="tablist"/, '包含 tablist');
  assert.match(html, /role="tab"/, '包含 tab 按钮');
  assert.match(html, /role="tabpanel"/, '包含 tabpanel 主区域');
  assert.match(html, /role="switch"/, '包含侧栏 switch 控件');

  // Sliders and settings controls
  assert.match(html, /data-appearance-setting="railWidthPx"/, '包含宽度设置控件');
  assert.match(html, /data-appearance-setting="railHeightPercent"/, '包含高度设置控件');
  assert.match(html, /data-appearance-setting="railPositionPercent"/, '包含垂直位置设置控件');
  assert.match(html, /data-appearance-setting="railFontSizePx"/, '包含字号设置控件');
  assert.match(html, /data-appearance-setting="railOpacityPercent"/, '包含透明度设置控件');
  assert.match(html, /data-appearance-setting="theme"/, '包含主题设置控件');
  assert.match(html, /data-appearance-setting="showRouteStatus"/, '包含结论可见性设置');
  assert.match(html, /data-appearance-setting="showRequestedModel"/, '包含请求模型可见性设置');
  assert.match(html, /data-appearance-setting="showActualModel"/, '包含服务器报告模型可见性设置');
  assert.match(html, /id="appearance-reset"/, '包含恢复默认外观按钮');
});

test('用户可见界面不保留旧作者推广或外链', async () => {
  const surfaces = [
    'extension/ui/popup/index.html',
    'extension/ui/dashboard/index.html',
    'extension/ui/announcement/index.html'
  ];

  for (const surface of surfaces) {
    const html = await readFile(resolve(root, surface), 'utf8');
    const externalLinks = [...html.matchAll(/href="(https?:\/\/[^\"]+)"/g)].map((match) => match[1]);
    const expected = surface.endsWith('announcement/index.html') ? [] : ['https://github.com/xxkingstuggle'];
    assert.deepEqual(externalLinks, expected, `${surface} 只保留维护者入口`);
  }

  const worker = await readFile(resolve(root, 'extension/background/service-worker.js'), 'utf8');
  assert.match(worker, /UPGRADE_NOTICE_PATH = "ui\/announcement\/index\.html"/, '公告目标是扩展内页面');
  assert.match(worker, /chrome\.runtime\.getURL\(UPGRADE_NOTICE_PATH\)/, '公告跳转使用扩展内部 URL');
});

test('Popup CSS 适配紧凑布局、320px 窄窗口与深浅主题', async () => {
  const css = await readFile(resolve(root, 'extension/ui/popup/styles.css'), 'utf8');

  assert.match(css, /width:\s*400px/, '默认宽度 400px');
  assert.match(css, /@media\s*\(max-width:\s*340px\)/, '提供 320px 窄屏幕适配');
  assert.match(css, /data-theme="dark"/, '支持深色主题');
  assert.match(css, /data-theme="light"/, '支持浅色主题');
  assert.match(css, /overflow-x:\s*hidden/, '禁止水平横向溢出');
});

test('Popup JS 具备中英文双语字典且键位对称', async () => {
  const js = await readFile(resolve(root, 'extension/ui/popup/index.js'), 'utf8');

  // Extract zh and en dictionary blocks
  const zhMatch = js.match(/const zh = \{([\s\S]*?)\};/);
  const enMatch = js.match(/const en = \{([\s\S]*?)\};/);
  assert.ok(zhMatch && enMatch, '找到 zh 与 en 字典定义');

  const extractKeys = (block) => {
    const keys = [];
    const re = /"([^"]+)":/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      keys.push(m[1]);
    }
    return keys;
  };

  const zhKeys = extractKeys(zhMatch[1]);
  const enKeys = extractKeys(enMatch[1]);

  assert.ok(zhKeys.length >= 50, `中文键数量充足 (${zhKeys.length})`);
  assert.ok(enKeys.length >= 50, `英文键数量充足 (${enKeys.length})`);

  for (const k of zhKeys) {
    assert.ok(enKeys.includes(k), `英文字典缺少键: ${k}`);
  }
});

test('恢复默认外观仅重置外观字段，不触碰记录、隐私与捕获模式', async () => {
  const js = await readFile(resolve(root, 'extension/ui/popup/index.js'), 'utf8');

  // Check appearanceDefaults structure
  assert.match(js, /const appearanceDefaults = \{[\s\S]*?railWidthPx:\s*72/);
  assert.match(js, /railHeightPercent:\s*75/);
  assert.match(js, /railPositionPercent:\s*58/);
  assert.match(js, /railFontSizePx:\s*10/);
  assert.match(js, /railOpacityPercent:\s*92/);
  assert.match(js, /showRouteStatus:\s*true/);
  assert.match(js, /showRequestedModel:\s*true/);
  assert.match(js, /showActualModel:\s*true/);
  assert.match(js, /theme:\s*"system"/);

  // Check that reset only passes appearanceDefaults to queueAppearancePatch
  assert.match(js, /appearanceReset\?\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*?queueAppearancePatch\(appearanceDefaults\)/);
});

test('bridge.js 静态源码包含 Shadow DOM 侧栏与条内滚动容器', async () => {
  const bridge = await readFile(resolve(root, 'extension/content/bridge.js'), 'utf8');

  assert.match(bridge, /attachShadow\(\{ mode: "open" \}\)/, '侧栏使用 Shadow DOM');
  assert.match(bridge, /function setNarrowRailSpace\(enabled,\s*width\s*=\s*72\)/);
  assert.match(bridge, /margin-right:\s*\$\{width\}px\s*!important/);
  assert.match(bridge, /class="rail-scroll"/);
  assert.match(bridge, /overflow-y:auto/);
  assert.match(bridge, /--accent:\s*#1a68d8/);
  assert.match(bridge, /--accent:\s*#4d93f7/);
});
