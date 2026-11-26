import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const pageHookSource = await readFile(resolve(here, '../extension/content/page-hook.js'), 'utf8');

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
  }
}

function createPageHookEnv({
  fetchImpl,
  locationHref = 'https://chatgpt.com/c/mock-conversation',
  visibilityState = 'visible',
  historyPushState,
  historyReplaceState
} = {}) {
  const parsedUrl = new URL(locationHref);
  const messages = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const activeIntervals = new Map();
  const sockets = [];
  let nextTimerId = 1;
  let sequence = 0;
  let postMessageError = null;

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url);
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, listener, options) {
      const entries = this.listeners.get(type) ?? [];
      entries.push({ listener, once: Boolean(options?.once) });
      this.listeners.set(type, entries);
    }

    emit(type, event) {
      const entries = [...(this.listeners.get(type) ?? [])];
      for (const entry of entries) {
        if (entry.once) {
          const current = this.listeners.get(type) ?? [];
          this.listeners.set(type, current.filter((item) => item !== entry));
        }
        entry.listener(event);
      }
    }
  }

  const location = {
    origin: parsedUrl.origin,
    pathname: parsedUrl.pathname,
    href: parsedUrl.href
  };

  const history = {
    pushState: historyPushState ?? function pushState() {},
    replaceState: historyReplaceState ?? function replaceState() {}
  };

  const window = {
    fetch: fetchImpl ?? (async () => new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })),
    WebSocket: MockWebSocket,
    history,
    addEventListener(type, listener) {
      const entries = windowListeners.get(type) ?? [];
      entries.push(listener);
      windowListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = windowListeners.get(type) ?? [];
      windowListeners.set(type, entries.filter((item) => item !== listener));
    },
    postMessage(data) {
      if (postMessageError) {
        const error = postMessageError;
        postMessageError = null;
        throw error;
      }
      messages.push(data);
    },
    setInterval(callback, delay) {
      const id = nextTimerId++;
      activeIntervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      activeIntervals.delete(id);
    },
    setTimeout() {
      return nextTimerId++;
    },
    clearTimeout() {}
  };

  const document = {
    documentElement: null,
    visibilityState,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) ?? [];
      entries.push(listener);
      documentListeners.set(type, entries);
    }
  };

  const context = {
    window,
    document,
    location,
    URL,
    Headers,
    Request,
    Response,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date,
    BigInt,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Math,
    JSON,
    Error,
    TypeError,
    queueMicrotask,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    crypto: { randomUUID: () => `test-id-${++sequence}` },
    console
  };

  vm.runInNewContext(pageHookSource, context);

  return {
    window,
    document,
    messages,
    activeIntervals,
    sockets,
    failNextPostMessage(error) {
      postMessageError = error;
    },
    dispatchControl(autoCaptureEnabled, revision = 1, captureMode = 'live') {
      for (const listener of windowListeners.get('message') ?? []) {
        listener({
          source: window,
          origin: location.origin,
          data: {
            source: 'chatgpt-route-inspector-control',
            version: 1,
            revision,
            autoCaptureEnabled,
            captureMode,
            clearedAt: null
          }
        });
      }
    },
    setVisibility(nextState) {
      document.visibilityState = nextState;
      for (const listener of documentListeners.get('visibilitychange') ?? []) {
        listener({});
      }
    },
    observations() {
      return messages
        .filter((entry) => entry?.source === 'chatgpt-route-inspector' && entry.observation)
        .map((entry) => entry.observation);
    },
    powEvents() {
      return messages
        .filter((entry) => entry?.source === 'chatgpt-route-inspector' && entry.pow)
        .map((entry) => entry.pow);
    }
  };
}

test('SseDecoder handles CRLF delta_encoding v1 streams, ignores content tokens, and tracks nested metadata mutations', async () => {
  const ssePayload = [
    'event: delta_encoding',
    'data: "v1"',
    '',
    'event: delta',
    'data: {"c":0,"o":"add","p":"","v":{"message":{"id":"asst-1","author":{"role":"assistant"},"metadata":{"model_slug":"gpt-5-2"}}}}',
    '',
    'event: delta',
    'data: {"c":0,"o":"append","p":"/message/content/parts/0","v":"SECRET_ANSWER_TOKEN_1"}',
    '',
    'event: delta',
    'data: {"c":0,"o":"patch","p":"","v":[{"o":"append","p":"/message/content/parts/0","v":"SECRET_ANSWER_TOKEN_2"},{"o":"add","p":"/message/metadata/resolved_model_slug","v":"gpt-5-2"}]}',
    '',
    'data: {"type":"server_ste_metadata","metadata":{"model_slug":"gpt-5-2"}}',
    '',
    'data: [DONE]',
    ''
  ].join('\r\n');

  const env = createPageHookEnv({
    fetchImpl: async () => new Response(ssePayload, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' }
    })
  });
  env.dispatchControl(true, 1);

  await env.window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gpt-5-2',
      conversation_id: 'conv-1',
      messages: [{ id: 'user-1', author: { role: 'user' }, content: { parts: ['SECRET_USER_PROMPT'] } }]
    })
  });
  await flushMicrotasks(20);

  const completed = env.observations().find((item) => item.phase === 'completed');
  assert.ok(completed, 'emits completed observation');
  assert.equal(completed.requestedModel, 'gpt-5-2');
  assert.equal(completed.responseModelSlug, 'gpt-5-2');
  assert.equal(completed.resolvedModelSlug, 'gpt-5-2');
  assert.equal(completed.serverModelSlug, 'gpt-5-2');

  const serialized = JSON.stringify(env.messages);
  assert.doesNotMatch(serialized, /SECRET_USER_PROMPT|SECRET_ANSWER_TOKEN/);
});

