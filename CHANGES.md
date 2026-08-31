# dsh-mobile-apk 变更记录

## v0.13.1 — 2026-08-31

### 新增功能

#### 1. Agnes AI 多模态插件生态

集成 4 个插件，实现多模态配置 → LLM 自动注册链路：

| 插件 | 功能 |
|------|------|
| `dsh-agconfig` | 多模态配置管理：持久化 `ag-multimodal.json`，保存时自动同步 credentials + settings.yaml |
| `dsh-agimage` | 常驻 `generate_image` 模型工具，读账号池，未配置回退默认号 |
| `dsh-agvideo` | 常驻 `generate_video` 模型工具，支持 text/keyframe/reference 三模式 |
| `dsh-zh-mode` | 中文模式开关，注入中文 persona |

**工作流程**：
```
用户填写多模态配置 → 点击保存
        ↓
dsh-agconfig host 端接收请求
        ↓
写入 ag-multimodal.json
        ↓
写入 credentials store (AGNES_API_KEY)
        ↓
写入 settings.yaml (llm-pi-ai + agent-default-model)
        ↓
返回 { ok: true, credentialsSynced: true }
        ↓
前端显示 "LLM 配置已自动同步" 提示
```

**核心逻辑** (`dsh-agconfig/lib/index.js`)：
- 添加 `credentials` 到 `inject` 数组
- 保存 accounts 时，将第一个 account 的 key 写入 credentials store
- 当所有 account 清空时，自动删除 credentials
- 生成 settings.yaml，注册 `llm-pi-ai` 的 `agnes` 提供者

#### 2. WebView Canvas/DOM API Polyfill

**问题**：Chromium 114 WebView 缺少 `DOMMatrix` / `ImageData` / `Path2D` / `OffscreenCanvas`，导致 `pdfjs-dist` 加载 `@napi-rs/canvas` 失败并抛 warn。

**修复**：在 `web-frontend-index.html` 注入极简 polyfill：
- `DOMMatrix`：仅支持 2D 变换（pdfjs 主要用这个）
- `ImageData`：最小实现（pdfjs 需要 putImageData）
- `Path2D`：空实现（pdfjs 用 path 做 clip，忽略实际绘制）
- `OffscreenCanvas`：暴露 context 给 pdfjs

### 依赖变更

- `dsh-agconfig/package.json`：添加 `@deepseek-ai/dsh-credentials` peerDependency

---

## v0.13.0-preview — 2026-08-30

### 初始版本

- 嵌入式 Termux 运行时快照（arm64）
- dsh 二进制包装器修复（Android 无 /usr/bin/env）
- OpenSSL/CA 证书路径注入
- termux-exec LD_PRELOAD
- WebView Polyfill（ES2022 API、剪贴板回退、沉浸模式反射）
- 手机端 UI 深度适配（mobile-polish）
- 私有数据存储 + 快照指纹验证
- 更新回滚机制

---

## 文件落点

| 文件 | 作用 |
|------|------|
| `app/src/main/assets/dsh-agconfig/{lib/index.js,lib/client.js,package.json,cordis.append.yml}` | 多模态配置 + LLM 自动注册插件 |
| `app/src/main/assets/dsh-agimage/*` | 常驻图片生成工具 |
| `app/src/main/assets/dsh-agvideo/*` | 常驻视频生成工具 |
| `app/src/main/assets/dsh-zh-mode/*` | 中文模式开关 |
| `app/src/main/java/com/dshmobile/shell/EngineManager.kt` | `deployAgPlugins()`（L547-580）+ `deployMobilePolish()` + `fixDshBin()` |
| `app/src/main/assets/mobile-polish/lib/client.js` | 手机端 UI 深度适配 |
| `app/src/main/assets/patched/web-frontend-index.html` | WebView Polyfill（ES2022 + Canvas） |
| `app/src/main/assets/snapshot.tar.xz` / `.sha256` | arm64 运行时快照 + 指纹 |
| `CHANGES.md` / `TEST_REPORT.md` | 变更记录 / 测试报告 |
| `AGENTS.md` | 工作交接文档 |

---

*最后更新：2026-08-31，AI 开发助手*
