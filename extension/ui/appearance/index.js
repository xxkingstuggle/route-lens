"use strict";
(() => {
  const DEFAULT_APPEARANCE = {
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
  const COPY = {
    zh: {
      "language.label": "切换语言",
      "appearance.title": "外观设置",
      "appearance.subtitle": "调整 ChatGPT 页面侧栏的显示方式",
      "appearance.layout": "侧栏尺寸与位置",
      "appearance.layoutHint": "调整后会立即应用并保存",
      "appearance.saved": "已保存",
      "appearance.saving": "正在保存",
      "appearance.width": "宽度",
      "appearance.widthHint": "64–112 px",
      "appearance.height": "高度",
      "appearance.heightHint": "占视口高度比例",
      "appearance.position": "垂直位置",
      "appearance.positionHint": "从顶部到安全区域底部",
      "appearance.fontSize": "字号",
      "appearance.fontHint": "侧栏文字大小",
      "appearance.opacity": "背景不透明度",
      "appearance.opacityHint": "数值越低越透明",
      "appearance.theme": "主题",
      "appearance.system": "跟随系统",
      "appearance.light": "浅色",
      "appearance.dark": "深色",
      "appearance.visibleItems": "侧栏内容",
      "appearance.routeStatus": "路由状态",
      "appearance.requestedModel": "请求模型",
      "appearance.actualModel": "\u670d\u52a1\u5668\u62a5\u544a\u6a21\u578b",
      "appearance.footer": "仅调整外观。记录、采集模式和隐私设置不会改变。",
      "appearance.reset": "恢复默认外观",
      "appearance.error": "保存失败，请重试"
    },
    en: {
      "language.label": "Language",
      "appearance.title": "Appearance",
      "appearance.subtitle": "Adjust the sidebar shown on ChatGPT pages",
      "appearance.layout": "Sidebar size and position",
      "appearance.layoutHint": "Changes apply and save immediately",
      "appearance.saved": "Saved",
      "appearance.saving": "Saving",
      "appearance.width": "Width",
      "appearance.widthHint": "64–112 px",
      "appearance.height": "Height",
      "appearance.heightHint": "Percent of the viewport height",
      "appearance.position": "Vertical position",
      "appearance.positionHint": "From the top to the safe lower edge",
      "appearance.fontSize": "Text size",
      "appearance.fontHint": "Sidebar text size",
      "appearance.opacity": "Background opacity",
      "appearance.opacityHint": "Lower values are more transparent",
      "appearance.theme": "Theme",
      "appearance.system": "Follow system",
      "appearance.light": "Light",
      "appearance.dark": "Dark",
      "appearance.visibleItems": "Sidebar content",
      "appearance.routeStatus": "Route status",
      "appearance.requestedModel": "Requested model",
      "appearance.actualModel": "Server-reported model",
      "appearance.footer": "Appearance only. Records, capture mode, and privacy settings stay unchanged.",
      "appearance.reset": "Restore default appearance",
      "appearance.error": "Save failed. Try again."
    }
  };
  let state = null;
  let saveTimer = null;
  let pendingPatch = {};
  let writeChain = Promise.resolve();
  let statusTimer = null;
  const saveStatus = document.querySelector("#save-status");

  function t(language, key) {
    return COPY[language]?.[key] ?? COPY.en[key] ?? key;
  }
  function applyTranslations(language) {
    const lang = language === "zh" ? "zh" : "en";
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = `${t(lang, "appearance.title")} · Route Lens`;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      element.textContent = t(lang, key);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(lang, element.dataset.i18nAriaLabel));
    });
    document.querySelectorAll("[data-language]").forEach((button) => {
      button.classList.toggle("active", button.dataset.language === lang);
      button.setAttribute("aria-pressed", String(button.dataset.language === lang));
    });
    if (saveStatus?.dataset.saving !== "true") saveStatus.textContent = t(lang, "appearance.saved");
  }
  function updateTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  function updateValue(setting, value) {
    const input = document.querySelector(`[data-setting="${setting}"]`);
    if (!input) return;
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
      return;
    }
    input.value = String(value);
    const output = document.querySelector(`output[for="${input.id}"]`);
    if (output) {
      const unit = setting === "railWidthPx" || setting === "railFontSizePx" ? "px" : "%";
      output.textContent = `${value} ${unit}`;
    }
  }
  function render(next) {
    if (!next?.settings || state && (next.revision ?? 0) < (state.revision ?? 0)) return;
    state = next;
    const language = state.settings.uiLanguage === "zh" ? "zh" : "en";
    applyTranslations(language);
    const appearance = { ...DEFAULT_APPEARANCE, ...state.settings };
    updateTheme(appearance.theme);
    for (const key of Object.keys(DEFAULT_APPEARANCE)) {
      if (key !== "theme") updateValue(key, appearance[key]);
    }
    document.querySelector("#theme").value = appearance.theme;
  }
  async function send(request) {
    try {
      return await chrome.runtime.sendMessage(request);
    } catch (error) {
      console.error("Route Lens appearance update failed.", error);
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
  function setSaveStatus(saving, failed = false) {
    if (!saveStatus || !state) return;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    saveStatus.dataset.saving = String(saving);
    saveStatus.textContent = failed ? t(state.settings.uiLanguage, "appearance.error") : t(state.settings.uiLanguage, saving ? "appearance.saving" : "appearance.saved");
    if (!saving && !failed) statusTimer = window.setTimeout(() => {
      if (saveStatus && state) saveStatus.textContent = t(state.settings.uiLanguage, "appearance.saved");
    }, 1600);
  }
  function queuePatch(patch) {
    pendingPatch = { ...pendingPatch, ...patch };
    setSaveStatus(true);
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushPatch, 90);
  }
  function flushPatch() {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    const patch = pendingPatch;
    pendingPatch = {};
    if (!Object.keys(patch).length) return;
    writeChain = writeChain.then(async () => {
      const response = await send({ type: "route:update-settings", settings: patch });
      if (!response?.ok) {
        setSaveStatus(false, true);
        return;
      }
      if (response.state) render(response.state);
      if (!Object.keys(pendingPatch).length) setSaveStatus(false);
    }).catch((error) => {
      console.error("Route Lens appearance save failed.", error);
      setSaveStatus(false, true);
    });
  }
  function setAppearanceValue(key, value) {
    updateValue(key, value);
    if (key === "theme") updateTheme(value);
    queuePatch({ [key]: value });
  }
  document.querySelectorAll("[data-setting]").forEach((input) => {
    const update = () => {
      const value = input.type === "checkbox" ? input.checked : Number(input.value);
      setAppearanceValue(input.dataset.setting, value);
    };
    input.addEventListener(input.type === "range" ? "input" : "change", update);
    if (input.type === "range") input.addEventListener("change", flushPatch);
  });
  document.querySelector("#theme").addEventListener("change", (event) => setAppearanceValue("theme", event.target.value));
  document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => {
    if (!state || !["zh", "en"].includes(button.dataset.language) || state.settings.uiLanguage === button.dataset.language) return;
    const uiLanguage = button.dataset.language;
    render({ ...state, settings: { ...state.settings, uiLanguage } });
    queuePatch({ uiLanguage });
  }));
  document.querySelector("#reset").addEventListener("click", () => {
    pendingPatch = { ...pendingPatch, ...DEFAULT_APPEARANCE };
    for (const [key, value] of Object.entries(DEFAULT_APPEARANCE)) {
      if (key === "theme") {
        document.querySelector("#theme").value = value;
        updateTheme(value);
      } else updateValue(key, value);
    }
    setSaveStatus(true);
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    flushPatch();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "route:state-changed" && message.state) render(message.state);
  });
  void (async () => {
    const response = await send({ type: "route:get-state" });
    if (!response?.ok || !response.state) {
      console.error("Unable to load Route Lens appearance settings.", response?.error);
      return;
    }
    render(response.state);
  })();
})();
