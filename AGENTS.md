# AGENTS.md — dsh-mobile-apk 工作交接

## 1. 快速编译 + 安装

```powershell
pushd C:\Users\XIAOPAN\Desktop\安卓开发\dsh-mobile-apk

// 构建 debug APK（耗时 ~5-10s 增量）
.\gradlew.bat assembleDebug

// 安装到手机（覆盖装，保留用户数据）
adb install -r app\build\outputs\apk\debug\app-debug.apk

// 重启 app（引擎启动需要 60-90s）
adb shell am force-stop com.dsharnessmobile.shell
Start-Sleep -Seconds 2
adb shell monkey -p com.dsharnessmobile.shell -c android.intent.category.LAUNCHER 1

// 等引擎起来后再连 CDP 验证
// adb shell pidof com.dsharnessmobile.shell 查 pid
// adb forward --remove-all; adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

**注意**：调试包默认带 **x86_64 快照**。装到 arm64 真机会引擎崩溃（ELF 不匹配）。当前真机是 arm64（`V4DUT20428003391`），已同步替换 `assets/snapshot.tar.xz` + `snapshot.sha256` 为 arm64 版，无需再处理。

---

## 2. 当前任务进度（2026-08-31 刷新）

> §2 依 git 与真机实测更新。早期 UI 适配（审批卡片上浮、设置页改造、状态栏/edge-to-edge、头部重构等）早已在 git `081c42d`/`3fa7e6f`/`990227d` 等提交封版，真机验收通过，不再赘述。项目重心在 **Agnes AI 多模态插件生态 + LLM 自动注册**。

### 2.1 ✅ 已完成：多模态配置 → LLM 自动注册

目标链路全部打通，真机实测验证通过。用户用新安装的空数据版本测试，发起"生成一张照片"请求，引擎正常启动、端口 3080 LISTENING、CDP 可连接、模型选择器显示 `agnes-2.5...`、对话正常进行（Deep diving...）。

**发现的两个 bug 及修复**：

| Bug | 现象 | 修复 |
|---|---|---|
| `dsh-agconfig/lib/index.js` 第175行多余 `}` | cordis 插件加载 SyntaxError，引擎启动后立即崩溃，port 3080 不监听 | 删除第175行多余的 `}`，本地源码已修正 |
| `.credentials.yaml` 权限 666 | credentials-local 插件拒绝加载（要求 owner-only 600），引擎启动失败 | `chmod 600 files/home/.dsh/.credentials.yaml`，已加入 deployAgPlugins() 部署逻辑 |

### 2.2 已落地（未提交）

- ✅ **`deployAgPlugins()`**（`EngineManager.kt`）：启动时把 4 个 Agnes 插件部署到 `$HOME/.dsh/profiles/web/node_modules/` 并在 `cordis.patch.yml` 追加挂载（幂等：content-fingerprint + marker），插件：
  - `dsh-agconfig` — 多模态配置（账号池）→ 持久化 `ag-multimodal.json` + 自动写 credentials + settings.yaml
  - `dsh-agimage` — 常驻 `generate_image` 模型工具（读 `ag-multimodal.json` 账号，未配回退默认号）
  - `dsh-agvideo` — 常驻 `generate_video` 模型工具（text/keyframe/reference 三模式）
  - `dsh-zh-mode` — 中文模式开关（systemPrompt.section order -50 注入中文 persona）
- ✅ 真机实测：引擎启动正常，端口 3080 监听，CDP 可连接，Agnes 出现在模型选择器，对话功能正常

---

## 3. 关键注意事项（必读，踩坑即停）

### 3.1 WebView + zoom 陷阱（最危险）
- ui-responsive 插件在 html 上设 `zoom:3`（dpr=3，布局视口 360px）。
- 设置 dialog 曾因改 DOM 时机/父级抽屉位移卡在屏幕外（x=-301）。
- **当前方案**：`dialog` 直接 `position:fixed; top:0; left:0; width:100vw; height:100vh`，父 `.VOzbGW_overlay` 同步 `left:0; width:100vw; height:100vh`；全屏样式立即应用，不等动画。
- 二级页标题必须取**点击按钮文本**，不能只依赖 `.zGbnIq_title`（仅「模型」页存在该 class）。
- 验证方法：打开设置 dialog 后查 `[role=dialog][aria-modal=true]` 的 `getBoundingClientRect().x`，负值 = bug 复现。

### 3.2 Chromium 114 的 :has() 选择器
- 浏览器版本：华为 WebView 114.0.5.302，支持 `:has()` 语法但不稳定，在重 DOM 场景会触发 renderer OOM 崩溃。
- **禁止在 client.js 中使用 `:has()` 选择器**。改用 `Array.from(el.children).find(c => c.tagName === "NAV")` 等同步遍历。
- 崩溃现场特征：logcat 里 `mmap failed: Out of memory`（renderer 进程）→ `Renderer process crash detected` → 主进程 SIGTRAP。crashpad 自己也会崩（open file error），无法收集 dump。

### 3.3 cordis.patch.yml 幂等陷阱
- 部署函数用 `patch.readText().contains(marker)` 判断是否追加，marker 是包名（如 `@dsh-mobile/mobile-polish`、`dsh-agconfig`）。
- **不要在注释里写 marker 字符串**——那会导致 append 静默跳过，插件条目不会挂载。之前 A/B 测试踩过：patch 注释含 marker → 重启后插件未加载。

### 3.4 Agnes 插件部署 / DSH_HOME 位置
- 插件统一部署到 `$HOME/.dsh/profiles/web/node_modules/`，`cordis.patch.yml` 也在 `$HOME/.dsh/profiles/web/` 下。
- dsh 数据根：`files/home/.dsh/`（含 `settings.yaml`、`.credentials.yaml`、`ag-multimodal.json` 应在此处，若缺失按 §2.1 排查）。
- host 侧用 Node 全局 `fetch`（Android 无 PowerShell/子进程），探针用 `fetch(endpoint + "/models")` 做 key 校验。
- **重要**：`.credentials.yaml` 权限必须为 600（owner-only），否则 `dsh-credentials-local` 插件拒绝加载导致引擎启动失败。

### 3.5 引擎启动失败排查
- 若 port 3080 不监听 + 页面显示"网页无法打开"，先看 `files/engine.log`：
  - `Unexpected token \"}\"` → 插件 JS 语法错误（参考 §2.1 已修复的 bug）
  - `credentials.yaml is readable beyond its owner (mode 666)` → 权限问题，执行 `chmod 600`
  - `Cannot find module \"@napi-rs/canvas\"` → 警告，不影响核心功能（pdfjs 渲染可能异常）

