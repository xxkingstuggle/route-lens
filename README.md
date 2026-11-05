# Route Lens

Chrome 扩展，当前版本为 **1.3.1**。它对照页面请求模型与服务器报告的响应模型字段；字段一致或不一致不代表已证明底层执行模型、回答质量或“降智”。证据不足时显示无法确认。PoW 只作为原始技术数据保留。

工具栏 Popup 包含状态页与外观页。外观项可即时调整右侧窄栏的尺寸、位置、字号、透明度、主题和显示内容。恢复默认只重置这些外观项。

## 本地检查

```sh
npm test
npm run check
node scripts/ui-preview.mjs
npm run package
node scripts/export-candidate.mjs
```

`ui-preview` 会在本地合成页面中运行真实 Popup 和 `content/bridge.js`，输出位置默认为 `outputs/route-lens-1.3.1/previews/`。这不是 ChatGPT 页面实测；详细范围见 [前端说明](docs/frontend.md)。`CHROME_PATH` 可指定 Chrome/Chromium，或通过 `--out-dir` / `ROUTE_LENS_PREVIEW_DIR` 改变截图目录。`npm run package` 将扩展文件（manifest 位于归档根目录）打包到 `dist/`；解压后可使用“加载已解压的扩展程序”。

本地持久目录可用 `~/Library/Application Support/Google/Chrome/Local Extensions/Route Lens`。将 `extension/` 复制到此处后，在 Chrome 扩展管理页开启开发者模式并选择“加载已解压的扩展程序”，指向该目录；复制本身不会自动启用扩展。

`node scripts/export-candidate.mjs` 将可加载扩展目录、扩展 ZIP、完整源码和源码 ZIP 写入 `outputs/route-lens-1.3.1/`，保留同目录的预览截图。重复导出前先检查目标目录；只有明确要替换已生成的候选文件时才传 `--replace`。

## 维护者

`xxkingstuggle`
