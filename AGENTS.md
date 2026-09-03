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

## 2. 当前任务进度（2026-09-04 刷新）

> §2 依 git 与真机实测更新。早期 UI 适配（审批卡片上浮、设置页改造、状态栏/edge-to-edge、头部重构等）早已在 git `081c42d`/`3fa7e6f`/`990227d` 等提交封版，真机验收通过，不再赘述。项目重心在 **Agnes AI 多模态插件生态 + LLM 自动注册**。

### 2.1 ✅ 已完成：多模态配置 → LLM 自动注册

目标链路全部打通，真机实测验证通过。用户用新安装的空数据版本测试，发起"生成一张照片"请求，引擎正常启动、端口 3080 LISTENING、CDP 可连接、模型选择器显示 `agnes-2.5...`、对话正常进行（Deep diving...）。

**发现的两个 bug 及修复**：

| Bug | 现象 | 修复 |
|---|---|---|
| `dsh-agconfig/lib/index.js` 第175行多余 `}` | cordis 插件加载 SyntaxError，引擎启动后立即崩溃，port 3080 不监听 | 删除第175行多余的 `}`，本地源码已修正 |
| `.credentials.yaml` 权限 666 | credentials-local 插件拒绝加载（要求 owner-only 600），引擎启动失败 | `chmod 600 files/home/.dsh/.credentials.yaml`，已加入 deployAgPlugins() 部署逻辑 |

### 2.2 已落地（未提交）

- ✅ **`deployAgPlugins()`**（`EngineManager.kt`）：启动时把 5 个插件部署到 `$HOME/.dsh/profiles/web/node_modules/` 并在 `cordis.patch.yml` 追加挂载（幂等：content-fingerprint + marker），插件：
  - `dsh-agconfig` — 多模态配置（账号池）→ 持久化 `ag-multimodal.json` + 自动写 credentials + settings.yaml
  - `dsh-agimage` — 常驻 `generate_image` 模型工具（读 `ag-multimodal.json` 账号，未配回退默认号）
  - `dsh-agvideo` — 常驻 `generate_video` 模型工具（text/keyframe/reference 三模式）
  - `dsh-zh-mode` — 中文模式开关（systemPrompt.section order -50 注入中文 persona）
  - `dsh-mobile-persona` — 移动端系统提示词完整重写（systemPrompt.section order -1000，见 §2.3）
- ✅ 真机实测：引擎启动正常，端口 3080 监听，CDP 可连接，Agnes 出现在模型选择器，对话功能正常

### 2.3 ✅ 已落地（2026-09-03 提交）：移动端 persona + agent-loop 串行 patch

- ✅ **`dsh-mobile-persona` 系统提示词完整重写**（`app/src/main/assets/dsh-mobile-persona/`）：注入 order -1000 的完整中文 persona（身份 DeepCode / Android 环境 / 包管理守则 / 图视频生成 / 工作方式 / 中文语言），agent 据此自动用 `pkg` 装包、不用 apt/pip、pkg show 验证包名、中文思考。
- ✅ **agent-loop 并行度 patch**（`app/src/main/assets/patched/agent-loop-index.js`）：`maxParallelToolCalls` 默认 10→1，同一步多个 bash 改串行排队执行（`applyRuntimePatches` 覆盖引擎文件 `dsh-agent-loop/lib/index.js`）。
- ✅ **已修复（v0.13.4）：「新会话首回合 pkg 安装被 interrupted」根因定位为 pkg 解压覆盖引擎 mmap 共享库导致引擎 SIGBUS 崩溃**——extractTar 改原子替换写入后真机复测通过（同依赖树重装 libicu 不再崩溃），详见 §3.10。

### 2.4 ✅ 已落地（2026-09-04）：PPT SVG 生成改并行 fan-out（v0.13.5，仅改 skill 打包物）

