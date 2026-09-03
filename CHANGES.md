# dsh-mobile-apk 变更记录

## v0.13.5 — 2026-09-04

### 性能：PPT 逐页 SVG 生成改为「父代理编排 + 子代理并行」fan-out（v0.13.4 分析 → 方案 → 落地）

**背景（session 6e0c5f77 实测）**：7 页 PPT 主流程 19.6 分钟中，SVG 实现阶段 317s 的构成——写 7 页 SVG 143s（heredoc exec 仅 0.05–0.1s/页，几乎全为模型逐 token 生成时间）+ 质检修正 ~174s（模型反复 checker/grep/sed/补 spec_lock）。页面之间零数据依赖（只共享只读 spec_lock），是天然并行点；单页成本 = 模型纯生成 ~17–25s，20 页串行将达 400–500s。

**改动（仅 assets/ppt_master.zip + .sha256，引擎零改动）**：
1. `SKILL.md` — 铁律 6 由「逐页顺序生成/禁止批处理」改为「页面并行 fan-out」：并发上限 **5 子代理**，页数 ≤5 每代理 1 页、>5 每代理连续 ceil(N/5) 页；Step 5 重写为 T0（派发前准备：逐页 page brief + spec_lock 终态校验 + 分组）/ T1（同一回合后台 spawn，发完即放手等 notice）/ T2（通知驱动逐份预验收 + 仅 fail 页修复）；铁律 7 相应改「spec_lock 唯一取值源」。
2. `references/page-brief-template.md`（新增）— 并行纪律 + 每页 brief 文件结构 + **子代理自足 prompt 模板**（子代理看不到父会话，prompt 必须携带项目路径/页号/brief 路径/硬性规范/自查清单）。
3. `references/executor-base.md` — 新增 §0 并行模式说明（规范由各子代理执行；batch-read 语境差异；spec_lock 每代理 T0 读一次摊多页；自查归子代理、全量质检归父代理）。

**部署机制**：EngineManager.deployBundledPptSkill 按 `ppt_master.sha256` 指纹幂等部署，marker 比对变化即原子重解压（含 ${DATA_DIR} 占位替换）。本次 zip 重打包后 hash 更新为 `b25882e8…`，真机已确认部署（marker/新文件/SKILL 均落盘）。

**待用户实测**：并行 fan-out 实际收益、手机端 notice 唤醒、5×4 分组质量一致性。

## v0.13.4 — 2026-09-03

### 修复：pkg 安装覆盖引擎 mmap 共享库导致引擎 SIGBUS 崩溃（§3.10 根因落定）

根因（logcat + 会话日志 + 源码三方实证）：TermuxPackageManager.extractTar 解压 deb 时用 target.outputStream 直接 truncate 覆盖写 PREFIX 下目标文件。引擎 node 运行时正 mmap 着 usr/lib 下的共享库（python 依赖链重装 libicu，覆盖 libicudata.so.78.3 / libicui18n.so.78.3），运行中引擎 SIGBUS(BUS_ADRERR) 崩溃（libc Fatal signal 7，栈在 libicui18n）；写入中断还留下半写坏 so（linker CANNOT LINK: invalid shdr offset/size）。bash 子进程脱离引擎继续装完，现象即「工具被 interrupted（实为崩溃后 repair.js 合成 interrupted-tool-result 闭合日志），但包已装好」。

修复：extractTar 文件写入改为原子替换——写同目录临时文件后 Files.move(ATOMIC_MOVE, REPLACE_EXISTING)（不支持原子移动则回退普通 move）。旧 inode 不被改动：运行中进程继续用完整旧映射不崩溃；新进程加载完整新文件；中断只留 tmp（finally 清理）。改动：app/src/main/java/com/dshmobile/shell/TermuxPackageManager.kt。

**验证（2026-09-03 真机实测通过）**：全新安装后首次 pkg install python-lxml python-pillow，依赖树再次真实重装 libicu（原崩溃路径）——全程无中断、引擎存活、29 秒完成；python-lxml 6.1.3 / python-pillow 12.3.0；logcat 零崩溃标记。

相关改进建议（未实施）：readBaseInstalled 未把快照预装的引擎核心库（libicu 等）视为已安装，依赖解析会重复下载重装引擎同路径库；可将快照自带 dpkg 基线纳入 installed 判定，避免无谓覆盖（原子替换后仅剩版本翻新语义，已不致命）。

