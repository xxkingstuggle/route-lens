import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { basename, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromePath } from './chrome-path.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = join(root, 'extension');
const chromePath = await resolveChromePath();
const tempRoot = await mkdtemp(join(os.tmpdir(), 'route-lens-ui-verify-'));
const profile = join(tempRoot, 'profile');
const screenshots = [];
const messagesKey = '__route_lens_messages_v1';
let server;
let chrome;
let cdp;

const initialTurn = {
  captureId: 'test-capture-1',
  captureContextId: 'test-context-1',
  tabId: 1,
  captureMode: 'live',
  phase: 'completed',
  observedAt: '2026-11-05T03:00:00.000Z',
  durationMs: 420,
  sources: ['page_fetch'],
  pageUrl: 'https://chatgpt.com/c/mock-conversation',
  conversationId: 'mock-conversation',
  requestedModel: 'gpt-5-2',
  routeModel: 'gpt-5-2',
  routeModelSources: ['resolved_model_slug'],
  modelLabel: 'gpt-5-2',
  modelLabelSources: ['assistant.metadata.model_slug'],
  modelLabelConflict: false,
  verdict: 'normal',
  requestId: 'mock-request-123456'
};

function makeState(scenario) {
  const longModel = 'gpt-5-6-auto-thinking-enterprise-preview-with-an-extraordinarily-long-routing-suffix';
  const first = scenario === 'long'
    ? { ...initialTurn, requestedModel: longModel, routeModel: longModel }
    : initialTurn;
  const turns = [first, { ...first, captureId: 'test-capture-2', observedAt: '2026-11-05T03:01:00.000Z' }];
  return {
    revision: 1,
    turns,
    captureContexts: {
      1: {
        id: 'test-context-1',
        documentId: 'test-document',
        documentStartedAt: Date.now() - 10000,
        pageUrl: 'https://chatgpt.com/c/mock-conversation',
        reloadEligible: true,
        revision: 1
      }
    },
    powReadings: [{ tabId: 1, rawHex: '07a120', decimal: '500000', observedAt: first.observedAt }],
    settings: {
      overlayEnabled: true,
      overlayMode: 'mini',
      overlayMinimized: true,
      theme: 'system',
      retentionLimit: 100,
      includeRequestIdsInExport: false,
      autoCaptureEnabled: true,
      captureMode: 'live',
      uiLanguage: 'zh',
      railWidthPx: 72,
      railHeightPercent: 75,
      railPositionPercent: 58,
      railFontSizePx: 10,
      railOpacityPercent: 92,
      showRouteStatus: true,
      showRequestedModel: true,
      showActualModel: true
    }
  };
}

const allowedBounds = {
  railWidthPx: [64, 112],
  railHeightPercent: [40, 90],
  railPositionPercent: [0, 100],
  railFontSizePx: [9, 14],
  railOpacityPercent: [55, 100]
};

