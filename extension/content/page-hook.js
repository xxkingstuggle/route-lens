"use strict";
(() => {
  // <define:__ROUTE_INSPECTOR_ALLOWED_ORIGINS__>
  var define_ROUTE_INSPECTOR_ALLOWED_ORIGINS_default = ["https://chatgpt.com", "https://chat.openai.com"];

  // src/core/endpoints.ts
  var POW_REQUIREMENTS_PATHS = /* @__PURE__ */ new Set([
    "/backend-api/sentinel/chat-requirements/prepare",
    "/backend-anon/sentinel/chat-requirements/prepare",
    "/api/sentinel/chat-requirements/prepare",
    "/backend-api/sentinel/chat-requirements",
    "/backend-anon/sentinel/chat-requirements",
    "/api/sentinel/chat-requirements"
  ]);
  function classifyEndpoint(input, base = "https://chatgpt.com/") {
    let url;
    try {
      url = new URL(input, base);
    } catch {
      return { kind: "other", conversationId: null };
    }
    if (url.pathname === "/backend-api/conversation" || /^\/backend-api\/f\/conversations?$/.test(url.pathname)) {
      return { kind: "conversation_stream", conversationId: null };
    }
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
    if (pathname === "/backend-api/conversation/init") return { kind: "conversation_init", conversationId: null };
    if (POW_REQUIREMENTS_PATHS.has(pathname)) {
      return { kind: "pow_requirements", conversationId: null };
    }
    const match = /^\/backend-api\/conversations?\/([^/]+)$/.exec(url.pathname);
    if (match?.[1]) {
      if (["cursor", "offset", "before", "after"].some((key) => url.searchParams.has(key))) {
        return { kind: "other", conversationId: null };
      }
      try {
        return { kind: "conversation_record", conversationId: decodeURIComponent(match[1]) };
      } catch {
        return { kind: "other", conversationId: null };
      }
    }
    return { kind: "other", conversationId: null };
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
  function temporaryConversationIdFromPathname(pathname) {
    const id = pathConversationId(pathname);
    return id?.startsWith(TEMPORARY_CONVERSATION_PREFIX) && id.length > TEMPORARY_CONVERSATION_PREFIX.length ? id : null;
  }
  function conversationIdFromPathname(pathname) {
    const id = pathConversationId(pathname);
    return id?.startsWith(TEMPORARY_CONVERSATION_PREFIX) ? null : id;
  }

  // src/core/capture-context.ts
  function contextConversation(context) {
    return conversationIdFromPathname(new URL(context.pageUrl).pathname);
  }
  var CaptureContextTracker = class {
    constructor(pageUrl, id = () => crypto.randomUUID(), startedAt = Date.now()) {
      this.id = id;
      this.current = {
        id: id(),
        documentId: id(),
        documentStartedAt: startedAt,
        visitStartedAt: startedAt,
        revision: 0,
        pageUrl,
        reloadEligible: Boolean(conversationIdFromPathname(new URL(pageUrl).pathname))
      };
    }
    current;
    previousCreation = null;
    assignedConversation = null;
    creationStartedAt = null;
    navigate(pageUrl) {
      if (pageUrl === this.current.pageUrl) return this.snapshot();
      const old = this.current;
      const pathname = new URL(pageUrl).pathname;
      const conversation = conversationIdFromPathname(pathname);
      const creating = !contextConversation(old) && !old.reloadEligible && this.liveStarted;
      const temporary = temporaryConversationIdFromPathname(pathname);
      const oldTemporary = temporaryConversationIdFromPathname(new URL(old.pageUrl).pathname);
      if (creating && temporary && (!oldTemporary || oldTemporary === temporary)) {
        this.current = { ...old, pageUrl, revision: old.revision + 1 };
        return this.snapshot();
      }
      const promoted = creating && conversation !== null && conversation === this.assignedConversation;
      const unresolvedCreation = creating && conversation !== null && this.assignedConversation === null;
      this.previousCreation = unresolvedCreation ? old : null;
      this.current = {
        ...old,
        id: promoted ? old.id : this.id(),
        pageUrl,
        revision: old.revision + 1,
        visitStartedAt: promoted ? old.visitStartedAt ?? old.documentStartedAt : Date.now(),
        reloadEligible: Boolean(conversation) && !promoted && !unresolvedCreation
      };
      this.liveStarted = promoted;
      this.assignedConversation = null;
      return this.snapshot();
    }
    liveStarted = false;
    startLive() {
      this.previousCreation = null;
      this.liveStarted = true;
      this.creationStartedAt = Date.now();
      this.current = { ...this.current, reloadEligible: false, revision: this.current.revision + 1 };
      return this.snapshot();
    }
    observeLive(contextId, conversationId) {
      if (!conversationId) return;
      if (contextId === this.current.id && !contextConversation(this.current)) this.assignedConversation = conversationId;
      if (this.previousCreation?.id === contextId) {
        const promoted = contextConversation(this.current) === conversationId;
        this.current = {
          ...this.current,
          id: promoted ? contextId : this.current.id,
          reloadEligible: !promoted,
          revision: this.current.revision + 1
        };
        this.previousCreation = null;
        this.liveStarted = promoted;
      }
    }
    abandonCreation(contextId) {
      if (contextId === this.current.id && !contextConversation(this.current) && !this.assignedConversation) this.liveStarted = false;
      if (this.previousCreation?.id === contextId) {
        this.previousCreation = null;
        this.current = { ...this.current, reloadEligible: true, revision: this.current.revision + 1 };
      }
    }
    stopFallback() {
      this.previousCreation = null;
      if (!contextConversation(this.current)) {
        this.liveStarted = false;
        this.assignedConversation = null;
      }
      this.current = { ...this.current, reloadEligible: false, revision: this.current.revision + 1 };
    }
    /** A delayed clear must not sever a creation or visit that started after it. */
    clearBefore(cutoff) {
      if (this.creationStartedAt !== null && this.creationStartedAt <= cutoff) {
        this.previousCreation = null;
        this.assignedConversation = null;
        this.creationStartedAt = null;
        if (!contextConversation(this.current)) this.liveStarted = false;
        this.current = { ...this.current, revision: this.current.revision + 1 };
      }
      if ((this.current.visitStartedAt ?? this.current.documentStartedAt) <= cutoff && this.current.reloadEligible) {
        this.current = { ...this.current, reloadEligible: false, revision: this.current.revision + 1 };
      }
    }
    hasUnresolvedCreation() {
      return this.previousCreation !== null;
    }
    /** New network reads are independent of DOM fallback, but not post-live history reads. */
    canStartReload() {
      return Boolean(contextConversation(this.current)) && !this.liveStarted;
    }
    snapshot() {
      return { ...this.current };
    }
  };

  // src/core/pow.ts
  var MAX_POW_HEX_LENGTH = 256;
  function asRecord(value) {
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
  function parsePowResponse(value) {
    const root = asRecord(value);
    if (!root) return null;
    const roots = [root, asRecord(root.chat_requirements), asRecord(root.requirements)].filter((candidate) => candidate !== null);
    for (const candidate of roots) {
      const proofOfWork = asRecord(candidate.proofofwork) ?? asRecord(candidate.proof_of_work) ?? asRecord(candidate.pow);
      const parsed = parsePowDifficulty(proofOfWork?.difficulty);
      if (parsed) return parsed;
    }
    return null;
  }

  // src/core/types.ts
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
  function projectLimitsProgress(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 128).map((item) => {
      const entry = record(item);
      if (entry?.feature_name !== "deep_research" && entry?.feature_name !== "image_gen") return null;
      return { feature_name: entry.feature_name, remaining: remaining(entry.remaining), reset_after: timestamp(entry.reset_after) };
    });
  }
  function parseUsageQuota(value) {
    const result = { ...EMPTY_QUOTA_FIELDS };
    for (const entry of projectLimitsProgress(record(value)?.limits_progress)) {
      if (!entry) continue;
      if (entry.feature_name === "deep_research") {
        result.deepResearchRemaining = entry.remaining;
        result.deepResearchResetAt = entry.reset_after;
      } else {
        result.imageGenRemaining = entry.remaining;
        result.imageGenResetAt = entry.reset_after;
      }
    }
    return result;
  }
  function hasUsageQuota(fields) {
    return fields.deepResearchRemaining !== null || fields.deepResearchResetAt !== null || fields.imageGenRemaining !== null || fields.imageGenResetAt !== null;
  }
  function quotaSignature(fields) {
    return JSON.stringify([fields.deepResearchRemaining, fields.deepResearchResetAt, fields.imageGenRemaining, fields.imageGenResetAt]);
  }

  // src/core/task-kind.ts
  function record2(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function imageTool(value) {
    return typeof value === "string" && /^(?:image_gen(?:\.text2im)?|dalle\.text2im)$/.test(value);
  }
  function taskFromMetadata(metadata) {
    const hints = metadata.system_hints;
    if (Array.isArray(hints) && hints.includes("plugin:connector_openai_deep_research") || record2(metadata.chatgpt_sdk)?.resource_name === "Deep Research App_start" || record2(metadata.invoked_resource)?.app_name === "Deep Research App") return "deep_research";
    return imageTool(metadata.tool_name) ? "image_generation" : null;
  }
  function taskFromMessage(message) {
    const author = record2(message.author);
    const metadata = record2(message.metadata);
    const task = metadata ? taskFromMetadata(metadata) : null;
    if (task) return task;
    if (author?.role === "tool" && typeof metadata?.image_gen_title === "string" && metadata.image_gen_title.trim()) {
      return "image_generation";
    }
    return author?.role === "assistant" && imageTool(message.recipient) || author?.role === "tool" && imageTool(author.name) ? "image_generation" : null;
  }

  // src/core/request-parser.ts
  function asRecord2(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  function correlationValue(value) {
    const string = stringValue(value);
    return string && string.length <= 512 ? string : null;
  }
  function parseRoot(raw) {
    try {
      return asRecord2(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  function correlationFromRoot(root) {
    const messages = Array.isArray(root?.messages) ? root.messages : [];
    const firstMessage = asRecord2(messages[0]);
    return {
      conversationId: correlationValue(root?.conversation_id),
      inputMessageId: correlationValue(firstMessage?.id),
      parentMessageId: correlationValue(root?.parent_message_id)
    };
  }
  function parseConversationCapture(raw) {
    const root = parseRoot(raw);
    return { fields: fieldsFromRoot(root), correlation: correlationFromRoot(root) };
  }
  function fieldsFromRoot(root) {
    if (!root) return { ...EMPTY_ROUTE_FIELDS };
    const mode = asRecord2(root.conversation_mode);
    const messages = Array.isArray(root.messages) ? root.messages : [];
    const firstMessage = asRecord2(messages[0]);
    const metadata = asRecord2(firstMessage?.metadata);
    const selectedSources = Array.isArray(metadata?.selected_sources) ? metadata.selected_sources : null;
    return {
      ...EMPTY_ROUTE_FIELDS,
      taskKind: firstMessage ? taskFromMessage(firstMessage) : null,
      requestedModel: stringValue(root.model),
      thinkingEffort: stringValue(root.thinking_effort),
      conversationId: stringValue(root.conversation_id),
      conversationMode: stringValue(mode?.kind),
      selectedSourcesCount: selectedSources?.length ?? null
    };
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
        reasons: [...evidence.reasons, "\u5DF2\u8BC6\u522B\u4E13\u7528\u4EFB\u52A1\uFF1B\u4FDD\u7559\u8DEF\u7531\u8BC1\u636E\uFF0C\u4E0D\u4EE5\u4EFB\u52A1\u6A21\u578B\u4E0E\u6240\u9009\u804A\u5929\u6A21\u578B\u4E0D\u540C\u5224\u5B9A\u964D\u7EA7"]
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
    const explicitRouteSources = presentRoutes.map((candidate) => candidate.source);
    const modelLabelSources = presentLabels.map((candidate) => candidate.source);
    const routeModels = [...new Set(presentRoutes.map((candidate) => candidate.model))];
    const modelLabels = [...new Set(presentLabels.map((candidate) => candidate.model))];
    const modelLabelConflict = modelLabels.length > 1;
    const modelLabel = modelLabelConflict ? null : modelLabels[0] ?? null;
    const reasons = [];
    if (requested) reasons.push(`\u8BF7\u6C42\u6A21\u578B\uFF1A${requested}`);
    for (const candidate of presentRoutes) reasons.push(`${candidate.source}\uFF1A${candidate.model}\uFF08\u663E\u5F0F\u54CD\u5E94\u8DEF\u7531\u5B57\u6BB5\uFF09`);
    for (const candidate of presentLabels) reasons.push(`${candidate.source}\uFF1A${candidate.model}\uFF08\u6A21\u578B\u6807\u7B7E\uFF09`);
    if (modelLabelConflict) reasons.push("\u6A21\u578B\u6807\u7B7E\u5B57\u6BB5\u4E92\u76F8\u4E0D\u540C");
    const explicitRouteConflict = routeModels.length > 1;
    const explicitRouteModel = explicitRouteConflict ? null : routeModels[0] ?? null;
    const autoRouteModel = explicitRouteModel;
    if (autoRouteModel === "gpt-5-6-auto-thinking" || autoRouteModel === "gpt-5-5-auto-thinking") {
      return {
        verdict: "auto_reasoning",
        routeModel: autoRouteModel,
        routeModelSources: presentRoutes.length > 0 ? explicitRouteSources : modelLabelSources,
        modelLabel,
        modelLabelSources,
        modelLabelConflict,
        reasons: [...reasons, `\u54CD\u5E94\u8DEF\u7531\u4E3A ${autoRouteModel}\uFF0C\u6807\u8BB0\u4E3A\u81EA\u52A8\u63A8\u7406`]
      };
    }
    if (explicitRouteConflict) {
      return {
        verdict: "conflict",
        routeModel: null,
        routeModelSources: explicitRouteSources,
        modelLabel,
        modelLabelSources,
        modelLabelConflict,
        reasons: [...reasons, "\u54CD\u5E94\u8DEF\u7531\u8BC1\u636E\u5B57\u6BB5\u4E4B\u95F4\u5B58\u5728\u4E0D\u4E00\u81F4"]
      };
    }
    const routeModel = explicitRouteModel;
    const routeModelSources = explicitRouteSources;
    if (!routeModel) {
      reasons.push(modelLabelConflict ? "\u6A21\u578B\u6807\u7B7E\u5B57\u6BB5\u4E92\u76F8\u4E0D\u540C\uFF0C\u65E0\u6CD5\u786E\u5B9A\u54CD\u5E94\u8DEF\u7531" : "\u54CD\u5E94\u4E2D\u6CA1\u6709\u53EF\u7528\u7684\u54CD\u5E94\u8DEF\u7531\u5B57\u6BB5\u6216\u6A21\u578B\u6807\u7B7E");
      return { verdict: "unknown", routeModel: null, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
    }
    if (presentLabels.some((candidate) => candidate.model !== routeModel)) reasons.push("\u6A21\u578B\u6807\u7B7E\u4E0E\u670D\u52A1\u5668\u62A5\u544A\u6A21\u578B\u5B57\u6BB5\u4E0D\u540C\uFF1B\u4FDD\u7559\u670D\u52A1\u5668\u62A5\u544A\u503C\uFF0C\u6807\u7B7E\u4EC5\u4F5C\u8865\u5145");
    if (requested === "auto") {
      reasons.push("\u8BF7\u6C42\u6A21\u578B\u4E3A auto\uFF0C\u5DF2\u53D6\u5F97\u54CD\u5E94\u8DEF\u7531\uFF1B\u6807\u8BB0\u4E3A\u81EA\u52A8\u63A8\u7406");
      return { verdict: "auto_reasoning", routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
    }
    if (!requested) {
      reasons.push("\u5DF2\u53D6\u5F97\u54CD\u5E94\u8DEF\u7531\u6A21\u578B\uFF0C\u4F46\u5F53\u524D\u8BB0\u5F55\u6CA1\u6709\u5BF9\u5E94\u7684\u8BF7\u6C42\u6A21\u578B");
      return { verdict: "unknown", routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
    }
    const verdict = requested === routeModel ? "normal" : "mismatch";
    reasons.push(verdict === "normal" ? "\u8BF7\u6C42\u6A21\u578B\u4E0E\u54CD\u5E94\u8DEF\u7531\u6A21\u578B\u4E00\u81F4" : "\u8BF7\u6C42\u6A21\u578B\u4E0E\u54CD\u5E94\u8DEF\u7531\u6A21\u578B\u4E0D\u4E00\u81F4");
    return { verdict, routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }

  // src/core/research.ts
  function record3(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
  }
  function projectedReport(value) {
    const message = record3(value);
    const metadata = record3(message?.metadata);
    if (record3(message?.author)?.role !== "assistant" || !metadata) return void 0;
    const model = (value2) => typeof value2 === "string" && value2.length <= 256 ? value2.trim() || null : null;
    return { author: { role: "assistant" }, metadata: {
      resolved_model_slug: model(metadata.resolved_model_slug),
      model_slug: model(metadata.model_slug),
      server_ste_metadata: { model_slug: model(record3(metadata.server_ste_metadata)?.model_slug) }
    } };
  }
  function reportModel(state) {
    const message = projectedReport(state?.report_message);
    const metadata = record3(message?.metadata);
    if (!metadata) return null;
    const serverFields = {
      ...EMPTY_ROUTE_FIELDS,
      resolvedModelSlug: metadata.resolved_model_slug,
      serverModelSlug: record3(metadata.server_ste_metadata)?.model_slug,
      responseModelSlug: metadata.model_slug
    };
    const hasServerRoute = Boolean(serverFields.resolvedModelSlug || serverFields.serverModelSlug);
    if (hasServerRoute) return assessRoute(serverFields).routeModel;
    return normalized(serverFields.responseModelSlug);
  }
  function projectResearchWidgetState(value) {
    let state = record3(value);
    if (typeof value === "string" && value.length <= 2 * 1024 * 1024) {
      try {
        state = record3(JSON.parse(value));
      } catch {
        return void 0;
      }
    }
    const report = projectedReport(state?.report_message);
    return report ? { report_message: report } : void 0;
  }
  function researchFromMetadata(metadata, messageId) {
    if (taskFromMetadata(metadata) !== "deep_research") return {};
    const sdk = record3(metadata.chatgpt_sdk);
    let state = record3(sdk?.widget_state);
    if (typeof sdk?.widget_state === "string" && sdk.widget_state.length <= 2 * 1024 * 1024) {
      try {
        state = record3(JSON.parse(sdk.widget_state));
      } catch {
      }
    }
    const widgetId = identifier(sdk?.widget_session_id);
    const ownsReport = Boolean(widgetId || sdk?.resource_name === "Deep Research App_start" || record3(metadata.invoked_resource)?.app_name === "Deep Research App");
    return {
      researchWidgetId: widgetId,
      researchMessageId: ownsReport ? identifier(messageId) : null,
      researchReportModel: reportModel(state)
    };
  }
  function parseResearchUpdates(raw) {
    if (raw.length > 2 * 1024 * 1024) return [];
    let root;
    try {
      root = record3(JSON.parse(raw));
    } catch {
      return [];
    }
    const payload = record3(root?.payload);
    if (root?.type !== "conversation-update" || payload?.update_type !== "update-widget-state") return [];
    const conversationId = identifier(payload.conversation_id);
    const updates = record3(payload.update_content)?.updates;
    if (!conversationId || !Array.isArray(updates)) return [];
    return updates.slice(0, 16).flatMap((value) => {
      const update = record3(value);
      const state = record3(update?.widget_state);
      if (!update || !state) return [];
      const correlationIds = ["id", "message_id", "widget_session_id"].flatMap((key) => {
        const id = identifier(update[key]);
        return id ? [id] : [];
      });
      return [{ conversationId, correlationIds, reportModel: reportModel(state), completed: state.status === "completed" }];
    });
  }
  function matchesResearchUpdate(fields, update) {
    return fields.taskKind === "deep_research" && fields.conversationId === update.conversationId && [fields.researchWidgetId, fields.researchMessageId].some((id) => Boolean(id && update.correlationIds.includes(id)));
  }

  // src/core/sse-decoder.ts
  var MAX_EVENT_CHARS = 1024 * 1024;
  var MAX_CHANNELS = 32;
  var MAX_DEPTH = 16;
  var MAX_OPERATIONS = 512;
  var MAX_STRING_CHARS = 1024;
  var KEYS = /* @__PURE__ */ new Set([
    "message",
    "messages",
    "metadata",
    "server_ste_metadata",
    "author",
    "role",
    "type",
    "name",
    "recipient",
    "system_hints",
    "chatgpt_sdk",
    "resource_name",
    "invoked_resource",
    "app_name",
    "widget_session_id",
    "widget_state",
    "report_message",
    "image_gen_title",
    "working_turn_id",
    "turn_exchange_id",
    "id",
    "parent",
    "parent_id",
    "conversation_id",
    "model_slug",
    "default_model_slug",
    "resolved_model_slug",
    "plan_type",
    "request_id",
    "tool_invoked",
    "tool_name",
    "is_search",
    "did_prompt_contain_image",
    "fast_convo",
    "limits_progress",
    "feature_name",
    "remaining",
    "reset_after"
  ]);
  var OPERATIONS = /* @__PURE__ */ new Set(["add", "replace", "append", "remove", "truncate", "patch"]);
  function record4(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function project(value, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 4096 || depth > MAX_DEPTH) throw new Error("stream_metadata_limit");
    if (typeof value === "string") return value.length <= MAX_STRING_CHARS ? value : void 0;
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (Array.isArray(value)) {
      if (value.length > 128) throw new Error("stream_metadata_limit");
      return value.map((item) => project(item, depth + 1, budget));
    }
    const source = record4(value);
    if (!source) return void 0;
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      if (!KEYS.has(key)) continue;
      if (key === "limits_progress") {
        result[key] = projectLimitsProgress(item);
        continue;
      }
      if (key === "widget_state") {
        result[key] = projectResearchWidgetState(item);
        continue;
      }
      if (key === "image_gen_title") {
        result[key] = typeof item === "string" && item.trim() ? "present" : null;
        continue;
      }
      const projected = project(item, depth + 1, budget);
      if (projected !== void 0) result[key] = projected;
    }
    return result;
  }
  var SseDecoder = class {
    buffer = "";
    eventName = "";
    data = [];
    dataLength = 0;
    previous = { channel: 0, path: "", op: "add" };
    channels = /* @__PURE__ */ new Map();
    push(text, onEvent) {
      this.buffer += text;
      let start = 0;
      for (let index = 0; index < this.buffer.length; index += 1) {
        const char = this.buffer[index];
        if (char !== "\r" && char !== "\n") continue;
        if (char === "\r" && index + 1 === this.buffer.length) break;
        const line = this.buffer.slice(start, index);
        if (char === "\r" && this.buffer[index + 1] === "\n") index += 1;
        start = index + 1;
        this.line(line, onEvent);
      }
      this.buffer = this.buffer.slice(start);
      if (this.buffer.length > MAX_EVENT_CHARS) throw new Error("stream_event_too_large");
    }
    finish(onEvent) {
      if (this.buffer) this.line(this.buffer.replace(/\r$/, ""), onEvent);
      this.buffer = "";
      this.dispatch(onEvent);
    }
    line(line, onEvent) {
      if (line.length > MAX_EVENT_CHARS) throw new Error("stream_event_too_large");
      if (line === "") {
        this.dispatch(onEvent);
        return;
      }
      if (line.startsWith(":")) return;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") this.eventName = value;
      if (field === "data") {
        this.dataLength += value.length + 1;
        if (this.dataLength > MAX_EVENT_CHARS) throw new Error("stream_event_too_large");
        this.data.push(value);
      }
    }
    dispatch(onEvent) {
      const payload = this.data.join("\n");
      const name = this.eventName;
      this.data = [];
      this.dataLength = 0;
      this.eventName = "";
      if (!payload) return;
      if (payload === "[DONE]") {
        onEvent({ value: null, done: true });
        this.channels.clear();
        this.previous = { channel: 0, path: "", op: "add" };
        return;
      }
      let value;
      try {
        value = JSON.parse(payload);
      } catch {
        if (name === "delta" || name === "delta_encoding") throw new Error("invalid_stream_delta");
        for (const line of payload.split("\n")) {
          let item2;
          try {
            item2 = JSON.parse(line);
          } catch {
            continue;
          }
          onEvent({ value: item2, done: false });
        }
        return;
      }
      if (name === "delta_encoding") {
        if (value !== "v1") throw new Error("unsupported_delta_encoding");
        this.channels.clear();
        this.previous = { channel: 0, path: "", op: "add" };
        onEvent({ value: null, done: false, reset: true });
        return;
      }
      const item = record4(value);
      if (name === "delta" && item && ("v" in item || "o" in item || "p" in item || "c" in item)) {
        value = this.delta(item);
      }
      onEvent({ value, done: false });
    }
    delta(item) {
      const channel = "c" in item ? item.c : this.previous.channel;
      const path = "p" in item ? item.p : this.previous.path;
      const op = "o" in item ? item.o : this.previous.op;
      if (typeof channel !== "number" || !Number.isSafeInteger(channel) || channel < 0 || typeof path !== "string" || path.length > MAX_STRING_CHARS || typeof op !== "string" || !OPERATIONS.has(op)) throw new Error("invalid_stream_delta");
      if (!this.channels.has(channel) && this.channels.size >= MAX_CHANNELS) throw new Error("stream_channel_limit");
      const header = { channel, path, op };
      const result = this.apply(this.channels.get(channel), header, item.v, { operations: 0 });
      if ((JSON.stringify(result)?.length ?? 0) > 64 * 1024) throw new Error("stream_metadata_limit");
      this.previous = header;
      this.channels.set(channel, result);
      return result;
    }
    apply(root, delta, value, budget, depth = 0) {
      if (++budget.operations > MAX_OPERATIONS || depth > MAX_DEPTH) throw new Error("stream_patch_limit");
      const { path, op } = delta;
      if (typeof path !== "string" || path.length > MAX_STRING_CHARS || !OPERATIONS.has(op)) throw new Error("invalid_stream_delta");
      const tokens = path === "" ? [] : path.replace(/^\//, "").split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
      if (tokens.length > MAX_DEPTH) throw new Error("stream_patch_limit");
      if (tokens.some((part) => !KEYS.has(part) && !/^(?:0|[1-9]\d{0,2})$/.test(part))) return root;
      const box = { root };
      let parent = box;
      let key = "root";
      for (const token of tokens) {
        let child = parent[key];
        if (!child || typeof child !== "object") {
          child = /^\d+$/.test(token) ? [] : {};
          parent[key] = child;
        }
        parent = child;
        key = Array.isArray(parent) ? Number(token) : token;
        if (Array.isArray(parent) && (!Number.isSafeInteger(key) || Number(key) >= 128)) throw new Error("stream_metadata_limit");
      }
      const target = parent;
      const old = target[key];
      if (op === "patch") {
        if (!Array.isArray(value) || value.length > MAX_OPERATIONS) throw new Error("invalid_stream_delta");
        let patched = old;
        for (const entry of value) {
          const child = record4(entry);
          if (!child || typeof child.o !== "string" || child.p !== void 0 && typeof child.p !== "string") throw new Error("invalid_stream_delta");
          patched = this.apply(patched, { channel: delta.channel, path: child.p ?? "", op: child.o }, child.v, budget, depth + 1);
        }
        target[key] = patched;
      } else if (op === "remove") {
        if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else delete target[key];
      } else if (op === "truncate") {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid_stream_delta");
        if (typeof old === "string") target[key] = old.slice(0, value);
        else if (Array.isArray(old)) old.length = Math.min(old.length, value);
      } else {
        const next = tokens.at(-1) === "widget_state" ? projectResearchWidgetState(value) : tokens.at(-1) === "image_gen_title" ? typeof value === "string" && value.trim() ? "present" : null : project(value);
        if (op === "append" && typeof old === "string" && typeof next === "string") {
          if (old.length + next.length > MAX_STRING_CHARS) throw new Error("stream_metadata_limit");
          target[key] = old + next;
        } else if (op === "append" && Array.isArray(old)) {
          const items = Array.isArray(next) ? next : [next];
          if (old.length + items.length > 128) throw new Error("stream_metadata_limit");
          old.push(...items);
        } else if (op === "append" && record4(old) && record4(next)) {
          Object.assign(old, next);
        } else if (op === "add" && Array.isArray(parent)) {
          if (parent.length >= 128) throw new Error("stream_metadata_limit");
          parent.splice(Number(key), 0, next);
        } else {
          target[key] = next;
        }
      }
      return box.root;
    }
  };

  // src/core/task-identity.ts
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function taskId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
  }
  function taskIdentity(message) {
    const metadata = object(message.metadata);
    return {
      messageId: taskId(message.id),
      parentId: taskId(message.parent_id) ?? taskId(metadata?.parent_id),
      workingTurnId: taskId(metadata?.working_turn_id),
      exchangeId: taskId(metadata?.turn_exchange_id)
    };
  }
  function streamTaskIdentities(value) {
    const identities = [];
    let budget = 0;
    const visit = (value2, depth = 0) => {
      if (++budget > 500 || depth > 10 || identities.length >= 128) return;
      if (Array.isArray(value2)) {
        for (const item of value2.slice(0, 64)) visit(item, depth + 1);
        return;
      }
      const message = object(value2);
      if (!message) return;
      if (["assistant", "tool"].includes(String(object(message.author)?.role))) identities.push(taskIdentity(message));
      for (const key of ["message", "messages", "data"]) if (message[key]) visit(message[key], depth + 1);
    };
    visit(value);
    return identities;
  }
  function compatibleTaskIdentity(a, b) {
    return !(a.workingTurnId && b.workingTurnId && a.workingTurnId !== b.workingTurnId) && !(a.exchangeId && b.exchangeId && a.exchangeId !== b.exchangeId);
  }
  function sameTaskTurn(a, b) {
    return Boolean(a.workingTurnId && a.workingTurnId === b.workingTurnId && compatibleTaskIdentity(a, b));
  }
  function currentTaskIdentity(value) {
    const root = object(value);
    const current = taskId(root?.current_node) ?? taskId(object(root?.current_node)?.id);
    if (!current) return null;
    const mapping = object(root?.mapping);
    const node = object(mapping?.[current]);
    const message = object(node?.message) ?? (Array.isArray(root?.messages) ? root.messages.map(object).find((m) => m?.id === current) : null);
    return message ? taskIdentity(message) : null;
  }
  function parseTaskMessageUpdates(raw) {
    if (raw.length > 2 * 1024 * 1024) return [];
    let root;
    try {
      root = object(JSON.parse(raw));
    } catch {
      return [];
    }
    const payload = object(root?.payload);
    if (root?.type !== "conversation-update" || payload?.update_type !== "add-messages") return [];
    const conversationId = taskId(payload.conversation_id);
    const messages = object(payload.update_content)?.messages;
    if (!conversationId || !Array.isArray(messages) || messages.length > 64) return [];
    return messages.flatMap((value) => {
      const message = object(value);
      if (!message || !["user", "assistant", "tool"].includes(String(object(message.author)?.role))) return [];
      return [{ conversationId, message, identity: taskIdentity(message) }];
    });
  }

  // src/core/response-parser.ts
  function asRecord3(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function stringValue2(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  function identifier2(value) {
    return stringValue2(value) ?? stringValue2(asRecord3(value)?.id);
  }
  function booleanValue(value) {
    return typeof value === "boolean" ? value : null;
  }
  function mergeFields(base, next) {
    const result = { ...base };
    for (const [key, value] of Object.entries(next)) {
      if (value !== null && value !== void 0) {
        result[key] = value;
      }
    }
    return result;
  }
  function extractMetadata(metadata, modelKind = "none") {
    const model = stringValue2(metadata.model_slug);
    return {
      ...parseUsageQuota(metadata),
      taskKind: taskFromMetadata(metadata),
      responseModelSlug: modelKind === "assistant" ? model : null,
      serverModelSlug: modelKind === "server" ? model : null,
      defaultModelSlug: stringValue2(metadata.default_model_slug),
      resolvedModelSlug: stringValue2(metadata.resolved_model_slug),
      planType: stringValue2(metadata.plan_type),
      requestId: stringValue2(metadata.request_id),
      conversationId: stringValue2(metadata.conversation_id),
      toolInvoked: booleanValue(metadata.tool_invoked),
      toolName: stringValue2(metadata.tool_name),
      isSearch: booleanValue(metadata.is_search),
      hadImage: booleanValue(metadata.did_prompt_contain_image),
      fastConvo: booleanValue(metadata.fast_convo)
    };
  }
  function walkForFields(value, accumulator, depth = 0, budget = { count: 0 }) {
    if (depth > 10 || budget.count > 3e3) return accumulator;
    budget.count += 1;
    if (Array.isArray(value)) {
      let result2 = accumulator;
      for (const item of value) {
        if (budget.count > 3e3) break;
        result2 = walkForFields(item, result2, depth + 1, budget);
      }
      return result2;
    }
    const record5 = asRecord3(value);
    if (!record5) return accumulator;
    let result = mergeFields(accumulator, { taskKind: taskFromMessage(record5) });
    const metadata = asRecord3(record5.metadata);
    if (metadata) result = mergeFields(result, researchFromMetadata(metadata, record5.id));
    if (record5.type === "server_ste_metadata" && metadata) {
      result = mergeFields(result, extractMetadata(metadata, "server"));
    } else {
      result = mergeFields(result, extractMetadata(record5));
      if (metadata) {
        const author = asRecord3(record5.author);
        result = mergeFields(result, extractMetadata(metadata, author?.role === "assistant" ? "assistant" : "none"));
      }
    }
    if (typeof record5.conversation_id === "string") {
      result = mergeFields(result, { conversationId: record5.conversation_id });
    }
    for (const [key, nested] of Object.entries(record5)) {
      if (budget.count > 3e3) break;
      if (["content", "parts", "text", "args", "arguments", "input", "output", "report_message", "widget_state"].includes(key)) continue;
      if (record5.type === "server_ste_metadata" && key === "metadata") continue;
      if (nested && typeof nested === "object") result = walkForFields(nested, result, depth + 1, budget);
    }
    return result;
  }
  var ResponseStreamParser = class {
    constructor(onEvent) {
      this.onEvent = onEvent;
    }
    decoder = new SseDecoder();
    fields = { ...EMPTY_ROUTE_FIELDS };
    accept = (event) => {
      if (event.reset) this.fields = { ...EMPTY_ROUTE_FIELDS };
      if (!event.done) this.fields = walkForFields(event.value, this.fields);
      this.onEvent?.(event);
    };
    push(text) {
      this.decoder.push(text, this.accept);
      return { ...this.fields };
    }
    finish() {
      this.decoder.finish(this.accept);
      return { ...this.fields };
    }
  };
  function messageFields(message) {
    const author = asRecord3(message.author);
    const metadata = asRecord3(message.metadata);
    if (!metadata) return { ...EMPTY_ROUTE_FIELDS, taskKind: taskFromMessage(message) };
    let fields = mergeFields(
      { ...EMPTY_ROUTE_FIELDS, taskKind: taskFromMessage(message) },
      extractMetadata(metadata, author?.role === "assistant" ? "assistant" : "none")
    );
    const nestedServerMetadata = asRecord3(metadata.server_ste_metadata);
    if (nestedServerMetadata) fields = mergeFields(fields, extractMetadata(nestedServerMetadata, "server"));
    fields = mergeFields(fields, researchFromMetadata(metadata, message.id));
    return fields;
  }
  function hasModelEvidence(fields) {
    return Boolean(
      fields.responseModelSlug || fields.resolvedModelSlug || fields.serverModelSlug || fields.taskKind
    );
  }
  function fieldsForAssistant(node, nodesById, consumedParents) {
    let fields = node.fields;
    let parentId = node.parentId;
    const visited = /* @__PURE__ */ new Set([node.key, node.messageId]);
    for (let depth = 0; parentId && depth < 64; depth += 1) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = nodesById.get(parentId);
      if (!parent) break;
      fields = mergeFields(parent.fields, fields);
      consumedParents?.add(parent.key);
      if (parent.role === "user") break;
      parentId = parent.parentId;
    }
    for (const sibling of new Set(nodesById.values())) {
      if (sibling === node || !sameTaskTurn(node.identity, sibling.identity)) continue;
      fields = mergeFields(fields, {
        taskKind: sibling.fields.taskKind,
        researchWidgetId: sibling.fields.researchWidgetId,
        researchMessageId: sibling.fields.researchMessageId,
        researchReportModel: sibling.fields.researchReportModel
      });
    }
    return fields;
  }
  function activeAssistant(currentNodeId, nodesById) {
    let node = nodesById.get(currentNodeId) ?? null;
    const visited = /* @__PURE__ */ new Set();
    for (let depth = 0; node && depth < 64; depth += 1) {
      if (visited.has(node.key)) return null;
      visited.add(node.key);
      if (node.role === "assistant" || node.role === "tool" && node.fields.taskKind) return node;
      node = node.parentId ? nodesById.get(node.parentId) ?? null : null;
    }
    return null;
  }
  function parseConversationRecord(value) {
    const root = asRecord3(value);
    const mapping = asRecord3(root?.mapping);
    const messages = Array.isArray(root?.messages) ? root.messages : null;
    if (!mapping && !messages) return [];
    const nodes = [];
    const nodesById = /* @__PURE__ */ new Map();
    const rawNodes = mapping ? Object.entries(mapping) : (messages ?? []).map((message, index) => [String(index), message]);
    for (const [key, rawNode] of rawNodes) {
      const node = asRecord3(rawNode);
      const nestedMessage = asRecord3(node?.message);
      const message = nestedMessage ?? node;
      const author = asRecord3(message?.author);
      const parsed = {
        identity: taskIdentity(message ?? {}),
        key,
        messageId: stringValue2(message?.id) ?? key,
        parentId: identifier2(node?.parent) ?? identifier2(message?.parent_id) ?? identifier2(asRecord3(message?.metadata)?.parent_id),
        role: stringValue2(author?.role),
        fields: message ? messageFields(message) : { ...EMPTY_ROUTE_FIELDS }
      };
      nodes.push(parsed);
      nodesById.set(key, parsed);
      nodesById.set(parsed.messageId, parsed);
    }
    const currentNodeId = identifier2(root?.current_node);
    if (currentNodeId) {
      const assistant = activeAssistant(currentNodeId, nodesById);
      if (assistant) {
        const fields = fieldsForAssistant(assistant, nodesById);
        return hasModelEvidence(fields) ? [fields] : [];
      }
      return [];
    }
    const grouped = /* @__PURE__ */ new Map();
    const consumedParents = /* @__PURE__ */ new Set();
    for (const node of nodes.filter((candidate) => candidate.role === "assistant")) {
      const fields = fieldsForAssistant(node, nodesById, consumedParents);
      if (!hasModelEvidence(fields)) continue;
      const groupKey = fields.requestId ?? node.messageId ?? crypto.randomUUID();
      grouped.set(groupKey, mergeFields(grouped.get(groupKey) ?? { ...EMPTY_ROUTE_FIELDS }, fields));
    }
    for (const node of nodes) {
      if (node.role === "assistant" || consumedParents.has(node.key) || !hasModelEvidence(node.fields)) continue;
      const groupKey = node.fields.requestId ?? node.messageId ?? crypto.randomUUID();
      grouped.set(groupKey, mergeFields(grouped.get(groupKey) ?? { ...EMPTY_ROUTE_FIELDS }, node.fields));
    }
    return [...grouped.values()];
  }
  function parseResponseValue(parsed) {
    const root = asRecord3(parsed);
    if (asRecord3(root?.mapping) || Array.isArray(root?.messages)) {
      return parseConversationRecord(parsed).map((fields) => mergeFields(fields, parseUsageQuota(parsed)));
    }
    return [walkForFields(parsed, { ...EMPTY_ROUTE_FIELDS })];
  }
  function mergeRouteFields(...items) {
    return items.reduce((result, item) => mergeFields(result, item), { ...EMPTY_ROUTE_FIELDS });
  }

  // src/core/websocket-parser.ts
  var MAX_FRAME_BYTES = 2 * 1024 * 1024;
  var MAX_ENCODED_ITEM_BYTES = 1024 * 1024;
  var MAX_ENVELOPES = 16;
  var MAX_CORRELATION_IDS = 8;
  var MAX_ID_LENGTH = 512;
  function asRecord4(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function boundedId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
  }
  function pushUnique(values, value) {
    if (value && values.length < MAX_CORRELATION_IDS && !values.includes(value)) values.push(value);
  }
  function collectCorrelation(value, result, depth = 0) {
    if (depth > 8 || result.visited >= 500) return;
    result.visited += 1;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 32)) {
        if (result.visited >= 500) break;
        collectCorrelation(item, result, depth + 1);
      }
      return;
    }
    const record5 = asRecord4(value);
    if (!record5) return;
    pushUnique(result.conversationIds, boundedId(record5.conversation_id));
    pushUnique(result.parentIds, boundedId(record5.parent_id));
    pushUnique(result.parentIds, boundedId(record5.parent));
    const author = asRecord4(record5.author);
    if (author) pushUnique(result.messageIds, boundedId(record5.id));
    const message = asRecord4(record5.message);
    if (message) pushUnique(result.messageIds, boundedId(message.id));
    if (record5.type === "server_ste_metadata") {
      result.terminal = true;
    }
    for (const [key, nested] of Object.entries(record5)) {
      if (result.visited >= 500) break;
      if (["content", "parts", "text", "args", "arguments", "input", "output"].includes(key)) continue;
      if (nested && typeof nested === "object") collectCorrelation(nested, result, depth + 1);
    }
  }
  function emptyCorrelation() {
    return {
      conversationIds: [],
      messageIds: [],
      parentIds: [],
      terminal: false,
      visited: 0
    };
  }
  var WebSocketRouteParser = class {
    topics = /* @__PURE__ */ new Map();
    clear() {
      this.topics.clear();
    }
    state() {
      const state = {
        parser: new ResponseStreamParser((event) => {
          if (event.reset) {
            state.reset = true;
            state.correlation = emptyCorrelation();
            state.taskIdentities = [];
          }
          state.streamEnded ||= event.done;
          state.correlation.terminal ||= event.done;
          if (!event.done) {
            collectCorrelation(event.value, state.correlation);
            state.taskIdentities.push(...streamTaskIdentities(event.value).slice(0, 128 - state.taskIdentities.length));
          }
        }),
        correlation: emptyCorrelation(),
        streamEnded: false,
        expiresAt: 0,
        reset: false,
        taskIdentities: []
      };
      return state;
    }
    parse(raw) {
      if (raw.length === 0 || raw.length > MAX_FRAME_BYTES) return [];
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      const results = [];
      const timestamp2 = Date.now();
      for (const [topic, state] of this.topics) if (state.expiresAt <= timestamp2) this.topics.delete(topic);
      for (const candidate of parsed.slice(0, MAX_ENVELOPES)) {
        const envelope = asRecord4(candidate);
        const outerPayload = asRecord4(envelope?.payload);
        const innerPayload = asRecord4(outerPayload?.payload);
        const encodedItem = innerPayload?.encoded_item;
        if (typeof encodedItem !== "string" || encodedItem.length === 0 || encodedItem.length > MAX_ENCODED_ITEM_BYTES) continue;
        const topic = boundedId(envelope?.topic_id);
        const state = topic ? this.topics.get(topic) ?? this.state() : this.state();
        const previous = state.correlation;
        state.correlation = emptyCorrelation();
        state.streamEnded = false;
        state.reset = false;
        state.taskIdentities = [];
        let fields;
        let errorCode;
        try {
          state.parser.push(encodedItem);
          fields = state.parser.finish();
        } catch {
          fields = { ...EMPTY_ROUTE_FIELDS };
          errorCode = "stream_decode_failed";
          state.streamEnded = true;
        }
        const correlation = state.correlation;
        for (const key of ["conversationIds", "messageIds", "parentIds"]) {
          if (!state.reset && correlation[key].length === 0) correlation[key] = previous[key];
        }
        pushUnique(correlation.conversationIds, fields.conversationId);
        results.push({
          topicId: topic,
          fields,
          conversationIds: [...correlation.conversationIds],
          messageIds: [...correlation.messageIds],
          parentIds: [...correlation.parentIds],
          taskIdentities: [...state.taskIdentities],
          terminal: correlation.terminal,
          streamEnded: state.streamEnded,
          ...errorCode ? { errorCode } : {}
        });
        if (topic) {
          this.topics.delete(topic);
          if (!state.streamEnded) {
            if (this.topics.size >= 32) this.topics.delete(this.topics.keys().next().value);
            state.expiresAt = timestamp2 + 10 * 60 * 1e3;
            this.topics.set(topic, state);
          }
        }
      }
      return results;
    }
  };

  // src/core/task-captures.ts
  var TTL = 2 * 60 * 60 * 1e3;
  function taskFieldsFrom(fields) {
    return {
      taskKind: fields.taskKind,
      researchWidgetId: fields.researchWidgetId,
      researchMessageId: fields.researchMessageId,
      researchReportModel: fields.researchReportModel,
      resolvedModelSlug: fields.resolvedModelSlug,
      serverModelSlug: fields.serverModelSlug,
      responseModelSlug: fields.responseModelSlug
    };
  }
  var TaskCaptures = class {
    captures = /* @__PURE__ */ new Map();
    clear(before = Infinity) {
      for (const [key, capture] of this.captures) {
        if (Date.parse(capture.observation.startedAt ?? capture.observation.observedAt) <= before) this.captures.delete(key);
      }
    }
    prune(timestamp2) {
      for (const [key, capture] of this.captures) if (capture.expiresAt <= timestamp2) this.captures.delete(key);
    }
    observe(observation, contextId, timestamp2 = Date.now(), identity) {
      this.prune(timestamp2);
      if (observation.captureContextId !== contextId) return;
      const key = `${contextId}:${observation.captureMode}:${observation.captureId}`;
      const existing = this.captures.get(key);
      if (!existing && this.captures.size >= 32) this.captures.delete(this.captures.keys().next().value);
      this.captures.set(key, {
        observation: { ...existing?.observation, ...observation },
        fields: mergeRouteFields(existing?.fields ?? {}, observation),
        expiresAt: existing?.expiresAt ?? timestamp2 + TTL,
        identity: existing?.identity ?? { ...identity ?? { messageId: null, parentId: null, workingTurnId: null, exchangeId: null } },
        messageIds: existing?.messageIds ?? new Set(identity?.messageId ? [identity.messageId] : [])
      });
    }
    /** The HTTP response is already bound to this request, unlike the multiplexed socket. */
    rememberStream(captureId, contextId, value) {
      this.rememberIdentities(captureId, contextId, streamTaskIdentities(value));
    }
    /** Socket callers must first match the envelope to its pending request/topic. */
    rememberIdentities(captureId, contextId, identities) {
      const capture = this.captures.get(`${contextId}:live:${captureId}`);
      if (!capture) return;
      for (const identity of identities.slice(0, 128)) {
        if (compatibleTaskIdentity(capture.identity, identity)) {
          capture.identity.workingTurnId ??= identity.workingTurnId;
          capture.identity.exchangeId ??= identity.exchangeId;
          if (identity.messageId && capture.messageIds.size < 128) capture.messageIds.add(identity.messageId);
        }
      }
    }
    consume(raw, contextId, timestamp2 = Date.now()) {
      this.prune(timestamp2);
      const results = this.consumeMessages(raw, contextId, timestamp2);
      return [...results, ...parseResearchUpdates(raw).flatMap((update) => {
        if (!update.reportModel) return [];
        const matched = this.match(update, contextId, timestamp2);
        return matched;
      })];
    }
    consumeMessages(raw, contextId, timestamp2) {
      let remaining2 = parseTaskMessageUpdates(raw);
      const changed = /* @__PURE__ */ new Map();
      for (let pass = 0; remaining2.length && pass < 64; pass++) {
        const unmatched = [];
        let progress = false;
        for (const update of remaining2) {
          const { identity } = update;
          const matches = [...this.captures.values()].filter((capture2) => {
            if (capture2.observation.captureContextId !== contextId || capture2.fields.conversationId && capture2.fields.conversationId !== update.conversationId || !compatibleTaskIdentity(capture2.identity, identity)) return false;
            const exactMessage = Boolean(identity.messageId && capture2.messageIds.has(identity.messageId));
            const role = update.message.author?.role;
            const linkedParent = role !== "user" && Boolean(identity.parentId && capture2.messageIds.has(identity.parentId));
            return exactMessage || linkedParent || role !== "user" && sameTaskTurn(capture2.identity, identity);
          });
          if (matches.length !== 1) {
            unmatched.push(update);
            continue;
          }
          const capture = matches[0];
          progress = true;
          capture.fields.conversationId ??= update.conversationId;
          capture.identity.workingTurnId ??= identity.workingTurnId;
          capture.identity.exchangeId ??= identity.exchangeId;
          if (identity.messageId && capture.messageIds.size < 128) capture.messageIds.add(identity.messageId);
          const fields = parseResponseValue({ message: update.message })[0];
          if (!fields || !(fields.taskKind || capture.fields.taskKind)) continue;
          const taskFields = taskFieldsFrom(fields);
          const next = mergeRouteFields(capture.fields, taskFields);
          if (JSON.stringify(next) === JSON.stringify(capture.fields)) continue;
          capture.fields = next;
          changed.set(capture, taskFieldsFrom(mergeRouteFields(changed.get(capture) ?? {}, taskFields, { taskKind: next.taskKind })));
        }
        if (!progress) break;
        remaining2 = unmatched;
      }
      return [...changed].map(([capture, fields]) => ({ ...this.observationFor(capture, contextId, timestamp2), ...fields }));
    }
    observationFor(capture, contextId, timestamp2) {
      const { observation } = capture;
      return {
        captureId: observation.captureId,
        captureContextId: contextId,
        captureMode: observation.captureMode,
        source: observation.captureMode === "live" ? "page_websocket" : "conversation_record",
        phase: observation.phase,
        ...observation.startedAt ? { startedAt: observation.startedAt } : {},
        observedAt: new Date(timestamp2).toISOString(),
        ...observation.pageUrl ? { pageUrl: observation.pageUrl } : {},
        conversationId: capture.fields.conversationId
      };
    }
    match(update, contextId, timestamp2) {
      const matches = [...this.captures.values()].filter((capture2) => capture2.observation.captureContextId === contextId && matchesResearchUpdate(capture2.fields, update));
      if (matches.length !== 1 || !update.reportModel) return [];
      const capture = matches[0];
      if (capture.fields.researchReportModel === update.reportModel) return [];
      capture.fields.researchReportModel = update.reportModel;
      return [{
        ...this.observationFor(capture, contextId, timestamp2),
        taskKind: "deep_research",
        conversationId: capture.fields.conversationId,
        researchWidgetId: capture.fields.researchWidgetId,
        researchMessageId: capture.fields.researchMessageId,
        researchReportModel: update.reportModel
      }];
    }
  };

  // src/content/page-hook.ts
  var nativeFetch = window.fetch;
  var nativeWebSocket = window.WebSocket;
  var allowedOrigins = new Set(define_ROUTE_INSPECTOR_ALLOWED_ORIGINS_default);
  var MAX_CONVERSATION_RECORD_BYTES = 8 * 1024 * 1024;
  var MAX_POW_RESPONSE_BYTES = 256 * 1024;
  var MAX_PENDING_CAPTURES = 32;
  var MAX_CAPTURE_TOPICS = 8;
  var PENDING_CAPTURE_TTL_MS = 10 * 60 * 1e3;
  var captureEnabled = false;
  var controlReceived = false;
  var taskCaptures = new TaskCaptures();
  var captureContext = new CaptureContextTracker(`${location.origin}${location.pathname}`);
  var lastContextSignature = "";
  var reloadVisit = { context: captureContext.snapshot(), committedStartedAt: null, unresolvedCreation: false };
  var deferredReloads = /* @__PURE__ */ new Set();
  var earlyReloads = /* @__PURE__ */ new Set();
  var EARLY_RELOAD_TTL_MS = 3e4;
  function syncReloadVisit(context) {
    if (reloadVisit.context.id === context.id) {
      reloadVisit.unresolvedCreation = captureContext.hasUnresolvedCreation();
      if (!reloadVisit.unresolvedCreation) {
        for (const candidate of deferredReloads) {
          if (Date.now() - Date.parse(candidate.startedAt) <= EARLY_RELOAD_TTL_MS) candidate.deliver?.();
        }
        deferredReloads.clear();
      }
      return;
    }
    deferredReloads.clear();
    const previousId = reloadVisit.context.id;
    reloadVisit = { context, committedStartedAt: null, unresolvedCreation: captureContext.hasUnresolvedCreation() };
    for (const candidate of earlyReloads) {
      if (candidate.originContextId === previousId && candidate.conversationId === contextConversation(context) && Date.now() - Date.parse(candidate.startedAt) <= EARLY_RELOAD_TTL_MS && captureContext.canStartReload()) {
        candidate.visit = reloadVisit;
        candidate.deliver?.();
      }
    }
    earlyReloads.clear();
  }
  function publishContext(force = false) {
    captureContext.navigate(`${location.origin}${location.pathname}`);
    if (controlReceived && !captureEnabled && captureContext.snapshot().reloadEligible) captureContext.stopFallback();
    const context = captureContext.snapshot();
    const signature = JSON.stringify(context);
    if (!force && lastContextSignature === signature) return;
    lastContextSignature = signature;
    window.postMessage({ source: "chatgpt-route-inspector-context", version: 1, context }, location.origin);
    syncReloadVisit(context);
  }
  var controlRevision = -1;
  var clearedAt = 0;
  var latestQuota = null;
  var inspectionReaders = /* @__PURE__ */ new Map();
  var captureEpoch = 0;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== "object") return;
    const data = event.data;
    if (data.source === "chatgpt-route-inspector-context-request") {
      publishContext(true);
      return;
    }
    if (data.source !== "chatgpt-route-inspector-control" || data.version !== 1 || typeof data.revision !== "number" || data.revision < controlRevision || typeof data.autoCaptureEnabled !== "boolean" || !["live", "reload"].includes(String(data.captureMode))) return;
    const nextClearedAt = typeof data.clearedAt === "string" ? Date.parse(data.clearedAt) || 0 : 0;
    const firstControl = !controlReceived;
    const pausing = captureEnabled && !data.autoCaptureEnabled;
    if (pausing || nextClearedAt > clearedAt) {
      taskCaptures.clear(pausing ? Infinity : nextClearedAt);
      if (pausing) captureEpoch++;
      for (const [id, pending] of pendingLiveCaptures) {
        if (pausing || Date.parse(pending.startedAt) <= nextClearedAt) pendingLiveCaptures.delete(id);
      }
      if (pausing || Date.parse(latestQuota?.quotaObservedAt ?? "") <= nextClearedAt) latestQuota = null;
      for (const [reader, startedAt] of inspectionReaders) {
        if (pausing || Date.parse(startedAt) <= nextClearedAt) void reader.cancel().catch(() => void 0);
      }
      for (const candidate of earlyReloads) {
        if (pausing || Date.parse(candidate.startedAt) <= nextClearedAt) earlyReloads.delete(candidate);
      }
      for (const candidate of deferredReloads) {
        if (pausing || Date.parse(candidate.startedAt) <= nextClearedAt) deferredReloads.delete(candidate);
      }
      if (pausing) captureContext.stopFallback();
      else {
        captureContext.clearBefore(nextClearedAt);
        if (reloadVisit.unresolvedCreation && !captureContext.hasUnresolvedCreation()) {
          reloadVisit.discarded = true;
          reloadVisit = { ...reloadVisit, discarded: false, unresolvedCreation: false };
        }
      }
      if (pausing || Date.parse(reloadVisit.committedStartedAt ?? "") <= nextClearedAt) reloadVisit.committedStartedAt = null;
      publishContext();
    }
    captureEnabled = data.autoCaptureEnabled;
    controlRevision = data.revision;
    clearedAt = Math.max(clearedAt, nextClearedAt);
    controlReceived = true;
    if (firstControl && !captureEnabled) publishContext();
  });
  window.postMessage({ source: "chatgpt-route-inspector-control-request" }, location.origin);
  function canCapture(_mode, startedAt) {
    return captureEnabled && (!startedAt || Date.parse(startedAt) > clearedAt);
  }
  function now() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  function safePageUrl() {
    return `${location.origin}${location.pathname}`;
  }
  function rememberQuota(fields, startedAt) {
    if (!hasUsageQuota(fields) || !canCapture(null, startedAt)) return null;
    latestQuota = { ...normalizeUsageQuota(fields), quotaObservedAt: now() };
    return latestQuota;
  }
  function emit(observation, identity) {
    if (!canCapture(observation.captureMode, observation.startedAt ?? observation.observedAt)) return;
    if (observation.captureMode === "live" && observation.captureContextId) {
      publishContext();
      captureContext.observeLive(observation.captureContextId, observation.conversationId);
      if (observation.phase === "failed" && ![...pendingLiveCaptures.values()].some((pending) => pending.captureContextId === observation.captureContextId && pending.captureId !== observation.captureId)) {
        captureContext.abandonCreation(observation.captureContextId);
      }
      publishContext();
    }
    const envelope = {
      source: "chatgpt-route-inspector",
      version: 1,
      observation
    };
    window.postMessage(envelope, location.origin);
    taskCaptures.observe(observation, captureContext.snapshot().id, Date.now(), identity);
  }
  function emitPow(pow) {
    if (!canCapture(null, pow.startedAt ?? pow.observedAt)) return;
    const envelope = {
      source: "chatgpt-route-inspector",
      version: 1,
      pow
    };
    window.postMessage(envelope, location.origin);
  }
  function requestUrl(input) {
    if (input instanceof Request) return input.url;
    return String(input);
  }
  function isAllowedRequest(url) {
    try {
      return allowedOrigins.has(location.origin) && new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }
  async function requestBody(input, init) {
    if (typeof init?.body === "string") return init.body;
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return null;
      }
    }
    return null;
  }
  function fieldsSignature(fields) {
    return JSON.stringify(fields);
  }
  var pendingLiveCaptures = /* @__PURE__ */ new Map();
  function prunePendingCaptures(timestamp2 = Date.now()) {
    for (const [captureId, pending] of pendingLiveCaptures) {
      if (!pending.httpActive && pending.expiresAt <= timestamp2) pendingLiveCaptures.delete(captureId);
    }
  }
  function registerPendingCapture(captureId, startedAt, correlation, pageUrl, captureContextId) {
    prunePendingCaptures();
    if (!correlation.conversationId && !correlation.inputMessageId && !correlation.parentMessageId) return;
    while (pendingLiveCaptures.size >= MAX_PENDING_CAPTURES) {
      const oldest = pendingLiveCaptures.keys().next().value;
      if (!oldest) break;
      pendingLiveCaptures.delete(oldest);
    }
    const emptyFields = mergeRouteFields();
    pendingLiveCaptures.set(captureId, {
      captureId,
      captureContextId,
      startedAt,
      pageUrl,
      ...correlation,
      expiresAt: Date.now() + PENDING_CAPTURE_TTL_MS,
      httpActive: true,
      topicIds: /* @__PURE__ */ new Set(),
      webSocketFields: emptyFields,
      lastWebSocketSignature: fieldsSignature(emptyFields)
    });
  }
  function uniqueCandidate(candidates) {
    return candidates.length === 1 ? candidates[0] ?? null : null;
  }
  function boundedCorrelationId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
  }
  function rememberTopic(pending, topicId) {
    if (topicId && pending.topicIds.size < MAX_CAPTURE_TOPICS) pending.topicIds.add(topicId);
  }
  function pendingCaptureFor(evidence) {
    prunePendingCaptures();
    const pending = [...pendingLiveCaptures.values()];
    const inputMatches = pending.filter(
      (candidate) => Boolean(candidate.inputMessageId) && (evidence.messageIds.includes(candidate.inputMessageId ?? "") || evidence.parentIds.includes(candidate.inputMessageId ?? ""))
    );
    const compatible = (candidate) => (!candidate.conversationId || evidence.conversationIds.length === 0 || evidence.conversationIds.includes(candidate.conversationId)) && (!evidence.topicId || candidate.topicIds.size === 0 || candidate.topicIds.has(evidence.topicId));
    const parentMatches = pending.filter(
      (candidate) => Boolean(candidate.parentMessageId) && evidence.parentIds.includes(candidate.parentMessageId ?? "") && (evidence.conversationIds.length === 0 || !candidate.conversationId || evidence.conversationIds.includes(candidate.conversationId))
    );
    const topicMatches = pending.filter((candidate) => Boolean(evidence.topicId && candidate.topicIds.has(evidence.topicId)));
    if (topicMatches.length > 0) {
      const match = uniqueCandidate(topicMatches);
      const identityMatches = inputMatches.length > 0 ? inputMatches : parentMatches;
      return match && compatible(match) && (identityMatches.length === 0 || identityMatches.includes(match)) ? match : null;
    }
    if (inputMatches.length > 0) return uniqueCandidate(inputMatches.filter(compatible));
    if (parentMatches.length > 0) return uniqueCandidate(parentMatches.filter(compatible));
    const conversationMatches = pending.filter(
      (candidate) => Boolean(candidate.conversationId) && evidence.conversationIds.includes(candidate.conversationId ?? "")
    );
    return uniqueCandidate(conversationMatches.filter(compatible));
  }
  function hasWebSocketMetadata(fields) {
    return Boolean(
      fields.responseModelSlug || fields.resolvedModelSlug || fields.serverModelSlug || fields.requestId || fields.planType || fields.taskKind || hasUsageQuota(fields)
    );
  }
  function handleWebSocketText(raw, parser) {
    if (canCapture("live")) {
      publishContext();
      for (const update of taskCaptures.consume(raw, captureContext.snapshot().id)) emit(update);
    }
    if (!canCapture("live") || pendingLiveCaptures.size === 0) {
      parser.clear();
      return;
    }
    const evidenceItems = parser.parse(raw);
    const updates = /* @__PURE__ */ new Map();
    for (const evidence of evidenceItems) {
      const pending = pendingCaptureFor(evidence);
      if (!pending) continue;
      pending.expiresAt = Date.now() + PENDING_CAPTURE_TTL_MS;
      rememberTopic(pending, evidence.topicId);
      const identityChanged = !pending.conversationId && evidence.conversationIds.length === 1;
      if (identityChanged) pending.conversationId = evidence.conversationIds[0] ?? null;
      if (evidence.errorCode) {
        emit({
          ...mergeRouteFields(updates.get(pending.captureId)?.fields ?? pending.webSocketFields, { conversationId: pending.conversationId }),
          captureId: pending.captureId,
          captureContextId: pending.captureContextId,
          source: "page_websocket",
          captureMode: "live",
          phase: "failed",
          observedAt: now(),
          startedAt: pending.startedAt,
          pageUrl: pending.pageUrl,
          errorCode: evidence.errorCode
        });
        updates.delete(pending.captureId);
        pendingLiveCaptures.delete(pending.captureId);
        continue;
      }
      taskCaptures.rememberIdentities(pending.captureId, pending.captureContextId, evidence.taskIdentities);
      const current = updates.get(pending.captureId);
      updates.set(pending.captureId, {
        pending,
        identityChanged: Boolean(current?.identityChanged || identityChanged),
        fields: mergeRouteFields(current?.fields ?? pending.webSocketFields, evidence.fields),
        terminal: Boolean(current?.terminal || evidence.terminal),
        streamEnded: Boolean(current?.streamEnded || evidence.streamEnded)
      });
    }
    for (const { pending, fields, terminal, streamEnded, identityChanged } of updates.values()) {
      if (hasUsageQuota(fields) && quotaSignature(fields) !== quotaSignature(pending.webSocketFields)) {
        Object.assign(fields, rememberQuota(fields, pending.startedAt));
      }
      pending.webSocketFields = mergeRouteFields(fields, { conversationId: pending.conversationId });
      const signature = fieldsSignature(pending.webSocketFields);
      const shouldEmit = (hasWebSocketMetadata(pending.webSocketFields) || identityChanged) && (signature !== pending.lastWebSocketSignature || terminal);
      if (shouldEmit) {
        pending.lastWebSocketSignature = signature;
        const observedAt = now();
        const observation = {
          captureId: pending.captureId,
          captureContextId: pending.captureContextId,
          source: "page_websocket",
          captureMode: "live",
          phase: terminal ? "completed" : "responding",
          observedAt,
          startedAt: pending.startedAt,
          pageUrl: pending.pageUrl,
          ...pending.webSocketFields
        };
        if (terminal) observation.completedAt = observedAt;
        emit(observation);
      }
      if (streamEnded) pendingLiveCaptures.delete(pending.captureId);
    }
  }
  async function parseSseStream(response, captureId, startedAt, baseFields, pageUrl, captureContextId, epoch) {
    const body = response.body;
    if (!body) throw new Error("stream_body_missing");
    const reader = body.getReader();
    inspectionReaders.set(reader, startedAt);
    const decoder = new TextDecoder();
    let handedOff = false;
    const parser = new ResponseStreamParser((event) => {
      if (!event.done && epoch === captureEpoch && canCapture("live", startedAt)) {
        taskCaptures.rememberStream(captureId, captureContextId, event.value);
      }
      const value = event.value;
      if (value?.type === "stream_handoff" || value?.type === "subscribe_ws_topic") {
        handedOff = true;
        const pending = pendingLiveCaptures.get(captureId);
        if (pending) rememberTopic(pending, boundedCorrelationId(value.topic_id) ?? boundedCorrelationId(value.topic));
      }
    });
    let fields = baseFields;
    let streamQuota = null;
    const mergeStreamFields = (parsed) => {
      const pending = pendingLiveCaptures.get(captureId);
      if (pending) {
        pending.expiresAt = Date.now() + PENDING_CAPTURE_TTL_MS;
        if (!pending.conversationId) pending.conversationId = boundedCorrelationId(parsed.conversationId);
      }
      if (hasUsageQuota(parsed) && (!streamQuota || quotaSignature(parsed) !== quotaSignature(streamQuota))) {
        streamQuota = rememberQuota(parsed, startedAt);
      }
      return mergeRouteFields(baseFields, parsed, streamQuota ?? {});
    };
    let lastSignature = fieldsSignature(fields);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (epoch !== captureEpoch || !canCapture("live", startedAt)) return;
        fields = mergeStreamFields(parser.push(decoder.decode(value, { stream: !done })));
        const signature = fieldsSignature(fields);
        if (signature !== lastSignature) {
          lastSignature = signature;
          emit({
            captureId,
            captureContextId,
            source: "page_fetch",
            captureMode: "live",
            phase: "responding",
            observedAt: now(),
            startedAt,
            pageUrl,
            ...fields
          });
        }
        if (done) break;
      }
      fields = mergeStreamFields(parser.finish());
    } finally {
      void reader.cancel().catch(() => void 0);
      inspectionReaders.delete(reader);
      const pending = pendingLiveCaptures.get(captureId);
      if (pending) {
        pending.httpActive = false;
        pending.expiresAt = Date.now() + PENDING_CAPTURE_TTL_MS;
      }
    }
    emit({
      captureId,
      captureContextId,
      source: "page_fetch",
      captureMode: "live",
      phase: handedOff ? "responding" : "completed",
      observedAt: now(),
      startedAt,
      ...!handedOff ? { completedAt: now() } : {},
      pageUrl,
      ...fields
    });
    if (!handedOff) pendingLiveCaptures.delete(captureId);
  }
  async function boundedResponseText(response, maxBytes, errorCode, startedAt) {
    const reader = response.body?.getReader();
    if (!reader) return "";
    inspectionReaders.set(reader, startedAt);
    try {
      if (Number(response.headers.get("content-length") ?? "0") > maxBytes) throw new Error(errorCode);
      const decoder = new TextDecoder();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error(errorCode);
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } finally {
      inspectionReaders.delete(reader);
      void reader.cancel().catch(() => void 0);
    }
  }
  async function parseConversationJson(response, captureId, startedAt, conversationId, quotaAtStart, candidate, epoch) {
    const raw = await boundedResponseText(response, MAX_CONVERSATION_RECORD_BYTES, "record_too_large", startedAt);
    const parsed = JSON.parse(raw);
    const taskAnchor = currentTaskIdentity(parsed);
    const parsedQuota = parseUsageQuota(parsed);
    const results = parseResponseValue(parsed).filter(
      (fields) => Boolean(fields.responseModelSlug || fields.resolvedModelSlug || fields.serverModelSlug || fields.taskKind)
    );
    candidate.deliver = () => {
      if (!candidate.visit || candidate.visit.discarded || candidate.visit.committedStartedAt || epoch !== captureEpoch || !canCapture("reload", startedAt)) return;
      if (candidate.visit.unresolvedCreation) {
        if (candidate.visit === reloadVisit && Date.now() - Date.parse(startedAt) <= EARLY_RELOAD_TTL_MS) {
          if (deferredReloads.size >= MAX_PENDING_CAPTURES) deferredReloads.delete(deferredReloads.values().next().value);
          deferredReloads.add(candidate);
        }
        return;
      }
      const ownQuota = candidate.visit === reloadVisit ? rememberQuota(parsedQuota, startedAt) : null;
      if (!results.length) return;
      candidate.visit.committedStartedAt = startedAt;
      for (const [index, fields] of results.entries()) {
        emit({
          captureId: `${captureId}:${index}`,
          captureContextId: candidate.visit.context.id,
          source: "conversation_record",
          captureMode: "reload",
          phase: "completed",
          observedAt: now(),
          startedAt,
          completedAt: now(),
          pageUrl: candidate.visit.context.pageUrl,
          ...mergeRouteFields(quotaAtStart, fields, ownQuota ?? {}),
          conversationId: conversationId ?? fields.conversationId
        }, results.length === 1 ? taskAnchor : null);
      }
    };
    candidate.deliver();
  }
  async function parseQuotaJson(response, startedAt, epoch) {
    const raw = await boundedResponseText(response, MAX_POW_RESPONSE_BYTES, "quota_too_large", startedAt);
    if (epoch === captureEpoch && canCapture(null, startedAt)) rememberQuota(parseUsageQuota(JSON.parse(raw)), startedAt);
  }
  async function parsePowJson(response, startedAt, epoch) {
    const raw = await boundedResponseText(response, MAX_POW_RESPONSE_BYTES, "pow_too_large", startedAt);
    const parsed = parsePowResponse(JSON.parse(raw));
    if (!parsed || epoch !== captureEpoch) return;
    emitPow({ rawHex: parsed.rawHex, observedAt: now(), startedAt });
  }
  async function inspectFetch(downstreamFetch, receiver, input, init) {
    const downstreamReceiver = receiver ?? window;
    publishContext();
    const url = requestUrl(input);
    const endpoint = classifyEndpoint(url, location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const metadataOnly = endpoint.kind === "pow_requirements" || endpoint.kind === "conversation_init";
    const mode = metadataOnly ? null : endpoint.kind === "conversation_stream" ? "live" : "reload";
    if (!canCapture(mode) || !isAllowedRequest(url) || endpoint.kind === "other" || endpoint.kind === "conversation_stream" && method !== "POST") {
      return downstreamFetch.call(downstreamReceiver, input, init);
    }
    const context = captureContext.snapshot();
    const startedAt = now();
    const epoch = captureEpoch;
    let reloadCandidate = null;
    if (endpoint.kind === "conversation_record") {
      const sameConversation = endpoint.conversationId === contextConversation(context);
      if (method !== "GET" || !endpoint.conversationId || sameConversation && (!captureContext.canStartReload() || reloadVisit.committedStartedAt)) {
        return downstreamFetch.call(downstreamReceiver, input, init);
      }
      reloadCandidate = {
        originContextId: context.id,
        conversationId: endpoint.conversationId,
        startedAt,
        visit: sameConversation ? reloadVisit : null
      };
      if (!sameConversation) {
        for (const candidate of earlyReloads) {
          if (Date.now() - Date.parse(candidate.startedAt) > EARLY_RELOAD_TTL_MS) earlyReloads.delete(candidate);
        }
        if (earlyReloads.size >= MAX_PENDING_CAPTURES) earlyReloads.delete(earlyReloads.values().next().value);
        earlyReloads.add(reloadCandidate);
      }
    }
    if (endpoint.kind === "conversation_stream") {
      earlyReloads.clear();
      deferredReloads.clear();
      if (reloadVisit.unresolvedCreation) reloadVisit.discarded = true;
      captureContext.startLive();
      publishContext();
    }
    const captureContextId = context.id;
    const captureId = crypto.randomUUID();
    const pageUrl = safePageUrl();
    const quotaAtStart = latestQuota ? { ...latestQuota } : {};
    const bodyPromise = endpoint.kind === "conversation_stream" ? requestBody(input, init) : Promise.resolve(null);
    const requestFieldsPromise = bodyPromise.then((raw) => {
      if (!raw) return null;
      const parsed = parseConversationCapture(raw);
      const fields = mergeRouteFields(quotaAtStart, parsed.fields);
      const { correlation } = parsed;
      if (epoch !== captureEpoch || !canCapture("live", startedAt)) return fields;
      registerPendingCapture(captureId, startedAt, correlation, pageUrl, captureContextId);
      emit({
        captureId,
        captureContextId,
        source: "page_fetch",
        captureMode: "live",
        phase: "requested",
        observedAt: now(),
        startedAt,
        pageUrl,
        ...fields
      }, { messageId: correlation.inputMessageId, parentId: null, workingTurnId: null, exchangeId: null });
      return fields;
    });
    const failed = (errorCode) => {
      pendingLiveCaptures.delete(captureId);
      if (metadataOnly || epoch !== captureEpoch) return;
      if (reloadCandidate && (!reloadCandidate.visit || reloadCandidate.visit.unresolvedCreation || reloadCandidate.visit.committedStartedAt)) return;
      emit({
        captureId,
        captureContextId: reloadCandidate?.visit?.context.id ?? captureContextId,
        source: endpoint.kind === "conversation_stream" ? "page_fetch" : "conversation_record",
        captureMode: mode ?? "live",
        phase: "failed",
        observedAt: now(),
        startedAt,
        completedAt: now(),
        pageUrl,
        conversationId: endpoint.conversationId,
        errorCode
      });
    };
    let response;
    try {
      response = await downstreamFetch.call(downstreamReceiver, input, init);
    } catch (error) {
      void requestFieldsPromise.then(() => failed(error instanceof Error ? error.name : "fetch_failed"));
      throw error;
    }
    if (epoch !== captureEpoch || !canCapture(mode, startedAt)) return response;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const validType = endpoint.kind === "conversation_stream" ? contentType === "text/event-stream" : contentType === "application/json" || /^application\/[\w.-]+\+json$/.test(contentType);
    if (!response.ok || !validType) {
      void requestFieldsPromise.then(() => failed(!response.ok ? `http_${response.status}` : "unexpected_content_type"));
      return response;
    }
    try {
      const clone = response.clone();
      void requestFieldsPromise.then(async (fields) => {
        if (epoch !== captureEpoch || !canCapture(mode, startedAt)) {
          void clone.body?.cancel().catch(() => void 0);
          return;
        }
        if (endpoint.kind === "pow_requirements") await parsePowJson(clone, startedAt, epoch);
        else if (endpoint.kind === "conversation_init") await parseQuotaJson(clone, startedAt, epoch);
        else if (endpoint.kind === "conversation_stream") await parseSseStream(clone, captureId, startedAt, fields ?? mergeRouteFields(quotaAtStart), pageUrl, captureContextId, epoch);
        else if (reloadCandidate) await parseConversationJson(clone, captureId, startedAt, endpoint.conversationId, quotaAtStart, reloadCandidate, epoch);
      }).catch((error) => failed(error instanceof Error && error.message === "record_too_large" ? "record_too_large" : endpoint.kind === "conversation_stream" ? "stream_parse_failed" : "record_parse_failed"));
    } catch {
      void requestFieldsPromise.then(() => failed("response_clone_failed"));
    }
    return response;
  }
  function createFetchGeneration(downstream, capturesRawResponse) {
    const generation = {
      capturesRawResponse,
      downstream,
      wrapper: nativeFetch
    };
    generation.wrapper = async function routeInspectorFetch(input, init) {
      const receiver = this ?? window;
      if (generation.capturesRawResponse) {
        return inspectFetch(generation.downstream, receiver, input, init);
      }
      return generation.downstream.call(receiver, input, init);
    };
    return generation;
  }
  var currentFetchGeneration = createFetchGeneration(nativeFetch, true);
  function adoptDownstreamFetch(candidate) {
    if (typeof candidate !== "function" || candidate === currentFetchGeneration.wrapper) return;
    currentFetchGeneration = createFetchGeneration(
      candidate,
      candidate === nativeFetch
    );
  }
  function routeFetchGetter() {
    return currentFetchGeneration.wrapper;
  }
  function routeFetchSetter(candidate) {
    adoptDownstreamFetch(candidate);
  }
  function installFetchHook() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, "fetch");
      if (descriptor?.get === routeFetchGetter && descriptor.set === routeFetchSetter) return;
      adoptDownstreamFetch(window.fetch);
      try {
        Object.defineProperty(window, "fetch", {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get: routeFetchGetter,
          set: routeFetchSetter
        });
      } catch {
        window.fetch = currentFetchGeneration.wrapper;
      }
    } catch {
    }
  }
  var observedSockets = /* @__PURE__ */ new WeakSet();
  function isAllowedWebSocket(url) {
    if (!allowedOrigins.has(location.origin)) return false;
    try {
      const parsed = new URL(url, location.href);
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return false;
      const httpOrigin = `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
      if (allowedOrigins.has(httpOrigin)) return true;
      const hostname = parsed.hostname.toLowerCase();
      return hostname.endsWith(".chatgpt.com") || hostname.endsWith(".openai.com");
    } catch {
      return false;
    }
  }
  function observeWebSocket(socket) {
    if (observedSockets.has(socket) || !isAllowedWebSocket(socket.url)) return;
    observedSockets.add(socket);
    const parser = new WebSocketRouteParser();
    socket.addEventListener("close", () => parser.clear(), { once: true });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || !canCapture("live")) {
        parser.clear();
        return;
      }
      const raw = event.data;
      queueMicrotask(() => handleWebSocketText(raw, parser));
    });
  }
  function copyWebSocketConstructorShape(wrapper, downstream) {
    try {
      Object.setPrototypeOf(wrapper, Object.getPrototypeOf(downstream));
    } catch {
    }
    for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
      const descriptor = Object.getOwnPropertyDescriptor(downstream, key) ?? Object.getOwnPropertyDescriptor(nativeWebSocket, key);
      if (!descriptor) continue;
      try {
        Object.defineProperty(wrapper, key, descriptor);
      } catch {
      }
    }
    try {
      Object.defineProperty(wrapper, "prototype", {
        value: downstream.prototype,
        writable: false,
        enumerable: false,
        configurable: false
      });
    } catch {
    }
    try {
      Object.defineProperty(wrapper, "name", { value: "WebSocket", configurable: true });
      Object.defineProperty(wrapper, "length", { value: downstream.length, configurable: true });
      const nativeSource = Function.prototype.toString.call(downstream);
      Object.defineProperty(wrapper, "toString", {
        value: () => nativeSource,
        configurable: true
      });
    } catch {
    }
  }
  function createWebSocketGeneration(downstream, capturesRawMessages) {
    const generation = {
      capturesRawMessages,
      downstream,
      wrapper: nativeWebSocket
    };
    generation.wrapper = function routeInspectorWebSocket(url, protocols) {
      if (!new.target) throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator.");
      const argumentsList = arguments.length > 1 ? [url, protocols] : [url];
      const invokedTarget = new.target;
      const newTarget = invokedTarget === generation.wrapper ? generation.downstream : invokedTarget;
      const socket = Reflect.construct(generation.downstream, argumentsList, newTarget);
      if (generation.capturesRawMessages) observeWebSocket(socket);
      return socket;
    };
    copyWebSocketConstructorShape(generation.wrapper, downstream);
    return generation;
  }
  var currentWebSocketGeneration = createWebSocketGeneration(nativeWebSocket, true);
  function adoptDownstreamWebSocket(candidate) {
    if (typeof candidate !== "function" || candidate === currentWebSocketGeneration.wrapper) return;
    currentWebSocketGeneration = createWebSocketGeneration(
      candidate,
      candidate === nativeWebSocket
    );
  }
  function routeWebSocketGetter() {
    return currentWebSocketGeneration.wrapper;
  }
  function routeWebSocketSetter(candidate) {
    adoptDownstreamWebSocket(candidate);
  }
  function installWebSocketHook() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, "WebSocket");
      if (descriptor?.get === routeWebSocketGetter && descriptor.set === routeWebSocketSetter) return;
      adoptDownstreamWebSocket(window.WebSocket);
      try {
        Object.defineProperty(window, "WebSocket", {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get: routeWebSocketGetter,
          set: routeWebSocketSetter
        });
      } catch {
        window.WebSocket = currentWebSocketGeneration.wrapper;
      }
    } catch {
    }
  }
  installFetchHook();
  installWebSocketHook();
  publishContext();
  try {
    for (const method of ["pushState", "replaceState"]) {
      if (!window.history) break;
      const original = window.history[method];
      window.history[method] = function(...args) {
        const result = original.apply(this, args);
        publishContext();
        return result;
      };
    }
  } catch {
  }
  window.addEventListener("popstate", () => publishContext());
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    captureEpoch++;
    earlyReloads.clear();
    deferredReloads.clear();
    for (const reader of inspectionReaders.keys()) void reader.cancel().catch(() => void 0);
    pendingLiveCaptures.clear();
    taskCaptures.clear();
    latestQuota = null;
    captureContext = new CaptureContextTracker(`${location.origin}${location.pathname}`);
    publishContext();
  });
  queueMicrotask(() => {
    installFetchHook();
    installWebSocketHook();
  });
  document.addEventListener("DOMContentLoaded", () => {
    installFetchHook();
    installWebSocketHook();
  }, { once: true });
  window.addEventListener("load", () => {
    installFetchHook();
    installWebSocketHook();
  }, { once: true });
  window.setInterval(() => {
    for (const candidate of deferredReloads) {
      if (Date.now() - Date.parse(candidate.startedAt) > EARLY_RELOAD_TTL_MS) deferredReloads.delete(candidate);
    }
    for (const candidate of earlyReloads) {
      if (Date.now() - Date.parse(candidate.startedAt) > EARLY_RELOAD_TTL_MS) earlyReloads.delete(candidate);
    }
    publishContext();
    installFetchHook();
    installWebSocketHook();
    prunePendingCaptures();
  }, 1e3);
})();
