import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const bridgeSource = await readFile(resolve(here, '../extension/content/bridge.js'), 'utf8');

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
  }
}

function camelToDataAttr(key) {
  return `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function createFakeDom(innerHtmlTracker) {
  class FakeNode {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.className = '';
      this.textContent = '';
      this.title = '';
      this.lang = '';
      this.type = '';
      this.scrollTop = 0;
      this.parentNode = null;
      this.children = [];
      this.shadowRoot = null;
      this.attributes = new Map();
      this.listeners = new Map();
      const styles = new Map();
      this.style = {
        setProperty(name, value) {
          styles.set(name, String(value));
        },
        getPropertyValue(name) {
          return styles.get(name) ?? '';
        }
      };
      const node = this;
      this.dataset = new Proxy({}, {
        get(_, prop) {
          if (typeof prop !== 'string') return undefined;
          return node.attributes.get(camelToDataAttr(prop));
        },
        set(_, prop, value) {
          if (typeof prop === 'string') {
            node.attributes.set(camelToDataAttr(prop), String(value));
          }
          return true;
        }
      });
    }

    get innerHTML() {
      return '';
    }

    set innerHTML(value) {
      innerHtmlTracker.writes.push({ tag: this.tagName, value });
    }

    get isConnected() {
      let current = this;
      while (current) {
        if (current === documentElement) return true;
        current = current.parentNode;
      }
      return false;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
      if (name === 'class') this.className = String(value);
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    appendChild(child) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    append(...nodes) {
      for (const node of nodes) this.appendChild(node);
    }

    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      for (const node of nodes) this.appendChild(node);
    }

    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }

    attachShadow() {
      const root = new FakeNode('#shadow-root');
      root.parentNode = this;
      this.shadowRoot = root;
      return root;
    }

    addEventListener(type, listener) {
      const entries = this.listeners.get(type) ?? [];
      entries.push(listener);
      this.listeners.set(type, entries);
    }

    click() {
      for (const listener of this.listeners.get('click') ?? []) {
        listener({ target: this });
      }
    }

    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) {
        return this.className.split(/\s+/).includes(selector.slice(1));
      }
      const attrMatch = /^([a-z0-9-]+)?\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(selector);
      if (attrMatch) {
        const [, tag, attr, expected] = attrMatch;
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        if (!this.attributes.has(attr)) return false;
        return expected === undefined || this.attributes.get(attr) === expected;
      }
      const tagClasses = selector.split('.');
      if (tagClasses.length > 1) {
        const [tag, ...classes] = tagClasses;
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const actual = new Set(this.className.split(/\s+/).filter(Boolean));
        return classes.every((name) => actual.has(name));
      }
      return this.tagName === selector.toUpperCase();
    }

    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }

    querySelectorAll(selector) {
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }
  }

  const documentElement = new FakeNode('html');
  documentElement.clientWidth = 1280;
  const document = {
    documentElement,
    createElement: (tag) => new FakeNode(tag),
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    addEventListener() {}
  };
  return { document, documentElement };
}

function makeState(revision, modelSlug) {
  return {
    revision,
    turns: [
      {
        captureId: `cap-${revision}`,
        captureContextId: 'ctx-1',
        tabId: 7,
        captureMode: 'live',
        phase: 'completed',
        observedAt: '2026-11-05T03:00:00.000Z',
        startedAt: '2026-11-05T03:00:00.000Z',
        completedAt: '2026-11-05T03:00:01.000Z',
        durationMs: 1000,
        sources: ['page_fetch'],
        pageUrl: 'https://chatgpt.com/c/mock-conversation',
        conversationId: 'mock-conversation',
        requestedModel: modelSlug,
        routeModel: modelSlug,
        routeModelSources: ['resolved_model_slug'],
        modelLabel: modelSlug,
        modelLabelSources: ['assistant.metadata.model_slug'],
        modelLabelConflict: false,
        verdict: 'normal'
      }
    ],
    captureContexts: {
      7: {
        id: 'ctx-1',
        documentId: 'doc-1',
        documentStartedAt: Date.now() - 5000,
        pageUrl: 'https://chatgpt.com/c/mock-conversation',
        reloadEligible: true,
        revision: 1
      }
    },
    powReadings: [],
    settings: {
      overlayEnabled: true,
      overlayMode: 'mini',
      overlayMinimized: true,
      theme: 'dark',
      retentionLimit: 100,
      includeRequestIdsInExport: false,
      autoCaptureEnabled: true,
      captureMode: 'live',
      uiLanguage: 'en',
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

function createBridgeEnv(initialState) {
  const innerHtmlTracker = { writes: [] };
  const { document, documentElement } = createFakeDom(innerHtmlTracker);
  const windowListeners = new Map();
  const runtimeListeners = new Set();
  const observerEvents = { observed: false, disconnected: false };
  let sendMessageHandler = async (request) => {
    if (request.type === 'route:get-state') {
      return { ok: true, state: initialState, tabId: 7 };
    }
    return { ok: true, state: initialState };
  };

  class FakeMutationObserver {
    observe() {
      observerEvents.observed = true;
    }
    disconnect() {
      observerEvents.disconnected = true;
    }
  }

  const location = {
    origin: 'https://chatgpt.com',
    pathname: '/c/mock-conversation',
    href: 'https://chatgpt.com/c/mock-conversation',
    reload() {}
  };
  const window = {
    innerWidth: 1280,
    addEventListener(type, listener) {
      const entries = windowListeners.get(type) ?? new Set();
      entries.add(listener);
      windowListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    postMessage() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {}
  };
  const chrome = {
    runtime: {
      sendMessage: (request) => sendMessageHandler(request),
      onMessage: {
        addListener: (listener) => runtimeListeners.add(listener),
        removeListener: (listener) => runtimeListeners.delete(listener)
      }
    }
  };

  const context = {
    window,
    document,
    location,
    chrome,
    MutationObserver: FakeMutationObserver,
    URL,
    Date,
    Map,
    Set,
    WeakMap,
    Promise,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Math,
    JSON,
    Error,
    crypto: { randomUUID: () => 'bridge-uuid-1' },
    console
  };
  vm.runInNewContext(bridgeSource, context);

  return {
    window,
    documentElement,
    innerHtmlTracker,
    windowListeners,
    runtimeListeners,
    observerEvents,
    setSendMessageHandler(fn) {
      sendMessageHandler = fn;
    },
    emitRuntimeState(nextState) {
      for (const listener of [...runtimeListeners]) {
        listener({ type: 'route:state-changed', state: nextState });
      }
    },
    emitPageContext(contextPayload) {
      for (const listener of [...(windowListeners.get('message') ?? [])]) {
        listener({
          source: window,
          origin: location.origin,
          data: {
            source: 'chatgpt-route-inspector-context',
            context: contextPayload
          }
        });
      }
    }
  };
}

test('Shadow DOM rail mounts with zero innerHTML and preserves .rail-scroll scrollTop across updates', async () => {
  const env = createBridgeEnv(makeState(1, 'gpt-5-2'));
  await flushMicrotasks(12);

  env.emitPageContext({
    id: 'ctx-1',
    documentId: 'doc-1',
    documentStartedAt: Date.now() - 4000,
    pageUrl: 'https://chatgpt.com/c/mock-conversation',
    reloadEligible: true,
    revision: 1
  });
  await flushMicrotasks(12);

  const host = env.documentElement.querySelector('#chatgpt-route-inspector-root');
  assert.ok(host?.shadowRoot, 'mounts Shadow DOM rail host');
  const scroll = host.shadowRoot.querySelector('.rail-scroll');
  assert.ok(scroll, 'renders .rail-scroll container');
  assert.equal(env.innerHtmlTracker.writes.length, 0, 'never writes innerHTML');

  scroll.scrollTop = 48;
  env.emitRuntimeState(makeState(2, 'gpt-5-2-pro'));
  await flushMicrotasks(12);

  const updatedScroll = host.shadowRoot.querySelector('.rail-scroll');
  assert.equal(updatedScroll, scroll, 'reuses .rail-scroll element incrementally');
  assert.equal(updatedScroll.scrollTop, 48, 'preserves scrollTop across state updates');
  assert.equal(env.innerHtmlTracker.writes.length, 0, 'still zero innerHTML writes');
});

test('Extension context invalidated cleans up observer/listeners and dismiss removes host & narrow-rail style', async () => {
  const env = createBridgeEnv(makeState(1, 'gpt-5-2'));
  await flushMicrotasks(12);

  assert.equal(env.observerEvents.observed, true);
  assert.ok(env.documentElement.querySelector('style[data-route-inspector-layout]'));

  env.setSendMessageHandler(async () => {
    throw new Error('Extension context invalidated.');
  });
  env.emitPageContext({
    id: 'ctx-2',
    documentId: 'doc-1',
    documentStartedAt: Date.now() - 1000,
    pageUrl: 'https://chatgpt.com/c/mock-conversation',
    reloadEligible: true,
    revision: 2
  });
  await flushMicrotasks(16);

  assert.equal(env.observerEvents.disconnected, true, 'disconnects MutationObserver');
  assert.equal(env.windowListeners.get('message')?.size ?? 0, 0, 'removes window message listener');
  assert.equal(env.windowListeners.get('resize')?.size ?? 0, 0, 'removes window resize listener');
  assert.equal(env.runtimeListeners.size, 0, 'removes chrome.runtime.onMessage listener');

  const host = env.documentElement.querySelector('#chatgpt-route-inspector-root');
  const dismissButton = host?.shadowRoot?.querySelector('#dismiss-disconnected');
  assert.ok(dismissButton, 'renders dismiss button in disconnected rail');

  dismissButton.click();

  assert.equal(env.documentElement.querySelector('#chatgpt-route-inspector-root'), null, 'removes rail host on dismiss');
  assert.equal(env.documentElement.querySelector('style[data-route-inspector-layout]'), null, 'clears narrow-rail margin style on dismiss');
});