function mockScript(scenario, storageKey) {
  const seeded = JSON.stringify(makeState(scenario)).replaceAll('<', '\\u003c');
  return `<script>
    (() => {
      const key = ${JSON.stringify(storageKey)};
      const logKey = ${JSON.stringify(messagesKey)};
      const seed = ${seeded};
      const read = (name, fallback) => { try { return JSON.parse(localStorage.getItem(name)) ?? fallback; } catch { return fallback; } };
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
      const listeners = [];
      const readState = () => read(key, seed);
      const saveState = (value) => localStorage.setItem(key, JSON.stringify(value));
      const log = (request) => { const entries = read(logKey, []); entries.push(request); localStorage.setItem(logKey, JSON.stringify(entries)); };
      window.chrome = {
        runtime: {
          sendMessage(request, callback) {
            log(request);
            let state = readState();
            let response;
            if (request.type === 'route:get-state') {
              response = { ok: true, state };
            } else if (request.type === 'route:update-settings') {
              const numeric = { railWidthPx: [64, 112], railHeightPercent: [40, 90], railPositionPercent: [0, 100], railFontSizePx: [9, 14], railOpacityPercent: [55, 100] };
              const patch = { ...request.settings };
              for (const [name, [min, max]] of Object.entries(numeric)) {
                if (Object.hasOwn(patch, name)) patch[name] = Math.max(min, Math.min(max, Math.round(patch[name])));
              }
              state = { ...state, revision: state.revision + 1, settings: { ...state.settings, ...patch } };
              saveState(state);
              response = { ok: true, state };
              for (const listener of listeners) listener({ type: 'route:state-changed', state });
            } else {
              response = { ok: true };
            }
            if (callback) callback(response);
            return Promise.resolve(response);
          },
          onMessage: { addListener(fn) { listeners.push(fn); } },
          openOptionsPage() {}
        },
        tabs: {
          query() { return Promise.resolve([{ id: 1, url: 'https://chatgpt.com/c/mock-conversation' }]); },
          onUpdated: { addListener() {} }
        }
      };
      window.__routeLensMock = {
        state: readState,
        messages: () => read(logKey, [])
      };
    })();
  </script>`;
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };
server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const pathname = requestUrl.pathname === '/' ? '/ui/popup/index.html' : requestUrl.pathname;
    const filePath = resolve(extensionDir, `.${pathname}`);
    assert.ok(filePath.startsWith(`${extensionDir}/`), 'request path remains within extension directory');
    let body = await readFile(filePath);
    const extension = extname(filePath);
    res.setHeader('Content-Type', mimeTypes[extension] ?? 'application/octet-stream');
    if (extension === '.html') {
      const scenario = requestUrl.searchParams.get('scenario') || 'base';
      const storageKey = `route-lens-state-${requestUrl.searchParams.get('storage') || scenario}`;
      body = Buffer.from(body.toString('utf8').replace('</head>', `${mockScript(scenario, storageKey)}</head>`));
    }
    res.writeHead(200);
    res.end(body);
  } catch (error) {
    res.writeHead(404);
    res.end(String(error));
  }
});

function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

async function openTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  assert.equal(response.status, 200, `Chrome target creation failed: ${response.status}`);
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }
    }, 10000).unref?.();
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 760, deviceScaleFactor: 1, mobile: false });
  return {
    socket,
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
      return result.result?.value;
    },
    async close() {
      const response = await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      assert.equal(response.status, 200, `Chrome target close failed: ${response.status}`);
      try { socket.close(); } catch {}
    }
  };
}

async function waitFor(page, expression, description) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await page.evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const output = join(tempRoot, name);
  await writeFile(output, Buffer.from(result.data, 'base64'));
  screenshots.push(output);
  return output;
}

