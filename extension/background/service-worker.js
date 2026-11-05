// <define:__ROUTE_INSPECTOR_ALLOWED_ORIGINS__>
var define_ROUTE_INSPECTOR_ALLOWED_ORIGINS_default = ["https://chatgpt.com", "https://chat.openai.com"];

// src/core/types.ts
var ROUTE_SCHEMA = "chatgpt-route-observation";
var ROUTE_SCHEMA_VERSION = "1.9.0";
function normalizeOverlayMode(value) {
  if (value === "full" || value === "compact" || value === "mini" || value === "docked") return value;
  return "mini";
}
var EMPTY_QUOTA_FIELDS = {
  deepResearchRemaining: null,
  deepResearchResetAt: null,
  imageGenRemaining: null,
  imageGenResetAt: null,
  quotaObservedAt: null
};
var EMPTY_ROUTE_FIELDS = {
  ...EMPTY_QUOTA_FIELDS,
  taskKind: null,
  researchReportModel: null,
  researchWidgetId: null,
  researchMessageId: null,
  requestedModel: null,
  responseModelSlug: null,
  defaultModelSlug: null,
  resolvedModelSlug: null,
  serverModelSlug: null,
  domModelSlug: null,
  thinkingEffort: null,
  planType: null,
  requestId: null,
  conversationId: null,
  conversationMode: null,
  selectedSourcesCount: null,
  toolInvoked: null,
  toolName: null,
  isSearch: null,
  hadImage: null,
  fastConvo: null
};
var DEFAULT_SETTINGS = {
  overlayEnabled: true,
  overlayMode: "mini",
  overlayMinimized: true,
  theme: "system",
  retentionLimit: 100,
  includeRequestIdsInExport: false,
  autoCaptureEnabled: true,
  captureMode: "live",
  uiLanguage: "en",
  railWidthPx: 72,
  railHeightPercent: 75,
  railPositionPercent: 58,
  railFontSizePx: 10,
  railOpacityPercent: 92,
  showRouteStatus: true,
  showRequestedModel: true,
  showActualModel: true
};

function normalizeAppearanceSettings(settings = {}) {
  const boundedNumber = (key, min, max, fallback) => {
    const value = settings[key];
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
  };
  const boolean = (key, fallback) => typeof settings[key] === "boolean" ? settings[key] : fallback;
  return {
    railWidthPx: boundedNumber("railWidthPx", 64, 112, DEFAULT_SETTINGS.railWidthPx),
    railHeightPercent: boundedNumber("railHeightPercent", 40, 90, DEFAULT_SETTINGS.railHeightPercent),
    railPositionPercent: boundedNumber("railPositionPercent", 0, 100, DEFAULT_SETTINGS.railPositionPercent),
    railFontSizePx: boundedNumber("railFontSizePx", 9, 14, DEFAULT_SETTINGS.railFontSizePx),
    railOpacityPercent: boundedNumber("railOpacityPercent", 55, 100, DEFAULT_SETTINGS.railOpacityPercent),
    showRouteStatus: boolean("showRouteStatus", DEFAULT_SETTINGS.showRouteStatus),
    showRequestedModel: boolean("showRequestedModel", DEFAULT_SETTINGS.showRequestedModel),
    showActualModel: boolean("showActualModel", DEFAULT_SETTINGS.showActualModel)
  };
}

// src/core/language.ts
function normalizeUiLanguage(value) {
  if (typeof value !== "string") return null;
  const normalized2 = value.trim().toLowerCase().replaceAll("_", "-");
  if (normalized2 === "zh" || normalized2.startsWith("zh-")) return "zh";
  if (normalized2 === "en" || normalized2.startsWith("en-")) return "en";
  return null;
}
function detectUiLanguage(locale) {
  return normalizeUiLanguage(locale) === "zh" ? "zh" : "en";
}
function browserUiLanguage() {
  try {
    if (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage) {
      return detectUiLanguage(chrome.i18n.getUILanguage());
    }
  } catch {
  }
  try {
    return detectUiLanguage(globalThis.navigator?.language);
  } catch {
    return "en";
  }
}

// src/core/chatgpt-path.ts
var STANDARD_CONVERSATION_PATH = /^\/c\/([^/]+)(?=\/|$)/;
var PROJECT_CONVERSATION_PATH = /^\/g\/[^/]+\/c\/([^/]+)(?=\/|$)/;
function conversationMatch(pathname) {
  return STANDARD_CONVERSATION_PATH.exec(pathname) ?? PROJECT_CONVERSATION_PATH.exec(pathname);
}
function pathConversationId(pathname) {
  const encodedId = conversationMatch(pathname)?.[1];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId) || null;
  } catch {
    return null;
  }
}
var TEMPORARY_CONVERSATION_PREFIX = "local-chatgpt:";
function conversationIdFromPathname(pathname) {
  const id = pathConversationId(pathname);
  return id?.startsWith(TEMPORARY_CONVERSATION_PREFIX) ? null : id;
}
function redactConversationPathname(pathname) {
  if (PROJECT_CONVERSATION_PATH.test(pathname)) {
    return pathname.replace(/^\/g\/[^/]+\/c\/[^/]+/, "/g/[redacted]/c/[redacted]");
  }
  if (STANDARD_CONVERSATION_PATH.test(pathname)) {
    return pathname.replace(/^\/c\/[^/]+/, "/c/[redacted]");
  }
  return pathname;
}

