import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromePath } from './chrome-path.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = path.join(root, 'extension');
const fixtureDir = path.join(root, 'tests', 'fixtures');
const defaultOutDir = path.join(root, 'outputs', 'route-lens-1.3.1', 'previews');
const outDir = path.resolve(readOutDir(process.argv, process.env.ROUTE_LENS_PREVIEW_DIR) ?? defaultOutDir);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'route-lens-preview-'));
const profile = path.join(tempRoot, 'chrome-profile');
const screenshotNames = [
  'popup-status-zh-light.png',
  'popup-appearance-zh-light.png',
  'popup-appearance-en-dark.png',
  'popup-appearance-narrow.png',
  'rail-default-light.png',
  'rail-system-dark.png',
  'rail-width-min.png',
  'rail-width-max.png',
  'rail-height-min-top.png',
  'rail-geometry-max.png',
  'rail-position-bottom.png',
  'rail-narrow-scroll.png',
  'rail-fields-hidden.png',
  'popup-reopened.png'
];
const bounds = {
  railWidthPx: [64, 112],
  railHeightPercent: [40, 90],
  railPositionPercent: [0, 100],
  railFontSizePx: [9, 14],
  railOpacityPercent: [55, 100]
};

function readOutDir(args, envValue) {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--out-dir') {
      if (!args[index + 1]) throw new Error('--out-dir requires a path.');
      return args[index + 1];
    }
    if (args[index].startsWith('--out-dir=')) return args[index].slice('--out-dir='.length);
  }
  return envValue || null;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[ext] ?? 'application/octet-stream';
}

async function serveFile(filePath, response) {
  const body = await readFile(filePath);
  response.setHeader('Content-Type', mimeType(filePath));
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(200);
  response.end(body);
}

const mockHtml = await readFile(path.join(fixtureDir, 'chatgpt-page.html'), 'utf8');
const mockRuntime = await readFile(path.join(fixtureDir, 'mock-runtime.js'), 'utf8');
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/mock/runtime.js') {
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.writeHead(200);
      response.end(mockRuntime);
      return;
    }
    if (url.pathname === '/c/mock-conversation') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.writeHead(200);
      response.end(mockHtml);
      return;
    }
    if (!url.pathname.startsWith('/extension/')) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice('/extension/'.length));
    const filePath = path.resolve(extensionDir, relative);
    assert.ok(filePath.startsWith(`${extensionDir}${path.sep}`), 'extension request must remain within the extension directory');
    let content = await readFile(filePath);
    if (relative === 'ui/popup/index.html') {
      content = Buffer.from(content.toString('utf8').replace('</head>', '<script src="/mock/runtime.js?role=popup"></script></head>'));
    }
    response.setHeader('Content-Type', mimeType(filePath));
    response.setHeader('Cache-Control', 'no-store');
    response.writeHead(200);
    response.end(content);
  } catch (error) {
    response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  }
});

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools request timed out: ${method}`));
      }, 10000);
      timeout.unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed.');
    return result.result?.value;
  }
}

async function connectWebSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new CdpConnection(socket);
}

async function startChrome(chromePath, portFile) {
  await mkdir(profile, { recursive: true });
  const child = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-default-apps',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--window-size=1280,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let debugPort;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      debugPort = Number((await readFile(portFile, 'utf8')).split(/\r?\n/)[0]);
      if (debugPort) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Chrome exited before the DevTools endpoint became ready (exit ${child.exitCode}).`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!debugPort) throw new Error('Chrome did not publish DevToolsActivePort within 12 seconds.');
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browser = await connectWebSocket(version.webSocketDebuggerUrl);
  return { child, debugPort, browser };
}