test('parseSseStream preserves captured route evidence on AbortError without failing as stream_parse_failed', async () => {
  const encoder = new TextEncoder();
  let readStep = 0;
  let cancelCalled = false;
  const firstChunk = encoder.encode(
    'data: {"message":{"id":"asst-abort","author":{"role":"assistant"},"metadata":{"model_slug":"gpt-5-2","resolved_model_slug":"gpt-5-2"}}}\n\n'
  );
  const mockClone = {
    body: {
      getReader() {
        return {
          async read() {
            readStep++;
            if (readStep === 1) return { value: firstChunk, done: false };
            throw Object.assign(new Error('Stream aborted by user'), { name: 'AbortError' });
          },
          async cancel() {
            cancelCalled = true;
          }
        };
      }
    }
  };
  const mockResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    clone() {
      return mockClone;
    }
  };

  const env = createPageHookEnv({ fetchImpl: async () => mockResponse });
  env.dispatchControl(true, 1);

  await env.window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-5-2', conversation_id: 'conv-abort' })
  });
  await flushMicrotasks(20);

  const observations = env.observations();
  const completed = observations.find((item) => item.phase === 'completed');
  assert.ok(completed, 'emits completed observation with partial evidence');
  assert.equal(completed.resolvedModelSlug, 'gpt-5-2');
  assert.equal(observations.some((item) => item.errorCode === 'stream_parse_failed'), false);
  assert.equal(cancelCalled, true, 'reader.cancel() invoked in finally');
});

test('parseSseStream enforces MAX_SSE_STREAM_BYTES cap and cancels reader cleanly', async () => {
  const line = `: ${' '.repeat(1020)}\n\n`;
  const lineBytes = new TextEncoder().encode(line);
  const chunk4MB = new Uint8Array(4 * 1024 * 1024);
  for (let offset = 0; offset + lineBytes.length <= chunk4MB.length; offset += lineBytes.length) {
    chunk4MB.set(lineBytes, offset);
  }
  let reads = 0;
  let cancelCalled = false;
  const mockClone = {
    body: {
      getReader() {
        return {
          async read() {
            reads++;
            if (reads <= 6) return { value: chunk4MB, done: false };
            return { value: undefined, done: true };
          },
          async cancel() {
            cancelCalled = true;
          }
        };
      }
    }
  };
  const mockResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    clone() {
      return mockClone;
    }
  };

  const env = createPageHookEnv({ fetchImpl: async () => mockResponse });
  env.dispatchControl(true, 1);

  await env.window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-5-2', conversation_id: 'conv-big' })
  });
  await flushMicrotasks(24);

  const failed = env.observations().find((item) => item.phase === 'failed');
  assert.ok(failed, 'emits failed observation on size cap without route evidence');
  assert.equal(failed.errorCode, 'stream_too_large');
  assert.equal(reads, 5, 'stops immediately after exceeding 16MB');
  assert.equal(cancelCalled, true, 'cancels reader when size limit trips');
});

test('inspectFetch cancels unconsumed clone.body in finally when captureEpoch changes mid-request', async () => {
  let resolveBody;
  const deferredBody = new Promise((resolveFn) => {
    resolveBody = resolveFn;
  });
  let cloneCancelCount = 0;
  const mockClone = {
    body: {
      async cancel() {
        cloneCancelCount++;
      }
    }
  };
  const mockResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    clone() {
      return mockClone;
    }
  };

  const env = createPageHookEnv({ fetchImpl: async () => mockResponse });
  env.dispatchControl(true, 1);

  const request = new Request('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-5-2' })
  });
  request.clone = () => ({
    body: null,
    text: () => deferredBody
  });

  await env.window.fetch(request);
  env.dispatchControl(false, 2);
  resolveBody(JSON.stringify({ model: 'gpt-5-2' }));
  await flushMicrotasks(20);

  assert.equal(cloneCancelCount, 1, 'unconsumed clone.body.cancel() called in finally');
});

