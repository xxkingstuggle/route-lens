# 维护入口

## 当前状态

- 当前代码版本：`1.3.1`。
- 维护时先检查 `git status`，保留共享工作区中未提交的修改；不要用其他副本覆盖本地前端和修复。
- 品牌图：`assets/icon-master.png`；manifest 图标导出位于 `extension/icons/`。

## 检查与打包

```sh
npm test
npm run check
node scripts/ui-preview.mjs
npm run package
node scripts/export-candidate.mjs
unzip -t dist/route-lens-*.zip
```

`check` 会解析扩展 JSON、检查所有 JavaScript 语法、核对图标路径，并限制扩展权限和站点匹配范围为当前 ChatGPT 域名。`test` 用合成数据回归路由评估边界。`package` 只打包 `extension/`。

`ui-preview` 在临时无头 Chrome/Chromium 中加载实际 Popup 与 `content/bridge.js`，通过本地合成运行时和聊天页布局验证消息传递、侧栏样式同步和输入框几何关系。合成页面不是 ChatGPT；测试不加载 `page-hook.js` 或扩展 service worker，也不验证真实站点兼容性。截图默认写入 `outputs/route-lens-1.3.1/previews/`，可用 `--out-dir` 或 `ROUTE_LENS_PREVIEW_DIR` 指定。浏览器自动探测，也可设置 `CHROME_PATH`。

`export-candidate` 将可加载扩展目录、扩展 ZIP、源码快照和源码 ZIP 写入 `outputs/route-lens-<version>/`。它保留已有 `previews/`，若候选源码或归档已存在会先停止；检查确认后可用 `--replace` 替换这些特定生成项。

Chrome 本地持久副本可放在 `~/Library/Application Support/Google/Chrome/Local Extensions/Route Lens`。复制扩展文件后仍需在 Chrome 扩展管理页手动加载已解压目录。

## 代码审计要点

- `manifest.json` 只申请 `storage`，仅在 `chatgpt.com` 与 `chat.openai.com` 注入内容脚本；没有 `webRequest`、调试器或后台网络权限。
- `content/page-hook.js` 在页面主世界包装 `fetch` 与 WebSocket，只对允许的 ChatGPT/OpenAI 来源解析路由、任务和额度字段。`content/bridge.js` 与后台通过消息传递规范化后的白名单字段；页面正文、提示词、附件、Cookie、Authorization、JWT、PoW seed/proof 不进入持久记录。此结论来自当前代码静态审阅，不代表对未来站点变化的保证。
- `background/service-worker.js` 将有限数量的观测和设置写入 `chrome.storage.local`。当前记录上限默认 100；清空记录保留设置并清除当前会话上下文，打开页面之后发布新的合法上下文时可重新登记路径。请求/会话标识可能出现在本地记录或用户主动导出中，导出默认脱敏。
- 请求与响应关联依赖页面捕获的请求 ID、会话/消息标识、活动上下文和有限期缓存。异步并发、站点接口变化会造成遗漏或误配；同源页面脚本也能伪造桥接消息，因此结果是尽力采集的页面字段，不是经过认证的服务端证明。不能确认时应报告未知。
- `resolved_model_slug`、`server_ste_metadata.model_slug` 是服务器响应报告字段；助手元数据和 DOM 值是标签。前两者一致只能说明字段一致，不能证明底层权重或生成质量。不要将速度、长度、错误、PoW 难度或字段缺失作为降级证据。
- 未在真实 ChatGPT 会话中验证此基线；以合成数据测试和静态检查为准。公开发布前仍需完成 ChatGPT 页面兼容验收、公开内容与提交历史审查。

## 维护者

`xxkingstuggle`

本机后续更新时，将新的 `extension/` 内容覆盖至 `~/Library/Application Support/Google/Chrome/Local Extensions/Route Lens/`，然后由使用者在 Chrome 中重新加载扩展。