- ✅ **逐页 SVG 生成并行化**（app/src/main/assets/ppt_master.zip，引擎零改动）：SKILL.md 铁律6 由「逐页顺序生成/禁止批处理」改为**并行 fan-out**——并发上限 5 子代理，页数 ≤5 每代理 1 页、>5 每代理连续 ceil(N/5) 页；Step 5 重写为 T0（派发前：逐页 page brief + spec_lock 终态校验）/ T1（同一回合后台 spawn 后放手等 notice）/ T2（通知驱动逐份预验收 + 仅 fail 页修复）。新增 references/page-brief-template.md（brief 结构 + 子代理自足 prompt 模板）；executor-base.md 增 §0 并行模式说明。
- ✅ **动机（session 6e0c5f77 实测）**：7 页 PPT 中写 7 页 SVG 143s（heredoc exec 仅 0.05–0.1s/页，几乎全是模型逐 token 生成），20 页串行将达 400–500s；页面间零数据依赖（只共享只读 spec_lock）→ 天然并行。部署机制：zip 重打包 + sha256 更新 → EngineManager.deployBundledPptSkill 启动时 marker 比对自动重部署（真机已确认落盘，zip sha256 b25882e8）。
- ⏳ **待用户实测**：并行收益、手机端 subagent notice 唤醒、5×4 分组一致性（详见 CHANGES v0.13.5）。

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

### 3.8 消息区长按手势控制（v0.13.2）
- **策略**：CSS 全局禁用 + JS 非 passive 监听兜底。
  - `* { -webkit-touch-callout: none; user-select: none }` → 消灭全局默认行为
  - `.wSkVaW_viewArea *` 和 `input/textarea` 恢复 `user-select: text; touch-callout: default`
  - JS `touchend` 中 ≥ 400ms 且移动 < 12px 时，若元素不在 `.wSkVaW_viewArea` 内则 `preventDefault()`
- **DOM 结构**：消息区是 `.wSkVaW_root > .wSkVaW_scrollBody > .wSkVaW_viewArea`；顶部栏 `.mp-hd-title` 是 body 直接子元素，**不在 viewArea 内**，所以 CSS 例外不会误覆盖顶部栏。
- **避坑**：`user-select: none` 必须加 `-webkit-user-select: none` 才能在华为 WebView 114 生效；所有例外规则必须带 `!important`。
- **禁止**：不要给 touch 事件加 `{ passive: true }`——非 passive 才能调用 `preventDefault()` 拦截长按。

### 3.9 pwsh 工具调用参数纪律（严防参数缺失）
- **核心要求**：调用 `pwsh` 工具时，**必须同时提供 `command` 和 `description` 两个必填参数**，且两个字段均不能为空。
- **严禁**：只传 `description`（如仅写 `"Check git status..."`）而遗漏 `command` 字段，否则会直接触发 JSON Schema 校验失败（`Error: invalid arguments: missing required property "command"`）。
- **执行原则**：先确定待执行的具体 PowerShell 命令字符串写入 `command`，再补充简短描述写入 `description`。

### 3.10 【已定位根因并修复 2026-09-03】pkg 安装覆盖引擎 mmap 共享库 -> 引擎 SIGBUS 崩溃
- **真实根因（logcat + 会话日志 + 源码实证）**：旧「被 interrupted」是表象——TermuxPackageManager.extractTar() 解压 .deb 时用 target.outputStream() **直接 truncate 覆盖写** $PREFIX 下文件。引擎 node 运行时就 mmap 着 usr/lib 下的共享库；python 依赖链重装 libicu -> 覆盖 libicudata.so.78.3 / libicui18n.so.78.3 -> 运行中引擎 SIGBUS(BUS_ADRERR) 崩（logcat: libc Fatal signal 7, backtrace 在 libicui18n）；写入中断还留半写坏 so（linker CANNOT LINK invalid shdr）。bash 子进程脱离引擎继续装完 -> 现象「工具 interrupted 但包已装好」。session.jsonl 里的 interrupted-tool-result 是崩溃后 dsh-session repair.js 合成的闭合事件（time 复用最后事件），非实时取消。
- **修复**：extractTar() 文件写入改为**原子替换**（同目录 tmp + Files.move ATOMIC_MOVE / REPLACE_EXISTING），旧 inode 不动 -> 运行中引擎不崩、无半写坏态。改动 TermuxPackageManager.kt（v0.13.4）。
- **验证**：对运行中引擎 mmap 的 libicudata 做 tmp+rename 替换模拟 + `pkg reinstall libicu` 真机复测（全新安装后同依赖树重装 libicu），引擎 pid 不变、3080 全程存活；取证脚本已清理不入库。
- **残余建议（未实施）**：readBaseInstalled 未把快照预装引擎核心库（libicu 等）视为已装，依赖解析会重复下载重装；可纳入 installed 判定减少无谓覆盖。
- **排查工具**：adb logcat -d -T 查 libc Fatal signal / linker CANNOT LINK；会话尾部合成事件 time = 最后真实事件 time；桌面 python zstandard 解压 session.jsonl.zstd。

