import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const [workerSource, popupSource, dashboardSource] = await Promise.all([
  readFile(resolve(root, 'extension/background/service-worker.js'), 'utf8'),
  readFile(resolve(root, 'extension/ui/popup/index.js'), 'utf8'),
  readFile(resolve(root, 'extension/ui/dashboard/index.js'), 'utf8')
]);
const stateKey = 'chatgptRouteInspectorStateV1';

function createWorkerHarness(initialState = {}) {
  let stored = { [stateKey]: initialState };
  let messageListener = null;
  const noopListener = { addListener() {} };
  const chrome = {
    runtime: {
      onInstalled: noopListener,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      },
      getManifest: () => ({ version: '1.3.1' }),
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: async () => ({})
    },
    tabs: {
      onUpdated: noopListener,
      onRemoved: noopListener,
      query: async () => [],
      sendMessage: async () => ({}),
      create: async () => ({})
    },
    storage: {
      local: {
        async get(key) {
          await Promise.resolve();
          return { [key]: stored[key] ? structuredClone(stored[key]) : undefined };
        },
        async set(update) {
          await Promise.resolve();
          stored = { ...stored, ...structuredClone(update) };
        }
      }
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {}
    }
  };

  const context = {
    chrome,
    console,
    URL,
    Date,
    BigInt,
    Map,
    Set,
    Promise,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Math,
    JSON,
    Error,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(workerSource, context);

  function sendMessage(raw, sender = {}) {
    return new Promise((resolveFn) => {
      messageListener(raw, sender, resolveFn);
    });
  }

  return {
    sendMessage,
    readStored: () => stored[stateKey]
  };
}

function loadPrivacyHelpers(source, endMarker) {
  const start = source.indexOf('STANDARD_CONVERSATION_PATH');
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `could not slice privacy helpers before ${endMarker}`);
  const snippet = `${source.slice(lineStart, end)}\n({ redactConversationPathname, redactedId, sanitizePageUrl, sanitizeTurn, sanitizedExport, buildMarkdownReport });`;
  return vm.runInNewContext(snippet, { URL, Date, String, Object, Array });
}