test('WebSocket binary frames do not clear in-progress route parser state', async () => {
  const handoffSse = 'data: {"type":"stream_handoff","topic_id":"topic-ws-1"}\n\n';
  const env = createPageHookEnv({
    fetchImpl: async () => new Response(handoffSse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
  });
  env.dispatchControl(true, 1);

  await env.window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-5-2', conversation_id: 'conv-ws-1' })
  });
  await flushMicrotasks(20);

  const socket = new env.window.WebSocket('wss://ws.chatgpt.com/ws/user/test');
  const frame1 = JSON.stringify([
    {
      topic_id: 'topic-ws-1',
      payload: {
        payload: {
          encoded_item: 'event: delta_encoding\ndata: "v1"\n\nevent: delta\ndata: {"c":0,"o":"add","p":"","v":{"message":{"id":"asst-ws","author":{"role":"assistant"},"metadata":{"model_slug":"gpt-5-2"}}}}\n\n'
        }
      }
    }
  ]);
  const frame3 = JSON.stringify([
    {
      topic_id: 'topic-ws-1',
      payload: {
        payload: {
          encoded_item: 'event: delta\ndata: {"c":0,"o":"add","p":"/message/metadata/resolved_model_slug","v":"gpt-5-2"}\n\ndata: [DONE]\n\n'
        }
      }
    }
  ]);

  socket.emit('message', { data: frame1 });
  await flushMicrotasks(10);
  socket.emit('message', { data: new Uint8Array([0x01, 0x02, 0x03]) });
  await flushMicrotasks(10);
  socket.emit('message', { data: frame3 });
  await flushMicrotasks(15);

  const wsCompleted = env.observations().find(
    (item) => item.source === 'page_websocket' && item.phase === 'completed'
  );
  assert.ok(wsCompleted, 'emits completed page_websocket observation');
  assert.equal(wsCompleted.responseModelSlug, 'gpt-5-2', 'preserves channel-0 state across binary frame');
  assert.equal(wsCompleted.resolvedModelSlug, 'gpt-5-2', 'applies nested metadata delta after binary frame');
});

test('history.pushState wrapper uses Reflect.apply, preserves return value, and isolates callback failures', () => {
  const recordedCalls = [];
  const env = createPageHookEnv({
    historyPushState(stateArg, titleArg, urlArg) {
      recordedCalls.push({ receiver: this, args: [stateArg, titleArg, urlArg] });
      return 'native-push-return';
    }
  });
  env.failNextPostMessage(new Error('synthetic postMessage failure'));

  const result = env.window.history.pushState({ step: 1 }, '', '/c/next-chat');
  assert.equal(result, 'native-push-return');
  assert.equal(recordedCalls.length, 1);
  assert.equal(recordedCalls[0].receiver, env.window.history);
  assert.deepEqual(recordedCalls[0].args, [{ step: 1 }, '', '/c/next-chat']);
});

test('maintenance timer stops when tab is hidden and resumes when visible', () => {
  const env = createPageHookEnv({ visibilityState: 'hidden' });
  assert.equal(env.activeIntervals.size, 0, 'zero intervals scheduled when hidden');

  env.setVisibility('visible');
  assert.equal(env.activeIntervals.size, 1, 'starts maintenance interval when visible');

  env.setVisibility('hidden');
  assert.equal(env.activeIntervals.size, 0, 'clears maintenance interval when tab hides again');
});

test('privacy boundary: never emits prompt text, Authorization, Cookie, JWT, or PoW seed/proof token', async () => {
  const env = createPageHookEnv({
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('chat-requirements')) {
        return new Response(JSON.stringify({
          proofofwork: { difficulty: '07a120', seed: 'SECRET_POW_SEED_42', required: true },
          token: 'SECRET_PROOF_TOKEN_99'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('data: {"message":{"id":"a1","author":{"role":"assistant"},"metadata":{"resolved_model_slug":"gpt-5-2"}}}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });
  env.dispatchControl(true, 1);

  await env.window.fetch('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.SECRET_JWT_PAYLOAD.SIGNATURE',
      Cookie: '__Secure-next-auth.session-token=SECRET_COOKIE_VAL'
    }
  });
  await env.window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gpt-5-2',
      messages: [{ id: 'u1', author: { role: 'user' }, content: { parts: ['SUPER_SECRET_USER_PROMPT'] } }]
    })
  });
  await flushMicrotasks(20);

  const pows = env.powEvents();
  assert.equal(pows.length, 1);
  assert.equal(pows[0].rawHex, '07a120');

  const serialized = JSON.stringify(env.messages);
  for (const forbidden of [
    'SECRET_POW_SEED_42',
    'SECRET_PROOF_TOKEN_99',
    'SECRET_JWT_PAYLOAD',
    'SECRET_COOKIE_VAL',
    'SUPER_SECRET_USER_PROMPT'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must not emit ${forbidden}`);
  }
});
