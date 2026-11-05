(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const role = scriptUrl.searchParams.get('role') || 'page';
  const STATE_KEY = 'route-lens-preview-state-v1';
  const REQUESTS_KEY = 'route-lens-preview-requests-v1';
  const CHANNEL_NAME = 'route-lens-preview-state-v1';
  const localPageUrl = `${location.origin}/c/mock-conversation`;
  const chatPageUrl = 'https://chatgpt.com/c/mock-conversation';
  const timestamp = Date.now();

  const makeTurn = (tabId, captureContextId, pageUrl) => ({
    schema: 'chatgpt-route-observation',
    schemaVersion: '1.9.0',
    captureId: `preview-capture-${tabId}`,
    captureContextId,
    sources: ['page_fetch'],
    captureMode: 'live',
    phase: 'completed',
    tabId,
    pageUrl,
    observedAt: new Date(timestamp).toISOString(),
    startedAt: new Date(timestamp - 1380).toISOString(),
    completedAt: new Date(timestamp).toISOString(),
    durationMs: 1380,
    requestedModel: 'gpt-5-6-pro',
    resolvedModelSlug: 'gpt-5-6-mini',
    serverModelSlug: 'gpt-5-6-mini',
    routeModel: 'gpt-5-6-mini',
    routeModelSources: ['resolved_model_slug', 'server_ste_metadata.model_slug'],
    modelLabel: 'gpt-5-6-pro',
    modelLabelSources: ['assistant.metadata.model_slug'],
    modelLabelConflict: false,
    verdict: 'mismatch',
    reasons: ['Request and server-reported fields differ; model label differs from server report'],
    requestId: `preview-request-${tabId}`,
    conversationId: 'mock-conversation',
    conversationMode: null,
    taskKind: null,
    researchReportModel: null,
    researchWidgetId: null,
    researchMessageId: null,
    selectedSourcesCount: null,
    toolInvoked: null,
    toolName: null,
    isSearch: null,
    hadImage: null,
    fastConvo: null
  });

  const newState = () => {
    const pageContextId = 'preview-page-context';
    const popupContextId = 'preview-popup-context';
    return {
      revision: 1,
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
      },
      captureContexts: {
        1: {
          id: pageContextId,
          documentId: 'preview-document',
          documentStartedAt: timestamp - 1000,
          visitStartedAt: timestamp - 1000,
          revision: 1,
          reloadEligible: false,
          pageUrl: localPageUrl
        },
        2: {
          id: popupContextId,
          documentId: 'preview-chat-document',
          documentStartedAt: timestamp - 1000,
          visitStartedAt: timestamp - 1000,
          revision: 1,
          reloadEligible: false,
          pageUrl: chatPageUrl
        }
      },
      turns: [
        makeTurn(1, pageContextId, localPageUrl),
        makeTurn(2, popupContextId, chatPageUrl)
      ],
      powReadings: [],
      parserHealth: { lastSuccessAt: new Date(timestamp).toISOString(), lastFailureAt: null, consecutiveFailures: 0 }
    };
  };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }

  let state = readJson(STATE_KEY, null);
  if (!state) state = newState();
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  const listeners = new Set();
  const channel = new BroadcastChannel(CHANNEL_NAME);

  function publish(next) {
    state = next;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    channel.postMessage({ type: 'route:state-changed', state });
    for (const listener of listeners) listener({ type: 'route:state-changed', state });
  }

  channel.addEventListener('message', (event) => {
    if (event.data?.type !== 'route:state-changed' || !event.data.state) return;
    state = event.data.state;
    for (const listener of listeners) listener({ type: 'route:state-changed', state });
  });

  const ranges = {
    railWidthPx: [64, 112],
    railHeightPercent: [40, 90],
    railPositionPercent: [0, 100],
    railFontSizePx: [9, 14],
    railOpacityPercent: [55, 100]
  };

  function logRequest(request) {
    const entries = readJson(REQUESTS_KEY, []);
    entries.push(request);
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(entries));
  }

  const runtime = {
    sendMessage: async (request) => {
      logRequest(request);
      if (request.type === 'route:get-state') {
        return { ok: true, state, ...(role === 'page' ? { tabId: 1 } : {}) };
      }
      if (request.type === 'route:update-settings') {
        const patch = { ...request.settings };
        for (const [key, [min, max]] of Object.entries(ranges)) {
          if (!Object.hasOwn(patch, key)) continue;
          const value = Number(patch[key]);
          if (!Number.isFinite(value)) return { ok: false, error: `Invalid appearance setting: ${key}.` };
          patch[key] = Math.max(min, Math.min(max, Math.round(value)));
        }
        const next = { ...state, revision: (state.revision ?? 0) + 1, settings: { ...state.settings, ...patch } };
        publish(next);
        return { ok: true, state: next };
      }
      if (request.type === 'route:context' && role === 'page') {
        const next = {
          ...state,
          revision: (state.revision ?? 0) + 1,
          captureContexts: { ...state.captureContexts, 1: request.context }
        };
        publish(next);
        return { ok: true, state: next, tabId: 1 };
      }
      if (request.type === 'route:clear') {
        const next = { ...state, revision: (state.revision ?? 0) + 1, turns: [], powReadings: [], captureContexts: {} };
        publish(next);
        return { ok: true, state: next };
      }
      if (request.type === 'route:observation' || request.type === 'pow:observation') return { ok: true, state };
      return { ok: true, state };
    },
    onMessage: { addListener: (listener) => listeners.add(listener) },
    getManifest: () => ({ version: '1.3.1' }),
    getURL: (path) => `${location.origin}/extension/${path}`,
    openOptionsPage: async () => {}
  };

  window.chrome = {
    i18n: { getUILanguage: () => 'zh-CN' },
    runtime,
    tabs: {
      query: async () => [{ id: 2, active: true, currentWindow: true, url: chatPageUrl }],
      create: async ({ url }) => ({ id: 3, url }),
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} }
    },
    storage: {
      local: {
        get: async () => ({ state }),
        set: async (values) => {
          const next = values.state;
          if (next) publish(next);
        }
      }
    }
  };

  window.routeLensPreview = {
    state: () => state,
    requests: () => readJson(REQUESTS_KEY, []),
    role,
    setLongModels: () => {
      const requestedModel = 'gpt-5-6-pro-enterprise-preview-with-an-extraordinarily-long-request-routing-suffix';
      const routeModel = 'gpt-5-6-mini-enterprise-preview-with-an-extraordinarily-long-response-routing-suffix';
      const next = {
        ...state,
        revision: (state.revision ?? 0) + 1,
        turns: state.turns.map((turn) => ({ ...turn, requestedModel, resolvedModelSlug: routeModel, serverModelSlug: routeModel, routeModel }))
      };
      publish(next);
    }
  };
})();