// src/core/usage-quota.ts
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function remaining(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function timestamp(value) {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function normalizeUsageQuota(value) {
  const source = record(value);
  return {
    deepResearchRemaining: remaining(source?.deepResearchRemaining),
    deepResearchResetAt: timestamp(source?.deepResearchResetAt),
    imageGenRemaining: remaining(source?.imageGenRemaining),
    imageGenResetAt: timestamp(source?.imageGenResetAt),
    quotaObservedAt: timestamp(source?.quotaObservedAt)
  };
}

// src/core/task-kind.ts
function normalizeTaskKind(value) {
  return value === "image_generation" || value === "deep_research" ? value : null;
}

// src/core/observation.ts
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function boundedString(value, maxLength = 512) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}
function validDate(value) {
  const string = boundedString(value, 64);
  return string && Number.isFinite(Date.parse(string)) ? string : null;
}
function safePageUrl(value) {
  const string = boundedString(value, 4096);
  if (!string) return null;
  try {
    const url = new URL(string);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.search = "";
    url.hash = "";
    url.pathname = redactConversationPathname(url.pathname).replace(/^\/backend-api\/(conversations?)\/[^/]+/, "/backend-api/$1/[redacted]");
    return url.toString();
  } catch {
    return null;
  }
}
function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}
function countOrNull(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1e4 ? value : null;
}
function routeFields(record2) {
  return {
    ...EMPTY_ROUTE_FIELDS,
    ...normalizeUsageQuota(record2),
    taskKind: normalizeTaskKind(record2.taskKind),
    researchReportModel: record2.taskKind === "deep_research" ? boundedString(record2.researchReportModel, 256) : null,
    researchWidgetId: record2.taskKind === "deep_research" ? boundedString(record2.researchWidgetId) : null,
    researchMessageId: record2.taskKind === "deep_research" ? boundedString(record2.researchMessageId) : null,
    requestedModel: boundedString(record2.requestedModel, 256),
    responseModelSlug: boundedString(record2.responseModelSlug, 256),
    defaultModelSlug: boundedString(record2.defaultModelSlug, 256),
    resolvedModelSlug: boundedString(record2.resolvedModelSlug, 256),
    serverModelSlug: boundedString(record2.serverModelSlug, 256),
    domModelSlug: boundedString(record2.domModelSlug, 256),
    thinkingEffort: boundedString(record2.thinkingEffort, 128),
    planType: boundedString(record2.planType, 128),
    requestId: boundedString(record2.requestId),
    conversationId: boundedString(record2.conversationId),
    conversationMode: boundedString(record2.conversationMode, 128),
    selectedSourcesCount: countOrNull(record2.selectedSourcesCount),
    toolInvoked: booleanOrNull(record2.toolInvoked),
    toolName: boundedString(record2.toolName, 256),
    isSearch: booleanOrNull(record2.isSearch),
    hadImage: booleanOrNull(record2.hadImage),
    fastConvo: booleanOrNull(record2.fastConvo)
  };
}
function normalizeObservation(value) {
  const record2 = asRecord(value);
  if (!record2) return null;
  const captureId = boundedString(record2.captureId);
  const observedAt = validDate(record2.observedAt);
  const source = record2.source;
  const captureMode = record2.captureMode;
  const phase = record2.phase;
  if (!captureId || !observedAt || !["page_fetch", "page_websocket", "conversation_record", "assistant_dom"].includes(String(source))) return null;
  if (!["live", "reload"].includes(String(captureMode))) return null;
  if (!["requested", "responding", "completed", "failed"].includes(String(phase))) return null;
  const result = {
    captureId,
    source,
    captureMode,
    phase,
    observedAt,
    ...routeFields(record2)
  };
  const captureContextId = boundedString(record2.captureContextId, 128);
  if (captureContextId) result.captureContextId = captureContextId;
  if (typeof record2.tabId === "number" && Number.isInteger(record2.tabId) && record2.tabId >= 0) result.tabId = record2.tabId;
  const pageUrl = safePageUrl(record2.pageUrl);
  if (pageUrl) result.pageUrl = pageUrl;
  const networkRequestId = boundedString(record2.networkRequestId);
  if (networkRequestId) result.networkRequestId = networkRequestId;
  const startedAt = validDate(record2.startedAt);
  if (startedAt) result.startedAt = startedAt;
  const completedAt = validDate(record2.completedAt);
  if (completedAt) result.completedAt = completedAt;
  const errorCode = boundedString(record2.errorCode, 128);
  if (errorCode) result.errorCode = errorCode;
  return result;
}