## v0.13.3 — 2026-09-03

### 新增功能

#### 1. 移动端系统提示词完整重写（dsh-mobile-persona）

针对手机环境定制 agent 的系统提示词（`systemPrompt.section` 注入，order -1000）：

| 段落 | 内容 |
|---|---|
| 身份使命 | DeepCode · Android/Termux 运行时 · 全栈助手 |
| (一) 运行环境 | Android/Termux、PREFIX/DSH_HOME 等变量、WebView zoom=3、SAF、冷启动时长 |
| (二) 包管理 | 只用 `pkg`（update/install/show/list-installed/remove）；**严禁** apt/dpkg/pip；装原生 Python 库用 `pkg install python-<名>`；只装 aarch64；不确定包名先 `pkg show` 验证 |
| (三) 图片/视频生成 | generate_image / generate_video（text/keyframe/reference 模式选法） |
| (四) 工作方式 | 先读后改、查退出码、后台长任务、危险操作先问、同一步只发一个 bash |
| (五) 语言 | 全程简体中文（回复与思考），代码/命令保留原文 |

插件文件：`app/src/main/assets/dsh-mobile-persona/`（host 段 `lib/index.js` + 设置页 `lib/client.js`），随 `deployAgPlugins()` 部署挂载。

#### 2. agent-loop 工具并行度降为 1（防同一步多 bash 中断）

`app/src/main/assets/patched/agent-loop-index.js` 把引擎 `dsh-agent-loop` 的
`maxParallelToolCalls` 默认 10 → 1（`applyRuntimePatches` 覆盖引擎文件）：同一步发出多个
bash 时改为**串行排队执行**（前一个完成再启动下一个），不再并行抢占。

### 已知问题（待修复）

**新会话首回合（seed turn 1）的 bash 长命令会被 interrupted**：新开会话的第一条消息若让
agent 执行安装类 bash 长命令（如 `pkg install`），回合在命令发出后立即被引擎取消
（`turn/end reason: interrupted`），但 bash 子进程仍会继续跑完（换会话可查「已安装」）。
同会话的后续回合（turn 2+）完全正常。与 mobile-persona 无关（移除后复现），与 agent-loop
并行度 patch 无关（回退后复现）；疑似 dsh 引擎 seed 首回合与 bash 工具 dispatch 的交互
问题。已试方向：complete:true 移除、agent-loop 并行度回退、提示词防并行——均未根治。

## v0.13.2 — 2026-08-31

### 新增功能

#### 1. 消息区域长按手势优化

**问题**：WebView 默认长按任何区域都会弹出系统文字选择器，与原生 App 体验不一致。标题栏、侧栏、按钮等非消息区域长按也会误触发文字高亮。

**方案**：三层防御，消息区保留原生体验，其余区域完全静默。

| 层 | 手段 | 作用 |
|---|---|---|
| CSS 全局 | `* { -webkit-touch-callout: none; user-select: none }` | 消灭所有区域的默认长按选择 |
| CSS 例外 | `.wSkVaW_viewArea *, input, textarea { user-select: text; touch-callout: default }` | 恢复消息区和输入框的原生长按 |
| JS 兜底 | `touchstart/touchmove/touchend` 非 passive 监听，≥400ms 长按非消息区域时 `preventDefault()` | 阻止偶发的系统 contextmenu |

**DOM 结构发现**（通过 CDP 验证）：
- 消息容器：`.wSkVaW_root` → `.wSkVaW_scrollBody` → `.wSkVaW_viewArea`
- 用户输入：`.wSkVaW_composerSeat`（在 viewArea 之外）
- 顶部栏：`.mp-hd-title` / `.mp-hd-mode` 挂在 `_3HOSdG_mobileTopBar` 下，是 body 的直接子元素，不在 viewArea 内

**注意**：`user-select: none` 必须同时设置 `-webkit-user-select: none` 才在华为 WebView 114 生效；CSS 规则必须在 `<style>` 标签内以 `!important` 声明，否则会被 dsh 前端 bundle 的内联样式覆盖。

### 改动文件

- `app/src/main/assets/mobile-polish/lib/client.js` — CSS 规则 + JS 长按拦截

---

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
