"use strict";
(() => {
  // Allowed origins
  const ALLOWED_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];
  const allowedOriginsSet = new Set(ALLOWED_ORIGINS);

  // Path matching
  const STANDARD_CONVERSATION_PATH = /^\/c\/([^/]+)(?=\/|$)/;
  const PROJECT_CONVERSATION_PATH = /^\/g\/[^/]+\/c\/([^/]+)(?=\/|$)/;

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

  const TEMPORARY_CONVERSATION_PREFIX = "local-chatgpt:";
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

  // Privacy helpers
  function redactedId(value) {
    if (!value) return null;
    return `[redacted:${value.slice(-6)}]`;
  }

  function sanitizePageUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      url.pathname = redactConversationPathname(url.pathname);
      url.pathname = url.pathname.replace(/^\/backend-api\/(conversations?)\/[^/]+/, "/backend-api/$1/[redacted]");
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function sanitizeTurn(turn, includeRequestIds = false) {
    return {
      ...turn,
      captureId: "[redacted]",
      ...(turn.captureContextId ? { captureContextId: "[redacted]" } : {}),
      pageUrl: sanitizePageUrl(turn.pageUrl),
      conversationId: redactedId(turn.conversationId),
      researchWidgetId: redactedId(turn.researchWidgetId),
      researchMessageId: redactedId(turn.researchMessageId),
      requestId: includeRequestIds ? turn.requestId : redactedId(turn.requestId),
      networkRequestId: includeRequestIds ? turn.networkRequestId : redactedId(turn.networkRequestId)
    };
  }

  function sanitizedExport(state) {
    return {
      ...state,
      captureContexts: {},
      turns: (state.turns || []).map((turn, index) => ({
        ...sanitizeTurn(turn, state.settings?.includeRequestIdsInExport),
        captureId: `capture-${index + 1}`
      }))
    };
  }

  function buildMarkdownReport(state, language = state.settings?.uiLanguage) {
    const exported = sanitizedExport(state);
    const chinese = language === "zh";
    const lines = chinese ? [
      "# Route Lens 报告",
      "",
      `生成时间：${new Date().toISOString()}`,
      `记录数：${exported.turns.length}`,
      "",
      "| 时间 | 模式 | 请求模型 | 模型标签 | 服务器报告模型 | 响应来源 | 结论 | 请求 ID |",
      "|---|---|---|---|---|---|---|---|"
    ] : [
      "# Route Lens Report",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Records: ${exported.turns.length}`,
      "",
      "| Time | Mode | Requested model | Model label | Response route | Response source | Verdict | Request ID |",
      "|---|---|---|---|---|---|---|---|"
    ];

    for (const turn of exported.turns) {
      const unknown = chinese ? "未知" : "Unknown";
      const none = chinese ? "无" : "None";
      const label = turn.modelLabelConflict ? (chinese ? "标签字段不一致" : "Label fields disagree") : (turn.modelLabel ?? unknown);
      lines.push(`| ${turn.observedAt} | ${turn.captureMode} | ${turn.requestedModel ?? unknown} | ${label} | ${turn.routeModel ?? unknown} | ${turn.routeModelSources.join(" + ") || none} | ${turn.verdict} | ${turn.requestId ?? none} |`);
    }

    for (const turn of exported.turns.filter((item) => item.taskKind === "deep_research")) {
      lines.push("", chinese ? `${turn.observedAt} · 规划模型：${turn.routeModel ?? "—"}；报告模型：${turn.researchReportModel ?? "—"}` : `${turn.observedAt} · Planning model: ${turn.routeModel ?? "—"}; Report model: ${turn.researchReportModel ?? "—"}`);
    }

    lines.push("", chinese ? "> 本报告仅包含白名单字段，不包含提示词、回答正文、Cookie、Authorization 或令牌。" : "> This report contains allowlisted fields only. Prompts, answers, cookies, Authorization headers, and tokens are excluded.");
    return lines.join("\n") + "\n";
  }

  // Page Scope
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

  function isStaleState(current, next) {
    return Boolean(current && (next.revision ?? 0) < (current.revision ?? 0));
  }

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
    const candidates = state.turns.filter((turn) =>
      turn.tabId === tabId &&
      turn.captureMode === mode &&
      turn.captureContextId === context.id &&
      (!conversation || !turn.conversationId || turn.conversationId === conversation) &&
      (mode !== "reload" || (Boolean(conversation) && turn.conversationId === conversation))
    );
    if (mode === "reload") {
      const record = candidates.find((turn) => turn.sources.includes("conversation_record") && hasResponseEvidence(turn));
      if (record) return record;
    }
    return candidates[0] ?? null;
  }

  function latestForTab(state, tabId, mode = state.settings.captureMode) {
    return latestInContext(state, tabId, mode);
  }

  function latestPowForTab(state, tabId) {
    if (tabId === void 0) return null;
    return state.powReadings.find((reading) => reading.tabId === tabId) ?? null;
  }

  // Dictionaries
  const zh = {
    "app.name": "Route Lens",
    "language.label": "切换语言",
    "popup.tabs": "页面",
    "popup.tabState": "状态",
    "popup.tabAppearance": "外观",
    "popup.controls": "控制",
    "popup.more": "更多",
    "popup.details": "详细字段",
    "status.idle": "待机",
    "status.paused": "已暂停",
    "status.liveListening": "实时监听",
    "status.reloadCaptured": "重载已捕获",
    "status.waitingReload": "等待刷新",
    "capture.section": "捕获模式",
    "mode.live": "实时请求",
    "mode.reload": "会话重载",
    "mode.liveHint": "发送新消息后，对照本轮请求模型与服务器报告模型字段。",
    "mode.reloadHint": "刷新会话以读取可用的服务器报告模型字段；原始请求可能不可用。",
    "overlay.label": "页面侧栏",
    "overlay.visible": "显示",
    "overlay.hidden": "隐藏",
    "field.requested": "请求模型",
    "field.responseRoute": "服务器报告模型",
    "field.mode": "模式",
    "field.time": "捕获时间",
    "field.duration": "耗时",
    "field.adapter": "捕获来源",
    "field.route": "响应来源",
    "field.label": "模型标签",
    "field.labelSource": "标签来源",
    "field.planningModel": "规划模型",
    "field.reportModel": "报告模型",
    "field.requestId": "请求 ID",
    "field.networkId": "网络 ID",
    "pow.inline": "PoW 难度",
    "pow.hex": "十六进制",
    "pow.decimal": "十进制",
    "pow.recommendation": "原始数值，不用于推断路由或账号状态。",
    "pow.notCaptured": "未捕获",
    "result.waiting": "等待中",
    "result.normal": "请求与服务器报告字段一致",
    "result.mismatch": "请求与服务器报告字段不一致",
    "result.routeConflict": "服务器报告字段冲突",
    "result.autoReasoning": "自动路由提示",
    "result.unknown": "证据不足，无法确认",
    "result.imageGeneration": "图片生成",
    "result.deepResearch": "深度研究",
    "result.workUnverifiable": "无法判断",
    "value.waiting": "等待中",
    "value.reloadNoRequest": "重载不提供",
    "value.inconclusive": "无法确认",
    "value.unresolved": "未解析",
    "value.noRouteField": "未捕获服务器报告模型字段",
    "value.noLabelField": "未捕获模型标签",
    "value.labelConflict": "模型标签字段冲突",
    "button.dashboard": "诊断台",
    "button.copySummary": "复制摘要",
    "button.options": "设置与隐私",
    "footer.records": "{{count}} 条记录",
    "toast.summaryCopied": "已复制本轮摘要。",
    "toast.noRecord": "暂无记录可复制。",
    "toast.modeLive": "已切换到实时请求。",
    "toast.modeReload": "已切换到会话重载，请刷新会话。",
    "toast.overlayShown": "页面侧栏已显示。",
    "toast.overlayHidden": "页面侧栏已隐藏。",
    "toast.appearanceReset": "已恢复默认外观。",
    "toast.appearanceSaved": "外观设置已保存。",
    "appearance.title": "页面侧栏外观",
    "appearance.saved": "已保存",
    "appearance.saving": "保存中",
    "appearance.error": "保存失败",
    "appearance.layout": "尺寸与位置",
    "appearance.width": "宽度",
    "appearance.height": "高度",
    "appearance.position": "垂直位置",
    "appearance.fontSize": "字号",
    "appearance.opacity": "背景不透明度",
    "appearance.theme": "主题",
    "appearance.system": "跟随系统",
    "appearance.light": "浅色",
    "appearance.dark": "深色",
    "appearance.visibleItems": "侧栏显示项",
    "appearance.routeStatus": "结论",
    "appearance.requestedModel": "请求模型",
    "appearance.actualModel": "服务器报告模型",
    "appearance.footer": "只恢复外观；记录、隐私与捕获模式不变。",
    "appearance.reset": "恢复默认外观",
    "credit.maintainer": "维护"
  };

  const en = {
    "app.name": "Route Lens",
    "language.label": "Switch language",
    "popup.tabs": "Pages",
    "popup.tabState": "Status",
    "popup.tabAppearance": "Appearance",
    "popup.controls": "Controls",
    "popup.more": "More",
    "popup.details": "Field details",
    "status.idle": "Idle",
    "status.paused": "Paused",
    "status.liveListening": "Live capture",
    "status.reloadCaptured": "Reload captured",
    "status.waitingReload": "Awaiting reload",
    "capture.section": "Capture mode",
    "mode.live": "Live request",
    "mode.reload": "Reload session",
    "mode.liveHint": "Send a message to compare its requested model with the server-reported model field.",
    "mode.reloadHint": "Reload the conversation to read available server-reported model fields; original request may be absent.",
    "overlay.label": "Page rail",
    "overlay.visible": "Visible",
    "overlay.hidden": "Hidden",
    "field.requested": "Requested model",
    "field.responseRoute": "Server-reported model",
    "field.mode": "Mode",
    "field.time": "Observed time",
    "field.duration": "Duration",
    "field.adapter": "Adapter",
    "field.route": "Response source",
    "field.label": "Model label",
    "field.labelSource": "Label source",
    "field.planningModel": "Planning model",
    "field.reportModel": "Report model",
    "field.requestId": "Request ID",
    "field.networkId": "Network ID",
    "pow.inline": "PoW difficulty",
    "pow.hex": "Hex",
    "pow.decimal": "Decimal",
    "pow.recommendation": "Raw value only; not used to judge routing or account status.",
    "pow.notCaptured": "Not captured",
    "result.waiting": "Waiting",
    "result.normal": "Request and server-reported fields match",
    "result.mismatch": "Request and server-reported fields differ",
    "result.routeConflict": "Server-reported model fields conflict",
    "result.autoReasoning": "Auto-route indication",
    "result.unknown": "Inconclusive evidence",
    "result.imageGeneration": "Image generation",
    "result.deepResearch": "Deep research",
    "result.workUnverifiable": "Cannot determine",
    "value.waiting": "Waiting",
    "value.reloadNoRequest": "Unavailable on reload",
    "value.inconclusive": "Unconfirmed",
    "value.unresolved": "Unresolved",
    "value.noRouteField": "No server-reported model field",
    "value.noLabelField": "No model label captured",
    "value.labelConflict": "Model label fields disagree",
    "button.dashboard": "Diagnostics",
    "button.copySummary": "Copy summary",
    "button.options": "Settings & privacy",
    "footer.records": "{{count}} records",
    "toast.summaryCopied": "Summary copied.",
    "toast.noRecord": "No record to copy.",
    "toast.modeLive": "Switched to live request mode.",
    "toast.modeReload": "Switched to reload session; reload the conversation.",
    "toast.overlayShown": "Page rail visible.",
    "toast.overlayHidden": "Page rail hidden.",
    "toast.appearanceReset": "Appearance restored to defaults.",
    "toast.appearanceSaved": "Appearance settings saved.",
    "appearance.title": "Sidebar appearance",
    "appearance.saved": "Saved",
    "appearance.saving": "Saving...",
    "appearance.error": "Save failed",
    "appearance.layout": "Size & position",
    "appearance.width": "Width",
    "appearance.height": "Height",
    "appearance.position": "Vertical position",
    "appearance.fontSize": "Font size",
    "appearance.opacity": "Background opacity",
    "appearance.theme": "Theme",
    "appearance.system": "System",
    "appearance.light": "Light",
    "appearance.dark": "Dark",
    "appearance.visibleItems": "Visible items",
    "appearance.routeStatus": "Verdict",
    "appearance.requestedModel": "Requested model",
    "appearance.actualModel": "Server-reported model",
    "appearance.footer": "Appearance only; records, privacy, and capture mode stay unchanged.",
    "appearance.reset": "Restore defaults",
    "credit.maintainer": "Maintainer"
  };

  const dictionaries = { zh, en };

  function t(language, key, variables = {}) {
    let value = dictionaries[language]?.[key] ?? en[key] ?? key;
    for (const [name, replacement] of Object.entries(variables)) {
      value = value.replaceAll(`{{${name}}}`, String(replacement));
    }
    return value;
  }

  function applyStaticTranslations(language, root = document) {
    const doc = root instanceof Document ? root : root.ownerDocument;
    doc.documentElement.lang = language === "zh" ? "zh-CN" : "en";

    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(language, key);
    });

    for (const [attribute, dataName] of [["aria-label", "i18nAriaLabel"], ["title", "i18nTitle"]]) {
      root.querySelectorAll(`[data-${dataName.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`).forEach((el) => {
        const key = el.dataset[dataName];
        if (key) el.setAttribute(attribute, t(language, key));
      });
    }

    root.querySelectorAll("[data-language]").forEach((btn) => {
      const active = btn.dataset.language === language;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  // Communication
  async function send(request) {
    try {
      const response = await chrome.runtime.sendMessage(request);
      if (!response.ok) throw new Error(response.error ?? "Operation failed.");
      return response;
    } catch (err) {
      console.warn("Route Lens send error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function getState(tabId) {
    const response = await send({ type: "route:get-state", ...(tabId !== void 0 ? { tabId } : {}) });
    if (!response.ok || !response.state) throw new Error(response.error ?? "Failed to read state.");
    return response.state;
  }

  function subscribe(handler) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && typeof message === "object" && message.type === "route:state-changed" && message.state) {
        handler(message.state);
      }
    });
  }

  // Formatting helpers
  function escapeHtml(val) {
    return String(val ?? "—").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[c] ?? c);
  }

  function modelLabel(model) {
    if (!model) return "—";
    return model
      .replace(/^gpt-/, "GPT-")
      .replace(/-pro$/i, " Pro")
      .replace(/-mini$/i, " mini")
      .replace(/-codex$/i, " Codex");
  }

  function verdictLabel(verdict, language) {
    const map = {
      normal: t(language, "result.normal"),
      mismatch: t(language, "result.mismatch"),
      conflict: t(language, "result.routeConflict"),
      auto_reasoning: t(language, "result.autoReasoning"),
      unknown: t(language, "result.unknown"),
      suspected_downgrade: t(language, "result.unknown"),
      work_unverifiable: t(language, "result.workUnverifiable"),
      image_generation: t(language, "result.imageGeneration"),
      deep_research: t(language, "result.deepResearch")
    };
    return map[verdict] ?? t(language, "result.unknown");
  }

  function verdictTone(verdict) {
    if (verdict === "normal") return "normal";
    if (verdict === "mismatch" || verdict === "conflict") return "danger";
    if (verdict === "auto_reasoning") return "auto";
    if (verdict === "image_generation" || verdict === "deep_research") return "task";
    if (verdict === "unknown" || verdict === "suspected_downgrade" || verdict === "work_unverifiable") return "warn";
    return "idle";
  }

  function formatTime(val, language) {
    if (!val) return "";
    try {
      const d = new Date(val);
      return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(d);
    } catch {
      return "";
    }
  }

  function formatDuration(ms) {
    if (ms === null || ms === void 0) return "—";
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  // Toast
  let toastTimer = null;
  function showToast(text, duration = 1800) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      toastTimer = null;
    }, duration);
  }

  // Appearance defaults
  const appearanceDefaults = {
    railWidthPx: 72,
    railHeightPercent: 75,
    railPositionPercent: 58,
    railFontSizePx: 10,
    railOpacityPercent: 92,
    showRouteStatus: true,
    showRequestedModel: true,
    showActualModel: true,
    theme: "system"
  };

  // State
  let state = null;
  let activeTab = null;
  let pendingAppearancePatch = {};
  let appearanceSaveTimer = null;
  let appearanceStatusTimer = null;
  let appearanceWriteChain = Promise.resolve();

  // DOM Elements
  const tabState = document.querySelector("#tab-state");
  const tabAppearance = document.querySelector("#tab-appearance");
  const stateView = document.querySelector("#state-view");
  const appearanceView = document.querySelector("#appearance-view");

  const captureDot = document.querySelector("#capture-dot");
  const captureStatus = document.querySelector("#capture-status");
  const observedAt = document.querySelector("#observed-at");

  const requestedModelEl = document.querySelector("#requested-model");
  const routeModelEl = document.querySelector("#route-model");
  const verdictEl = document.querySelector("#verdict");
  const verdictText = document.querySelector("#verdict-text");
  const modeHint = document.querySelector("#mode-hint");
  const detailList = document.querySelector("#detail-list");

  const overlayToggle = document.querySelector("#overlay-toggle");
  const overlayState = document.querySelector("#overlay-state");
  const recordCount = document.querySelector("#record-count");

  const appearanceSaveStatus = document.querySelector("#appearance-save-status");
  const appearanceReset = document.querySelector("#appearance-reset");

  // Tab Switching
  function setPopupView(view) {
    const isAppearance = view === "appearance";
    stateView.hidden = isAppearance;
    appearanceView.hidden = !isAppearance;

    tabState.classList.toggle("active", !isAppearance);
    tabState.setAttribute("aria-selected", String(!isAppearance));
    tabState.tabIndex = !isAppearance ? 0 : -1;

    tabAppearance.classList.toggle("active", isAppearance);
    tabAppearance.setAttribute("aria-selected", String(isAppearance));
    tabAppearance.tabIndex = isAppearance ? 0 : -1;
  }

  tabState?.addEventListener("click", () => setPopupView("state"));
  tabAppearance?.addEventListener("click", () => setPopupView("appearance"));

  // Keyboard navigation for tabs
  [tabState, tabAppearance].forEach((tab) => {
    tab?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = tab === tabState ? "appearance" : "state";
        setPopupView(next);
        (next === "appearance" ? tabAppearance : tabState)?.focus();
      }
    });
  });

  // Appearance Controls
  function updateAppearanceControl(setting, value) {
    const input = document.querySelector(`[data-appearance-setting="${setting}"]`);
    if (!input) return;

    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else if (input.type === "radio") {
      const radio = document.querySelector(`input[name="theme"][value="${value}"]`);
      if (radio) radio.checked = true;
    } else {
      input.value = String(value);
    }

    if (input.type === "range") {
      const output = document.querySelector(`#${setting}-value`);
      if (output) {
        const unit = setting === "railWidthPx" || setting === "railFontSizePx" ? "px" : "%";
        output.textContent = `${value} ${unit}`;
      }
    }
  }

  function renderAppearanceSettings(settings) {
    const merged = { ...appearanceDefaults, ...settings, ...pendingAppearancePatch };
    for (const [key, value] of Object.entries(merged)) {
      updateAppearanceControl(key, value);
    }
  }

  function setAppearanceSaveStatus(saving, failed = false) {
    if (!appearanceSaveStatus || !state) return;
    if (appearanceStatusTimer !== null) clearTimeout(appearanceStatusTimer);
    appearanceSaveStatus.dataset.saving = String(saving);
    appearanceSaveStatus.dataset.failed = String(failed);
    const lang = state.settings.uiLanguage;
    appearanceSaveStatus.textContent = t(lang, failed ? "appearance.error" : saving ? "appearance.saving" : "appearance.saved");

    if (!saving && !failed) {
      appearanceStatusTimer = setTimeout(() => {
        if (appearanceSaveStatus && state) {
          appearanceSaveStatus.textContent = t(state.settings.uiLanguage, "appearance.saved");
        }
      }, 1500);
    }
  }

  function queueAppearancePatch(patch) {
    pendingAppearancePatch = { ...pendingAppearancePatch, ...patch };
    renderAppearanceSettings(state?.settings ?? {});
    setAppearanceSaveStatus(true);
    if (patch.theme) {
      document.documentElement.dataset.theme = patch.theme;
    }
    if (appearanceSaveTimer !== null) clearTimeout(appearanceSaveTimer);
    appearanceSaveTimer = setTimeout(flushAppearancePatch, 80);
  }

  function flushAppearancePatch() {
    if (appearanceSaveTimer !== null) clearTimeout(appearanceSaveTimer);
    appearanceSaveTimer = null;
    const patch = pendingAppearancePatch;
    pendingAppearancePatch = {};
    if (!Object.keys(patch).length) return;

    appearanceWriteChain = appearanceWriteChain.then(async () => {
      const response = await send({ type: "route:update-settings", settings: patch });
      if (!response?.ok) {
        pendingAppearancePatch = { ...patch, ...pendingAppearancePatch };
        renderAppearanceSettings(state?.settings ?? {});
        setAppearanceSaveStatus(false, true);
        return;
      }
      if (response.state) render(response.state);
      if (Object.keys(pendingAppearancePatch).length) {
        renderAppearanceSettings(state?.settings ?? {});
        setAppearanceSaveStatus(true);
        flushAppearancePatch();
      } else {
        setAppearanceSaveStatus(false);
      }
    }).catch((err) => {
      console.warn("Appearance update failed:", err);
      pendingAppearancePatch = { ...patch, ...pendingAppearancePatch };
      renderAppearanceSettings(state?.settings ?? {});
      setAppearanceSaveStatus(false, true);
    });
  }

  // Main Render
  function render(next) {
    if (isStaleState(state, next)) return;
    state = next;

    const language = state.settings.uiLanguage ?? "zh";
    const mode = state.settings.captureMode ?? "live";
    const theme = state.settings.theme ?? "system";
    document.documentElement.dataset.theme = theme;

    const tabId = displayTabId(state, activeTab, allowedOriginsSet);
    const turn = latestForTab(state, tabId, mode);
    const pow = latestPowForTab(state, tabId);

    applyStaticTranslations(language);
    renderAppearanceSettings(state.settings);

    // Mode buttons
    document.querySelectorAll("[data-mode]").forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    // Sidebar switch
    if (overlayToggle) {
      overlayToggle.checked = Boolean(state.settings.overlayEnabled);
    }
    if (overlayState) {
      overlayState.textContent = t(language, state.settings.overlayEnabled ? "overlay.visible" : "overlay.hidden");
    }

    // Mode hint
    if (modeHint) {
      modeHint.textContent = t(language, mode === "live" ? "mode.liveHint" : "mode.reloadHint");
    }

    // Record count
    if (recordCount) {
      recordCount.textContent = t(language, "footer.records", { count: (state.turns || []).length });
    }

    // Status line
    if (captureDot && captureStatus) {
      if (!state.settings.autoCaptureEnabled) {
        captureDot.dataset.tone = "idle";
        captureStatus.textContent = t(language, "status.paused");
      } else if (mode === "live") {
        captureDot.dataset.tone = "signal";
        captureStatus.textContent = t(language, "status.liveListening");
      } else {
        captureDot.dataset.tone = turn ? "signal" : "amber";
        captureStatus.textContent = t(language, turn ? "status.reloadCaptured" : "status.waitingReload");
      }
    }

    if (observedAt) {
      observedAt.textContent = turn ? formatTime(turn.observedAt, language) : "";
    }

    // Route Lockup
    if (requestedModelEl) {
      if (turn?.requestedModel) {
        const formatted = modelLabel(turn.requestedModel);
        requestedModelEl.textContent = formatted;
        requestedModelEl.title = turn.requestedModel;
      } else if (turn?.captureMode === "reload") {
        requestedModelEl.textContent = t(language, "value.reloadNoRequest");
        requestedModelEl.title = t(language, "value.reloadNoRequest");
      } else {
        requestedModelEl.textContent = "—";
        requestedModelEl.title = "";
      }
    }

    if (routeModelEl) {
      if (!turn) {
        routeModelEl.textContent = "—";
        routeModelEl.title = "";
      } else if (turn.verdict === "conflict") {
        routeModelEl.textContent = t(language, "result.routeConflict");
        routeModelEl.title = t(language, "result.routeConflict");
      } else if (turn.routeModel) {
        let display = modelLabel(turn.routeModel);
        let full = turn.routeModel;
        if (turn.taskKind === "deep_research" && turn.researchReportModel) {
          display += ` / ${modelLabel(turn.researchReportModel)}`;
          full += ` / ${turn.researchReportModel}`;
        }
        routeModelEl.textContent = display;
        routeModelEl.title = full;
      } else {
        routeModelEl.textContent = t(language, "value.inconclusive");
        routeModelEl.title = t(language, "value.inconclusive");
      }
    }

    // Verdict Banner
    if (verdictEl && verdictText) {
      const tone = turn ? verdictTone(turn.verdict) : "idle";
      verdictEl.dataset.tone = tone;
      verdictText.textContent = turn ? verdictLabel(turn.verdict, language) : t(language, "result.waiting");
    }

    // Details List
    if (detailList) {
      const items = [];
      if (turn) {
        items.push(`<dt>${escapeHtml(t(language, "field.mode"))}</dt><dd>${escapeHtml(mode === "live" ? t(language, "mode.live") : t(language, "mode.reload"))}</dd>`);
        items.push(`<dt>${escapeHtml(t(language, "field.duration"))}</dt><dd>${escapeHtml(formatDuration(turn.durationMs))}</dd>`);
        items.push(`<dt>${escapeHtml(t(language, "field.adapter"))}</dt><dd>${escapeHtml(turn.sources?.join(" + ") || "—")}</dd>`);
        items.push(`<dt>${escapeHtml(t(language, "field.route"))}</dt><dd>${escapeHtml(turn.routeModelSources?.join(" + ") || t(language, "value.noRouteField"))}</dd>`);

        const labelText = turn.modelLabelConflict ? t(language, "value.labelConflict") : (turn.modelLabel || t(language, "value.noLabelField"));
        items.push(`<dt>${escapeHtml(t(language, "field.label"))}</dt><dd>${escapeHtml(labelText)}</dd>`);

        if (turn.taskKind === "deep_research") {
          items.push(`<dt>${escapeHtml(t(language, "field.planningModel"))}</dt><dd>${escapeHtml(turn.routeModel || "—")}</dd>`);
          items.push(`<dt>${escapeHtml(t(language, "field.reportModel"))}</dt><dd>${escapeHtml(turn.researchReportModel || "—")}</dd>`);
        }

        if (turn.requestId) {
          items.push(`<dt>${escapeHtml(t(language, "field.requestId"))}</dt><dd title="${escapeHtml(turn.requestId)}">${escapeHtml(turn.requestId)}</dd>`);
        }
      }

      // PoW Difficulty
      if (pow) {
        items.push(`<dt>${escapeHtml(t(language, "pow.inline"))}</dt><dd>HEX: ${escapeHtml(pow.rawHex)} · DEC: ${escapeHtml(pow.decimal)}</dd>`);
        items.push(`<dd class="full-width">${escapeHtml(t(language, "pow.recommendation"))}</dd>`);
      } else {
        items.push(`<dt>${escapeHtml(t(language, "pow.inline"))}</dt><dd>${escapeHtml(t(language, "pow.notCaptured"))}</dd>`);
      }

      detailList.innerHTML = items.join("");
    }
  }

  // Event Handlers
  async function setLanguage(uiLanguage) {
    if (state?.settings.uiLanguage === uiLanguage) return;
    const response = await send({ type: "route:update-settings", settings: { uiLanguage } });
    if (response?.ok && response.state) render(response.state);
  }

  document.querySelectorAll("[data-language]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.language;
      if (lang === "zh" || lang === "en") void setLanguage(lang);
    });
  });

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.mode;
      if (mode !== "live" && mode !== "reload") return;
      const response = await send({ type: "route:update-settings", settings: { captureMode: mode } });
      if (response?.ok && response.state) {
        render(response.state);
        showToast(t(state.settings.uiLanguage, mode === "live" ? "toast.modeLive" : "toast.modeReload"));
      }
    });
  });

  overlayToggle?.addEventListener("change", async () => {
    const enabled = overlayToggle.checked;
    const response = await send({
      type: "route:update-settings",
      settings: enabled
        ? { overlayEnabled: true, overlayMode: "mini", overlayMinimized: true }
        : { overlayEnabled: false }
    });
    if (response?.ok && response.state) {
      render(response.state);
      showToast(t(state.settings.uiLanguage, enabled ? "toast.overlayShown" : "toast.overlayHidden"));
    }
  });

  document.querySelector("#dashboard")?.addEventListener("click", () => {
    void send({ type: "route:open-dashboard" });
  });

  document.querySelector("#options")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  document.querySelector("#copy")?.addEventListener("click", async () => {
    const tabId = displayTabId(state, activeTab, allowedOriginsSet);
    const turn = latestForTab(state, tabId, state?.settings?.captureMode);
    if (!turn) {
      showToast(t(state?.settings?.uiLanguage ?? "zh", "toast.noRecord"));
      return;
    }
    const report = buildMarkdownReport({ ...state, turns: [turn] }, state.settings.uiLanguage);
    await navigator.clipboard.writeText(report);
    showToast(t(state.settings.uiLanguage, "toast.summaryCopied"));
  });

  // Appearance Inputs
  document.querySelectorAll("[data-appearance-setting]").forEach((input) => {
    const setting = input.dataset.appearanceSetting;

    if (input.type === "range") {
      input.addEventListener("input", () => {
        const value = Number(input.value);
        updateAppearanceControl(setting, value);
        queueAppearancePatch({ [setting]: value });
      });
      input.addEventListener("change", flushAppearancePatch);
    } else if (input.type === "checkbox") {
      input.addEventListener("change", () => {
        queueAppearancePatch({ [setting]: input.checked });
        flushAppearancePatch();
      });
    } else if (input.type === "radio") {
      input.addEventListener("change", () => {
        if (input.checked) {
          queueAppearancePatch({ [setting]: input.value });
          flushAppearancePatch();
        }
      });
    }
  });

  appearanceReset?.addEventListener("click", () => {
    queueAppearancePatch(appearanceDefaults);
    flushAppearancePatch();
    showToast(t(state?.settings?.uiLanguage ?? "zh", "toast.appearanceReset"));
  });

  // Initialization
  (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs[0];

      chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
        if (change.url === void 0 && change.status === void 0) return;
        if (tabId !== activeTab?.id) return;
        activeTab = tab;
        if (state) render(state);
      });

      subscribe(render);
      const initialState = await getState(activeTab?.id);
      render(initialState);
    } catch (err) {
      console.warn("Route Lens popup init warning:", err);
    }
  })();
})();