// src/core/assessment.ts
function normalized(value) {
  return value?.trim().toLowerCase() || null;
}
function assessRoute(fields) {
  if (fields.taskKind) {
    const evidence = assessRoute({ ...fields, taskKind: null });
    return {
      ...evidence,
      verdict: fields.taskKind,
      reasons: [...evidence.reasons, "已识别专用任务；保留路由证据，不以任务模型与所选聊天模型不同判定降级"]
    };
  }
  const requested = normalized(fields.requestedModel);
  const routeCandidates = [
    { source: "resolved_model_slug", model: normalized(fields.resolvedModelSlug) },
    { source: "server_ste_metadata.model_slug", model: normalized(fields.serverModelSlug) }
  ];
  const labelCandidates = [
    { source: "assistant.metadata.model_slug", model: normalized(fields.responseModelSlug) },
    { source: "assistant[data-message-model-slug]", model: normalized(fields.domModelSlug) }
  ];
  const presentRoutes = routeCandidates.filter((candidate) => candidate.model !== null);
  const presentLabels = labelCandidates.filter((candidate) => candidate.model !== null);
  const routeSources = presentRoutes.map((candidate) => candidate.source);
  const modelLabelSources = presentLabels.map((candidate) => candidate.source);
  const routeModels = [...new Set(presentRoutes.map((candidate) => candidate.model))];
  const modelLabels = [...new Set(presentLabels.map((candidate) => candidate.model))];
  const modelLabelConflict = modelLabels.length > 1;
  const modelLabel = modelLabelConflict ? null : modelLabels[0] ?? null;
  const reasons = [];
  if (requested) reasons.push("请求模型：" + requested);
  for (const candidate of presentRoutes) reasons.push(candidate.source + "：" + candidate.model + "（服务器报告的响应模型字段）");
  for (const candidate of presentLabels) reasons.push(candidate.source + "：" + candidate.model + "（模型标签）");
  if (modelLabelConflict) reasons.push("模型标签字段互相不同");
  if (routeModels.length > 1) {
    return {
      verdict: "conflict",
      routeModel: null,
      routeModelSources: routeSources,
      modelLabel,
      modelLabelSources,
      modelLabelConflict,
      reasons: [...reasons, "显式响应路由字段之间存在不一致"]
    };
  }
  const routeModel = routeModels[0] ?? null;
  if (!routeModel) {
    reasons.push(modelLabel ? "只取得模型标签 " + modelLabel + "，没有显式响应路由字段；无法确认是否一致" : "没有显式响应路由字段；无法确认是否一致");
    return { verdict: "unknown", routeModel: null, routeModelSources: [], modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }
  const routeLabelConflict = presentLabels.some((candidate) => candidate.model !== routeModel);
  if (routeLabelConflict) reasons.push("模型标签与服务器报告模型字段不同；保留服务器报告值，标签仅作补充");
  if (routeModel === "gpt-5-6-auto-thinking" || routeModel === "gpt-5-5-auto-thinking" || requested === "auto") {
    return { verdict: "auto_reasoning", routeModel, routeModelSources: routeSources, modelLabel, modelLabelSources, modelLabelConflict, reasons: [...reasons, "已取得显式响应路由；标记为自动推理"] };
  }
  if (!requested) {
    reasons.push("已取得响应路由模型，但缺少请求模型；无法确认是否一致");
    return { verdict: "unknown", routeModel, routeModelSources: routeSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }
  const verdict = requested === routeModel ? "normal" : "mismatch";
  reasons.push(verdict === "normal" ? "请求模型与服务器报告模型字段一致" : "请求模型与服务器报告模型字段不一致");
  return { verdict, routeModel, routeModelSources: routeSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
}

// src/core/turns.ts
function duration(startedAt, completedAt) {
  if (!completedAt) return null;
  const value = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function fieldsFromObservation(observation) {
  return {
    ...EMPTY_ROUTE_FIELDS,
    ...normalizeUsageQuota(observation),
    taskKind: observation.taskKind ?? null,
    researchReportModel: observation.researchReportModel ?? null,
    researchWidgetId: observation.researchWidgetId ?? null,
    researchMessageId: observation.researchMessageId ?? null,
    requestedModel: observation.requestedModel ?? null,
    responseModelSlug: observation.responseModelSlug ?? null,
    defaultModelSlug: observation.defaultModelSlug ?? null,
    resolvedModelSlug: observation.resolvedModelSlug ?? null,
    serverModelSlug: observation.serverModelSlug ?? null,
    domModelSlug: observation.domModelSlug ?? null,
    thinkingEffort: observation.thinkingEffort ?? null,
    planType: observation.planType ?? null,
    requestId: observation.requestId ?? null,
    conversationId: observation.conversationId ?? null,
    conversationMode: observation.conversationMode ?? null,
    selectedSourcesCount: observation.selectedSourcesCount ?? null,
    toolInvoked: observation.toolInvoked ?? null,
    toolName: observation.toolName ?? null,
    isSearch: observation.isSearch ?? null,
    hadImage: observation.hadImage ?? null,
    fastConvo: observation.fastConvo ?? null
  };
}
function assessTurn(fields, captureMode, phase, sources) {
  const assessment = assessRoute(fields);
  return assessment;
}
function createTurn(observation) {
  const fields = fieldsFromObservation(observation);
  const completedAt = observation.completedAt ?? null;
  const startedAt = observation.startedAt ?? observation.observedAt;
  return {
    schema: ROUTE_SCHEMA,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    captureId: observation.captureId,
    ...observation.captureContextId ? { captureContextId: observation.captureContextId } : {},
    sources: [observation.source],
    captureMode: observation.captureMode,
    phase: observation.phase,
    tabId: observation.tabId ?? null,
    pageUrl: observation.pageUrl ?? null,
    networkRequestId: observation.networkRequestId ?? null,
    observedAt: observation.observedAt,
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    errorCode: observation.errorCode ?? null,
    ...fields,
    ...assessTurn(fields, observation.captureMode, observation.phase, [observation.source])
  };
}
var phaseRank = {
  requested: 0,
  responding: 1,
  completed: 2,
  failed: 2
};
function monotonicPhase(current, incoming) {
  return phaseRank[incoming] >= phaseRank[current] ? incoming : current;
}
function mergeTurn(turn, observation) {
  const stale = Date.parse(observation.observedAt) < Date.parse(turn.observedAt);
  const pick = (current, incoming2) => stale ? current ?? incoming2 : incoming2 ?? current;
  const incoming = fieldsFromObservation(observation);
  const fields = {
    taskKind: pick(turn.taskKind, incoming.taskKind),
    researchReportModel: pick(turn.researchReportModel, incoming.researchReportModel),
    researchWidgetId: pick(turn.researchWidgetId, incoming.researchWidgetId),
    researchMessageId: pick(turn.researchMessageId, incoming.researchMessageId),
    deepResearchRemaining: pick(turn.deepResearchRemaining, incoming.deepResearchRemaining),
    deepResearchResetAt: pick(turn.deepResearchResetAt, incoming.deepResearchResetAt),
    imageGenRemaining: pick(turn.imageGenRemaining, incoming.imageGenRemaining),
    imageGenResetAt: pick(turn.imageGenResetAt, incoming.imageGenResetAt),
    quotaObservedAt: pick(turn.quotaObservedAt, incoming.quotaObservedAt),
    requestedModel: pick(turn.requestedModel, incoming.requestedModel),
    responseModelSlug: pick(turn.responseModelSlug, incoming.responseModelSlug),
    defaultModelSlug: pick(turn.defaultModelSlug, incoming.defaultModelSlug),
    resolvedModelSlug: pick(turn.resolvedModelSlug, incoming.resolvedModelSlug),
    serverModelSlug: pick(turn.serverModelSlug, incoming.serverModelSlug),
    domModelSlug: pick(turn.domModelSlug, incoming.domModelSlug),
    thinkingEffort: pick(turn.thinkingEffort, incoming.thinkingEffort),
    planType: pick(turn.planType, incoming.planType),
    requestId: pick(turn.requestId, incoming.requestId),
    conversationId: pick(turn.conversationId, incoming.conversationId),
    conversationMode: pick(turn.conversationMode, incoming.conversationMode),
    selectedSourcesCount: pick(turn.selectedSourcesCount, incoming.selectedSourcesCount),
    toolInvoked: pick(turn.toolInvoked, incoming.toolInvoked),
    toolName: pick(turn.toolName, incoming.toolName),
    isSearch: pick(turn.isSearch, incoming.isSearch),
    hadImage: pick(turn.hadImage, incoming.hadImage),
    fastConvo: pick(turn.fastConvo, incoming.fastConvo)
  };
  const completedAt = pick(turn.completedAt, observation.completedAt ?? null);
  const phase = stale ? turn.phase : monotonicPhase(turn.phase, observation.phase);
  const sources = [.../* @__PURE__ */ new Set([...turn.sources, observation.source])];
  return {
    ...turn,
    ...fields,
    ...assessTurn(fields, observation.captureMode, phase, sources),
    sources,
    captureMode: observation.captureMode,
    phase,
    tabId: observation.tabId ?? turn.tabId,
    pageUrl: pick(turn.pageUrl, observation.pageUrl ?? null),
    networkRequestId: pick(turn.networkRequestId, observation.networkRequestId ?? null),
    observedAt: stale ? turn.observedAt : observation.observedAt,
    completedAt,
    durationMs: duration(turn.startedAt, completedAt),
    errorCode: pick(turn.errorCode, observation.errorCode ?? null)
  };
}
function upsertTurn(turns, observation) {
  const index = turns.findIndex(
    (turn) => turn.tabId === (observation.tabId ?? null) && turn.captureMode === observation.captureMode && turn.captureContextId === observation.captureContextId && (turn.captureId === observation.captureId || observation.requestId !== void 0 && observation.requestId !== null && turn.requestId === observation.requestId && observation.conversationId !== void 0 && observation.conversationId !== null && turn.conversationId === observation.conversationId)
  );
  if (index === -1) return [createTurn(observation), ...turns].sort(newestCaptureFirst);
  const copy = [...turns];
  const existing = copy[index];
  if (!existing) return [createTurn(observation), ...turns];
  copy[index] = mergeTurn(existing, observation);
  return copy.sort(newestCaptureFirst);
}
function newestCaptureFirst(a, b) {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

// src/core/migration.ts
function asRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function sourcesFrom(record2) {
  const allowed = /* @__PURE__ */ new Set(["page_fetch", "page_websocket", "conversation_record", "assistant_dom"]);
  const sources = Array.isArray(record2.sources) ? record2.sources.filter((source) => allowed.has(source)) : [];
  return [...new Set(sources)];
}
function inferMode(record2, sources) {
  if (record2.captureMode === "live" || record2.captureMode === "reload") return record2.captureMode;
  if ((sources.includes("conversation_record") || sources.includes("assistant_dom")) && !sources.includes("page_fetch") && !sources.includes("page_websocket")) return "reload";
  if (typeof record2.pageUrl === "string" && /\/backend-api\/conversations?\//.test(record2.pageUrl)) return "reload";
  return "live";
}
function migrateStoredTurn(value) {
  const record2 = asRecord2(value);
  if (!record2) return null;
  const sources = sourcesFrom(record2);
  if (Array.isArray(record2.sources) && record2.sources.length > 0 && sources.length === 0) return null;
  const source = sources[0] ?? "page_fetch";
  const captureMode = inferMode(record2, sources);
  const observation = normalizeObservation({ ...record2, source, captureMode });
  if (!observation) return null;
  const turn = createTurn(observation);
  return { ...turn, sources: sources.length > 0 ? sources : [source] };
}

// src/core/pow.ts
var MAX_POW_HEX_LENGTH = 256;
var MAX_POW_READINGS = 32;
function asRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function parsePowDifficulty(value) {
  if (typeof value !== "string") return null;
  const rawHex = value.trim();
  if (!rawHex || rawHex.length > MAX_POW_HEX_LENGTH) return null;
  const match = /^(?:0[xX])?([0-9a-fA-F]+)$/.exec(rawHex);
  const digits = match?.[1];
  if (!digits) return null;
  try {
    return { rawHex, decimal: BigInt("0x" + digits).toString(10) };
  } catch {
    return null;
  }
}
function normalizePowObservation(value) {
  const record2 = asRecord3(value);
  if (!record2) return null;
  const parsed = parsePowDifficulty(record2.rawHex);
  const observedAt = timestamp(record2.observedAt);
  const hasStartedAt = Object.hasOwn(record2, "startedAt");
  const startedAt = hasStartedAt ? timestamp(record2.startedAt) : null;
  if (!parsed || !observedAt || hasStartedAt && !startedAt) return null;
  if (startedAt && Date.parse(startedAt) > Date.parse(observedAt)) return null;
  const tabId = typeof record2.tabId === "number" && Number.isInteger(record2.tabId) && record2.tabId >= 0 ? record2.tabId : null;
  return { ...parsed, observedAt, ...(startedAt ? { startedAt } : {}), tabId };
}
function upsertPowReading(readings, observation) {
  const normalized2 = normalizePowObservation(observation);
  if (!normalized2) return readings;
  const reading = {
    rawHex: normalized2.rawHex,
    decimal: normalized2.decimal,
    observedAt: normalized2.observedAt,
    tabId: normalized2.tabId
  };
  return [reading, ...readings.filter((item) => item.tabId !== reading.tabId)].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, MAX_POW_READINGS);
}

// src/core/capture-context.ts
function contextConversation(context) {
  return conversationIdFromPathname(new URL(context.pageUrl).pathname);
}
function hasResponseEvidence(turn) {
  return Boolean(turn.resolvedModelSlug || turn.serverModelSlug || turn.routeModel || turn.modelLabel || turn.modelLabelConflict || turn.taskKind);
}
function latestInContext(state, tabId, mode) {
  if (tabId === void 0) return null;
  const context = state.captureContexts?.[tabId];
  if (!context || context.invalidated) return null;
  const conversation = contextConversation(context);
  const candidates = state.turns.filter((turn) => turn.tabId === tabId && turn.captureMode === mode && turn.captureContextId === context.id && (!conversation || !turn.conversationId || turn.conversationId === conversation) && (mode !== "reload" || Boolean(conversation) && turn.conversationId === conversation));
  if (mode === "reload") {
    const record2 = candidates.find((turn) => turn.sources.includes("conversation_record") && hasResponseEvidence(turn));
    if (record2) return record2;
  }
  return candidates[0] ?? null;
}
function normalizeCaptureContext(value) {
  if (!value || typeof value !== "object") return null;
  const v = value;
  if (typeof v.id !== "string" || !v.id || v.id.length > 128 || typeof v.documentId !== "string" || !v.documentId || v.documentId.length > 128 || !Number.isSafeInteger(v.documentStartedAt) || v.documentStartedAt < 0 || v.visitStartedAt !== void 0 && (!Number.isSafeInteger(v.visitStartedAt) || v.visitStartedAt < v.documentStartedAt) || !Number.isSafeInteger(v.revision) || v.revision < 0 || typeof v.reloadEligible !== "boolean") return null;
  try {
    const url = new URL(v.pageUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return {
      id: v.id,
      documentId: v.documentId,
      documentStartedAt: v.documentStartedAt,
      ...v.invalidated === true ? { invalidated: true } : {},
      ...v.visitStartedAt !== void 0 ? { visitStartedAt: v.visitStartedAt } : {},
      revision: v.revision,
      reloadEligible: v.reloadEligible,
      pageUrl: `${url.origin}${url.pathname}`
    };
  } catch {
    return null;
  }
}
function newerContext(current, incoming) {
  if (current?.invalidated && current.documentId === incoming.documentId) return false;
  return !current || (current.documentId === incoming.documentId ? incoming.revision > current.revision : incoming.documentStartedAt > current.documentStartedAt);
}

// src/background/storage.ts
var STORAGE_KEY = "chatgptRouteInspectorStateV1";
var queue = Promise.resolve();
var cached = null;
function defaultState() {
  return {
    revision: 0,
    turns: [],
    powReadings: [],
    settings: { ...DEFAULT_SETTINGS, uiLanguage: browserUiLanguage() },
    parserHealth: { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
  };
}
async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const candidate = stored[STORAGE_KEY];
  if (!candidate) return defaultState();
  const turns = Array.isArray(candidate.turns) ? candidate.turns.map(migrateStoredTurn).filter((turn) => turn !== null) : [];
  const powReadings = Array.isArray(candidate.powReadings) ? candidate.powReadings.map(normalizePowObservation).filter((reading) => reading !== null) : [];
  const captureMode = candidate.settings?.captureMode === "reload" ? "reload" : "live";
  const uiLanguage = normalizeUiLanguage(candidate.settings?.uiLanguage) ?? browserUiLanguage();
  const theme = ["system", "light", "dark"].includes(candidate.settings?.theme) ? candidate.settings.theme : "system";
  const overlayMode = normalizeOverlayMode(candidate.settings?.overlayMode);
  return {
    revision: Number.isSafeInteger(candidate.revision) && (candidate.revision ?? 0) >= 0 ? candidate.revision : 0,
    ...candidate.clearedAt ? { clearedAt: candidate.clearedAt } : {},
    turns: turns.sort(newestCaptureFirst),
    captureContexts: Object.fromEntries(Object.entries(candidate.captureContexts ?? {}).flatMap(([tab, value]) => {
      const context = normalizeCaptureContext(value);
      return context && /^\d+$/.test(tab) ? [[tab, context]] : [];
    })),
    powReadings,
    settings: {
      ...DEFAULT_SETTINGS,
      ...candidate.settings,
      ...normalizeAppearanceSettings(candidate.settings),
      captureMode,
      uiLanguage,
      theme,
      overlayMode,
      overlayMinimized: overlayMode !== "full"
    },
    parserHealth: candidate.parserHealth ?? { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
  };
}
function currentState() {
  cached ??= loadState().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}
async function readState() {
  await queue;
  return currentState();
}
function clearState() {
  return mutateState((current) => ({
    ...defaultState(),
    settings: current.settings,
    captureContexts: {},
    clearedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
}
function storeCaptureContext(tabId, context) {
  return mutateState((state) => {
    if (!newerContext(state.captureContexts?.[tabId], context)) return state;
    return { ...state, captureContexts: { ...state.captureContexts, [tabId]: context } };
  });
}
function invalidateCaptureContext(tabId, expectedId) {
  return mutateState((state) => {
    const context = state.captureContexts?.[tabId];
    if (!expectedId || !context || context.invalidated || context.id !== expectedId) return state;
    return { ...state, captureContexts: { ...state.captureContexts, [tabId]: { ...context, invalidated: true } } };
  });
}
function storePowObservation(observation) {
  return mutateState((state) => {
    const normalized2 = normalizePowObservation(observation);
    if (!state.settings.autoCaptureEnabled || !normalized2 || isCleared(state, normalized2.startedAt ?? normalized2.observedAt)) return state;
    return { ...state, powReadings: upsertPowReading(state.powReadings, normalized2) };
  });
}
function mutateState(mutator) {
  const operation = queue.then(async () => {
    const current = await currentState();
    const updated = await mutator(current);
    if (updated === current) return current;
    const next = { ...updated, revision: (current.revision ?? 0) + 1 };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    cached = Promise.resolve(next);
    return next;
  });
  queue = operation.then(() => void 0, () => void 0);
  return operation;
}
function storeObservation(observation) {
  return mutateState((state) => {
    if (!state.settings.autoCaptureEnabled || isCleared(state, observation.startedAt ?? observation.observedAt)) return state;
    const turns = upsertTurn(state.turns, observation).slice(0, state.settings.retentionLimit);
    const previous = state.turns.find((turn) => turn.captureId === observation.captureId && turn.tabId === (observation.tabId ?? null) && turn.captureMode === observation.captureMode && turn.captureContextId === observation.captureContextId);
    const stale = previous && Date.parse(observation.observedAt) < Date.parse(previous.observedAt);
    const failed = observation.phase === "failed" && previous?.phase !== "failed";
    const successful = observation.phase !== "requested" && observation.phase !== "failed" && Boolean(
      observation.responseModelSlug || observation.resolvedModelSlug || observation.serverModelSlug || observation.domModelSlug
    );
    return {
      ...state,
      turns,
      parserHealth: stale ? state.parserHealth : failed ? { lastSuccessAt: state.parserHealth.lastSuccessAt, lastFailureAt: observation.observedAt, consecutiveFailures: state.parserHealth.consecutiveFailures + 1 } : successful ? { lastSuccessAt: observation.observedAt, lastFailureAt: state.parserHealth.lastFailureAt, consecutiveFailures: 0 } : state.parserHealth
    };
  });
}
function isCleared(state, startedAt) {
  return Boolean(state.clearedAt && Date.parse(startedAt) <= Date.parse(state.clearedAt));
}

// src/core/page-scope.ts
function supportedPageUrl(value, origins) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return origins.has(url.origin) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}
function displayTabId(state, tab, origins) {
  if (tab?.id === void 0 || tab.pendingUrl) return void 0;
  const pageUrl = supportedPageUrl(tab.url, origins);
  const context = state.captureContexts?.[tab.id];
  return pageUrl && context && !context.invalidated && context.pageUrl === pageUrl ? tab.id : void 0;
}

// src/core/state.ts
function stateForTab(state, tabId) {
  return {
    ...state,
    captureContexts: state.captureContexts?.[tabId] ? { [tabId]: state.captureContexts[tabId] } : {},
    turns: state.turns.filter((turn) => turn.tabId === tabId),
    powReadings: state.powReadings.filter((reading) => reading.tabId === tabId)
  };
}

// src/shared/upgrade-notice.ts
var UPGRADE_NOTICE_VERSION = "1.0.9";
var UPGRADE_NOTICE_PATH = "ui/announcement/index.html";

// src/background/upgrade-notice.ts
var UPGRADE_NOTICE_KEY = "routeInspectorNotice109Shown";
function isNoticeUpgrade(current, details) {
  if (current !== UPGRADE_NOTICE_VERSION || details.reason !== "update" || !details.previousVersion || !/^\d+(?:\.\d+){0,3}$/.test(details.previousVersion)) return false;
  const previous = details.previousVersion.split(".").map(Number);
  const target = [...UPGRADE_NOTICE_VERSION.split(".").map(Number), 0];
  for (let index = 0; index < target.length; index++) {
    const value = previous[index] ?? 0;
    if (value !== target[index]) return value < target[index];
  }
  return false;
}
var opening = null;
async function handleInstallation(details) {
  if (details.reason === "install") return;
  if (!isNoticeUpgrade(chrome.runtime.getManifest().version, details)) return;
  if (opening) return opening;
  opening = (async () => {
    const stored = await chrome.storage.local.get(UPGRADE_NOTICE_KEY);
    if (stored[UPGRADE_NOTICE_KEY] === true) return;
    await chrome.tabs.create({ url: chrome.runtime.getURL(UPGRADE_NOTICE_PATH), active: true });
    await chrome.storage.local.set({ [UPGRADE_NOTICE_KEY]: true });
  })();
  try {
    await opening;
  } finally {
    opening = null;
  }
}

// src/background/service-worker.ts
var allowedOrigins = new Set(define_ROUTE_INSPECTOR_ALLOWED_ORIGINS_default);
var badgeTexts = /* @__PURE__ */ new Map();
async function currentTabPage(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return supportedPageUrl(tab.url, allowedOrigins);
  } catch {
    return null;
  }
}
async function retireOffsiteContext(tabId) {
  const before = await readState();
  const expectedId = before.captureContexts?.[tabId]?.id;
  if (await currentTabPage(tabId) === null) return invalidateCaptureContext(tabId, expectedId);
  return readState();
}
async function updateBadge(tabId, state) {
  if (tabId === void 0) return;
  const latest = latestInContext(state, tabId, state.settings.captureMode);
  const text = !latest || !state.settings.autoCaptureEnabled ? "" : latest.phase === "failed" ? "?" : latest?.verdict === "mismatch" || latest?.verdict === "conflict" ? "!" : latest?.verdict === "normal" ? "OK" : latest?.verdict === "auto_reasoning" ? "AUTO" : latest?.verdict === "image_generation" ? "IMG" : latest?.verdict === "deep_research" ? "DR" : latest?.verdict === "suspected_downgrade" ? "?" : latest?.verdict === "work_unverifiable" ? "WM" : latest?.phase === "requested" || latest?.phase === "responding" ? "\u2026" : "?";
  const color = text === "!" ? "#d95343" : text === "OK" ? "#6fa92e" : text === "AUTO" ? "#367c8c" : text === "IMG" || text === "DR" ? "#776099" : text === "WM" ? "#545e52" : "#b47d2d";
  if (badgeTexts.get(tabId) === text) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  badgeTexts.set(tabId, text);
}
async function broadcast(state) {
  const message = { type: "route:state-changed", state };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
  }
  try {
    const tabs = await chrome.tabs.query({});
    const openIds = new Set(tabs.map((tab) => tab.id));
    for (const tabId of badgeTexts.keys()) if (!openIds.has(tabId)) badgeTexts.delete(tabId);
    await Promise.allSettled(tabs.map(async (tab) => {
      if (tab.id === void 0) return;
      if (!supportedPageUrl(tab.url, allowedOrigins)) {
        if (state.captureContexts?.[tab.id] && !state.captureContexts[tab.id].invalidated) {
          const invalidated = await invalidateCaptureContext(tab.id, state.captureContexts[tab.id].id);
          void publish(invalidated).catch((error) => console.error("Could not publish retired tab context.", error));
        }
        await updateBadge(tab.id, { ...state, captureContexts: {} });
        return;
      }
      await Promise.allSettled([
        updateBadge(tab.id, displayTabId(state, tab, allowedOrigins) === void 0 ? { ...state, captureContexts: {} } : state),
        chrome.tabs.sendMessage(tab.id, { ...message, state: stateForTab(state, tab.id) })
      ]);
    }));
  } catch {
  }
}
var publication = Promise.resolve();
var publishedRevision = -1;
function publish(state) {
  const operation = publication.then(async () => {
    if ((state.revision ?? 0) <= publishedRevision) return;
    await broadcast(state);
    publishedRevision = state.revision ?? 0;
  });
  publication = operation.catch(() => void 0);
  return operation;
}
function refreshTabBadge(tabId) {
  const operation = publication.then(async () => {
    const tab = await chrome.tabs.get(tabId);
    const state = await readState();
    await updateBadge(tabId, displayTabId(state, tab, allowedOrigins) === void 0 ? { ...state, captureContexts: {} } : state);
  });
  publication = operation.catch(() => void 0);
  return operation;
}
async function acceptObservation(observation) {
  const normalized2 = normalizeObservation(observation);
  if (!normalized2) throw new Error("\u65E0\u6548\u7684\u8DEF\u7531\u89C2\u5BDF\u8BB0\u5F55\u3002");
  const state = await storeObservation(normalized2);
  await publish(state);
  return state;
}
async function acceptPowObservation(observation) {
  const state = await storePowObservation(observation);
  await publish(state);
  return state;
}
chrome.runtime.onInstalled.addListener((details) => {
  void handleInstallation(details).catch((error) => console.error("Unable to open the extension welcome or update page.", error));
  if (details.reason === "update" && chrome.runtime.getManifest().version === "1.2.2") {
    void (async () => {
      const next = await mutateState((state) => ({ ...state, settings: { ...state.settings, overlayMode: "mini", overlayMinimized: true } }));
      await publish(next);
    })().catch((error) => console.error("Unable to apply the narrow rail defaults.", error));
  }
});
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const request = raw;
  let contentTabId;
  try {
    if (sender.url && allowedOrigins.has(new URL(sender.url).origin)) contentTabId = sender.tab?.id;
  } catch {
  }
  void (async () => {
    if (request.type === "route:context") {
      const context = normalizeCaptureContext(request.context);
      if (contentTabId === void 0 || !context || new URL(context.pageUrl).origin !== new URL(sender.url).origin) {
        return { ok: false, error: "Invalid capture context." };
      }
      if (await currentTabPage(contentTabId) !== context.pageUrl) {
        return { ok: false, error: "Capture context does not belong to the current page." };
      }
      const state = await storeCaptureContext(contentTabId, context);
      const accepted = state.captureContexts?.[contentTabId];
      if (!accepted || accepted.invalidated || accepted.id !== context.id || accepted.documentId !== context.documentId) {
        return { ok: false, error: "Capture context is no longer current." };
      }
      await publish(state);
      return { ok: true, state };
    }
    if (request.type === "route:observation") {
      const observation = sender.tab?.id === void 0 ? request.observation : { ...request.observation, tabId: sender.tab.id };
      return { ok: true, state: await acceptObservation(observation) };
    }
    if (request.type === "pow:observation") {
      const observation = sender.tab?.id === void 0 ? request.observation : { ...request.observation, tabId: sender.tab.id };
      return { ok: true, state: await acceptPowObservation(observation) };
    }
    if (request.type === "route:get-state") {
      if (Number.isInteger(request.tabId)) await publish(await retireOffsiteContext(request.tabId));
      const state = await readState();
      return sender.tab?.id === void 0 ? { ok: true, state } : { ok: true, state, tabId: sender.tab.id };
    }
    if (request.type === "route:update-settings") {
      const requestedLanguage = request.settings.uiLanguage;
      const requestedTheme = request.settings.theme;
      const uiLanguage = requestedLanguage === void 0 ? void 0 : normalizeUiLanguage(requestedLanguage);
      if (requestedLanguage !== void 0 && !uiLanguage) return { ok: false, error: "Invalid UI language." };
      if (requestedTheme !== void 0 && !["system", "light", "dark"].includes(requestedTheme)) return { ok: false, error: "Invalid theme." };
      const appearanceKeys = ["railWidthPx", "railHeightPercent", "railPositionPercent", "railFontSizePx", "railOpacityPercent", "showRouteStatus", "showRequestedModel", "showActualModel"];
      const appearanceInput = Object.fromEntries(appearanceKeys.filter((key) => Object.hasOwn(request.settings, key)).map((key) => [key, request.settings[key]]));
      for (const [key, value] of Object.entries(appearanceInput)) {
        const expected = key.startsWith("show") ? "boolean" : "number";
        if (typeof value !== expected || expected === "number" && !Number.isFinite(value)) return { ok: false, error: `Invalid appearance setting: ${key}.` };
      }
      const normalizedAppearance = normalizeAppearanceSettings(appearanceInput);
      const normalizedAppearancePatch = Object.fromEntries(Object.keys(appearanceInput).map((key) => [key, normalizedAppearance[key]]));
      const settings = { ...request.settings, ...normalizedAppearancePatch, ...(uiLanguage ? { uiLanguage } : {}) };
      const state = await mutateState((current) => ({ ...current, settings: { ...current.settings, ...settings } }));
      await publish(state);
      return { ok: true, state };
    }
    if (request.type === "route:clear") {
      const state = await clearState();
      await publish(state);
      return { ok: true, state };
    }
    if (request.type === "route:open-dashboard") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("ui/dashboard/index.html") });
      return { ok: true };
    }
    if (request.type === "route:open-appearance") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("ui/appearance/index.html") });
      return { ok: true };
    }
    if (request.type === "route:open-announcement") {
      await chrome.tabs.create({ url: chrome.runtime.getURL(UPGRADE_NOTICE_PATH) });
      return { ok: true };
    }
    return { ok: false, error: "\u672A\u77E5\u8BF7\u6C42\u3002" };
  })().then((response) => sendResponse(response.state && contentTabId !== void 0 ? { ...response, state: stateForTab(response.state, contentTabId) } : response)).catch((error) => sendResponse({
    ok: false,
    error: error instanceof Error ? error.message : "\u6269\u5C55\u5185\u90E8\u9519\u8BEF\u3002"
  }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url === void 0 && change.status === void 0) return;
  if (supportedPageUrl(tab.url, allowedOrigins)) {
    void refreshTabBadge(tabId).catch((error) => console.error("Could not refresh navigation badge.", error));
    return;
  }
  void retireOffsiteContext(tabId).then(publish).catch((error) => console.error("Could not retire navigation context.", error));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  badgeTexts.delete(tabId);
  void mutateState((state) => {
    if (!state.captureContexts?.[tabId]) return state;
    const captureContexts = { ...state.captureContexts };
    delete captureContexts[tabId];
    return { ...state, captureContexts };
  }).then(publish).catch((error) => console.error("Could not clear closed-tab capture context.", error));
});