### 3.6 验证对话常用 CDP 命令
```powershell
$pid = adb shell pidof com.dsharnessmobile.shell
adb forward --remove-all; adb forward tcp:9222 localabstract:webview_devtools_remote_$pid
$target = (Invoke-RestMethod http://127.0.0.1:9222/json | Select-Object -First 1).webSocketDebuggerUrl

// 探针：检查页面标题和 URL
node -e "const ws=new (require('ws'))('$target'); ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.title+'|'+location.href'}}));});ws.on('message',d=>{console.log(JSON.parse(d).result?.result?.value);ws.close();});"
```

### 3.7 状态栏 / Edge-to-edge 陷阱
- `SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN` 会覆盖 `systemUiVisibility` 全量 mask，**必须同时加上 `SYSTEM_UI_FLAG_LIGHT_STATUS_BAR`**（浅色主题时），否则状态栏图标变成白色不可见。`isLightStatusBar()` 根据 `uiMode` 判断。
- `window.statusBarColor = Color.TRANSPARENT` 在 API 29 上让内容透出；API 30+ 由 `setDecorFitsSystemWindows(false)` 自动处理。
- WebView 的 `env(safe-area-inset-top)` 在部分 WebView 上返回 0；改用 `var(--dsh-android-system-top, 0px)`（由 native `pushWebInsets()` 注入）。
- 切换深/浅色模式时 `onConfigurationChanged` 会重推 `applyImmersive()`，确保图标色更新。

---

## 4. 文件落点

| 文件 | 作用 |
|---|---|
| `app/src/main/assets/dsh-agconfig/{lib/index.js,lib/client.js,package.json,cordis.append.yml}` | **多模态配置 + LLM 自动注册插件**（已修复第175行语法错误） |
| `app/src/main/assets/dsh-agimage/*` | 常驻图片生成工具（`generate_image`，读 ag-multimodal.json） |
| `app/src/main/assets/dsh-agvideo/*` | 常驻视频生成工具（`generate_video`，text/keyframe/reference） |
| `app/src/main/assets/dsh-zh-mode/*` | 中文模式开关（systemPrompt 段注入） |
| `app/src/main/java/com/dshmobile/shell/EngineManager.kt` | `deployAgPlugins()`（L547-580）+ `deployMobilePolish()` + `fixDshBin()` |
| `app/src/main/assets/mobile-polish/lib/client.js` | 手机端 UI 深度适配（早期已封版） |
| `app/src/main/assets/patched/web-frontend-index.html` | `data-dsh-immersive` 默认关闭（`=== "1"`） |
| `app/src/main/assets/snapshot.tar.xz` / `.sha256` | arm64 运行时快照 + 指纹（必须成对） |
| `CHANGES.md` / `TEST_REPORT.md` | 变更记录 / 测试报告 |
| `C:\Users\XIAOPAN\Desktop\dsh\cdp-probe.js` | 桌面端 CDP 探针脚本 |

---

## 5. VCP HTML 输出规则备忘

> 每次输出视觉卡（HTML 卡片）时，必须遵守以下规则。详见 `~/.dsh/user-rules/vcp-html-rules.md`。

### 核心铁律
1. **单卡片** — 一次只有一个 `<div id="vcp-root">`，不能有两个根容器
2. **闭合检查** — 输出前数 `</div>` 与 `<div>` 配对
3. **无空行** — `#vcp-root` 内禁止 `\n\n`（双换行），只允许单换行
4. **开标签短小** — 开标签长度控制在 150 字符内，background 等长样式放 `<style>`
5. **选择器前缀** — 所有 CSS 用 `#vcp-root` 开头（如 `#vcp-root .section`）

### 常见错误
| 错误 | 修复 |
|------|------|
| 输出两个 `<div id="vcp-root">` | 合并为一个 |
| `</div>` 数量不对 | 每开一标签必闭合 |
| style 压成超长单行 | 每条规则独立一行 |

*上次更新时间：2026-08-31，AI 开发助手*