async function main() {
  const serviceWorker = await readFile(join(extensionDir, 'background/service-worker.js'), 'utf8');
  const popupHtml = await readFile(join(extensionDir, 'ui/popup/index.html'), 'utf8');
  for (const [key, [min, max]] of Object.entries(allowedBounds)) {
    const backendPattern = new RegExp(`${key}:\\s*boundedNumber\\("${key}",\\s*(\\d+),\\s*(\\d+),`);
    const match = serviceWorker.match(backendPattern);
    assert.ok(match, `backend bound for ${key} is present`);
    assert.deepEqual([Number(match[1]), Number(match[2])], [min, max], `verified expected backend bounds for ${key}`);
    const controlPattern = new RegExp(`data-appearance-setting="${key}"[^>]*min="(\\d+)" max="(\\d+)"`);
    const control = popupHtml.match(controlPattern);
    assert.ok(control, `popup range for ${key} is present`);
    assert.deepEqual([Number(control[1]), Number(control[2])], [min, max], `popup range matches service worker for ${key}`);
  }
  console.log('PASS: all five popup slider limits match the service-worker clamp limits.');

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const port = server.address().port;
  await import('node:fs/promises').then(({ mkdir }) => mkdir(profile, { recursive: true }));
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--window-size=400,760', 'about:blank'
  ], { stdio: 'ignore' });
  let devToolsPort;
  const portFile = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      devToolsPort = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
      if (devToolsPort) break;
    } catch {}
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools started (${chrome.exitCode})`);
    await sleep(100);
  }
  assert.ok(devToolsPort, 'Chrome DevTools endpoint started');
  const baseUrl = `http://127.0.0.1:${port}/ui/popup/index.html`;
  const makeUrl = (scenario = 'base', storage = scenario) => `${baseUrl}?scenario=${scenario}&storage=${storage}`;
  cdp = await openTarget(devToolsPort, makeUrl('base', 'main'));
  await waitFor(cdp, `document.querySelector('#record-count')?.textContent.includes('2')`, 'popup state and records to render');

  const initial = await cdp.evaluate(`({ requested: document.querySelector('#requested-model').textContent, actual: document.querySelector('#route-model').textContent, verdict: document.querySelector('#verdict-text').textContent, records: document.querySelector('#record-count').textContent, detailsHidden: document.querySelector('#details').open, width: document.documentElement.scrollWidth, viewport: innerWidth })`);
  assert.equal(initial.requested, 'GPT-5-2');
  assert.equal(initial.actual, 'GPT-5-2');
  assert.match(initial.verdict, /一致/);
  assert.match(initial.records, /2/);
  assert.equal(initial.detailsHidden, false);
  assert.ok(initial.width <= initial.viewport, `base layout has no horizontal overflow (${initial.width}/${initial.viewport})`);
  console.log('PASS: Chinese status renders request/response fields, verdict, record count, and collapsed details.');

  await cdp.evaluate(`document.querySelector('[data-language="en"]').click()`);
  await waitFor(cdp, `document.documentElement.lang === 'en' && document.querySelector('#capture-status').textContent === 'Live capture'`, 'English labels');
  assert.equal(await cdp.evaluate(`document.querySelector('#tab-appearance').textContent.trim()`), 'Appearance');
  await cdp.evaluate(`document.querySelector('[data-language="zh"]').click()`);
  await waitFor(cdp, `document.documentElement.lang === 'zh-CN'`, 'Chinese labels');
  console.log('PASS: language buttons switch visible status and tab text in the actual rendered popup.');

  await cdp.evaluate(`document.querySelector('#tab-appearance').focus(); document.querySelector('#tab-appearance').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));`);
  assert.equal(await cdp.evaluate(`document.querySelector('#tab-state').getAttribute('aria-selected')`), 'true');
  assert.equal(await cdp.evaluate(`document.activeElement.id`), 'tab-state');
  await cdp.evaluate(`document.querySelector('#tab-state').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));`);
  assert.equal(await cdp.evaluate(`document.querySelector('#tab-appearance').getAttribute('aria-selected')`), 'true');
  assert.equal(await cdp.evaluate(`document.activeElement.id`), 'tab-appearance');
  console.log('PASS: left/right keyboard navigation switches and focuses popup tabs.');

  await cdp.evaluate(`document.querySelector('#tab-appearance').click()`);
  await waitFor(cdp, `!document.querySelector('#appearance-view').hidden`, 'appearance tab');
  await screenshot(cdp, 'popup-appearance-zh.png');
  for (const [key, [min, max]] of Object.entries(allowedBounds)) {
    for (const value of [min, max]) {
      await cdp.evaluate(`(() => { const input = document.querySelector('[data-appearance-setting="${key}"]'); input.value = '${value}'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitFor(cdp, `window.__routeLensMock.state().settings['${key}'] === ${value}`, `${key}=${value} to be saved`);
      const output = await cdp.evaluate(`document.querySelector('#${key}-value').textContent.trim()`);
      assert.ok(output.includes(String(value)), `${key} visible output shows ${value}`);
      const lastSettingsMessage = await cdp.evaluate(`window.__routeLensMock.messages().filter((item) => item.type === 'route:update-settings').at(-1)?.settings`);
      assert.equal(lastSettingsMessage?.[key], value, `${key}=${value} was sent via route:update-settings`);
    }
  }
  console.log('PASS: all slider min/max endpoints are displayed, sent through the real popup runtime API, and persisted by the mock backend.');

  for (const theme of ['dark', 'light', 'system']) {
    if (theme === 'system') {
      await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    }
    await cdp.evaluate(`document.querySelector('input[name="theme"][value="${theme}"]').click()`);
    await waitFor(cdp, `window.__routeLensMock.state().settings.theme === '${theme}' && document.documentElement.dataset.theme === '${theme}'`, `theme ${theme} to be saved and applied`);
    const bg = await cdp.evaluate(`getComputedStyle(document.body).backgroundColor`);
    if (theme === 'light') assert.equal(bg, 'rgb(255, 255, 255)');
    if (theme === 'dark' || theme === 'system') assert.equal(bg, 'rgb(15, 20, 25)');
  }
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const systemLightBg = await cdp.evaluate(`getComputedStyle(document.body).backgroundColor`);
  assert.equal(systemLightBg, 'rgb(255, 255, 255)', 'system theme follows an emulated light browser preference');
  console.log('PASS: explicit light/dark and system themes save and render with emulated browser color preferences.');

  for (const key of ['showRouteStatus', 'showRequestedModel', 'showActualModel']) {
    await cdp.evaluate(`document.querySelector('[data-appearance-setting="${key}"]').click()`);
    await waitFor(cdp, `window.__routeLensMock.state().settings['${key}'] === false`, `${key} false to be saved`);
    assert.equal(await cdp.evaluate(`window.__routeLensMock.messages().filter((item) => item.type === 'route:update-settings').at(-1)?.settings['${key}']`), false);
    await cdp.evaluate(`document.querySelector('[data-appearance-setting="${key}"]').click()`);
    await waitFor(cdp, `window.__routeLensMock.state().settings['${key}'] === true`, `${key} true to be saved`);
  }
  console.log('PASS: all three sidebar visibility checkboxes send and persist both off/on values.');

  await cdp.evaluate(`window.chrome.runtime.sendMessage({ type: 'route:update-settings', settings: { autoCaptureEnabled: false, captureMode: 'reload', includeRequestIdsInExport: true, overlayEnabled: false } })`);
  await waitFor(cdp, `window.__routeLensMock.state().settings.captureMode === 'reload' && window.__routeLensMock.state().settings.overlayEnabled === false`, 'non-appearance settings fixture');
  const beforeReset = await cdp.evaluate(`({ records: window.__routeLensMock.state().turns.length, contexts: Object.keys(window.__routeLensMock.state().captureContexts).length })`);
  assert.equal(beforeReset.records, 2);
  assert.equal(beforeReset.contexts, 1);
  await cdp.evaluate(`document.querySelector('#appearance-reset').click()`);
  await waitFor(cdp, `window.__routeLensMock.state().settings.railWidthPx === 72 && window.__routeLensMock.state().settings.theme === 'system'`, 'appearance reset');
  const afterReset = await cdp.evaluate(`({ state: window.__routeLensMock.state(), resetPatch: window.__routeLensMock.messages().filter((item) => item.type === 'route:update-settings').at(-1)?.settings })`);
  assert.deepEqual(afterReset.resetPatch, {
    railWidthPx: 72, railHeightPercent: 75, railPositionPercent: 58, railFontSizePx: 10, railOpacityPercent: 92,
    showRouteStatus: true, showRequestedModel: true, showActualModel: true, theme: 'system'
  });
  assert.equal(afterReset.state.turns.length, 2);
  assert.equal(Object.keys(afterReset.state.captureContexts).length, 1);
  assert.equal(afterReset.state.settings.autoCaptureEnabled, false);
  assert.equal(afterReset.state.settings.captureMode, 'reload');
  assert.equal(afterReset.state.settings.includeRequestIdsInExport, true);
  assert.equal(afterReset.state.settings.overlayEnabled, false);
  assert.equal(afterReset.state.powReadings.length, 1);
  assert.equal(afterReset.state.settings.railWidthPx, 72);
  console.log('PASS: reset sends only appearance keys and preserves records, contexts, PoW data, capture mode, privacy, and sidebar visibility.');

  await cdp.close();
  cdp = await openTarget(devToolsPort, makeUrl('base', 'main'));
  await waitFor(cdp, `document.querySelector('#record-count')?.textContent.includes('2')`, 'reopened popup');
  const reopened = await cdp.evaluate(`({ width: document.querySelector('[data-appearance-setting="railWidthPx"]').value, theme: document.querySelector('input[name="theme"]:checked')?.value, captureMode: window.__routeLensMock.state().settings.captureMode, records: window.__routeLensMock.state().turns.length })`);
  assert.deepEqual(reopened, { width: '72', theme: 'system', captureMode: 'reload', records: 2 });
  console.log('PASS: closing and reopening the popup reloads saved settings from persistent browser storage.');

  await cdp.evaluate(`document.querySelector('#tab-state').click()`);
  await cdp.evaluate(`document.querySelector('#overlay-toggle').click()`);
  await waitFor(cdp, `window.__routeLensMock.state().settings.overlayEnabled === true`, 'sidebar show toggle');
  let overlayPatch = await cdp.evaluate(`window.__routeLensMock.messages().filter((item) => item.type === 'route:update-settings').at(-1)?.settings`);
  assert.deepEqual(overlayPatch, { overlayEnabled: true, overlayMode: 'mini', overlayMinimized: true });
  await cdp.evaluate(`document.querySelector('#overlay-toggle').click()`);
  await waitFor(cdp, `window.__routeLensMock.state().settings.overlayEnabled === false`, 'sidebar hide toggle');
  overlayPatch = await cdp.evaluate(`window.__routeLensMock.messages().filter((item) => item.type === 'route:update-settings').at(-1)?.settings`);
  assert.deepEqual(overlayPatch, { overlayEnabled: false });
  console.log('PASS: sidebar show/hide controls send the expected backend patches.');

  await cdp.evaluate(`document.querySelector('[data-mode="live"]').click()`);
  await waitFor(cdp, `window.__routeLensMock.state().settings.captureMode === 'live'`, 'live mode before reading captured fields');
  const detailsState = await cdp.evaluate(`(() => { const details = document.querySelector('#details'); details.open = true; return { text: details.innerText, records: document.querySelector('#record-count').textContent }; })()`);
  assert.match(detailsState.text, /resolved_model_slug/);
  assert.match(detailsState.text, /PoW/);
  assert.match(detailsState.records, /2/);
  console.log('PASS: expanding record details renders source and PoW fields without losing the record count.');

  const longUrl = makeUrl('long', 'long-model');
  await cdp.close();
  cdp = await openTarget(devToolsPort, longUrl);
  await waitFor(cdp, `document.querySelector('#requested-model')?.title.includes('extraordinarily-long-routing-suffix')`, 'long model scenario');
  const longAt400 = await cdp.evaluate(`({ requested: document.querySelector('#requested-model').textContent, requestedTitle: document.querySelector('#requested-model').title, actualTitle: document.querySelector('#route-model').title, width: document.documentElement.scrollWidth, viewport: innerWidth })`);
  assert.match(longAt400.requestedTitle, /extraordinarily-long-routing-suffix/);
  assert.match(longAt400.actualTitle, /extraordinarily-long-routing-suffix/);
  assert.ok(longAt400.width <= longAt400.viewport, `long model has no horizontal overflow at 400px (${longAt400.width}/${longAt400.viewport})`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: false });
  await waitFor(cdp, `innerWidth === 320`, '320px viewport');
  const narrow = await cdp.evaluate(`({ width: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth, requestedTitle: document.querySelector('#requested-model').title, requestedScroll: document.querySelector('#requested-model').scrollWidth, requestedClient: document.querySelector('#requested-model').clientWidth })`);
  assert.ok(narrow.width <= narrow.viewport && narrow.body <= narrow.viewport, `320px view has no horizontal overflow (${narrow.width}/${narrow.body}/${narrow.viewport})`);
  assert.match(narrow.requestedTitle, /extraordinarily-long-routing-suffix/);
  await screenshot(cdp, 'popup-long-model-320.png');
  console.log('PASS: long model text retains its full tooltip and stays inside 320px popup layout.');

  console.log(`Screenshots: ${screenshots.map((path) => basename(path)).join(', ')}`);
  console.log('Chrome: isolated headless profile; page origin and runtime are localhost-only mocks.');
}

try {
  await main();
} finally {
  if (cdp) await cdp.close().catch(() => {});
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise((resolvePromise) => chrome.once('exit', resolvePromise));
  }
  await rm(profile, { recursive: true, force: true });
  if (server?.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
  console.log(`Verification screenshots are in ${tempRoot}`);
}
