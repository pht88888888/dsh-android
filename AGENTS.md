# AGENTS.md — dsh-mobile-apk 工作交接

## 1. 快速编译 + 安装

```powershell
pushd C:\Users\XIAOPAN\Desktop\安卓开发\dsh-mobile-apk

# 构建 debug APK（耗时 ~5-10s 增量）
.\gradlew.bat assembleDebug

# 安装到手机（覆盖装，保留用户数据）
adb install -r app\build\outputs\apk\debug\app-debug.apk

# 重启 app（引擎启动需要 60-90s）
adb shell am force-stop com.dsharnessmobile.shell
Start-Sleep -Seconds 2
adb shell monkey -p com.dsharnessmobile.shell -c android.intent.category.LAUNCHER 1

# 等引擎起来后再连 CDP 验证
# adb shell pidof com.dsharnessmobile.shell 查 pid
# adb forward --remove-all; adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

**注意**：调试包默认带 **x86_64 快照**。装到 arm64 真机会引擎崩溃（ELF 不匹配）。当前真机是 arm64，已同步替换 `assets/snapshot.tar.xz` + `snapshot.sha256` 为 arm64 版（指纹 `a60fcc60...`），无需再处理。

---

## 2. 当前任务进度

### 已完成
- ✅ 克隆仓库到 `C:\Users\XIAOPAN\Desktop\安卓开发\dsh-mobile-apk`
- ✅ 创建手机端 UI 适配插件 `@dsh-mobile/mobile-polish`（assets/mobile-polish/），7 项适配
- ✅ 修复 renderer OOM 崩溃根因（详见 §3）
- ✅ 修复 trimMeta 文本拼接 bug（多文本节点重复设置）
- ✅ 修复 stats 条「输入 1.5M tok」正则遗漏
- ✅ 第 4 项（去点击闪烁）+ 第 5 项（审批卡片上浮）CSS/JS 已落地
- ✅ Cordis 预设「创造模式（参数修复）」已 bundle 到 assets/presets/cordis-argfix/
- ✅ 第 1/6/7 项已真机（CDP DOM 实测）验证，并修复两处问题：
  - 头部重叠：`headerActions` 需在 `titleCluster` 内 `flex:1 1 auto; min-width:0; width:100%` 才能换行收缩，否则溢出与 `headerUtilities` 重叠
  - 设置返回条：漏了 `dialog.insertBefore(backBar, nav)`，返回条从未进 DOM；已补
- ✅ 设置页已按 DeepSeek APP 风格改造（全屏 + 圆形返回按钮 + 标题 + 分类小标题）：
  - 全屏：`dialog` 固定视口、去圆角/阴影、`flex-direction:column`
  - 顶部只保留圆形返回按钮 + 标题，**已移除右上角 ✕**
  - 二级页标题取点击的 nav 按钮文本，所有 tab 均正确（不依赖 `.zGbnIq_title`）
  - 一级/二级均可纵向滚动（`nav`/`content` 均 `flex:1 1 0%; min-height:0; overflow-y:auto`）
  - 消除旧样式闪烁：MutationObserver 对新增 dialog 立即执行 `setupSettingsDialog`，不再等 300ms 节流

### 未完成 / 待验证
1. **第 5 项 审批卡片上浮**：代码已落地，但当前无待审批任务，未实测
2. **第 2/3 项**：真机 DOM 确认生效（隐藏按钮 display:none；stats 条 `首 token`/`输入 tok` 及分隔符 display:none）

### 新增（2026-08-26 UI 重构第二阶段）
- ✅ **状态栏修复**：默认 `immersive_mode=false`（状态栏显示），edge-to-edge 内容延伸到状态栏后（API 29 用 `LAYOUT_FULLSCREEN`，API 30+ 用 `setDecorFitsSystemWindows(false)`），状态栏背景透明并适配主题色
- ✅ **状态栏图标自适应**：浅色主题→深色图标，深色主题→浅色图标（`isLightStatusBar()` + `SYSTEM_UI_FLAG_LIGHT_STATUS_BAR` / `isAppearanceLightStatusBars`）
- ✅ **迁移机制**：`migrateImmersiveDefault()` 在覆盖安装后首次启动强制重置 `immersive_mode=false`，保证旧用户升级后黑条消失
- ✅ **Mobile 头部重构**：`setupMobileHeader()` 在 `mobile-polish/client.js` 中实现，顶栏改为：
  - 左：汉堡菜单按钮（保留原 `_3HOSdG_mobileHamburger`）
  - 中：会话标题 + 模式名（取自 `.wSkVaW_crumbCurrent` + `.SVAs4q_label`）
  - 右：⋮ 三点菜单按钮 → 下拉菜单含「下载日志」「已存 N 份快照」「查看轨迹/返回对话」
  - 隐藏原 `.wSkVaW_header` 和 `.wSkVaW_tabs`（对话/轨迹标签）
  - 默认界面为对话，轨迹视图通过菜单切换
- ✅ **Edge-to-edge 顶部内边距**：顶栏 `padding-top: var(--dsh-android-system-top, 0px)` 让内容让出状态栏区域
- ✅ **Web 端沉浸状态同步**：`pushImmersiveToWeb()` 在页面加载/恢复/切换时把原生状态写入 `localStorage('dsh.android.immersive')`，`data-dsh-immersive` 默认关闭（`=== "1"` 替代 `!== "0"`）
- ✅ **顶部 inset 推送**：`--dsh-android-system-top` CSS 变量随 `pushWebInsets()` 注入 WebView

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
- **禁止在 client.js 中使用 `:has()` 选择器**。改用 `Array.from(el.children).find(c => c.tagName === 'NAV')` 等同步遍历。
- 崩溃现场特征：logcat 里 `mmap failed: Out of memory`（renderer 进程）→ `Renderer process crash detected` → 主进程 SIGTRAP。crashpad 自己也会崩（open file error），无法收集 dump。

### 3.3 cordis.patch.yml 幂等陷阱
- EngineManager.deployMobilePolish 用 `patch.readText().contains(marker)` 判断是否追加。marker 字符串是 `@dsh-mobile/mobile-polish`。
- **不要在注释里写 marker 字符串**——那会导致 append 静默跳过，插件条目不会挂载。之前 A/B 测试踩过：patch 注释含 marker → 重启后插件未加载。

### 3.4 验证对话常用 CDP 命令
```powershell
$pid = adb shell pidof com.dsharnessmobile.shell
adb forward --remove-all; adb forward tcp:9222 localabstract:webview_devtools_remote_$pid
$target = (Invoke-RestMethod http://127.0.0.1:9222/json | Select-Object -First 1).webSocketDebuggerUrl

# 探针：插件注入
node C:\Users\XIAOPAN\Desktop\dsh\cdp-probe.js $target '!!document.querySelector("style[data-plugin-css*=mobile-polish]")'
# 探针：头部重叠（x 范围相交即重叠）
node C:\Users\XIAOPAN\Desktop\dsh\cdp-probe.js $target 'JSON.stringify([[".u_actions",(document.querySelector(".u_actions")||{}).getBoundingClientRect(),[".wSkVaW_headerUtilities",(document.querySelector(".wSkVaW_headerUtilities")||{}).getBoundingClientRect()]])'
# 探针：设置 dialog 位置（x<0 即屏幕外 bug）
node C:\Users\XIAOPAN\Desktop\dsh\cdp-probe.js $target 'JSON.stringify((document.querySelector("[role=dialog][aria-modal=true]")||{}).getBoundingClientRect())'
```

### 3.5 状态栏 / Edge-to-edge 陷阱
- `SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN` 会覆盖 `systemUiVisibility` 全量 mask，**必须同时加上 `SYSTEM_UI_FLAG_LIGHT_STATUS_BAR`**（浅色主题时），否则状态栏图标变成白色不可见。`isLightStatusBar()` 根据 `uiMode` 判断。
- `window.statusBarColor = Color.TRANSPARENT` 在 API 29 上让内容透出；API 30+ 由 `setDecorFitsSystemWindows(false)` 自动处理。
- WebView 的 `env(safe-area-inset-top)` 在部分 WebView 上返回 0；改用 `var(--dsh-android-system-top, 0px)`（由 native `pushWebInsets()` 注入）。
- 切换深/浅色模式时 `onConfigurationChanged` 会重推 `applyImmersive()`，确保图标色更新。

### 3.6 scrcpy 后台任务
上一轮开了 `scrcpy --turn-screen-off --stay-awake --no-audio` 在后台（job pwsh-6），已自然退出。下次如需镜像，重新开。

---

## 4. 文件落点

| 文件 | 作用 |
|---|---|
| `app/src/main/assets/mobile-polish/lib/client.js` | **核心文件**：7 项适配 + 头部重构 + 三点菜单 |
| `app/src/main/assets/mobile-polish/lib/index.js` | Host 侧空壳（ESM export） |
| `app/src/main/assets/mobile-polish/package.json` | 客户端插件 manifest（type:module, inject:[], exports.client） |
| `app/src/main/assets/mobile-polish/cordis.append.yml` | cordis patch 追加片段（幂等 marker） |
| `app/src/main/java/com/dshmobile/shell/EngineManager.kt` | 部署函数 `deployMobilePolish()` 在 L528-548 |
| `app/src/main/java/com/dshmobile/shell/MainActivity.kt` | `applyImmersive()` 状态栏逻辑 + edge-to-edge + `pushImmersiveToWeb()` + `migrateImmersiveDefault()` + `isLightStatusBar()` |
| `app/src/main/assets/patched/web-frontend-index.html` | `data-dsh-immersive` 默认关闭（`=== "1"`） |
| `app/src/main/assets/snapshot.tar.xz` | arm64 运行时快照（153MB） |
| `app/src/main/assets/snapshot.sha256` | 快照指纹（与快照必须成对） |
| `C:\Users\XIAOPAN\Desktop\dsh\cdp-probe.js` | 桌面端 CDP 探针脚本 |

---

*上次更新时间：2026-08-26，AI 开发助手*