### 3.11 杂项踩坑（2026-09-03 实测）
- **`run-as` 无法写 app data**：`adb shell run-as <pkg> cat > files/...` 报 `Permission denied`（FBE/SELinux 限制，读可以写不行）。还原 `files/home/.dsh` 配置要用**引擎侧途径**：POST `http://127.0.0.1:3080/ag-config/api` `{"method":"set","patch":{"accounts":[{endpoint,key}]}}`（agconfig 自动写 credentials + settings.yaml）。
- 覆盖安装（`adb install -r`）**不会移除** cordis.patch.yml 里已挂载的插件条目；要真正去掉某插件需卸载重装。
- 二进制经 PowerShell 重定向会被破坏；`adb exec-out ... > file` 必须用 `cmd /c` 包裹。

---

## 4. 文件落点

| 文件 | 作用 |
|---|---|
| `app/src/main/assets/dsh-agconfig/{lib/index.js,lib/client.js,package.json,cordis.append.yml}` | **多模态配置 + LLM 自动注册插件**（已修复第175行语法错误） |
| `app/src/main/assets/dsh-agimage/*` | 常驻图片生成工具（`generate_image`，读 ag-multimodal.json） |
| `app/src/main/assets/dsh-agvideo/*` | 常驻视频生成工具（`generate_video`，text/keyframe/reference） |
| `app/src/main/assets/dsh-zh-mode/*` | 中文模式开关（systemPrompt 段注入） |
| `app/src/main/assets/dsh-mobile-persona/*` | **移动端系统提示词完整重写**（DeepCode persona：身份/安卓环境/包管理/图视频/工作守则/中文，systemPrompt.section order -1000） |
| `app/src/main/assets/patched/agent-loop-index.js` | agent-loop 并行度 patch（`maxParallelToolCalls` 默认 10→1，同一步多 bash 串行；`applyRuntimePatches` 覆盖引擎文件） |
| `app/src/main/assets/patched/dsh-android-bridge-index.js` | pkg 命令 → Kotlin HTTP 后台 job 路由 + ADB 授权桥 patch（部署到 profiles 下 @dsh-android/dsh-android-bridge） |
| `app/src/main/java/com/dshmobile/shell/EngineManager.kt` | `deployAgPlugins()`（5 插件，含 dsh-mobile-persona）+ `deployBundledPptSkill()` + `deployPackageClient()` + `applyRuntimePatches()`（含 agent-loop patch）+ `deployMobilePolish()` + `fixDshBin()` |
| `app/src/main/java/com/dshmobile/shell/TermuxPackageManager.kt` | Android 原生 Termux 包安装器（镜像索引/依赖解析/deb 解压/状态管理；v0.13.4 起解压改**原子替换写入**，防止覆盖引擎 mmap 共享库） |
| `app/src/main/java/com/dshmobile/shell/TermuxPackageService.kt` | pkg 本地 HTTP 服务（127.0.0.1 随机端口 + token，endpoint 文件 files/.dsh-pkg-endpoint） |
| `app/src/main/assets/mobile-polish/lib/client.js` | 手机端 UI 深度适配（早期已封版） |
| `app/src/main/assets/patched/web-frontend-index.html` | `data-dsh-immersive` 默认关闭（`=== "1"`） |
| `app/src/main/assets/ppt_master.zip` / `.sha256` | **PPT Master skill 打包物**（v0.13.5：铁律6 并行 fan-out + Step5 T0/T1/T2 + 新增 references/page-brief-template.md）；sha256 指纹驱动 EngineManager.deployBundledPptSkill 幂等部署 |
| `app/src/main/assets/snapshot.tar.xz` / `.sha256` | arm64 运行时快照 + 指纹（必须成对） |
| `CHANGES.md` | 变更记录（含 v0.13.4 SIGBUS 修复） |
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