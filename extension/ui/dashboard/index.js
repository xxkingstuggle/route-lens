"use strict";
(() => {
  // src/core/chatgpt-path.ts
  var STANDARD_CONVERSATION_PATH = /^\/c\/([^/]+)(?=\/|$)/;
  var PROJECT_CONVERSATION_PATH = /^\/g\/[^/]+\/c\/([^/]+)(?=\/|$)/;
  function redactConversationPathname(pathname) {
    if (PROJECT_CONVERSATION_PATH.test(pathname)) {
      return pathname.replace(/^\/g\/[^/]+\/c\/[^/]+/, "/g/[redacted]/c/[redacted]");
    }
    if (STANDARD_CONVERSATION_PATH.test(pathname)) {
      return pathname.replace(/^\/c\/[^/]+/, "/c/[redacted]");
    }
    return pathname;
  }

  // src/core/privacy.ts
  function redactedId(value) {
    if (!value) return null;
    return `[redacted:${value.slice(-6)}]`;
  }
  function sanitizePageUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      url.pathname = redactConversationPathname(url.pathname);
      url.pathname = url.pathname.replace(
        /^\/backend-api\/(conversations?)\/[^/]+/,
        "/backend-api/$1/[redacted]"
      );
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
      ...turn.captureContextId ? { captureContextId: "[redacted]" } : {},
      pageUrl: sanitizePageUrl(turn.pageUrl),
      conversationId: redactedId(turn.conversationId),
      researchWidgetId: redactedId(turn.researchWidgetId),
      researchMessageId: redactedId(turn.researchMessageId),
      requestId: includeRequestIds ? turn.requestId : redactedId(turn.requestId),
      networkRequestId: includeRequestIds ? turn.networkRequestId : redactedId(turn.networkRequestId)
    };
  }
  function sanitizedExport(state2) {
    return {
      ...state2,
      captureContexts: {},
      turns: state2.turns.map((turn, index) => ({
        ...sanitizeTurn(turn, state2.settings.includeRequestIdsInExport),
        captureId: `capture-${index + 1}`
      }))
    };
  }
  function buildMarkdownReport(state2, language = state2.settings.uiLanguage) {
    const exported = sanitizedExport(state2);
    const chinese = language === "zh";
    const lines = chinese ? [
      "# ChatGPT Route Lens \u62A5\u544A",
      "",
      `\u751F\u6210\u65F6\u95F4\uFF1A${(/* @__PURE__ */ new Date()).toISOString()}`,
      `\u8BB0\u5F55\u6570\uFF1A${exported.turns.length}`,
      "",
      "| \u65F6\u95F4 | \u6A21\u5F0F | \u8BF7\u6C42\u6A21\u578B | \u6A21\u578B\u6807\u7B7E | \u54CD\u5E94\u8DEF\u7531\u6A21\u578B | \u54CD\u5E94\u6765\u6E90 | \u7ED3\u8BBA | \u8BF7\u6C42 ID |",
      "|---|---|---|---|---|---|---|---|"
    ] : [
      "# ChatGPT Route Lens Report",
      "",
      `Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `Records: ${exported.turns.length}`,
      "",
      "| Time | Mode | Requested model | Model label | Response route | Response source | Verdict | Request ID |",
      "|---|---|---|---|---|---|---|---|"
    ];
    for (const turn of exported.turns) {
      const unknown = chinese ? "\u672A\u77E5" : "Unknown";
      const none = chinese ? "\u65E0" : "None";
      const label = turn.modelLabelConflict ? chinese ? "\u6807\u7B7E\u5B57\u6BB5\u4E0D\u4E00\u81F4" : "Label fields disagree" : turn.modelLabel ?? unknown;
      lines.push(`| ${turn.observedAt} | ${turn.captureMode} | ${turn.requestedModel ?? unknown} | ${label} | ${turn.routeModel ?? unknown} | ${turn.routeModelSources.join(" + ") || none} | ${turn.verdict} | ${turn.requestId ?? none} |`);
    }
    for (const turn of exported.turns.filter((item) => item.taskKind === "deep_research")) lines.push("", chinese ? `${turn.observedAt} \xB7 \u89C4\u5212\u6A21\u578B\uFF1A${turn.routeModel ?? "\u2014"}\uFF1B\u62A5\u544A\u6A21\u578B\uFF1A${turn.researchReportModel ?? "\u2014"}` : `${turn.observedAt} \xB7 Planning model: ${turn.routeModel ?? "\u2014"}; Report model: ${turn.researchReportModel ?? "\u2014"}`);
    lines.push("", chinese ? "> \u672C\u62A5\u544A\u53EA\u5305\u542B\u5141\u8BB8\u5B57\u6BB5\uFF0C\u4E0D\u5305\u542B\u63D0\u793A\u8BCD\u3001\u56DE\u7B54\u6B63\u6587\u3001Cookie\u3001Authorization \u6216\u4EE4\u724C\u3002" : "> This report contains allowlisted fields only. It excludes prompts, answer text, cookies, Authorization headers, and tokens.");
    return `${lines.join("\n")}
`;
  }

  // src/core/state.ts
  function isStaleState(current, next) {
    return Boolean(current && (next.revision ?? 0) < (current.revision ?? 0));
  }

  // src/ui/shared/i18n.ts
  var zh = {
    "app.name": "Route Lens",
    "app.author": "xxkingstuggle",
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
    "notice.documentTitle": "Route Lens \u00b7 1.2.3 \u7248\u672c\u516c\u544a",
    "notice.subtitle": "1.2.3 \u00b7 \u7248\u672c\u516c\u544a",
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
    "notice.release101": "\u9996\u6B21\u516C\u5F00\u53D1\u5E03\uFF1A\u5B9E\u65F6\u8BF7\u6C42\u3001\u4F1A\u8BDD\u91CD\u8F7D\u3001Popup\u3001\u6D6E\u7A97\u3001\u8BCA\u65AD\u53F0\u3001PoW \u96BE\u5EA6\u53CA\u4E2D\u82F1\u6587\u754C\u9762\u3002",
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
    "app.author": "xxkingstuggle",
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
    "notice.documentTitle": "Route Lens \u00b7 1.2.3 Version notice",
    "notice.subtitle": "1.2.3 \u00b7 Version notice",
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
    "notice.release101": "First public release: live capture, session reload, popup, overlay, diagnostics, PoW difficulty and Chinese/English UI.",
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
  function applyStaticTranslations(language, root = document) {
    const documentRef = root instanceof Document ? root : root.ownerDocument;
    documentRef.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      if (key) element.textContent = t(language, key);
    });
    for (const [attribute, dataName] of [["aria-label", "i18nAriaLabel"], ["title", "i18nTitle"]]) {
      root.querySelectorAll(`[data-${dataName.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}]`).forEach((element) => {
        const key = element.dataset[dataName];
        if (key) element.setAttribute(attribute, t(language, key));
      });
    }
    root.querySelectorAll("[data-language]").forEach((button) => {
      const active = button.dataset.language === language;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function bindLanguageSwitch(handler, root = document) {
    root.querySelectorAll("[data-language]").forEach((button) => {
      button.addEventListener("click", () => {
        const language = button.dataset.language;
        if (language === "zh" || language === "en") void handler(language);
      });
    });
  }

  // src/ui/shared/client.ts
  async function send(request) {
    try {
      const response = await chrome.runtime.sendMessage(request);
      if (!response.ok) throw new Error(response.error ?? "The extension could not complete this action.");
      document.getElementById("route-operation-error")?.remove();
      return response;
    } catch (error) {
      showOperationError(error);
      return { ok: false, error: error instanceof Error ? error.message : "The extension could not complete this action." };
    }
  }
  function showOperationError(error) {
    const message = error instanceof Error ? error.message : "The extension could not complete this action.";
    let element = document.getElementById("route-operation-error");
    if (!element) {
      element = document.createElement("div");
      element.id = "route-operation-error";
      element.setAttribute("role", "alert");
      element.style.cssText = "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;padding:12px;background:#471f1a;color:#fff;white-space:pre-wrap";
      document.body.append(element);
    }
    element.textContent = message;
  }
  async function getState(tabId) {
    const response = await send({ type: "route:get-state", ...tabId !== void 0 ? { tabId } : {} });
    if (!response.ok || !response.state) throw new Error(response.error ?? "Unable to read extension state.");
    return response.state;
  }
  function escapeHtml(value) {
    return String(value ?? "\u2014").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[char] ?? char);
  }
  function modelLabel(model, language) {
    if (!model) return t(language, "value.unresolved");
    return model.replace(/^gpt-/, "GPT ").replace(/-(\d)/g, ".$1").replace(/-pro$/i, " Pro").replace(/-mini$/i, " mini").replace(/-sol$/i, " Sol");
  }
  function verdictLabel(verdict, language) {
    return {
      normal: t(language, "result.normal"),
      image_generation: t(language, "result.imageGeneration"),
      deep_research: t(language, "result.deepResearch"),
      mismatch: t(language, "result.mismatch"),
      conflict: t(language, "result.routeConflict"),
      auto_reasoning: t(language, "result.autoReasoning"),
      suspected_downgrade: t(language, "result.unknown"),
      work_unverifiable: t(language, "result.workUnverifiable"),
      unknown: t(language, "result.unknown")
    }[verdict];
  }
  function verdictTone(verdict) {
    if (verdict === "image_generation" || verdict === "deep_research") return "task";
    if (verdict === "auto_reasoning") return "auto";
    if (verdict === "suspected_downgrade") return "neutral";
    if (verdict === "work_unverifiable") return "neutral";
    if (verdict === "normal") return "signal";
    if (verdict === "mismatch" || verdict === "conflict") return "danger";
    return "amber";
  }
  function turnResultLabel(turn, language) {
    if (!turn) return t(language, "result.waiting");
    if (turn.verdict === "unknown") {
      return t(language, "result.unknown");
    }
    return verdictLabel(turn.verdict, language);
  }
  function requestedModelLabel(turn, language) {
    if (turn?.requestedModel) return modelLabel(turn.requestedModel, language);
    return turn?.captureMode === "reload" ? t(language, "value.reloadNoRequest") : t(language, "value.unresolved");
  }
  function captureModeLabel(mode, language) {
    return mode === "live" ? t(language, "mode.live") : t(language, "mode.reload");
  }
  function routeSourcesLabel(turn, language) {
    return turn?.routeModelSources.join(" + ") || t(language, "value.noRouteField");
  }
  function recordedModelLabel(turn, language) {
    if (turn?.modelLabelConflict) return t(language, "value.labelConflict");
    return modelLabel(turn?.modelLabel ?? null, language);
  }
  function formatTime(value, language) {
    if (!value) return "\u2014";
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  }
  function formatDuration(value) {
    if (value === null) return "\u2014";
    if (value < 1e3) return `${value} ms`;
    if (value < 6e4) return `${(value / 1e3).toFixed(1)} s`;
    return `${Math.floor(value / 6e4)}m ${Math.round(value % 6e4 / 1e3)}s`;
  }
  function subscribe(handler) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") return;
      const record = message;
      if (record.type === "route:state-changed" && record.state) handler(record.state);
    });
  }

  // src/ui/dashboard/index.ts
  var state;
  var filter = "all";
  var modeFilter = "all";
  var selectedId = null;
  var evidenceFieldHints = {
    "detail.assistantMetadataLabel": "assistant.metadata.model_slug",
    "detail.renderedAssistantLabel": "assistant[data-message-model-slug]",
    "detail.resolvedModel": "resolved_model_slug",
    "detail.serverModel": "server_ste_metadata.model_slug",
    "detail.deepResearchRemaining": "limits_progress[feature_name=deep_research].remaining",
    "detail.deepResearchResetAt": "limits_progress[feature_name=deep_research].reset_after",
    "detail.imageGenRemaining": "limits_progress[feature_name=image_gen].remaining",
    "detail.imageGenResetAt": "limits_progress[feature_name=image_gen].reset_after"
  };
  var versionLabel = document.querySelector("#dashboard-version");
  if (versionLabel) {
    const version = chrome.runtime.getManifest().version;
    versionLabel.textContent = `v${version}`;
  }
  function quotaTime(value, language) {
    if (!value || !Number.isFinite(Date.parse(value))) return t(language, "quota.notCaptured");
    const formatted = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(value));
    return `${formatted} ${language === "zh" ? "\uFF08\u5317\u4EAC\u65F6\u95F4\uFF09" : "(UTC+08:00)"}`;
  }
  function toast(message) {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    window.setTimeout(() => element.classList.remove("show"), 1800);
  }
  function download(name, content, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1e3);
  }
  function selectedTurn(turns) {
    return turns.find((turn) => turn.captureId === selectedId) ?? turns[0] ?? null;
  }
  function renderDetail(turn, language) {
    const detail = document.querySelector("#detail");
    const tag = document.querySelector("#detail-tag");
    if (!detail || !tag) return;
    if (!turn) {
      detail.innerHTML = `<div class="panel-empty">${escapeHtml(t(language, "dashboard.selectRecord"))}</div>`;
      tag.textContent = t(language, "result.unknown");
      return;
    }
    const tone = verdictTone(turn.verdict);
    tag.className = `tag ${tone}`;
    tag.textContent = turnResultLabel(turn, language);
    const items = [
      ["detail.captureMode", captureModeLabel(turn.captureMode, language)],
      ["detail.captureStatus", t(language, {
        requested: "phase.requested",
        responding: "phase.responding",
        completed: "phase.completed",
        failed: "phase.failed"
      }[turn.phase])],
      ["detail.errorCode", turn.errorCode],
      ["detail.requestedModel", turn.requestedModel ?? requestedModelLabel(turn, language)],
      ["detail.responseRoute", turn.verdict === "conflict" ? t(language, "result.routeConflict") : turn.routeModel ?? t(language, "value.inconclusive")],
      ["detail.routeFieldSource", routeSourcesLabel(turn, language)],
      ["detail.resolvedModel", turn.resolvedModelSlug],
      ["detail.serverModel", turn.serverModelSlug],
      ["detail.assistantMetadataLabel", turn.responseModelSlug],
      ["detail.modelLabelSource", turn.responseModelSlug ? "assistant.metadata.model_slug" : null],
      ["detail.renderedAssistantLabel", turn.domModelSlug],
      ["detail.thinkingEffort", turn.thinkingEffort],
      ["detail.fastConvo", turn.fastConvo],
      ["detail.planType", turn.planType],
      ["detail.deepResearchRemaining", turn.deepResearchRemaining ?? t(language, "quota.notCaptured")],
      ["detail.deepResearchResetAt", quotaTime(turn.deepResearchResetAt, language)],
      ["detail.imageGenRemaining", turn.imageGenRemaining ?? t(language, "quota.notCaptured")],
      ["detail.imageGenResetAt", quotaTime(turn.imageGenResetAt, language)],
      ["detail.requestId", turn.requestId],
      ["detail.networkId", turn.networkRequestId],
      ["detail.duration", formatDuration(turn.durationMs)],
      ["detail.adapters", turn.sources.join(" + ")]
    ];
    const availableItems = items.filter(([, value]) => value !== null && value !== "");
    if (turn.taskKind === "deep_research") availableItems.unshift(
      ["field.planningModel", turn.routeModel ?? "\u2014"],
      ["field.reportModel", turn.researchReportModel ?? "\u2014"]
    );
    detail.innerHTML = `<div class="evidence-list">${availableItems.map(([label, value]) => {
      const isAssistantLabel = label === "detail.assistantMetadataLabel";
      const quotaHint = evidenceFieldHints[label]?.startsWith("limits_progress") ? `${evidenceFieldHints[label]}
${t(language, "quota.snapshotHint", { time: quotaTime(turn.quotaObservedAt, language) })}` : null;
      const hint = isAssistantLabel ? t(language, "detail.assistantReferenceHint") : quotaHint ?? evidenceFieldHints[label];
      const name = `<small${hint ? ` title="${escapeHtml(hint)}"` : ""}>${escapeHtml(t(language, label))}</small>`;
      const labelHtml = isAssistantLabel ? `<div class="evidence-label">${name}<sup class="evidence-note" tabindex="0" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}">*</sup></div>` : name;
      return `<div class="evidence">${labelHtml}<code>${escapeHtml(value)}</code></div>`;
    }).join("")}</div>`;
  }
  function render(next) {
    if (isStaleState(state, next)) return;
    state = next;
    const language = state.settings.uiLanguage;
    applyStaticTranslations(language);
    const total = state.turns.length;
    const live = state.turns.filter((turn) => turn.captureMode === "live").length;
    const reload = state.turns.filter((turn) => turn.captureMode === "reload").length;
    const anomaly = state.turns.filter((turn) => turn.verdict === "mismatch" || turn.verdict === "conflict").length;
    document.querySelector("#summary").innerHTML = `<div class="readout"><small>${escapeHtml(t(language, "summary.total"))}</small><b>${total}</b></div><div class="readout"><small>${escapeHtml(t(language, "summary.live"))}</small><b class="signal-text">${live}</b></div><div class="readout"><small>${escapeHtml(t(language, "summary.reload"))}</small><b class="amber-text">${reload}</b></div><div class="readout"><small>${escapeHtml(t(language, "summary.anomalies"))}</small><b class="danger-text">${anomaly}</b></div>`;
    const verdictFilters = [["all", "filter.allVerdicts"], ["normal", "filter.normal"], ["auto_reasoning", "filter.autoReasoning"], ["work_unverifiable", "filter.workUnverifiable"], ["mismatch", "filter.mismatch"], ["conflict", "filter.conflict"], ["unknown", "filter.unknown"]];
    const modeFilters = [["all", "filter.allModes"], ["live", "mode.live"], ["reload", "mode.reload"]];
    verdictFilters.splice(3, 0, ["image_generation", "result.imageGeneration"], ["deep_research", "result.deepResearch"]);
    document.querySelector("#filters").innerHTML = verdictFilters.map(([value, label]) => `<button class="filter-button ${filter === value ? "active" : ""}" data-filter="${value}">${escapeHtml(t(language, label))}</button>`).join("");
    document.querySelector("#mode-filters").innerHTML = modeFilters.map(([value, label]) => `<button class="filter-button ${modeFilter === value ? "active" : ""}" data-mode-filter="${value}">${escapeHtml(t(language, label))}</button>`).join("");
    const visible = state.turns.filter(
      (turn) => (filter === "all" || turn.verdict === filter) && (modeFilter === "all" || turn.captureMode === modeFilter)
    );
    if (!visible.some((turn) => turn.captureId === selectedId)) selectedId = visible[0]?.captureId ?? null;
    const rows = document.querySelector("#rows");
    const empty = document.querySelector("#empty");
    if (rows) rows.innerHTML = visible.map((turn) => `<tr data-id="${escapeHtml(turn.captureId)}" class="${selectedId === turn.captureId ? "selected" : ""}"><td class="mono">${escapeHtml(formatTime(turn.observedAt, language))}</td><td><span class="tag ${turn.captureMode === "live" ? "signal" : "amber"}">${escapeHtml(captureModeLabel(turn.captureMode, language))}</span></td><td>${escapeHtml(requestedModelLabel(turn, language))}</td><td>${escapeHtml(recordedModelLabel(turn, language))}</td><td>${escapeHtml(turn.verdict === "conflict" ? t(language, "result.routeConflict") : turn.routeModel ? modelLabel(turn.routeModel, language) : t(language, "value.inconclusive"))}</td><td><span class="tag ${verdictTone(turn.verdict)}">${escapeHtml(turnResultLabel(turn, language))}</span></td><td class="mono muted">${escapeHtml(routeSourcesLabel(turn, language))}</td></tr>`).join("");
    if (empty) empty.style.display = visible.length ? "none" : "block";
    renderDetail(selectedTurn(visible), language);
    document.querySelector("#health").innerHTML = `<div class="timeline"><div class="timeline-item signal"><strong>${escapeHtml(t(language, "health.lastSuccess"))}</strong><p>${escapeHtml(formatTime(state.parserHealth.lastSuccessAt, language))}</p></div><div class="timeline-item ${state.parserHealth.consecutiveFailures ? "danger" : ""}"><strong>${escapeHtml(t(language, "health.lastFailure"))}</strong><p>${escapeHtml(formatTime(state.parserHealth.lastFailureAt, language))} \xB7 ${escapeHtml(t(language, "health.failures", { count: state.parserHealth.consecutiveFailures }))}</p></div><div class="timeline-item"><strong>${escapeHtml(t(language, "health.activeMode"))}</strong><p>${escapeHtml(captureModeLabel(state.settings.captureMode, language))}</p></div></div>`;
    document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
      filter = button.dataset.filter;
      render(state);
    }));
    document.querySelectorAll("[data-mode-filter]").forEach((button) => button.addEventListener("click", () => {
      modeFilter = button.dataset.modeFilter;
      render(state);
    }));
    document.querySelectorAll("[data-id]").forEach((row) => row.addEventListener("click", () => {
      selectedId = row.dataset.id ?? null;
      render(state);
    }));
  }
  bindLanguageSwitch(async (uiLanguage) => {
    if (state?.settings.uiLanguage === uiLanguage) return;
    const response = await send({ type: "route:update-settings", settings: { uiLanguage } });
    if (!response.ok) return;
    if (response.state) render(response.state);
  });
  document.querySelector("#export-json")?.addEventListener("click", () => download(`route-inspector-${Date.now()}.json`, JSON.stringify(sanitizedExport(state), null, 2), "application/json"));
  document.querySelector("#export-md")?.addEventListener("click", () => download(`route-inspector-${Date.now()}.md`, buildMarkdownReport(state, state.settings.uiLanguage), "text/markdown"));
  document.querySelector("#clear")?.addEventListener("click", async () => {
    if (!confirm(t(state.settings.uiLanguage, "confirm.clearAll"))) return;
    const response = await send({ type: "route:clear" });
    if (!response.ok) return;
    if (response.state) render(response.state);
    toast(t(state.settings.uiLanguage, "toast.cleared"));
  });
  subscribe(render);
  void getState().then(render);
})();