test('concurrent route:update-settings calls serialize without losing writes', async () => {
  const worker = createWorkerHarness();
  const [first, second] = await Promise.all([
    worker.sendMessage({ type: 'route:update-settings', settings: { theme: 'dark' } }),
    worker.sendMessage({ type: 'route:update-settings', settings: { railWidthPx: 96 } })
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const persisted = worker.readStored();
  assert.equal(persisted.settings.theme, 'dark');
  assert.equal(persisted.settings.railWidthPx, 96);
  assert.equal(persisted.revision, 2);
});

test('route:update-settings enforces strict allowlist and rejects invalid payloads', async () => {
  const worker = createWorkerHarness();

  const badRaw = await worker.sendMessage(null);
  assert.equal(badRaw.ok, false);
  assert.equal(badRaw.error, 'Invalid request.');

  const unknownKey = await worker.sendMessage({
    type: 'route:update-settings',
    settings: { unexpectedAdminFlag: true }
  });
  assert.equal(unknownKey.ok, false);
  assert.match(unknownKey.error, /Unsupported setting/);

  const badType = await worker.sendMessage({
    type: 'route:update-settings',
    settings: { overlayEnabled: 'yes' }
  });
  assert.equal(badType.ok, false);

  const badRetention = await worker.sendMessage({
    type: 'route:update-settings',
    settings: { retentionLimit: Number.NaN }
  });
  assert.equal(badRetention.ok, false);
});

test('retentionLimit clamps to 10..500 on load and update, trimming stored turns immediately', async () => {
  const turns = Array.from({ length: 25 }, (_, index) => ({
    captureId: `cap-${index + 1}`,
    captureContextId: 'ctx-1',
    tabId: 1,
    captureMode: 'live',
    phase: 'completed',
    observedAt: '2026-11-05T03:00:00.000Z',
    startedAt: '2026-11-05T03:00:00.000Z',
    completedAt: '2026-11-05T03:00:01.000Z',
    durationMs: 1000,
    sources: ['page_fetch'],
    pageUrl: 'https://chatgpt.com/c/demo',
    conversationId: 'demo',
    requestedModel: 'gpt-5-2',
    routeModel: 'gpt-5-2',
    routeModelSources: ['resolved_model_slug'],
    modelLabel: 'gpt-5-2',
    modelLabelSources: ['assistant.metadata.model_slug'],
    modelLabelConflict: false,
    verdict: 'normal'
  }));
  const worker = createWorkerHarness({
    revision: 5,
    turns,
    settings: { retentionLimit: 9999 }
  });

  const loaded = await worker.sendMessage({ type: 'route:get-state' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.settings.retentionLimit, 500);

  const shrunk = await worker.sendMessage({
    type: 'route:update-settings',
    settings: { retentionLimit: 3 }
  });
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.state.settings.retentionLimit, 10);
  assert.equal(shrunk.state.turns.length, 10);
});

test('popup and dashboard export privacy helpers redact project/share URLs, short IDs, tabIds, and Markdown pipes', () => {
  const surfaces = [
    ['popup', loadPrivacyHelpers(popupSource, '// Page Scope')],
    ['dashboard', loadPrivacyHelpers(dashboardSource, '// src/core/state.ts')]
  ];

  for (const [name, helpers] of surfaces) {
    assert.equal(
      helpers.sanitizePageUrl('https://chatgpt.com/g/g-p-secret-slug?foo=1#bar'),
      'https://chatgpt.com/g/[redacted]',
      `${name}: redacts /g/<slug>`
    );
    assert.equal(
      helpers.sanitizePageUrl('https://chatgpt.com/g/g-p-secret-slug/c/conv-999'),
      'https://chatgpt.com/g/[redacted]/c/[redacted]',
      `${name}: redacts /g/<slug>/c/<id>`
    );
    assert.equal(
      helpers.sanitizePageUrl('https://chatgpt.com/share/share-secret-id'),
      'https://chatgpt.com/share/[redacted]',
      `${name}: redacts /share/<id>`
    );
    assert.equal(helpers.redactedId('abcd1234'), '[redacted]', `${name}: hides <=8-char IDs completely`);
    assert.equal(helpers.redactedId('request-1234567890'), '[redacted:567890]', `${name}: preserves 6-char tail for long IDs`);

    const sampleState = {
      revision: 3,
      captureContexts: { 7: { id: 'ctx-secret' } },
      powReadings: [{ tabId: 7, rawHex: '07a120', decimal: '500000', observedAt: '2026-11-05T03:00:00.000Z' }],
      settings: { includeRequestIdsInExport: false, uiLanguage: 'en' },
      turns: [
        {
          captureId: 'raw-capture-id',
          captureContextId: 'ctx-secret',
          tabId: 7,
          captureMode: 'live',
          observedAt: '2026-11-05T03:00:00.000Z',
          pageUrl: 'https://chatgpt.com/share/my-shared-chat?token=1',
          conversationId: 'short99',
          requestedModel: 'gpt-5|injected\nline',
          modelLabel: 'gpt-5|label',
          modelLabelConflict: false,
          routeModel: 'gpt-5-2',
          routeModelSources: ['resolved_model_slug'],
          verdict: 'normal',
          requestId: 'req-long-identifier-abcdef',
          networkRequestId: 'net-1234'
        }
      ]
    };

    const exported = helpers.sanitizedExport(sampleState);
    assert.deepEqual(JSON.parse(JSON.stringify(exported.captureContexts)), {}, `${name}: clears captureContexts`);
    assert.equal(exported.turns[0].tabId, null, `${name}: scrubs turn tabId`);
    assert.equal(exported.powReadings[0].tabId, null, `${name}: scrubs powReading tabId`);
    assert.equal(exported.turns[0].conversationId, '[redacted]', `${name}: redacts short conversationId`);
    assert.equal(exported.turns[0].networkRequestId, '[redacted]', `${name}: redacts short networkRequestId`);
    assert.equal(exported.turns[0].requestId, '[redacted:abcdef]', `${name}: redacts long requestId`);
    assert.equal(exported.turns[0].pageUrl, 'https://chatgpt.com/share/[redacted]', `${name}: redacts share URL`);

    const report = helpers.buildMarkdownReport(sampleState, 'en');
    assert.match(report, /gpt-5\\\|injected line/, `${name}: escapes pipe and newline in Markdown cells`);
    assert.match(report, /gpt-5\\\|label/, `${name}: escapes pipe in model label`);
  }
});
