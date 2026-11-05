"use strict";
(() => {
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

  // src/core/capture-context.ts
  function contextConversation(context) {
    return conversationIdFromPathname(new URL(context.pageUrl).pathname);
  }
  function hasResponseEvidence(turn) {
    return Boolean(turn.resolvedModelSlug || turn.serverModelSlug || turn.routeModel || turn.modelLabel || turn.modelLabelConflict || turn.taskKind);
  }
  function latestInContext(state2, tabId, mode) {
    if (tabId === void 0) return null;
    const context = state2.captureContexts?.[tabId];
    if (!context || context.invalidated) return null;
    const conversation = contextConversation(context);
    const candidates = state2.turns.filter((turn) => turn.tabId === tabId && turn.captureMode === mode && turn.captureContextId === context.id && (!conversation || !turn.conversationId || turn.conversationId === conversation) && (mode !== "reload" || Boolean(conversation) && turn.conversationId === conversation));
    if (mode === "reload") {
      const record = candidates.find((turn) => turn.sources.includes("conversation_record") && hasResponseEvidence(turn));
      if (record) return record;
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

  // src/core/state.ts
  function isStaleState(current, next) {
    return Boolean(current && (next.revision ?? 0) < (current.revision ?? 0));
  }

  // src/shared/messages.ts
  function isPageBridgeEnvelope(value) {
    if (!value || typeof value !== "object") return false;
    const candidate = value;
    if (candidate.source !== "chatgpt-route-inspector" || candidate.version !== 1) return false;
    if (candidate.pow && typeof candidate.pow === "object") {
      const pow = candidate.pow;
      return typeof pow.rawHex === "string" && typeof pow.observedAt === "string";
    }
    if (!candidate.observation || typeof candidate.observation !== "object") return false;
    const record = candidate.observation;
    return typeof record.captureId === "string" && typeof record.observedAt === "string" && ["page_fetch", "page_websocket", "conversation_record"].includes(String(record.source)) && ["live", "reload"].includes(String(record.captureMode)) && ["requested", "responding", "completed", "failed"].includes(String(record.phase));
  }

  // src/ui/shared/branding.ts

  // src/ui/shared/i18n.ts
  var zh = {
    "app.name": "Route Lens",
    "app.author": "Maintainer: xxkingstuggle",
    "language.label": "\u5207\u6362\u8BED\u8A00",
    "language.en": "EN",
    "language.zh": "\u4E2D",
    "popup.title": "Route Lens",
    "popup.subtitle": "\u5bf9\u7167\u8bf7\u6c42\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b",
    "status.idle": "\u5F85\u673A",
    "status.paused": "\u5DF2\u6682\u505C",
    "status.liveListening": "\u5B9E\u65F6\u76D1\u542C",
    "status.reloadCaptured": "\u91CD\u8F7D\u5DF2\u6355\u83B7",
    "status.waitingReload": "\u7B49\u5F85\u5237\u65B0",
    "status.switchedLive": "\u5DF2\u5207\u6362\uFF1A\u5B9E\u65F6\u8BF7\u6C42",
    "status.switchedReload": "\u5DF2\u5207\u6362\uFF1A\u4F1A\u8BDD\u91CD\u8F7D",
    "status.overlayShown": "\u6D6E\u7A97\u5DF2\u663E\u793A",
    "status.overlayHidden": "\u6D6E\u7A97\u5DF2\u9690\u85CF",
    "status.summaryCopied": "\u6458\u8981\u5DF2\u590D\u5236",
    "status.noRecord": "\u6682\u65E0\u53EF\u590D\u5236\u8BB0\u5F55",
    "capture.section": "\u6355\u83B7\u6A21\u5F0F",
    "capture.select": "\u9009\u62E9\u6355\u83B7\u6A21\u5F0F",
    "mode.live": "\u5B9E\u65F6\u8BF7\u6C42",
    "mode.reload": "\u4F1A\u8BDD\u91CD\u8F7D",
    "mode.liveHint": "\u53d1\u9001\u65b0\u6d88\u606f\u540e\uff0c\u5bf9\u7167\u672c\u8f6e\u8bf7\u6c42\u6a21\u578b\u548c\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u3002",
    "mode.reloadHint": "\u5237\u65b0\u4f1a\u8bdd\u4ee5\u8bfb\u53d6\u53ef\u7528\u7684\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\uff1b\u539f\u59cb\u8bf7\u6c42\u53ef\u80fd\u4e0d\u53ef\u7528\u3002",
    "overlay.section": "\u9875\u9762\u6D6E\u7A97",
    "overlay.label": "\u9875\u9762\u6D6E\u7A97",
    "overlay.controls": "\u63A7\u5236\u9875\u9762\u6D6E\u7A97",
    "overlay.visible": "\u5DF2\u663E\u793A",
    "overlay.hidden": "\u5DF2\u9690\u85CF",
    "overlay.show": "\u663E\u793A\u6D6E\u7A97",
    "overlay.hide": "\u9690\u85CF\u6D6E\u7A97",
    "overlay.disconnected": "\u6269\u5C55\u8FDE\u63A5\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u7EE7\u7EED\u4F7F\u7528\u3002",
    "overlay.refreshPage": "\u5237\u65B0\u9875\u9762",
    "overlay.actionFailed": "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u6269\u5C55\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    "overlay.compact": "\u6781\u7B80\u6A21\u5F0F",
    "overlay.mini": "\u8FF7\u4F60\u6A21\u5F0F",
    "overlay.dock": "\u505C\u9760\u5230\u8FB9\u7F18",
    "overlay.undock": "\u6062\u590D\u8FF7\u4F60\u6D6E\u7A97",
    "overlay.expand": "\u5C55\u5F00\u6D6E\u7A97",
    "overlay.liveHint": "\u53d1\u9001\u65b0\u6d88\u606f\u4ee5\u67e5\u770b\u8bf7\u6c42\u6a21\u578b\u548c\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u3002",
    "overlay.reloadHint": "\u5237\u65b0\u5f53\u524d\u4f1a\u8bdd\u4ee5\u8bfb\u53d6\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u3002",
    "field.requested": "\u8BF7\u6C42\u6A21\u578B",
    "field.responseRoute": "\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b",
    "field.mode": "\u6A21\u5F0F",
    "field.duration": "\u8017\u65F6",
    "field.adapter": "\u6355\u83B7\u6765\u6E90",
    "field.route": "\u54CD\u5E94\u6765\u6E90",
    "field.label": "\u6A21\u578B\u6807\u7B7E",
    "field.labelSource": "\u6807\u7B7E\u5B57\u6BB5",
    "pow.hex": "\u5341\u516D\u8FDB\u5236",
    "pow.inline": "PoW \u539f\u59cb\u96be\u5ea6\u503c",
    "pow.decimal": "\u5341\u8FDB\u5236",
    "pow.recommendation": "\u53ea\u663e\u793a\u539f\u59cb\u6570\u503c\uff0c\u4e0d\u636e\u6b64\u5224\u65ad\u8def\u7531\u6216\u8d26\u53f7\u72b6\u6001\u3002",
    "pow.notCaptured": "\u672A\u6355\u83B7",
    "result.waiting": "\u7B49\u5F85\u6355\u83B7",
    "result.waitingNext": "\u7B49\u5F85\u4E0B\u4E00\u6B21\u56DE\u7B54",
    "result.waitingReload": "\u7B49\u5F85\u5237\u65B0\u4F1A\u8BDD",
    "result.capturing": "\u6B63\u5728\u6355\u83B7",
    "result.normal": "请求与服务器报告字段一致",
    "result.imageGeneration": "\u56FE\u7247\u751F\u6210",
    "result.deepResearch": "\u6DF1\u5EA6\u7814\u7A76",
    "field.planningModel": "\u89C4\u5212\u6A21\u578B",
    "field.reportModel": "\u62A5\u544A\u6A21\u578B",
    "reason.specialTask": "\u5df2\u8bc6\u522b\u4e13\u7528\u4efb\u52a1\uff1b\u4fdd\u7559\u62a5\u544a\u5b57\u6bb5\uff0c\u4f46\u4e0d\u628a\u4e13\u7528\u4efb\u52a1\u6a21\u578b\u4e0e\u804a\u5929\u8bf7\u6c42\u6bd4\u8f83\u4e3a\u964d\u7ea7\u3002",
    "result.autoReasoning": "\u81ea\u52a8\u8def\u7531\u63d0\u793a",
    "result.suspectedDowngrade": "\u65e0\u6cd5\u786e\u8ba4",
    "result.workUnverifiable": "\u65E0\u6CD5\u5224\u65AD",
    "result.mismatch": "请求与服务器报告字段不一致",
    "result.mismatchDetected": "\u8bf7\u6c42\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u4e0d\u4e00\u81f4",
    "result.routeConflict": "服务器报告的响应路由字段冲突",
    "result.actualRouteConflict": "服务器报告字段冲突",
    "result.unknown": "\u8BC1\u636E\u4E0D\u8DB3",
    "result.routeRead": "\u5df2\u8bfb\u53d6\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5",
    "result.labelOnly": "\u4EC5\u53D6\u5F97\u6A21\u578B\u6807\u7B7E",
    "result.routeMissing": "\u672a\u8bfb\u53d6\u5230\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5",
    "value.unresolved": "\u672A\u89E3\u6790",
    "value.unavailable": "\u672A\u53D6\u5F97",
    "value.inconclusive": "\u65E0\u6CD5\u786E\u8BA4",
    "value.reloadNoRequest": "\u91CD\u8F7D\u4E0D\u63D0\u4F9B",
    "value.noRouteField": "\u672a\u6355\u83b7\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5",
    "value.noLabelField": "\u672A\u6355\u83B7\u6A21\u578B\u6807\u7B7E\u5B57\u6BB5",
    "value.labelConflict": "\u6807\u7B7E\u5B57\u6BB5\u4E0D\u4E00\u81F4",
    "value.waiting": "\u7B49\u5F85\u4E2D",
    "button.openDashboard": "\u6253\u5F00\u8BCA\u65AD\u53F0",
    "button.dashboard": "\u8BCA\u65AD\u53F0",
    "button.copySummary": "\u590D\u5236\u672C\u8F6E\u6458\u8981",
    "button.options": "\u8BBE\u7F6E\u4E0E\u9690\u79C1",
    "privacy.local": "\u672C\u5730\u89E3\u6790",
    "privacy.popup": "\u4E0D\u4FDD\u5B58\u63D0\u793A\u8BCD\u548C\u56DE\u7B54\u6B63\u6587\uFF1B\u6269\u5C55\u53EA\u4FDD\u7559\u8DEF\u7531\u767D\u540D\u5355\u5B57\u6BB5\u3002",
    "footer.records": "{{count}} \u6761\u8BB0\u5F55",
    "toast.modeLive": "\u5DF2\u5207\u6362\u5230\u5B9E\u65F6\u8BF7\u6C42\u3002",
    "toast.modeReload": "\u4F1A\u8BDD\u91CD\u8F7D\u5DF2\u5C31\u7EEA\uFF0C\u8BF7\u5237\u65B0\u76EE\u6807\u4F1A\u8BDD\u3002",
    "toast.overlayShown": "\u9875\u9762\u6D6E\u7A97\u5DF2\u663E\u793A\u3002",
    "toast.overlayHidden": "\u9875\u9762\u6D6E\u7A97\u5DF2\u5F7B\u5E95\u9690\u85CF\u3002",
    "toast.noRecord": "\u5F53\u524D\u6A21\u5F0F\u8FD8\u6CA1\u6709\u53EF\u590D\u5236\u7684\u8BB0\u5F55\u3002",
    "toast.summaryCopied": "\u5DF2\u590D\u5236\u8131\u654F\u6458\u8981\u3002",
    "dashboard.documentTitle": "Route Lens \xB7 \u8BCA\u65AD\u53F0",
    "dashboard.subtitle": "\u8bf7\u6c42\u6a21\u578b\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u5bf9\u7167",
    "dashboard.localOnly": "\u4EC5\u4FDD\u5B58\u5728\u672C\u673A",
    "dashboard.title": "\u8DEF\u7531\u8BCA\u65AD\u53F0",
    "dashboard.exportJson": "\u5BFC\u51FA JSON",
    "dashboard.exportReport": "\u5BFC\u51FA\u62A5\u544A",
    "dashboard.clear": "\u6E05\u7A7A\u8BB0\u5F55",
    "dashboard.ledger": "\u6355\u83B7\u8BB0\u5F55",
    "dashboard.evidence": "\u8BC1\u636E\u5B57\u6BB5",
    "dashboard.health": "\u8FD0\u884C\u72B6\u6001",
    "dashboard.empty": "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u8BB0\u5F55\u3002",
    "dashboard.selectRecord": "\u9009\u62E9\u4E00\u6761\u8BB0\u5F55\u67E5\u770B\u5B57\u6BB5\u3002",
    "summary.total": "\u5168\u90E8\u8BB0\u5F55",
    "summary.live": "\u5B9E\u65F6\u8BF7\u6C42",
    "summary.reload": "\u4F1A\u8BDD\u91CD\u8F7D",
    "summary.anomalies": "\u5F02\u5E38",
    "filter.allVerdicts": "\u5168\u90E8\u7ED3\u8BBA",
    "filter.normal": "\u6B63\u5E38",
    "filter.autoReasoning": "\u81EA\u52A8\u63A8\u7406",
    "filter.suspectedDowngrade": "\u65e0\u6cd5\u786e\u8ba4",
    "filter.workUnverifiable": "\u65E0\u6CD5\u5224\u65AD",
    "filter.mismatch": "\u9519\u914D",
    "filter.conflict": "\u51B2\u7A81",
    "filter.unknown": "\u672A\u6BD4\u8F83",
    "filter.allModes": "\u5168\u90E8\u6A21\u5F0F",
    "table.time": "\u65F6\u95F4",
    "table.mode": "\u6A21\u5F0F",
    "table.request": "\u8BF7\u6C42",
    "table.modelLabel": "\u6A21\u578B\u6807\u7B7E",
    "table.responseRoute": "\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b",
    "table.verdict": "\u5224\u5B9A",
    "table.routeSource": "\u54CD\u5E94\u6765\u6E90",
    "detail.captureMode": "\u6355\u83B7\u6A21\u5F0F",
    "detail.captureStatus": "\u6355\u83B7\u72B6\u6001",
    "detail.errorCode": "\u9519\u8BEF\u7801",
    "phase.requested": "\u5DF2\u53D1\u8D77\u8BF7\u6C42",
    "phase.responding": "\u54CD\u5E94\u4E2D",
    "phase.completed": "\u5DF2\u5B8C\u6210",
    "phase.failed": "\u6355\u83B7\u5931\u8D25",
    "detail.requestedModel": "\u8BF7\u6C42\u6A21\u578B",
    "detail.modelLabel": "\u6A21\u578B\u6807\u7B7E",
    "detail.modelLabelSource": "\u56DE\u7B54\u6807\u7B7E\u6765\u6E90",
    "detail.responseRoute": "\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b",
    "detail.routeFieldSource": "\u54CD\u5E94\u6765\u6E90",
    "detail.assistantMetadataLabel": "\u56DE\u7B54\u6A21\u578B\u6807\u7B7E",
    "detail.assistantReferenceHint": "\u5B57\u6BB5\uFF1Aassistant.metadata.model_slug\n\u56DE\u7B54\u5143\u6570\u636E\u4E2D\u7684\u6A21\u578B\u6807\u7B7E\uFF0C\u4E0D\u4FDD\u8BC1\u4E0E\u5B9E\u9645\u6267\u884C\u6A21\u578B\u4E00\u81F4\u3002\u8BF7\u7ED3\u5408\u201C\u89E3\u6790\u6A21\u578B\u201D\u548C\u201C\u670D\u52A1\u7AEF\u6A21\u578B\u201D\u6838\u5BF9\u3002",
    "detail.renderedAssistantLabel": "\u9875\u9762\u6A21\u578B\u6807\u7B7E",
    "detail.resolvedModel": "\u89E3\u6790\u6A21\u578B",
    "detail.serverModel": "\u670D\u52A1\u7AEF\u6A21\u578B",
    "detail.planType": "\u5957\u9910\u7C7B\u578B",
    "detail.thinkingEffort": "\u601D\u8003\u5F3A\u5EA6",
    "detail.fastConvo": "\u5FEB\u901F\u4F1A\u8BDD",
    "detail.deepResearchRemaining": "\u6DF1\u5EA6\u7814\u7A76\u5269\u4F59\u989D\u5EA6",
    "detail.deepResearchResetAt": "\u6DF1\u5EA6\u7814\u7A76\u91CD\u7F6E\u65F6\u95F4",
    "detail.imageGenRemaining": "\u56FE\u7247\u751F\u6210\u5269\u4F59\u989D\u5EA6",
    "detail.imageGenResetAt": "\u56FE\u7247\u751F\u6210\u91CD\u7F6E\u65F6\u95F4",
    "quota.notCaptured": "\u672A\u6355\u83B7",
    "quota.snapshotHint": "\u989D\u5EA6\u91C7\u96C6\u65F6\u95F4\uFF1A{{time}}\u3002\u8FD9\u662F\u672C\u6761\u8BB0\u5F55\u6355\u83B7\u65F6\u6536\u5230\u7684\u989D\u5EA6\u5FEB\u7167\uFF0C\u5E76\u975E\u5B9E\u65F6\u67E5\u8BE2\u3002",
    "detail.toolInvoked": "\u8C03\u7528\u5DE5\u5177",
    "detail.toolName": "\u5DE5\u5177\u540D\u79F0",
    "detail.search": "\u641C\u7D22",
    "detail.promptImage": "\u63D0\u793A\u8BCD\u56FE\u7247",
    "detail.requestId": "\u8BF7\u6C42 ID",
    "detail.networkId": "\u7F51\u7EDC ID",
    "detail.duration": "\u8017\u65F6",
    "detail.adapters": "\u6355\u83B7\u6765\u6E90",
    "health.lastSuccess": "\u6700\u8FD1\u6210\u529F",
    "health.lastFailure": "\u6700\u8FD1\u5931\u8D25",
    "health.activeMode": "\u5F53\u524D\u6A21\u5F0F",
    "health.failures": "\u8FDE\u7EED\u5931\u8D25 {{count}} \u6B21",
    "confirm.clearAll": "\u6E05\u7A7A\u5168\u90E8\u672C\u5730\u8DEF\u7531\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
    "toast.cleared": "\u672C\u5730\u8BB0\u5F55\u5DF2\u6E05\u7A7A\u3002",
    "options.documentTitle": "Route Lens \xB7 \u8BBE\u7F6E",
    "options.subtitle": "\u672C\u5730\u8BBE\u7F6E\u4E0E\u6570\u636E\u7BA1\u7406",
    "options.localConfig": "\u4EC5\u672C\u5730",
    "options.title": "\u8BBE\u7F6E\u4E0E\u9690\u79C1",
    "options.general": "\u5E38\u89C4",
    "options.auto": "\u81EA\u52A8\u76D1\u542C",
    "options.retention": "\u8BB0\u5F55\u4E0A\u9650",
    "options.requestIds": "\u5BFC\u51FA\u8BF7\u6C42 ID",
    "options.redacted": "\u9ED8\u8BA4\u8131\u654F",
    "options.fullIds": "\u4FDD\u7559\u5B8C\u6574 ID",
    "options.save": "\u4FDD\u5B58\u8BBE\u7F6E",
    "options.clear": "\u6E05\u7A7A\u672C\u5730\u8BB0\u5F55",
    "options.notice": "\u8DEF\u7531\u8BB0\u5F55\u4EC5\u4FDD\u5B58\u5728\u672C\u673A\uFF1B\u5BFC\u51FA\u65F6\u8BF7\u6C42 ID \u9ED8\u8BA4\u8131\u654F\u3002",
    "toast.settingsSaved": "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002",
    "onboarding.documentTitle": "Route Lens \xB7 \u5F00\u59CB\u4F7F\u7528",
    "onboarding.subtitle": "\u7CBE\u786E\u8DEF\u7531\u8BC1\u636E",
    "onboarding.badge": "\u8DEF\u7531\u8BC1\u636E / V2",
    "onboarding.title": "\u770B\u89C1\u54CD\u5E94\u62A5\u544A\u7684\u8DEF\u7531\u3002",
    "onboarding.lede": "Route Lens \u5BF9\u7167 ChatGPT \u7684\u8BF7\u6C42\u6A21\u578B\u4E0E\u54CD\u5E94\u8DEF\u7531\u5B57\u6BB5\u3002\u5B83\u4E0D\u95EE\u6A21\u578B\u201C\u4F60\u662F\u8C01\u201D\uFF0C\u4E0D\u51ED\u901F\u5EA6\u731C\u6D4B\uFF0C\u4E5F\u4E0D\u4FDD\u5B58\u4F60\u7684\u804A\u5929\u6B63\u6587\u3002",
    "onboarding.liveTitle": "\u6355\u83B7\u65B0\u8BF7\u6C42",
    "onboarding.liveCopy": "\u53d1\u9001\u6d88\u606f\u540e\u67e5\u770b\u8bf7\u6c42\u6a21\u578b\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\uff0c\u65e0\u9700\u63d0\u524d\u5207\u6362\u663e\u793a\u6807\u7b7e\u3002",
    "onboarding.reloadTitle": "\u590D\u67E5\u5DF2\u6709\u56DE\u7B54",
    "onboarding.reloadCopy": "\u5237\u65b0\u4f1a\u8bdd\u4ee5\u67e5\u770b\u53ef\u8bfb\u53d6\u7684\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u3002\u53ea\u6709\u6a21\u578b\u6807\u7b7e\u800c\u6ca1\u6709\u62a5\u544a\u5b57\u6bb5\u65f6\u663e\u793a\u201c\u65e0\u6cd5\u786e\u8ba4\u201d\u3002",
    "onboarding.exactTitle": "\u663E\u793A\u7CBE\u786E\u5B57\u6BB5",
    "onboarding.exactCopy": "\u670d\u52a1\u5668\u62a5\u544a\u5b57\u6bb5\u7528\u4e8e\u4e0e\u8bf7\u6c42\u6807\u8bc6\u6bd4\u8f83\uff1b\u6a21\u578b\u6807\u7b7e\u4ec5\u4f5c\u8865\u5145\u3002\u7ed3\u679c\u4e0d\u8868\u793a\u80fd\u529b\u6216\u8d28\u91cf\u6b63\u5e38\u3002",
    "onboarding.privacyTitle": "\u767D\u540D\u5355\u5B57\u6BB5\uFF0C\u672C\u5730\u7559\u5B58",
    "onboarding.privacyCopy": "\u6B63\u6587\u3001Cookie\u3001Authorization\u3001JWT\u3001\u9644\u4EF6\u3001PoW seed \u4E0E proof token \u4E0D\u4F1A\u5199\u5165\u6269\u5C55\u5B58\u50A8\u3002",
    "onboarding.checkPrivacy": "\u68C0\u67E5\u9690\u79C1\u8BBE\u7F6E",
    "notice.documentTitle": "Route Lens \u00b7 1.3.0 \u7248\u672c\u516c\u544a",
    "notice.subtitle": "1.3.0 \u00b7 \u7248\u672c\u516c\u544a",
    "notice.release121": "\u6539\u4e3a\u9875\u9762\u6700\u53f3\u4fa7\u5e38\u9a7b\u7a84\u578b\u72b6\u6001\u680f\uff0c\u53ea\u663e\u793a\u8def\u7531\u72b6\u6001\u3001\u8bf7\u6c42\u6a21\u578b\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u7684\u6a21\u578b\u5b57\u6bb5\uff1b\u5185\u5bb9\u53ef\u5728\u680f\u5185\u6eda\u52a8\uff0c\u4e3b\u9898\u8ddf\u968f\u6d4f\u89c8\u5668\u3002",
    "notice.badge": "\u7248\u672C\u516C\u544A",
    "notice.pollBefore": "\u65e7\u7248\u66fe\u628a",
    "notice.pollLink": "\u5b57\u6bb5\u7f3a\u5931",
    "notice.pollAfter": "字段缺失只表示没有捕获到模型字段；本版显示“无法确认”。",
    "notice.pollResult": "\u7f3a\u5c11\u6a21\u578b\u5b57\u6bb5\u4e0d\u80fd\u786e\u8ba4\u8def\u7531\u662f\u5426\u53d8\u5316\uff0c\u4e5f\u4e0d\u80fd\u636e\u6b64\u5224\u65ad\u964d\u7ea7\u3002",
    "notice.suspectBefore": "\u65e7\u7248\u66fe\u5c06",
    "notice.suspectAfter": "旧版对字段缺失的推测已改为“无法确认”；不据此判断降级。",
    "notice.suspectEnding": "\u5f53\u524d\u7248\u672c\u4e0d\u518d\u4f7f\u7528\u6b64\u542f\u53d1\u5f0f\u3002",
    "notice.scopeCopy": "\u672c\u6269\u5c55\u6bd4\u8f83\u8bf7\u6c42\u6a21\u578b\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u7684\u6a21\u578b\u5b57\u6bb5\u3002\u7f51\u9875 Work \u6a21\u5f0f\u8bc1\u636e\u4e0d\u8db3\u65f6\u663e\u793a\u201c\u65e0\u6cd5\u786e\u8ba4\u201d\u3002",
    "notice.imageLead": "\u4f8b\u5982\uff0c",
    "notice.imageBefore": "\u7279\u5b9a\u4efb\u52a1\u53ef\u80fd\u6ca1\u6709\u663e\u5f0f\u54cd\u5e94\u8def\u7531\u5b57\u6bb5\uff1b\u8fd9\u65f6",
    "notice.imageAfter": "\u65e0\u6cd5\u786e\u8ba4\u8bf7\u6c42\u6a21\u578b\u4e0e\u5b9e\u9645\u8def\u7531\u662f\u5426\u4e00\u81f4\u3002",
    "notice.historyTitle": "\u5386\u4EE3\u66F4\u65B0\u65E5\u5FD7",
    "notice.release109": "\u4FEE\u590D\u65B0\u5EFA\u4F1A\u8BDD\u65F6\u5B9E\u65F6\u8BF7\u6C42\u6A21\u578B\u4E0E\u54CD\u5E94\u8DEF\u7531\u65E0\u6CD5\u663E\u793A\u7684\u95EE\u9898\uFF1B\u6269\u5C55\u8FDE\u63A5\u5931\u6548\u65F6\u63D0\u793A\u5237\u65B0\u9875\u9762\uFF0C\u907F\u514D\u6D6E\u7A97\u6309\u94AE\u65E0\u54CD\u5E94\u3002",
    "notice.release108": "\u65e7\u7248\u66fe\u628a\u5b57\u6bb5\u7f3a\u5931\u6807\u4e3a\u201c\u7591\u4f3c\u964d\u7ea7\u201d\uff1b\u5f53\u524d\u7248\u672c\u5728\u8bc1\u636e\u4e0d\u8db3\u65f6\u663e\u793a\u201c\u65e0\u6cd5\u786e\u8ba4\u201d\u3002",
    "notice.release107": "\u5B9E\u65F6\u8BF7\u6C42\u4E0E\u4F1A\u8BDD\u91CD\u8F7D\u540C\u65F6\u72EC\u7ACB\u91C7\u96C6\uFF0C\u5207\u6362\u6807\u7B7E\u5373\u53EF\u67E5\u770B\uFF1B\u4F18\u5316\u6D6E\u7A97\u6392\u7248\u3002",
    "notice.release106": "\u9002\u914D\u589E\u91CF\u6D41\u3001\u591A\u884C SSE \u4E0E WebSocket\uFF1B\u4FEE\u590D\u8BF7\u6C42\u914D\u5BF9\u4E0E\u8BB0\u5F55\u9694\u79BB\uFF1B\u65B0\u589E\u989D\u5EA6\u5FEB\u7167\u548C 5.6/5.5 \u81EA\u52A8\u63A8\u7406\u72B6\u6001\u3002",
    "notice.release105": "\u4FEE\u590D ChatGPT \u9875\u9762\u91CD\u5EFA\u540E\u6D6E\u7A97\u6D88\u5931\u7684\u95EE\u9898\uFF0C\u5E76\u4FDD\u7559\u624B\u52A8\u9690\u85CF\u8BBE\u7F6E\u3002",
    "notice.release104": "\u9002\u914D ChatGPT \u5B98\u65B9\u540E\u7AEF\u4F1A\u8BDD\u63A5\u53E3\u7684\u8DEF\u5F84\u4E0E\u54CD\u5E94\u7ED3\u6784\u8C03\u6574\u3002",
    "notice.release103": "\u65B0\u589E\u8FF7\u4F60\u6D6E\u7A97\u4E0E\u8FB9\u7F18\u505C\u9760\uFF0C\u4F18\u5316\u82F1\u6587\u6587\u6848\u548C\u7A84\u5C4F\u6392\u7248\u3002",
    "notice.release102": "\u652F\u6301\u9879\u76EE\u5185\u4F1A\u8BDD\u7684\u91CD\u8F7D\u8DEF\u7531\u8BC6\u522B\uFF0C\u5E76\u52A0\u5F3A\u5BFC\u51FA\u8131\u654F\u4E0E\u9690\u79C1\u6D4B\u8BD5\u3002",
    "notice.release101": "\u5305\u62EC\u5B9E\u65F6\u8BF7\u6C42\u3001\u4F1A\u8BDD\u91CD\u8F7D\u3001Popup\u3001\u6D6E\u7A97\u3001\u8BCA\u65AD\u53F0\u3001PoW \u6570\u636E\u53CA\u4E2D\u82F1\u6587\u754C\u9762\u3002",
    "notice.close": "\u5173\u95ED\u516C\u544A",
    "notice.closeManually": "\u8BF7\u5173\u95ED\u6B64\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u3002",
    "notice.hintLabel": "\u8def\u7531\u8bc1\u636e\u8bf4\u660e",
    "notice.hint": "\u672c\u6269\u5c55\u6bd4\u8f83\u8bf7\u6c42\u6a21\u578b\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u7684\u6a21\u578b\u5b57\u6bb5\u3002\u5b57\u6bb5\u7f3a\u5931\u3001\u53ea\u6709\u6a21\u578b\u6807\u7b7e\u6216\u6ca1\u6709\u8bf7\u6c42\u6a21\u578b\u65f6\uff0c\u7ed3\u679c\u4e3a\u201c\u65e0\u6cd5\u786e\u8ba4\u201d\u3002",
    "notice.readMore": "\u67E5\u770B\u8BE6\u60C5",
    "notice.openFailed": "\u65E0\u6CD5\u6253\u5F00\u516C\u544A\uFF0C\u8BF7\u91CD\u8BD5\u6216\u5237\u65B0\u9875\u9762\u3002",
    "work.hint": "\u7f51\u9875 Work \u6a21\u5f0f\u8def\u7531\u5b57\u6bb5\u4e0d\u8db3\u65f6\u663e\u793a\u201c\u65e0\u6cd5\u786e\u8ba4\u201d\uff0c\u4e0d\u636e\u6b64\u63a8\u6d4b\u964d\u7ea7\u3002",
    "reason.requested": "\u8BF7\u6C42\u6A21\u578B\uFF1A{{model}}",
    "reason.routeField": "{{source}}\uff1a{{model}}\uff08\u670d\u52a1\u5668\u62a5\u544a\u5b57\u6bb5\uff09",
    "reason.labelField": "{{source}}\uFF1A{{model}}\uFF08\u6A21\u578B\u6807\u7B7E\uFF09",
    "reason.labelConflict": "\u6A21\u578B\u6807\u7B7E\u5B57\u6BB5\u4E92\u76F8\u4E0D\u540C",
    "reason.routeConflict": "\u670d\u52a1\u5668\u62a5\u544a\u7684\u54cd\u5e94\u6a21\u578b\u5b57\u6bb5\u4e92\u76f8\u4e0d\u4e00\u81f4",
    "reason.labelRouteMismatch": "\u6a21\u578b\u6807\u7b7e {{label}} \u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5 {{route}} \u4e0d\u540c\uff1b\u4ecd\u6309\u670d\u52a1\u5668\u62a5\u544a\u5b57\u6bb5\u6bd4\u8f83\u8bf7\u6c42\u6807\u8bc6\u3002",
    "reason.labelOnly": "\u53ea\u8bfb\u53d6\u5230\u6a21\u578b\u6807\u7b7e\uff0c\u6ca1\u6709\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5",
    "reason.noRoute": "\u54cd\u5e94\u4e2d\u6ca1\u6709\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5",
    "reason.noRequest": "\u8bfb\u53d6\u5230\u4e86\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\uff0c\u4f46\u6ca1\u6709\u5bf9\u5e94\u8bf7\u6c42\u6a21\u578b",
    "reason.match": "\u8bf7\u6c42\u6a21\u578b\u6807\u8bc6\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u4e00\u81f4",
    "reason.autoReasoning": "\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u4e3a {{model}}\uff1b\u6807\u8bb0\u4e3a\u81ea\u52a8\u63a8\u7406",
    "reason.autoRequested": "\u8bf7\u6c42\u6a21\u578b\u4e3a auto\uff1b\u5df2\u53d6\u5f97\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\uff0c\u6807\u8bb0\u4e3a\u81ea\u52a8\u63a8\u7406",
    "reason.suspectedDowngrade": "\u6ca1\u6709\u8bfb\u53d6\u5230\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\uff1b\u5355\u72ec\u7684\u6a21\u578b\u6807\u7b7e\u65e0\u6cd5\u786e\u8ba4\u5b83\u4e0e\u8bf7\u6c42\u662f\u5426\u4e00\u81f4\u3002",
    "reason.workUnverifiable": "\u7f51\u9875 Work \u6a21\u5f0f\u7f3a\u5c11\u8db3\u591f\u7684\u670d\u52a1\u5668\u62a5\u544a\u5b57\u6bb5\uff1b\u65e0\u6cd5\u786e\u8ba4\u8bf7\u6c42\u4e0e\u62a5\u544a\u6807\u8bc6\u662f\u5426\u4e00\u81f4\u3002",
    "reason.mismatch": "\u8bf7\u6c42\u6a21\u578b\u6807\u8bc6\u4e0e\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b\u5b57\u6bb5\u4e0d\u4e00\u81f4"
  };
  var en = {
    "app.name": "Route Lens",
    "app.author": "Maintainer: xxkingstuggle",
    "language.label": "Switch language",
    "language.en": "EN",
    "language.zh": "\u4E2D",
    "popup.title": "Route Lens",
    "popup.subtitle": "Compare request and server-reported model",
    "status.idle": "Idle",
    "status.paused": "Paused",
    "status.liveListening": "Live capture",
    "status.reloadCaptured": "Reload captured",
    "status.waitingReload": "Awaiting reload",
    "status.switchedLive": "Switched: Live request",
    "status.switchedReload": "Switched: Reload session",
    "status.overlayShown": "Overlay shown",
    "status.overlayHidden": "Overlay hidden",
    "status.summaryCopied": "Summary copied",
    "status.noRecord": "No record to copy",
    "capture.section": "Capture mode",
    "capture.select": "Select capture mode",
    "mode.live": "Live request",
    "mode.reload": "Reload session",
    "mode.liveHint": "Send a message to compare its requested model with the server-reported model field.",
    "mode.reloadHint": "Reload the conversation to read available server-reported model fields; the original request may be absent.",
    "overlay.section": "Page overlay",
    "overlay.label": "Page overlay",
    "overlay.controls": "Control the page overlay",
    "overlay.visible": "Visible",
    "overlay.hidden": "Hidden",
    "overlay.show": "Show overlay",
    "overlay.hide": "Hide overlay",
    "overlay.disconnected": "The extension connection is no longer available. Refresh this page to continue.",
    "overlay.refreshPage": "Refresh page",
    "overlay.actionFailed": "Unable to reach the extension. Please try again.",
    "overlay.compact": "Compact mode",
    "overlay.mini": "Mini mode",
    "overlay.dock": "Dock to edge",
    "overlay.undock": "Restore mini overlay",
    "overlay.expand": "Expand overlay",
    "overlay.liveHint": "Send a message to see the request and server-reported model fields.",
    "overlay.reloadHint": "Reload this conversation to read server-reported model fields.",
    "field.requested": "Requested",
    "field.responseRoute": "Server-reported model",
    "field.mode": "Mode",
    "field.duration": "Duration",
    "field.adapter": "Adapter",
    "field.route": "Response source",
    "field.label": "Label",
    "field.labelSource": "Label field",
    "pow.hex": "Hexadecimal",
    "pow.inline": "PoW raw difficulty",
    "pow.decimal": "Decimal",
    "pow.recommendation": "Raw value only; it does not verify routing or account status.",
    "pow.notCaptured": "Not captured",
    "result.waiting": "Awaiting capture",
    "result.waitingNext": "Awaiting answer",
    "result.waitingReload": "Awaiting reload",
    "result.capturing": "Capturing",
    "result.normal": "Request and server-reported fields match",
    "result.imageGeneration": "Image generation",
    "result.deepResearch": "Deep research",
    "field.planningModel": "Planning model",
    "field.reportModel": "Report model",
    "reason.specialTask": "A dedicated task was identified. Keep its report fields, but do not compare its model with the chat request as a downgrade.",
    "result.autoReasoning": "Auto-route indication",
    "result.suspectedDowngrade": "Unconfirmed",
    "result.workUnverifiable": "Cannot determine",
    "result.mismatch": "Request and server-reported fields differ",
    "result.mismatchDetected": "Requested and server-reported model fields differ",
    "result.routeConflict": "Server-reported response-route fields conflict",
    "result.actualRouteConflict": "Server-reported model fields conflict",
    "result.unknown": "Inconclusive",
    "result.routeRead": "Server-reported model field captured",
    "result.labelOnly": "Label only",
    "result.routeMissing": "No server-reported model field captured",
    "value.unresolved": "Unresolved",
    "value.unavailable": "Unavailable",
    "value.inconclusive": "Unconfirmed",
    "value.reloadNoRequest": "Unavailable on reload",
    "value.noRouteField": "No server-reported model field captured",
    "value.noLabelField": "No label field captured",
    "value.labelConflict": "Label fields disagree",
    "value.waiting": "Waiting",
    "button.openDashboard": "Open diagnostics",
    "button.dashboard": "Diagnostics",
    "button.copySummary": "Copy turn summary",
    "button.options": "Settings & privacy",
    "privacy.local": "Local parsing",
    "privacy.popup": "Prompts and answers are never stored; only allowlisted routing fields are retained.",
    "footer.records": "{{count}} RECORDS",
    "toast.modeLive": "Switched to live request mode.",
    "toast.modeReload": "Reload session is ready. Reload the target conversation.",
    "toast.overlayShown": "The page overlay is visible.",
    "toast.overlayHidden": "The page overlay is fully hidden.",
    "toast.noRecord": "There is no record to copy in this mode yet.",
    "toast.summaryCopied": "Redacted summary copied.",
    "dashboard.documentTitle": "Route Lens \xB7 Diagnostics",
    "dashboard.subtitle": "Requested model and server-reported model field",
    "dashboard.localOnly": "LOCAL ONLY",
    "dashboard.title": "Route diagnostics",
    "dashboard.exportJson": "Export JSON",
    "dashboard.exportReport": "Export report",
    "dashboard.clear": "Clear records",
    "dashboard.ledger": "Turn ledger",
    "dashboard.evidence": "Evidence packet",
    "dashboard.health": "Status",
    "dashboard.empty": "No records match the current filters.",
    "dashboard.selectRecord": "Select a record to inspect its fields.",
    "summary.total": "Total records",
    "summary.live": "Live requests",
    "summary.reload": "Reload scans",
    "summary.anomalies": "Anomalies",
    "filter.allVerdicts": "All verdicts",
    "filter.normal": "Normal",
    "filter.autoReasoning": "Auto reasoning",
    "filter.suspectedDowngrade": "Unconfirmed",
    "filter.workUnverifiable": "Cannot determine",
    "filter.mismatch": "Mismatch",
    "filter.conflict": "Conflict",
    "filter.unknown": "Not compared",
    "filter.allModes": "All modes",
    "table.time": "Time",
    "table.mode": "Mode",
    "table.request": "Requested",
    "table.modelLabel": "Model label",
    "table.responseRoute": "Server-reported model",
    "table.verdict": "Verdict",
    "table.routeSource": "Response source",
    "detail.captureMode": "Capture mode",
    "detail.captureStatus": "Capture status",
    "detail.errorCode": "Error code",
    "phase.requested": "Request started",
    "phase.responding": "Responding",
    "phase.completed": "Completed",
    "phase.failed": "Capture failed",
    "detail.requestedModel": "Requested model",
    "detail.modelLabel": "Model label",
    "detail.modelLabelSource": "Assistant label source",
    "detail.responseRoute": "Server-reported model",
    "detail.routeFieldSource": "Response source",
    "detail.assistantMetadataLabel": "Assistant model label",
    "detail.assistantReferenceHint": "Field: assistant.metadata.model_slug\nThe model label in the answer metadata does not guarantee the model that actually executed the request. Cross-check it with Resolved model and Server model.",
    "detail.renderedAssistantLabel": "Page model label",
    "detail.resolvedModel": "Resolved model",
    "detail.serverModel": "Server model",
    "detail.planType": "Plan type",
    "detail.thinkingEffort": "Thinking effort",
    "detail.fastConvo": "Fast convo",
    "detail.deepResearchRemaining": "Deep research remaining",
    "detail.deepResearchResetAt": "Deep research reset time",
    "detail.imageGenRemaining": "Image generation remaining",
    "detail.imageGenResetAt": "Image generation reset time",
    "quota.notCaptured": "Not captured",
    "quota.snapshotHint": "Quota observed: {{time}}. This is the quota snapshot available when this record was captured, not a live query.",
    "detail.toolInvoked": "Tool invoked",
    "detail.toolName": "Tool name",
    "detail.search": "Search",
    "detail.promptImage": "Prompt image",
    "detail.requestId": "Request ID",
    "detail.networkId": "Network ID",
    "detail.duration": "Duration",
    "detail.adapters": "Capture source",
    "health.lastSuccess": "Last success",
    "health.lastFailure": "Last failure",
    "health.activeMode": "Active mode",
    "health.failures": "{{count}} consecutive failures",
    "confirm.clearAll": "Clear all local route records? This cannot be undone.",
    "toast.cleared": "Local records cleared.",
    "options.documentTitle": "Route Lens \xB7 Settings",
    "options.subtitle": "Local settings and data",
    "options.localConfig": "LOCAL ONLY",
    "options.title": "Settings & privacy",
    "options.general": "General",
    "options.auto": "Automatic capture",
    "options.retention": "Record limit",
    "options.requestIds": "Export request IDs",
    "options.redacted": "Redacted by default",
    "options.fullIds": "Keep full IDs",
    "options.save": "Save settings",
    "options.clear": "Clear local records",
    "options.notice": "Route records stay on this device. Request IDs are redacted by default when exported.",
    "toast.settingsSaved": "Settings saved.",
    "onboarding.documentTitle": "Route Lens \xB7 Get started",
    "onboarding.subtitle": "Exact route evidence",
    "onboarding.badge": "ROUTE EVIDENCE / V2",
    "onboarding.title": "See the route reported by the response.",
    "onboarding.lede": "Route Lens compares ChatGPT\u2019s requested model with response routing fields. It does not ask the model what it is, guess from response speed, or store your chat text.",
    "onboarding.liveTitle": "Capture new requests",
    "onboarding.liveCopy": "Send a message, then compare its requested model with the server-reported model field. No tab selection is needed beforehand.",
    "onboarding.reloadTitle": "Recheck existing answers",
    "onboarding.reloadCopy": "Reload the conversation to read available server-reported model fields. A model label without a report field is unconfirmed.",
    "onboarding.exactTitle": "Show exact fields",
    "onboarding.exactCopy": "Compare the request identifier with the server-reported field; model labels are supplemental. This does not confirm capability or quality.",
    "onboarding.privacyTitle": "Allowlisted fields, local storage",
    "onboarding.privacyCopy": "Message text, cookies, Authorization headers, JWTs, attachments, PoW seeds, and proof tokens are never written to extension storage.",
    "onboarding.checkPrivacy": "Review privacy settings",
    "notice.documentTitle": "Route Lens \u00b7 1.3.0 Version notice",
    "notice.subtitle": "1.3.0 \u00b7 Version notice",
    "notice.release121": "Replaced the expandable overlay with a narrow right-edge rail showing route status, requested model, and the server-reported model field; content scrolls within the rail and follows the browser theme.",
    "notice.badge": "Version notice",
    "notice.pollBefore": "An earlier version treated",
    "notice.pollLink": "missing fields",
    "notice.pollAfter": "Missing fields only mean no model field was captured; this version shows Unconfirmed.",
    "notice.pollResult": "Missing model fields cannot confirm whether routing changed and do not establish a downgrade.",
    "notice.suspectBefore": "An earlier version used",
    "notice.suspectAfter": "Earlier missing-field guesses now show Unconfirmed; no downgrade is inferred.",
    "notice.suspectEnding": "The current version no longer uses this heuristic.",
    "notice.scopeCopy": "This extension compares the request model with model fields reported by the server. When web Work mode lacks sufficient evidence, it shows Unconfirmed.",
    "notice.imageLead": "For example, ",
    "notice.imageBefore": "some task types may lack an explicit response route field; in that case, ",
    "notice.imageAfter": "request-to-route consistency cannot be confirmed.",
    "notice.historyTitle": "Version history",
    "notice.release109": "Fixed missing live request models and response routes in new chats; added a refresh prompt when the extension connection is lost instead of leaving unresponsive overlay controls.",
    "notice.release108": "Earlier versions marked missing fields as \u201csuspected downgrade\u201d; this version shows Unconfirmed when evidence is insufficient.",
    "notice.release107": "Captured live requests and session reloads independently at the same time; improved overlay layout.",
    "notice.release106": "Adapted delta streams, multiline SSE and WebSockets; fixed request pairing and record isolation; added quota snapshots and 5.6/5.5 auto-reasoning status.",
    "notice.release105": "Restored the overlay after ChatGPT rebuilt the page, while respecting manual hiding.",
    "notice.release104": "Adapted to changes in ChatGPT\u2019s official conversation API paths and response format.",
    "notice.release103": "Added mini overlay and edge docking; improved English copy and narrow-screen layout.",
    "notice.release102": "Supported reload routing for project conversations and improved export redaction and privacy tests.",
    "notice.release101": "\u5305\u62EC\u5B9E\u65F6\u8BF7\u6C42\u3001\u4F1A\u8BDD\u91CD\u8F7D\u3001Popup\u3001\u6D6E\u7A97\u3001\u8BCA\u65AD\u53F0\u3001PoW \u6570\u636E\u53CA\u4E2D\u82F1\u6587\u754C\u9762\u3002",
    "notice.close": "Close notice",
    "notice.closeManually": "Please close this browser tab.",
    "notice.hintLabel": "Route evidence details",
    "notice.hint": "This extension compares the request model with model fields reported by the server. Missing fields, a model label alone, or no requested model means the result is unconfirmed.",
    "notice.readMore": "View details",
    "notice.openFailed": "Could not open the notice. Please retry or reload the page.",
    "work.hint": "When web Work mode lacks sufficient route fields, the result is unconfirmed; no downgrade is inferred.",
    "reason.requested": "Requested model: {{model}}",
    "reason.routeField": "{{source}}: {{model}} (server-reported field)",
    "reason.labelField": "{{source}}: {{model}} (model label)",
    "reason.labelConflict": "Model label fields disagree",
    "reason.routeConflict": "Server-reported response model fields disagree",
    "reason.labelRouteMismatch": "Model label {{label}} differs from server-reported model field {{route}}; request comparison still uses the server-reported field.",
    "reason.labelOnly": "Only a model label was captured; no server-reported model field was found.",
    "reason.noRoute": "No server-reported model field was found in the response",
    "reason.noRequest": "A server-reported model field was captured, but no matching request model is available.",
    "reason.match": "The request identifier matches the server-reported model field",
    "reason.autoReasoning": "Server-reported model field is {{model}}; labeled auto reasoning",
    "reason.autoRequested": "The request model is auto; a server-reported model field was captured and labeled auto reasoning",
    "reason.suspectedDowngrade": "No server-reported model field was captured; a model label alone cannot confirm whether it matches the request.",
    "reason.workUnverifiable": "Web Work mode lacks sufficient server-reported fields; request and reported identifiers cannot be compared.",
    "reason.mismatch": "The request identifier differs from the server-reported model field"
  };
  var dictionaries = { zh, en };
  var TRANSLATION_KEYS = Object.freeze(Object.keys(zh));
  function t(language, key, variables = {}) {
    let value = dictionaries[language][key] ?? en[key] ?? key;
    for (const [name, replacement] of Object.entries(variables)) {
      value = value.replaceAll(`{{${name}}}`, String(replacement));
    }
    return value;
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

  // src/ui/shared/overlay.ts
  function overlayPrimaryRouteText(turn, language) {
    const conflict = turn.verdict === "conflict" || turn.taskKind && assessRoute({ ...turn, taskKind: null }).verdict === "conflict";
    return conflict ? t(language, "result.routeConflict") : turn.routeModel;
  }
  function overlayRouteText(turn, language) {
    if (!turn) return null;
    const route = overlayPrimaryRouteText(turn, language);
    const routeValue = route ?? t(language, "value.inconclusive");
    if (turn.taskKind === "deep_research") return `${routeValue} / ${turn.researchReportModel ?? "\u2014"}`;
    return routeValue;
  }
  function overlayVerdictCopy(turn, mode, language) {
    if (!turn) return { label: t(language, mode === "live" ? "result.waitingNext" : "result.waitingReload"), tone: "idle" };
    if (turn.verdict === "image_generation") return { label: t(language, "result.imageGeneration"), tone: "task" };
    if (turn.verdict === "deep_research") return { label: t(language, "result.deepResearch"), tone: "task" };
    if (turn.verdict === "auto_reasoning") return { label: t(language, "result.autoReasoning"), tone: "auto" };
    if (turn.verdict === "suspected_downgrade") return { label: t(language, "result.unknown"), tone: "warn" };
    if (turn.verdict === "work_unverifiable") return { label: t(language, "result.workUnverifiable"), tone: "neutral" };
    if (turn.verdict === "normal") return { label: t(language, "result.normal"), tone: "normal" };
    if (turn.verdict === "mismatch") return { label: t(language, "result.mismatchDetected"), tone: "danger" };
    if (turn.verdict === "conflict") return { label: t(language, "result.actualRouteConflict"), tone: "danger" };
    if (turn.verdict === "unknown") return { label: t(language, "result.unknown"), tone: "warn" };
    if (turn.routeModel) return { label: t(language, "result.routeRead"), tone: "warn" };
    if (turn.modelLabel || turn.modelLabelConflict) return { label: t(language, "result.labelOnly"), tone: "warn" };
    return {
      label: t(language, turn.phase === "completed" || turn.phase === "failed" ? "result.routeMissing" : "result.capturing"),
      tone: "warn"
    };
  }

  // src/shared/upgrade-notice.ts

  // src/content/bridge.ts
  var state = null;
  var host = null;
  var railPageSpaceStyle = null;
  var ownTabId = null;
  var scanTimer = null;
  var scanRunning = false;
  var captureContext = null;
  var DOM_FALLBACK_DELAY_MS = 1200;
  var seenDomRoutes = /* @__PURE__ */ new Set();
  var domPathname = location.pathname;
  var nodeIdentities = /* @__PURE__ */ new WeakMap();
  var domSelector = '[data-message-author-role="assistant"][data-message-model-slug]';
  var renderedSignature = "";
  var captureGeneration = 0;
  var waitingObservations = 0;
  var MAX_STARTUP_OBSERVATIONS = 128;
  var runtimeDisconnected = false;
  var disconnectedDismissed = false;
  async function sendToRuntime(request) {
    try {
      if (runtimeDisconnected || typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
        throw new Error("Extension context invalidated.");
      }
      return await chrome.runtime.sendMessage(request);
    } catch (error) {
      if (!runtimeDisconnected && error instanceof Error && /extension context invalidated/i.test(error.message)) {
        runtimeDisconnected = true;
        captureGeneration++;
        pendingContext = null;
        if (scanTimer !== null) {
          window.clearTimeout(scanTimer);
          scanTimer = null;
        }
        render();
      }
      throw error;
    }
  }
  function trackDomNodes(blocked = state?.settings.autoCaptureEnabled === false) {
    if (domPathname !== location.pathname) {
      domPathname = location.pathname;
      seenDomRoutes.clear();
    }
    const nodes = [...document.querySelectorAll(domSelector)];
    for (const node of nodes) {
      const identity = nodeIdentities.get(node);
      const messageId = node.getAttribute("data-message-id");
      if (!identity || identity.contextId === null || messageId !== null && messageId !== identity.messageId) {
        const contextId = captureContext?.pageUrl === `${location.origin}${domPathname}` ? captureContext.id : null;
        nodeIdentities.set(node, {
          pathname: domPathname,
          messageId,
          contextId,
          observedAt: identity?.messageId === messageId ? identity.observedAt : Date.now(),
          blocked: blocked || Boolean(identity?.messageId === messageId && identity.blocked)
        });
      }
      if (blocked) nodeIdentities.get(node).blocked = true;
    }
    return nodes;
  }
  function publishCaptureControl() {
    if (!state) return;
    window.postMessage({
      source: "chatgpt-route-inspector-control",
      version: 1,
      revision: state.revision ?? 0,
      autoCaptureEnabled: state.settings.autoCaptureEnabled,
      captureMode: state.settings.captureMode,
      clearedAt: state.clearedAt ?? null
    }, location.origin);
  }
  function acceptState(next) {
    if (runtimeDisconnected) return false;
    if (isStaleState(state, next)) return false;
    if (!next.settings.autoCaptureEnabled) captureGeneration++;
    if (!next.settings.autoCaptureEnabled || state?.settings.autoCaptureEnabled === false) trackDomNodes(true);
    if (state?.clearedAt !== next.clearedAt) {
      seenDomRoutes.clear();
      if (next.clearedAt && captureContext && Date.parse(next.clearedAt) >= (captureContext.visitStartedAt ?? captureContext.documentStartedAt)) {
        captureContext = { ...captureContext, reloadEligible: false };
      }
    }
    state = next;
    publishCaptureControl();
    render();
    scheduleReloadDomScan();
    return true;
  }
  var stateRetryDelay = 250;
  async function initializeState() {
    while (!runtimeDisconnected) {
      try {
        const response = await sendToRuntime({ type: "route:get-state" });
        if (response.ok && response.state && Number.isInteger(response.tabId)) {
          ownTabId = response.tabId;
          acceptState(response.state);
          render();
          return;
        }
      } catch {
      }
      if (runtimeDisconnected) return;
      await new Promise((resolve) => window.setTimeout(resolve, stateRetryDelay));
      stateRetryDelay = Math.min(stateRetryDelay * 2, 5e3);
    }
  }
  var pendingContext = null;
  var contextSyncRunning = false;
  var contextRetryScheduled = false;
  var contextRetryDelay = 250;
  var stateReady = initializeState();
  async function syncContext() {
    if (runtimeDisconnected || contextSyncRunning || !pendingContext) return;
    contextSyncRunning = true;
    await stateReady;
    if (runtimeDisconnected || !pendingContext) {
      contextSyncRunning = false;
      return;
    }
    const next = pendingContext;
    try {
      const response = await sendToRuntime({ type: "route:context", context: next });
      if (response.ok) {
        if (pendingContext === next) pendingContext = null;
        contextRetryDelay = 250;
        if (response.state) acceptState(response.state);
      }
    } catch {
    } finally {
      contextSyncRunning = false;
      if (!runtimeDisconnected && pendingContext && !contextRetryScheduled) {
        contextRetryScheduled = true;
        window.setTimeout(() => {
          contextRetryScheduled = false;
          void syncContext();
        }, contextRetryDelay);
        contextRetryDelay = Math.min(contextRetryDelay * 2, 5e3);
      }
    }
  }
  function currentTurn() {
    if (!state || !captureContext || ownTabId === null || captureContext.pageUrl !== `${location.origin}${location.pathname}`) return null;
    return latestInContext({ ...state, captureContexts: { [ownTabId]: captureContext } }, ownTabId, state.settings.captureMode);
  }
  function currentPowReading() {
    if (!state) return null;
    if (ownTabId !== null) return state.powReadings.find((reading) => reading.tabId === ownTabId) ?? null;
    return state.powReadings.find((reading) => reading.tabId === null) ?? null;
  }
  function modeLabel(mode, language) {
    return t(language, mode === "live" ? "mode.live" : "mode.reload");
  }
  function routeSource(turn, language) {
    return turn?.routeModelSources.join(" + ") || t(language, "value.noRouteField");
  }
  function labelSource(turn, language) {
    return turn?.modelLabelSources.join(" + ") || t(language, "value.noLabelField");
  }
  function labelValue(turn, language) {
    if (turn?.modelLabelConflict) return t(language, "value.labelConflict");
    return turn?.modelLabel ?? "\u2014";
  }
  function escapeHtml(value) {
    return String(value ?? "\u2014").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
  }
  function conversationIdFromPath() {
    return conversationIdFromPathname(location.pathname);
  }
  function hasCurrentDocumentConversationRecord() {
    if (!state || ownTabId === null) return false;
    const conversationId = conversationIdFromPath();
    if (!conversationId) return false;
    return state.turns.some(
      (turn) => turn.tabId === ownTabId && turn.captureMode === "reload" && turn.conversationId === conversationId && turn.phase === "completed" && turn.sources.includes("conversation_record") && turn.captureContextId === captureContext?.id && hasResponseEvidence(turn)
    );
  }
  async function scanReloadDom() {
    if (runtimeDisconnected || !captureContext?.reloadEligible || scanRunning || !state?.settings.autoCaptureEnabled || captureContext.pageUrl !== `${location.origin}${location.pathname}`) return;
    if (hasCurrentDocumentConversationRecord()) return;
    const context = captureContext;
    scanRunning = true;
    try {
      const pathname = location.pathname;
      const conversationId = conversationIdFromPath();
      if (!conversationId) return;
      const nodes = trackDomNodes();
      for (const [index, node] of nodes.entries()) {
        if (runtimeDisconnected || location.pathname !== pathname || captureContext?.id !== context.id || !captureContext.reloadEligible || !state?.settings.autoCaptureEnabled) break;
        const identity = nodeIdentities.get(node);
        if (!node.isConnected || identity?.pathname !== pathname || identity.contextId !== context.id || identity.blocked || identity.observedAt <= Date.parse(state.clearedAt ?? "")) continue;
        const model = node.getAttribute("data-message-model-slug")?.trim() ?? "";
        if (!model || model.length > 256) continue;
        const messageKey = node.getAttribute("data-message-id") ?? String(index);
        const key = `${pathname}\0${messageKey}\0${model}`;
        if (seenDomRoutes.has(key)) continue;
        const observedAt = (/* @__PURE__ */ new Date()).toISOString();
        try {
          const response = await sendToRuntime({
            type: "route:observation",
            observation: {
              captureId: crypto.randomUUID(),
              captureContextId: context.id,
              source: "assistant_dom",
              captureMode: "reload",
              phase: "completed",
              observedAt,
              startedAt: new Date(identity.observedAt).toISOString(),
              completedAt: observedAt,
              pageUrl: `${location.origin}${pathname}`,
              conversationId,
              domModelSlug: model
            }
          });
          if (response.ok) {
            if (seenDomRoutes.size >= 1e3) seenDomRoutes.delete(seenDomRoutes.values().next().value);
            seenDomRoutes.add(key);
            if (response.state) acceptState(response.state);
          }
        } catch {
        }
      }
      render();
    } finally {
      scanRunning = false;
    }
  }
  function scheduleReloadDomScan() {
    if (runtimeDisconnected || scanTimer !== null) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      void scanReloadDom();
    }, DOM_FALLBACK_DELAY_MS);
  }
  async function runAction(request) {
    try {
      const response = await sendToRuntime(request);
      if (!response.ok) throw new Error(response.error ?? "Extension action failed.");
      if (response.state) acceptState(response.state);
    } catch (error) {
      if (!runtimeDisconnected) console.error("Route Lens action failed.", error);
    }
  }
  function updateSettings(settings) {
    return runAction({ type: "route:update-settings", settings });
  }
  function setNarrowRailSpace(enabled, width = 72) {
    if (!enabled) {
      railPageSpaceStyle?.remove();
      railPageSpaceStyle = null;
      return;
    }
    if (!railPageSpaceStyle?.isConnected) {
      railPageSpaceStyle = document.createElement("style");
      railPageSpaceStyle.dataset.routeInspectorLayout = "true";
      document.documentElement.append(railPageSpaceStyle);
    }
    railPageSpaceStyle.textContent = `@media(max-width:1120px){body{width:auto!important;margin-right:${width}px!important}}`;
  }
  function railGeometry(settings) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const requestedWidth = Number.isFinite(settings.railWidthPx) ? settings.railWidthPx : 72;
    const width = Math.max(48, Math.min(requestedWidth, viewportWidth - 220));
    return { width: Math.round(width) };
  }
  function render() {
    if (!state?.settings.overlayEnabled || disconnectedDismissed) {
      host?.remove();
      host = null;
      setNarrowRailSpace(false);
      renderedSignature = "";
      return;
    }
    const geometry = railGeometry(state.settings);
    setNarrowRailSpace(true, geometry.width);
    if (!host?.isConnected) {
      host = document.createElement("div");
      host.id = "chatgpt-route-inspector-root";
      document.documentElement.append(host);
      host.attachShadow({ mode: "open" });
      renderedSignature = "";
    }
    const root = host.shadowRoot;
    if (!root) return;
    const language = state.settings.uiLanguage;
    if (runtimeDisconnected) {
      if (renderedSignature === "disconnected") return;
      renderedSignature = "disconnected";
      root.innerHTML = '<style>:host{all:initial;position:relative;z-index:2147483647}*{box-sizing:border-box}.disconnected{position:fixed;top:72px;right:calc(100% - 100vw);bottom:100px;z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:10px;width:72px;padding:10px 7px;border:1px solid #e2e8f0;border-right:0;border-radius:8px 0 0 8px;background:#fff;color:#0f172a;box-shadow:-3px 0 #dc2626,0 4px 16px rgba(0,0,0,.08);font:11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}@media(max-width:560px){.disconnected{top:72px;bottom:96px;width:64px;padding:8px 6px}}.disconnected button{width:28px;height:28px;flex:0 0 auto;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:inherit;cursor:pointer;font:14px/1 system-ui,sans-serif}.disconnected button:focus-visible{outline:2px solid #1a68d8;outline-offset:1px}@media(prefers-color-scheme:dark){.disconnected{border-color:#26323f;background:#0f1419;color:#f1f5f9;box-shadow:-3px 0 #f87171,0 4px 16px rgba(0,0,0,.3)}.disconnected button{border-color:#364455;background:#182029}}</style><section class="disconnected" role="status" aria-label="' + escapeHtml(t(language, "overlay.disconnected")) + '"><span aria-hidden="true">!</span><span>' + escapeHtml(t(language, "overlay.disconnected")) + '</span><button id="reconnect" type="button" title="' + escapeHtml(t(language, "overlay.refreshPage")) + '" aria-label="' + escapeHtml(t(language, "overlay.refreshPage")) + '">↻</button></section>';
      root.getElementById("reconnect")?.addEventListener("click", () => location.reload());
      return;
    }
    const mode = state.settings.captureMode;
    const turn = currentTurn();
    const theme = ["system", "light", "dark"].includes(state.settings.theme) ? state.settings.theme : "system";
    const appearance = state.settings;
    const signature = JSON.stringify([
      language,
      mode,
      theme,
      geometry,
      appearance.railHeightPercent,
      appearance.railPositionPercent,
      appearance.railFontSizePx,
      appearance.railOpacityPercent,
      appearance.showRouteStatus,
      appearance.showRequestedModel,
      appearance.showActualModel,
      turn && [
        turn.phase,
        turn.verdict,
        turn.requestedModel,
        turn.routeModel,
        turn.modelLabel,
        turn.modelLabelConflict,
        turn.researchReportModel,
        turn.routeModelSources,
        turn.modelLabelSources,
        turn.sources
      ]
    ]);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    const copy = overlayVerdictCopy(turn, mode, language);
    const routeModel = overlayRouteText(turn, language);
    const requestedModel = turn?.requestedModel ?? (turn?.captureMode === "reload" ? t(language, "value.reloadNoRequest") : "—");
    const marker = turn?.verdict === "normal" ? "✓" : ["mismatch", "conflict"].includes(turn?.verdict) ? "!" : turn ? "·" : "…";
    const styles = `
    <style>
      :host{all:initial;position:relative;z-index:2147483647}*{box-sizing:border-box}
      .probe{--bg:#0f1419;--surface:#182029;--text:#f1f5f9;--muted:#94a3b8;--line:#26323f;--accent:#4d93f7;--good:#34d399;--warn:#fbbf24;--bad:#f87171;position:fixed;z-index:2147483647;color:var(--text);background:color-mix(in srgb,var(--bg) var(--ri-opacity),transparent);border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.25);font:var(--ri-font-size)/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
      .probe[data-theme="light"]{--bg:#ffffff;--surface:#f8fafc;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#1a68d8;--good:#047857;--warn:#b45309;--bad:#b91c1c;color-scheme:light}
      @media(prefers-color-scheme:light){.probe[data-theme="system"]{--bg:#ffffff;--surface:#f8fafc;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#1a68d8;--good:#047857;--warn:#b45309;--bad:#b91c1c;color-scheme:light}}
      .probe[data-theme="dark"]{color-scheme:dark}
      .probe{--ri-safe-height:min(calc(var(--ri-height-percent)*1dvh),calc(100dvh - 164px));top:max(16px,calc(16px + (100dvh - 148px - var(--ri-safe-height) - 16px)*var(--ri-position)));right:calc(100% - 100vw);bottom:auto;display:flex;flex-direction:column;width:var(--ri-width);height:var(--ri-safe-height);overflow:hidden;border-right:0;border-radius:8px 0 0 8px;box-shadow:-3px 0 var(--accent),0 4px 16px rgba(0,0,0,.12);backdrop-filter:blur(12px)}
      .probe.normal{--accent:var(--good)}.probe.danger,.probe.conflict{--accent:var(--bad)}.probe.warn,.probe.suspect{--accent:var(--warn)}
      .rail-scroll{min-height:0;height:100%;padding:8px 6px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
      .status-block{display:grid;justify-items:center;gap:4px;padding:4px 1px 10px;border-bottom:1px solid var(--line);text-align:center}
      .status-icon{display:grid;place-items:center;width:20px;height:20px;border:1.5px solid var(--accent);border-radius:50%;color:var(--accent);font-size:calc(var(--ri-font-size) + 1px);font-weight:700;line-height:1}
      .status{color:var(--accent);font-size:var(--ri-font-size);font-weight:600;line-height:1.25;overflow-wrap:anywhere}
      .model-block{display:grid;gap:3px;padding:8px 1px;border-bottom:1px solid var(--line)}
      .model-block small{color:var(--muted);font-size:calc(var(--ri-font-size) - 1px);line-height:1.2;overflow-wrap:anywhere}
      .model-block b{display:block;min-width:0;color:var(--text);font-size:var(--ri-font-size);font-weight:600;line-height:1.25;overflow-wrap:anywhere;word-break:normal}
      .model-block:last-child{border-bottom:0}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
    </style>`;
    const heightPercent = appearance.railHeightPercent ?? 75;
    const verticalPosition = Math.max(0, Math.min(appearance.railPositionPercent ?? 58, 100)) / 100;
    const railStyle = `--ri-width:${geometry.width}px;--ri-height-percent:${heightPercent};--ri-position:${verticalPosition};--ri-font-size:${appearance.railFontSizePx ?? 10}px;--ri-opacity:${appearance.railOpacityPercent ?? 92}%`;
    const statusBlock = appearance.showRouteStatus === false ? "" : `<div class="status-block" role="status" aria-label="${escapeHtml(copy.label)}" title="${escapeHtml(copy.label)}"><span class="status-icon" aria-hidden="true">${marker}</span><span class="status">${escapeHtml(copy.label)}</span></div>`;
    const requestedBlock = appearance.showRequestedModel === false ? "" : `<div class="model-block"><small>${escapeHtml(t(language, "field.requested"))}</small><b title="${escapeHtml(requestedModel)}">${escapeHtml(requestedModel)}</b></div>`;
    const actualBlock = appearance.showActualModel === false ? "" : `<div class="model-block"><small>${escapeHtml(t(language, "field.responseRoute"))}</small><b title="${escapeHtml(routeModel ?? "—")}">${escapeHtml(routeModel)}</b></div>`;
    root.innerHTML = `${styles}
      <aside class="probe rail ${copy.tone}" style="${railStyle}" data-theme="${theme}" lang="${language === "zh" ? "zh-CN" : "en"}" role="complementary" aria-label="${escapeHtml(language === "zh" ? "路由状态" : "Route status")}">
        <div class="rail-scroll">
          ${statusBlock}${requestedBlock}${actualBlock}
        </div>
      </aside>`;
  }
  window.addEventListener("message", (event) => {
    if (runtimeDisconnected) return;
    if (event.source === window && event.origin === location.origin && event.data?.source === "chatgpt-route-inspector-context") {
      const next = normalizeCaptureContext(event.data.context);
      if (!next || new URL(next.pageUrl).origin !== location.origin || !newerContext(captureContext ?? void 0, next)) return;
      if (captureContext?.id !== next.id) seenDomRoutes.clear();
      captureContext = next;
      trackDomNodes();
      render();
      scheduleReloadDomScan();
      pendingContext = next;
      void syncContext();
      return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === "chatgpt-route-inspector-control-request") {
      publishCaptureControl();
      return;
    }
    if (event.source !== window || event.origin !== location.origin || !isPageBridgeEnvelope(event.data)) return;
    if (state?.settings.autoCaptureEnabled === false || ownTabId === null && waitingObservations >= MAX_STARTUP_OBSERVATIONS) return;
    const envelope = event.data;
    const generation = captureGeneration;
    waitingObservations++;
    void stateReady.then(async () => {
      if (runtimeDisconnected || generation !== captureGeneration || !state?.settings.autoCaptureEnabled || ownTabId === null) return;
      if ("pow" in envelope) {
        const response2 = await sendToRuntime({
          type: "pow:observation",
          observation: envelope.pow
        });
        if (response2.ok && response2.state) acceptState(response2.state);
        return;
      }
      const response = await sendToRuntime({
        type: "route:observation",
        observation: envelope.observation
      });
      if (response.ok && response.state) acceptState(response.state);
    }).catch(() => void 0).finally(() => {
      waitingObservations--;
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    const record = message;
    if (record.type !== "route:state-changed" || !record.state) return;
    const next = record.state;
    acceptState(next);
  });
  window.addEventListener("resize", () => {
    if (!runtimeDisconnected && state?.settings.overlayEnabled) {
      renderedSignature = "";
      render();
    }
  }, { passive: true });
  var domObserver = new MutationObserver(() => {
    if (captureContext?.reloadEligible || state?.settings.autoCaptureEnabled === false) trackDomNodes();
    if (state?.settings.overlayEnabled && !host?.isConnected) render();
    scheduleReloadDomScan();
  });
  function observeDocument() {
    if (!document.documentElement) return;
    trackDomNodes();
    domObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-message-model-slug", "data-message-id"]
    });
    scheduleReloadDomScan();
  }
  if (document.documentElement) observeDocument();
  else document.addEventListener("DOMContentLoaded", observeDocument, { once: true });
  window.postMessage({ source: "chatgpt-route-inspector-context-request" }, location.origin);
})();