async function createPage(browser, debugPort, width, height, colorScheme = 'light') {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  let target;
  for (let attempt = 0; attempt < 60; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = targets.find((item) => item.id === targetId);
    if (target?.webSocketDebuggerUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Chrome did not expose target ${targetId}.`);
  const connection = await connectWebSocket(target.webSocketDebuggerUrl);
  await connection.send('Page.enable');
  await connection.send('Runtime.enable');
  await connection.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await connection.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
  return {
    id: targetId,
    connection,
    async navigate(url) {
      await connection.send('Page.navigate', { url });
      await waitFor(this, 'document.readyState === "complete" || document.readyState === "interactive"', 'document readiness');
    },
    async close() {
      await browser.send('Target.closeTarget', { targetId });
      try { connection.socket.close(); } catch {}
    },
    async screenshot(name) {
      const result = await connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(outDir, name), Buffer.from(result.data, 'base64'));
    }
  };
}

const pause = (duration = 120) => new Promise((resolve) => setTimeout(resolve, duration));

async function waitFor(page, expression, label, predicate = (value) => Boolean(value)) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await page.connection.evaluate(expression);
    if (predicate(value)) return value;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function getRail(page) {
  return page.connection.evaluate(`(() => {
    const host = document.querySelector('#chatgpt-route-inspector-root');
    const rail = host?.shadowRoot?.querySelector('.rail');
    if (!rail) return null;
    const rect = rail.getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const scroll = rail.querySelector('.rail-scroll');
    const intersects = !(rect.right <= composer.left || rect.left >= composer.right || rect.bottom <= composer.top || rect.top >= composer.bottom);
    return {
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      composer: { left: composer.left, right: composer.right, top: composer.top, bottom: composer.bottom, width: composer.width, height: composer.height },
      intersectsComposer: intersects,
      composerVisible: composer.width > 0 && composer.height > 0 && composer.left >= 0 && composer.right <= innerWidth && composer.top >= 0 && composer.bottom <= innerHeight,
      pageMarginRight: getComputedStyle(document.body).marginRight,
      theme: rail.dataset.theme,
      language: rail.lang,
      background: getComputedStyle(rail).backgroundColor,
      status: rail.querySelector('.status')?.textContent.trim() ?? null,
      requested: rail.querySelectorAll('.model-block b')[0]?.textContent.trim() ?? null,
      reported: rail.querySelectorAll('.model-block b')[1]?.textContent.trim() ?? null,
      statusVisible: Boolean(rail.querySelector('.status-block')),
      modelCount: rail.querySelectorAll('.model-block').length,
      scrollClientHeight: scroll?.clientHeight ?? 0,
      scrollHeight: scroll?.scrollHeight ?? 0,
      style: rail.getAttribute('style')
    };
  })()`);
}

async function setRange(popup, route, key, value) {
  await popup.connection.evaluate(`(() => {
    const input = document.querySelector('[data-appearance-setting="${key}"]');
    input.value = '${value}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(popup, `window.routeLensPreview.state().settings['${key}'] === ${value}`, `${key} saved as ${value}`);
  const bridgeSetting = {
    railHeightPercent: `--ri-height-percent:${value}`,
    railPositionPercent: `--ri-position:${value / 100}`,
    railFontSizePx: `--ri-font-size:${value}px`,
    railOpacityPercent: `--ri-opacity:${value}%`
  }[key];
  await waitFor(route, `(() => {
    const rail = document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail');
    if (!rail) return false;
    if ('${key}' === 'railWidthPx') return rail.getBoundingClientRect().width === Math.min(${value}, innerWidth - 220);
    return rail.getAttribute('style')?.includes('${bridgeSetting}');
  })()`, `${key} propagated to the real bridge rail`);
}

function checkComposer(rail, label) {
  assert.equal(rail.composerVisible, true, `${label}: mock composer must remain visible in the viewport`);
  assert.equal(rail.intersectsComposer, false, `${label}: real bridge rail must not intersect the mock composer (${JSON.stringify(rail)})`);
}

const chromePath = await resolveChromePath();
await mkdir(outDir, { recursive: true });
let chrome;
let popup;
let route;
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const httpPort = server.address().port;
const origin = `http://127.0.0.1:${httpPort}`;

try {
  chrome = await startChrome(chromePath, path.join(profile, 'DevToolsActivePort'));
  route = await createPage(chrome.browser, chrome.debugPort, 1280, 900, 'light');
  await route.navigate(`${origin}/c/mock-conversation`);
  await waitFor(route, `document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail')`, 'actual extension bridge rail');
  await waitFor(route, `window.routeLensPreview.requests().some((request) => request.type === 'route:context')`, 'route context handshake');

  popup = await createPage(chrome.browser, chrome.debugPort, 400, 740, 'light');
  await popup.navigate(`${origin}/extension/ui/popup/index.html`);
  await waitFor(popup, `document.querySelector('#record-count')?.textContent.includes('2')`, 'popup state render');
  await waitFor(popup, `document.querySelector('#route-model')?.textContent === 'GPT-5-6 mini'`, 'popup route model render');

  const results = {};
  results.popupInitial = await popup.connection.evaluate(`({ lang:document.documentElement.lang, requested:document.querySelector('#requested-model').textContent, reported:document.querySelector('#route-model').textContent, records:document.querySelector('#record-count').textContent, verdict:document.querySelector('#verdict-text').textContent })`);
  assert.equal(results.popupInitial.lang, 'zh-CN');
  assert.equal(results.popupInitial.requested, 'GPT-5-6 Pro');
  assert.equal(results.popupInitial.reported, 'GPT-5-6 mini');
  assert.match(results.popupInitial.records, /2/);
  assert.match(results.popupInitial.verdict, /不一致/);
  await popup.screenshot('popup-status-zh-light.png');

  results.railDefaultLight = await getRail(route);
  assert.equal(results.railDefaultLight.rect.width, 72);
  assert.equal(results.railDefaultLight.theme, 'system');
  assert.match(results.railDefaultLight.status, /不一致/);
  assert.equal(results.railDefaultLight.requested, 'gpt-5-6-pro');
  assert.equal(results.railDefaultLight.reported, 'gpt-5-6-mini');
  checkComposer(results.railDefaultLight, 'default light rail');
  await route.screenshot('rail-default-light.png');

  await popup.connection.evaluate(`document.querySelector('#tab-appearance').click()`);
  await waitFor(popup, `!document.querySelector('#appearance-view').hidden`, 'appearance tab');
  await popup.screenshot('popup-appearance-zh-light.png');

  const actualWorker = await readFile(path.join(extensionDir, 'background', 'service-worker.js'), 'utf8');
  const actualPopup = await readFile(path.join(extensionDir, 'ui', 'popup', 'index.html'), 'utf8');
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const backendPattern = new RegExp(`${key}:\\s*boundedNumber\\("${key}",\\s*(\\d+),\\s*(\\d+),`);
    const backend = actualWorker.match(backendPattern);
    const inputPattern = new RegExp(`data-appearance-setting="${key}"[^>]*min="(\\d+)" max="(\\d+)"`);
    const input = actualPopup.match(inputPattern);
    assert.ok(backend && input, `popup/backend range found for ${key}`);
    assert.deepEqual([Number(backend[1]), Number(backend[2])], [min, max], `worker limits for ${key}`);
    assert.deepEqual([Number(input[1]), Number(input[2])], [min, max], `popup limits match worker for ${key}`);
  }

  for (const [key, [min, max]] of Object.entries(bounds)) {
    await setRange(popup, route, key, min);
    if (key === 'railWidthPx') {
      results.railWidthMin = await getRail(route);
      assert.equal(results.railWidthMin.rect.width, 64);
      checkComposer(results.railWidthMin, 'minimum rail width');
      await route.screenshot('rail-width-min.png');
    }
    await setRange(popup, route, key, max);
    if (key === 'railWidthPx') {
      results.railWidthMax = await getRail(route);
      assert.equal(results.railWidthMax.rect.width, 112);
      checkComposer(results.railWidthMax, 'maximum rail width');
      await route.screenshot('rail-width-max.png');
    }
  }
  const allAtMax = await getRail(route);
  assert.equal(allAtMax.rect.width, 112);
  assert.match(allAtMax.style, /--ri-height-percent:90/);
  assert.match(allAtMax.style, /--ri-position:1/);
  assert.match(allAtMax.style, /--ri-font-size:14px/);
  assert.match(allAtMax.style, /--ri-opacity:100%/);
  checkComposer(allAtMax, 'maximum appearance values');
  results.railGeometryMax = allAtMax;
  await route.screenshot('rail-geometry-max.png');

  await setRange(popup, route, 'railHeightPercent', 40);
  await setRange(popup, route, 'railPositionPercent', 0);
  const atTop = await getRail(route);
  assert.ok(Math.abs(atTop.rect.top - 16) <= 1, `position 0 should anchor at 16px from the top: ${JSON.stringify(atTop.rect)}`);
  assert.ok(Math.abs(atTop.rect.height - 360) <= 1, `height 40% at 900px should be 360px: ${JSON.stringify(atTop.rect)}`);
  checkComposer(atTop, 'minimum height and top position');
  results.railGeometryMin = atTop;
  await route.screenshot('rail-height-min-top.png');

  await setRange(popup, route, 'railPositionPercent', 100);
  const atBottom = await getRail(route);
  assert.ok(atBottom.rect.top > atTop.rect.top, `position 100 should move the short rail down: ${JSON.stringify({ top: atTop.rect.top, bottom: atBottom.rect.top })}`);
  checkComposer(atBottom, 'bottom position');
  results.railPositionBottom = atBottom;
  await route.screenshot('rail-position-bottom.png');

  for (const theme of ['light', 'dark', 'system']) {
    if (theme === 'system') {
      await popup.connection.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await route.connection.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    }
    await popup.connection.evaluate(`document.querySelector('input[name="theme"][value="${theme}"]').click()`);
    await waitFor(popup, `window.routeLensPreview.state().settings.theme === '${theme}'`, `${theme} theme saved`);
    await waitFor(route, `document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail')?.dataset.theme === '${theme}'`, `${theme} theme sent to bridge`);
    results[`theme_${theme}`] = await getRail(route);
  }
  assert.notEqual(results.theme_light.background, results.theme_dark.background);
  assert.equal(results.theme_dark.background, results.theme_system.background, 'system theme follows the dark preference');
  await route.screenshot('rail-system-dark.png');
  await popup.connection.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await route.connection.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await pause(200);
  const systemLight = await getRail(route);
  assert.notEqual(systemLight.background, results.theme_system.background, 'system theme follows the light preference after dark');

  await popup.connection.evaluate(`document.querySelector('[data-language="en"]').click()`);
  await waitFor(popup, `document.documentElement.lang === 'en'`, 'English popup labels');
  await waitFor(route, `document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail')?.lang === 'en'`, 'English rail labels');
  await popup.connection.evaluate(`document.querySelector('input[name="theme"][value="dark"]').click()`);
  await waitFor(popup, `window.routeLensPreview.state().settings.theme === 'dark'`, 'dark popup theme');
  await waitFor(popup, `document.querySelector('.appearance-title, .section-head h2')?.textContent`, 'English appearance label');
  results.popupEnglish = await popup.connection.evaluate(`({ lang:document.documentElement.lang, appearance:document.querySelector('.section-head h2').textContent.trim(), width:document.documentElement.scrollWidth, viewport:document.documentElement.clientWidth })`);
  assert.equal(results.popupEnglish.appearance, 'Sidebar appearance');
  assert.ok(results.popupEnglish.width <= results.popupEnglish.viewport);
  await waitFor(popup, `document.documentElement.dataset.theme === 'dark' && document.querySelector('input[name="theme"][value="dark"]').checked`, 'dark theme selection displayed in popup');
  await popup.screenshot('popup-appearance-en-dark.png');

  await popup.connection.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 420, deviceScaleFactor: 1, mobile: false });
  await popup.connection.evaluate('window.dispatchEvent(new Event("resize"))');
  await pause(150);
  const narrowPopup = await popup.connection.evaluate(`(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    buttonOverflow: [...document.querySelectorAll('button')].some((button) => button.scrollWidth > button.clientWidth + 1),
    writingModeOk: [...document.querySelectorAll('button')].every((button) => getComputedStyle(button).writingMode === 'horizontal-tb')
  }))()`);
  assert.equal(narrowPopup.viewport, 320);
  assert.ok(narrowPopup.width <= narrowPopup.viewport && narrowPopup.bodyWidth <= narrowPopup.viewport, `narrow Popup has horizontal overflow: ${JSON.stringify(narrowPopup)}`);
  assert.equal(narrowPopup.buttonOverflow, false);
  assert.equal(narrowPopup.writingModeOk, true);
  assert.ok(narrowPopup.scrollHeight > narrowPopup.clientHeight, `short Popup should scroll vertically: ${JSON.stringify(narrowPopup)}`);
  await popup.screenshot('popup-appearance-narrow.png');
  await popup.connection.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
  await waitFor(popup, `scrollY > 0 && document.querySelector('#appearance-reset').getBoundingClientRect().bottom <= innerHeight`, 'narrow Popup scroll reaches reset control');
  await popup.connection.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 740, deviceScaleFactor: 1, mobile: false });
  await popup.connection.evaluate('window.scrollTo(0, 0)');
  await popup.connection.evaluate('window.dispatchEvent(new Event("resize"))');

  for (const setting of ['showRouteStatus', 'showRequestedModel', 'showActualModel']) {
    await popup.connection.evaluate(`(() => {const input=document.querySelector('[data-appearance-setting="${setting}"]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(popup, `window.routeLensPreview.state().settings['${setting}'] === false`, `${setting} disabled`);
    const visible = await waitFor(route, `(() => {
      const rail=document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail');
      if(!rail)return null;
      return {status:Boolean(rail.querySelector('.status-block')),models:rail.querySelectorAll('.model-block').length};
    })()`, `${setting} synchronized`, (value) => value !== null);
    if (setting === 'showRouteStatus') assert.equal(visible.status, false);
    if (setting === 'showRequestedModel') assert.equal(visible.models, 1);
    if (setting === 'showActualModel') assert.equal(visible.models, 0);
  }
  results.railFieldsHidden = await getRail(route);
  await route.screenshot('rail-fields-hidden.png');

  for (const setting of ['showRouteStatus', 'showRequestedModel', 'showActualModel']) {
    await popup.connection.evaluate(`(() => {const input=document.querySelector('[data-appearance-setting="${setting}"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(popup, `window.routeLensPreview.state().settings['${setting}'] === true`, `${setting} restored`);
    await waitFor(route, `(() => {
      const rail=document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail');
      if(!rail)return false;
      if ('${setting}' === 'showRouteStatus') return Boolean(rail.querySelector('.status-block'));
      if ('${setting}' === 'showRequestedModel') return rail.querySelectorAll('.model-block').length === 1;
      return rail.querySelectorAll('.model-block').length === 2;
    })()`, `${setting} visibility synchronized`);
  }

  await popup.connection.evaluate(`window.routeLensPreview.setLongModels()`);
  await waitFor(route, `document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail .model-block b[title*="extraordinarily-long-request"]')`, 'long model labels in actual bridge');
  await route.connection.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false });
  await route.connection.evaluate('window.dispatchEvent(new Event("resize"))');
  await popup.connection.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false });
  await pause(350);
  results.railNarrow = await getRail(route);
  assert.equal(results.railNarrow.rect.width, 100, `rail width should adapt to narrow viewport while leaving a content area: ${JSON.stringify(results.railNarrow.rect)}`);
  assert.ok(results.railNarrow.rect.right <= 320 && results.railNarrow.rect.left >= 0);
  assert.equal(results.railNarrow.composerVisible, true);
  assert.equal(results.railNarrow.intersectsComposer, false);
  assert.ok(results.railNarrow.scrollHeight > results.railNarrow.scrollClientHeight, `long model names should scroll inside the narrow rail: ${JSON.stringify(results.railNarrow)}`);
  assert.equal(results.railNarrow.pageMarginRight, '100px', 'the mock page should reserve the effective rail width below 1120px');
  await route.screenshot('rail-narrow-scroll.png');

  await popup.connection.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 740, deviceScaleFactor: 1, mobile: false });
  await popup.connection.evaluate('window.dispatchEvent(new Event("resize"))');
  await popup.connection.evaluate(`window.chrome.runtime.sendMessage({type:'route:update-settings',settings:{autoCaptureEnabled:false,retentionLimit:37,includeRequestIdsInExport:true}})`);
  await waitFor(popup, `window.routeLensPreview.state().settings.retentionLimit === 37`, 'non-appearance settings fixture');
  const beforeReset = await popup.connection.evaluate(`({ turns:window.routeLensPreview.state().turns.length, auto:window.routeLensPreview.state().settings.autoCaptureEnabled, retention:window.routeLensPreview.state().settings.retentionLimit, requestIds:window.routeLensPreview.state().settings.includeRequestIdsInExport, captureMode:window.routeLensPreview.state().settings.captureMode })`);
  await popup.connection.evaluate(`document.querySelector('#appearance-reset').click()`);
  await waitFor(popup, `window.routeLensPreview.state().settings.railWidthPx === 72 && window.routeLensPreview.state().settings.theme === 'system'`, 'appearance reset saved');
  const afterReset = await popup.connection.evaluate(`(() => {const s=window.routeLensPreview.state();return {turns:s.turns.length,settings:s.settings,patch:window.routeLensPreview.requests().filter((request)=>request.type==='route:update-settings').at(-1)?.settings}})()`);
  assert.equal(afterReset.turns, beforeReset.turns);
  assert.equal(afterReset.settings.autoCaptureEnabled, beforeReset.auto);
  assert.equal(afterReset.settings.retentionLimit, beforeReset.retention);
  assert.equal(afterReset.settings.includeRequestIdsInExport, beforeReset.requestIds);
  assert.equal(afterReset.settings.captureMode, beforeReset.captureMode);
  assert.deepEqual(Object.keys(afterReset.patch).sort(), ['railWidthPx', 'railHeightPercent', 'railPositionPercent', 'railFontSizePx', 'railOpacityPercent', 'showRouteStatus', 'showRequestedModel', 'showActualModel', 'theme'].sort());
  const resetRail = await getRail(route);
  assert.equal(resetRail.rect.width, 72);
  assert.equal(resetRail.theme, 'system');
  assert.equal(resetRail.modelCount, 2);
  checkComposer(resetRail, 'rail after appearance reset');

  await popup.connection.evaluate(`(() => {const input=document.querySelector('[data-appearance-setting="railWidthPx"]');input.value='88';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(popup, `window.routeLensPreview.state().settings.railWidthPx === 88`, 'width preference before reopen');
  await waitFor(route, `document.querySelector('#chatgpt-route-inspector-root')?.shadowRoot?.querySelector('.rail')?.getBoundingClientRect().width === 88`, 'rail update before reopen');
  await popup.close();
  popup = await createPage(chrome.browser, chrome.debugPort, 400, 740, 'light');
  await popup.navigate(`${origin}/extension/ui/popup/index.html`);
  await waitFor(popup, `document.querySelector('#railWidthPx')?.value === '88'`, 'saved setting after popup reopen');
  results.popupReopened = await popup.connection.evaluate(`({ width:document.querySelector('#railWidthPx').value, stored:window.routeLensPreview.state().settings.railWidthPx, records:window.routeLensPreview.state().turns.length })`);
  assert.deepEqual(results.popupReopened, { width: '88', stored: 88, records: 2 });
  const railAfterReopen = await getRail(route);
  assert.equal(railAfterReopen.rect.width, 88);
  checkComposer(railAfterReopen, 'rail after popup reopen');
  await popup.screenshot('popup-reopened.png');

  console.log(`Chrome: ${chromePath}`);
  console.log(`Preview output: ${outDir}`);
  console.log(`Real bridge and popup checks passed; generated ${screenshotNames.length} screenshots.`);
  console.log(JSON.stringify({
    popupInitial: results.popupInitial,
    railDefaultLight: results.railDefaultLight,
    railGeometryMin: results.railGeometryMin.rect,
    railGeometryMax: results.railGeometryMax.rect,
    railPositionBottom: results.railPositionBottom.rect,
    themeBackgrounds: Object.fromEntries(['theme_light', 'theme_dark', 'theme_system'].map((key) => [key, results[key].background])),
    popupEnglish: results.popupEnglish,
    railNarrow: results.railNarrow,
    reset: { turns: afterReset.turns, autoCaptureEnabled: afterReset.settings.autoCaptureEnabled, retentionLimit: afterReset.settings.retentionLimit, includeRequestIdsInExport: afterReset.settings.includeRequestIdsInExport, captureMode: afterReset.settings.captureMode },
    popupReopened: results.popupReopened
  }, null, 2));
} finally {
  if (popup) await popup.close().catch(() => {});
  if (route) await route.close().catch(() => {});
  if (chrome?.browser?.socket.readyState === WebSocket.OPEN) chrome.browser.socket.close();
  if (chrome?.child && chrome.child.exitCode === null) {
    chrome.child.kill('SIGTERM');
    await new Promise((resolve) => chrome.child.once('exit', resolve));
  }
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

const previewReadme = [
  '# Route Lens 1.3.1 local browser previews',
  '',
  'Generated by `node scripts/ui-preview.mjs` using a temporary headless Chrome profile and localhost-only synthetic data. The popup loads the repository actual `extension/ui/popup` files; the right rail is rendered by the actual `extension/content/bridge.js` inside its Shadow DOM. A local Chrome API mock supplies state and broadcasts settings between pages.',
  '',
  'The chat page and composer are a hand-built layout fixture, not ChatGPT. This run checks rail geometry against that fixture at the listed viewport settings; it does not establish compatibility with ChatGPT live layout, load the page hook or service worker, send network requests, or confirm model execution.',
  '',
  'The PNG files listed by the preview script are integration screenshots from the real bridge. Other pre-existing files in a custom output folder are not validated by this run.'
].join('\n') + '\n';
await writeFile(path.join(outDir, 'README.md'), previewReadme);
