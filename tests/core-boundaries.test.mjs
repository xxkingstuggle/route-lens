import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(here, '../extension/background/service-worker.js');
const pageHookPath = resolve(here, '../extension/content/page-hook.js');
const [workerSource, pageHookSource] = await Promise.all([
  readFile(workerPath, 'utf8'),
  readFile(pageHookPath, 'utf8')
]);
const stateKey = 'chatgptRouteInspectorStateV1';
const chromeListener = { addListener() {} };

function workerWithState(value = {}) {
  let stored = { [stateKey]: value };
  const chrome = {
    runtime: { onInstalled: chromeListener, onMessage: chromeListener, getManifest: () => ({ version: '1.2.3' }) },
    tabs: { onUpdated: chromeListener, onRemoved: chromeListener },
    storage: {
      local: {
        get: async (key) => ({ [key]: stored[key] }),
        set: async (update) => { stored = { ...stored, ...update }; }
      }
    },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} }
  };
  const context = {
    chrome, console, URL, Date, BigInt, Map, Set, Promise, Number, String, Array, Object,
    RegExp, Math, JSON, Error, setTimeout, clearTimeout
  };
  vm.runInNewContext(workerSource, context);
  return { context, readStored: () => stored[stateKey] };
}

function pageHookHarness() {
  const messages = [];
  const listeners = new Map();
  let sequence = 0;
  const responseBody = 'data: [DONE]\n\n';
  const nativeFetch = async () => new Response(responseBody, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
  const nativeWebSocket = class MockWebSocket {};
  const location = { origin: 'https://chatgpt.com', pathname: '/c/mock-conversation', href: 'https://chatgpt.com/c/mock-conversation' };
  const window = {
    fetch: nativeFetch,
    WebSocket: nativeWebSocket,
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    postMessage(data) { messages.push(data); },
    setInterval() { return 1; },
    setTimeout,
    clearTimeout
  };
  const document = { documentElement: null, addEventListener() {} };
  const context = {
    window, document, location, URL, Request, Response, TextDecoder,
    Date, BigInt, Map, Set, WeakMap, WeakSet, Promise, Number, String, Array, Object,
    RegExp, Math, JSON, Error, queueMicrotask, setTimeout, clearTimeout,
    crypto: { randomUUID: () => `test-id-${++sequence}` }, console
  };
  vm.runInNewContext(pageHookSource, context);
  return {
    window,
    messages,
    dispatchControl(autoCaptureEnabled, revision = 1) {
      for (const listener of listeners.get('message') ?? []) {
        listener({
          source: window,
          origin: location.origin,
          data: {
            source: 'chatgpt-route-inspector-control',
            version: 1,
            revision,
            autoCaptureEnabled,
            captureMode: 'live',
            clearedAt: null
          }
        });
      }
    }
  };
}

const messageRequest = JSON.stringify({
  model: 'gpt-5-2',
  conversation_id: 'mock-conversation',
  parent_message_id: 'parent-1',
  messages: [{ id: 'user-1', author: { role: 'user' } }]
});

async function flushAsyncWork() {
  for (let i = 0; i < 20; i++) await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

test('PoW 观测先校验时间，清空前和无效时间都不会写回', async () => {
  const { context, readStored } = workerWithState({
    clearedAt: '2026-11-05T00:00:00.000Z',
    settings: { autoCaptureEnabled: true }
  });

  await context.storePowObservation({
    rawHex: '0a', observedAt: '2026-11-04T23:59:00.000Z', startedAt: 'invalid-date', tabId: 4
  });
  assert.equal((await context.readState()).powReadings.length, 0);
  assert.equal(readStored().powReadings, undefined);

  await context.storePowObservation({
    rawHex: '0d', observedAt: '2026-11-04T23:59:00.000Z', tabId: 4
  });
  assert.equal((await context.readState()).powReadings.length, 0);

  await context.storePowObservation({
    rawHex: '0b', observedAt: '2026-11-05T00:00:02.000Z', startedAt: '2026-11-04T23:59:59.000Z', tabId: 4
  });
  assert.equal((await context.readState()).powReadings.length, 0);

  await context.storePowObservation({
    rawHex: '0e', observedAt: '2026-11-05T00:00:02.000Z', startedAt: '2026-11-05T00:00:03.000Z', tabId: 4
  });
  assert.equal((await context.readState()).powReadings.length, 0);

  await context.storePowObservation({
    rawHex: '0c', observedAt: '2026-11-05T00:00:02.000Z', startedAt: '2026-11-05T00:00:01.000Z', tabId: 4
  });
  const state = await context.readState();
  assert.equal(state.powReadings.length, 1);
  assert.equal(state.powReadings[0].rawHex, '0c');
  assert.equal(Object.hasOwn(state.powReadings[0], 'startedAt'), false);
});

test('清空会话上下文不残留旧会话 ID，后续合法上下文仍可登记', async () => {
  const { context, readStored } = workerWithState();
  const now = Date.now();
  const first = context.normalizeCaptureContext({
    id: 'context-old', documentId: 'document-old', documentStartedAt: now,
    visitStartedAt: now, revision: 1, reloadEligible: true,
    pageUrl: 'https://chatgpt.com/c/private-chat-token'
  });
  await context.storeCaptureContext(7, first);
  assert.equal((await context.readState()).captureContexts['7'].pageUrl, 'https://chatgpt.com/c/private-chat-token');

  const cleared = await context.clearState();
  assert.deepEqual(JSON.parse(JSON.stringify(cleared.captureContexts)), {});
  assert.equal(JSON.stringify(cleared).includes('private-chat-token'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(readStored().captureContexts)), {});
  assert.equal(JSON.stringify(readStored()).includes('private-chat-token'), false);

  const next = context.normalizeCaptureContext({
    id: 'context-new', documentId: 'document-new', documentStartedAt: now + 1,
    visitStartedAt: now + 1, revision: 1, reloadEligible: true,
    pageUrl: 'https://chatgpt.com/c/new-conversation'
  });
  const reopened = await context.storeCaptureContext(7, next);
  assert.equal(reopened.captureContexts['7'].pageUrl, 'https://chatgpt.com/c/new-conversation');
});

test('页面钩子在首次控制握手前不采集，启用设置到达后恢复实时采集', async () => {
  const harness = pageHookHarness();
  const beforeControl = harness.messages.filter((message) => message.source === 'chatgpt-route-inspector' && message.observation);
  assert.equal(beforeControl.length, 0);
  const initialContext = harness.messages.find((message) => message.source === 'chatgpt-route-inspector-context');
  assert.equal(initialContext.context.reloadEligible, true);

  await harness.window.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST', body: messageRequest
  });
  await flushAsyncWork();
  assert.equal(harness.messages.filter((message) => message.source === 'chatgpt-route-inspector' && message.observation).length, 0);

  harness.dispatchControl(true);
  await harness.window.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST', body: messageRequest
  });
  await flushAsyncWork();
  const observations = harness.messages.filter((message) => message.source === 'chatgpt-route-inspector' && message.observation);
  assert.ok(observations.length > 0);
  assert.equal(observations[0].observation.requestedModel, 'gpt-5-2');
});

test('首次握手确认关闭时停止重载 DOM 兜底和实时采集', async () => {
  const harness = pageHookHarness();
  const initialContext = harness.messages.find((message) => message.source === 'chatgpt-route-inspector-context');
  assert.equal(initialContext.context.reloadEligible, true);

  harness.dispatchControl(false);
  const contexts = harness.messages.filter((message) => message.source === 'chatgpt-route-inspector-context');
  assert.equal(contexts.at(-1).context.reloadEligible, false);
  await harness.window.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST', body: messageRequest
  });
  await flushAsyncWork();
  assert.equal(harness.messages.some((message) => message.source === 'chatgpt-route-inspector' && message.observation), false);
});
