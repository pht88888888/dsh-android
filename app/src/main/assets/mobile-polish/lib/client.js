window.__ModuleLoader__.load({
	id: "@dsh-mobile/mobile-polish",
	factory: (require) => {
		"use strict";
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── CSS ──────────────────────────────────────────────────────────────
		// Scoped styles injected as one style tag (same pattern as ui-responsive).
		// Class names below are the stable ones observed in the 0.13.0-preview
		// snapshot bundles (wSkVaW_* = conversation root, FJxK0a_* = composer
		// StatsLine, Nqubda_* = cordis panel). Where possible we key off ARIA/data
		// attributes instead so the rules survive minor bundle changes.
		const CSS = `
/* 4. 去掉全局点击/聚焦蓝色闪烁（WebView tap highlight + focus ring） */
* {
  -webkit-tap-highlight-color: transparent !important;
}

/* 4b. 隐藏所有滚动条（移动端太丑） */
*::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
* {
  scrollbar-width: none !important;
}

/* 侧边栏让出状态栏（与对话顶栏对齐） */
[data-mobile] ._3HOSdG_mobileDrawer {
  padding-top: var(--dsh-android-system-top, 0px) !important;
}
button:focus, button:focus-visible, a:focus, [tabindex]:focus,
input:focus, textarea:focus, select:focus {
  outline: none !important;
  box-shadow: none !important;
}

/* 2. 消息操作栏：隐藏点赞/有问题反馈按钮（保留 复制/分支/时间/用时） */
button[aria-label="好的回答"],
button[aria-label="有问题的回答"] {
  display: none !important;
}

/* 1. 会话头部：标题长时右侧 actions/utilities 溢出重叠（undo 快照徽章 vs session log 按钮）→ 换行。
   容器是 wSkVaW_headerActions（模式徽章+快照徽章+utilities 并排超出容器宽，flex nowrap 导致重叠）。
   让 headerActions 在 titleCluster 内收缩、换行，避免溢出与 headerUtilities 重叠。 */
.wSkVaW_titleRow {
  flex-wrap: wrap;
  row-gap: 2px;
  align-items: flex-start;
}
.wSkVaW_titleCluster {
  flex: 1 1 0%;
  min-width: 0;
  overflow: hidden;
}
.wSkVaW_headerActions {
  flex-wrap: wrap;
  row-gap: 4px;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  width: 100% !important;
}
.wSkVaW_headerUtilities {
  margin-left: 0 !important;
}
[data-mobile] .wSkVaW_titleRow {
  gap: 2px 4px;
}
[data-mobile] .wSkVaW_headerUtilities {
  margin-left: 0 !important;
}

/* 3. composer StatsLine：隐藏 首token/tok/s 与 输入/输出 tokens 段（JS 按文本处理，
    这里兜底隐藏其分隔符与目标段） */
.FJxK0a_sep {
  flex: none;
}

/* 7. 设置页两级化（移动端）：横向滑动导航 → 竖向列表；一级=列表，二级=内容。
   NOTE: 全部用 JS inline style，不用 CSS 规则 —— 实测本 WebView（Chromium 114 +
   ui-responsive 的 html zoom:3）下，任何匹配设置 dialog 子树的 CSS 规则都会把
   dialog 推到屏幕外（x=-301，关闭按钮变 0 尺寸，无法关闭）。 */

/* 5. 审批面板（cordis）：移动端固定到 composer 上方 —— 定位全在 JS（positionApprovalPanel），
   此处不再注入 CSS（同上，避免 media CSS 触发布局 bug）。 */

/* 审批有内容时自动打开的遮罩提示：面板上缘阴影强化层级 */
.Nqubda_panel[data-mp-approval] {
  box-shadow: var(--dsw-shadow-lv3, 0 8px 30px rgba(0, 0, 0, .25)) !important;
}

/* 8. 移动端头部重构：隐藏桌面 header 与 对话/轨迹 tabs（改由手机顶栏承载） */
[data-mobile] .wSkVaW_header,
[data-mobile] .wSkVaW_tabs {
  display: none !important;
}

/* 8. 顶栏重建元素（自建类，不碰 dialog 子树） */
[data-mobile] ._3HOSdG_mobileTopBar {
  gap: 8px;
  padding-top: var(--dsh-android-system-top, 0px);
  background: transparent !important;
  box-shadow: none !important;
}
.mp-hd-center {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.25;
}
.mp-hd-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #222);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-hd-mode {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-hd-menu-btn {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 20px;
  line-height: 1;
  color: var(--dsw-alias-label-primary, #222);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.mp-hd-menu {
  position: fixed;
  z-index: 99999;
  min-width: 180px;
  background: var(--dsw-alias-surface, #fff);
  border: 1px solid var(--dsw-alias-border, rgba(0,0,0,.08));
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, .18);
  padding: 6px;
  box-sizing: border-box;
}
.mp-hd-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--dsw-alias-label-primary, #222);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.mp-hd-menu button:hover,
.mp-hd-menu button:active {
  background: var(--dsw-alias-interactive-bg-hover, #f0f0f0);
}
.mp-hd-mask {
  position: fixed;
  inset: 0;
  z-index: 99998;
  background: transparent;
}
/* 5. 审批面板浮到输入框上方（面板保留在 Cordis layer 内不动，仅重定位）。
   抽屉打开时 transform 为 identity，fixed 相对视口生效；bottom 用 CSS 变量
   承载：React 重算 anchor 覆盖内联 bottom 也压不过 !important。 */
.Nqubda_panel[data-mp-approval] {
  position: fixed !important;
  left: 12px !important;
  right: 12px !important;
  top: auto !important;
  width: auto !important;
  max-width: calc(100vw - 24px) !important;
  bottom: var(--mp-approval-bottom, 96px) !important;
  z-index: 9999 !important;
}
`;

		function injectStyles() {
			if (document.querySelector("style[data-plugin-css='@dsh-mobile/mobile-polish/main.css']")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-mobile/mobile-polish";
			tag.dataset.pluginCss = "@dsh-mobile/mobile-polish/main.css";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		// ── 3. 消息 meta 精简：保留 "22:41 · 用时 3秒"，删 " · 首 token … / … tok/s" ──
		function trimMeta(el) {
			const m = /^(.+?·\s*用时\s*[^·]*?)(\s*·.*)?$/.exec((el.textContent || "").trim());
			if (!m || !m[2]) return;
			el.textContent = m[1];
		}

		// ── 3. composer StatsLine 精简：隐藏 首token/每秒token 与 输入/输出 tokens ──
		// 不设永久标记：新会话会重建 stats，节流已限制扫描频率。
		function processStatsLine() {
			const seat = document.querySelector("[data-composer-seat]");
			const roots = seat ? Array.from(seat.querySelectorAll("div")) : [];
			for (const root of roots) {
				const spans = root.querySelectorAll(":scope > span");
				if (spans.length < 3) continue;
				// 特征：该容器文本同时含 "轮 ·" 且子级全为 span（含分隔 span）
				if (!/轮\s*·/.test(root.textContent || "")) continue;
				spans.forEach((span) => {
					const t = span.textContent || "";
					if (/首\s*token/.test(t) || /tok\/s/.test(t) || /^输入\s+\S+\s*tok/.test(t)) {
						span.style.display = "none";
						const prev = span.previousElementSibling;
						if (prev && /^\|$/.test(prev.textContent || "")) prev.style.display = "none";
						const next = span.nextElementSibling;
						if (next && /^\|$/.test(next.textContent || "")) next.style.display = "none";
					}
				});
				return;
			}
		}

		// ── 6. 侧栏点「新会话」后自动收回抽屉 ──
		function onNewSessionClick(e) {
			const t = e.target.closest('button[aria-label="新建会话"]');
			if (!t) return;
			setTimeout(() => {
				const drawer = document.querySelector('[data-mobile] [class*="mobileDrawer"][data-open]');
				if (!drawer) return;
				const hamburger = document.querySelector('button[aria-label="打开导航"], [class*="mobileHamburger"]');
				if (hamburger) hamburger.click();
			}, 150);
		}

		// ── 5. 审批自动上浮到输入框上方 ──
		let lastApprovalCount = -1;
		function watchApproval() {
			const badge = document.querySelector("[data-cordis-approval-badge]");
			if (!badge) return;
			const count = parseInt(badge.getAttribute("data-cordis-approval-badge") || "0", 10);
			if (count === lastApprovalCount) return;
			const prev = lastApprovalCount;
			lastApprovalCount = count;
			if (count > 0) {
				// 有新审批：展开面板 + 打开抽屉（面板保留在 layer 内，useDismiss/React 均正常）
				if (badge.getAttribute("aria-expanded") !== "true") badge.click();
				openDrawer();
				positionApprovalPanel();
			} else if (prev > 0) {
				// 审批已处理：收起面板 + 收起抽屉
				if (badge.getAttribute("aria-expanded") === "true") badge.click();
				closeDrawer();
			}
		}

		function openDrawer() {
			const drawer = document.querySelector('[data-mobile] [class*="mobileDrawer"]');
			if (!drawer || drawer.getAttribute("data-open")) return;
			const hamburger = document.querySelector('button[aria-label="打开导航"], [class*="mobileHamburger"]');
			if (hamburger) hamburger.click();
		}

		function closeDrawer() {
			const drawer = document.querySelector('[data-mobile] [class*="mobileDrawer"][data-open]');
			if (!drawer) return;
			const hamburger = document.querySelector('button[aria-label="打开导航"], [class*="mobileHamburger"]');
			if (hamburger) hamburger.click();
		}

		function positionApprovalPanel() {
			// 面板渲染是异步的（React setState → re-render）：轮询等面板出现再定位
			let tries = 0;
			const tick = () => {
				const panel = document.querySelector(".Nqubda_panel");
				const seat = document.querySelector("[data-composer-seat]");
				if (panel && seat) {
					const r = seat.getBoundingClientRect();
					panel.dataset.mpApproval = "1";
					panel.style.setProperty("--mp-approval-bottom", Math.max(8, window.innerHeight - r.top + 8) + "px");
				} else if (tries++ < 10) {
					setTimeout(tick, 100);
				}
			};
			tick();
		}

						// ── 7. 设置页两级化（全 inline style，不用 CSS 规则——见 CSS 区注释） ──
		function setupSettingsDialog(dialog) {
			if (dialog.dataset.mpReady) return;
			dialog.dataset.mpReady = "1";
			const nav = Array.from(dialog.children).find((c) => c.tagName === "NAV");
			if (!nav) return;
			dialog.dataset.mpSettings = "1";
			const content = nav.nextElementSibling;
			const isNarrow = () => window.innerWidth <= 639;
			// — 全屏 + 纵向布局（避免旧样式闪烁：立即应用，不等动画结束） —
			Object.assign(dialog.style, {
				width: "100vw", maxWidth: "100vw", height: "100vh", maxHeight: "100vh",
				borderRadius: "0", boxShadow: "none", position: "fixed", top: "0", left: "0",
				flexDirection: "column", overflow: "hidden",
			});
			const overlay = dialog.parentElement;
			if (overlay) {
				overlay.style.left = "0";
				overlay.style.width = "100vw";
				overlay.style.height = "100vh";
				overlay.style.alignItems = "stretch";
			}
			const navTitle = nav.querySelector(".VOzbGW_navTitle");
			if (navTitle) navTitle.style.display = "none";
			// 顶部返回条：只有圆形返回按钮 + 标题，不再放 ✕
			const backBar = document.createElement("div");
			backBar.className = "mp-back-bar";
			backBar.innerHTML = '<button type="button" class="mp-back-circle" aria-label="返回">‹</button>'
				+ '<span class="mp-title">设置</span>';
			Object.assign(backBar.style, {
				display: "flex", flex: "0 0 auto", alignItems: "center", gap: "4px",
				minHeight: "56px", padding: "8px 12px", boxSizing: "border-box",
				borderBottom: "none", background: "transparent",
			});
			// 回退 CSS 规则：用 !important 压内联 padding，让出状态栏
			const sysTop = getComputedStyle(document.documentElement).getPropertyValue("--dsh-android-system-top").trim() || "0px";
			backBar.style.setProperty("padding-top", sysTop, "important");
			const backBtn = backBar.querySelector(".mp-back-circle");
			Object.assign(backBtn.style, {
				width: "36px", height: "36px", borderRadius: "50%", background: "var(--dsw-alias-interactive-bg-hover, #f0f0f0)",
				border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center",
				justifyContent: "center", fontSize: "20px", color: "#222", flex: "0 0 auto",
			});
			const titleSpan = backBar.querySelector(".mp-title");
			Object.assign(titleSpan.style, {
				flex: "1 1 0%", textAlign: "center", fontSize: "17px", fontWeight: "600",
				color: "var(--dsw-alias-label-primary, #222)", whiteSpace: "nowrap",
				overflow: "hidden", textOverflow: "ellipsis", padding: "0 4px",
			});
			dialog.insertBefore(backBar, nav);
			const closeDialog = () => {
				const mask = dialog.parentElement?.querySelector(".VOzbGW_mask");
				if (mask) mask.click();
			};
			// 返回按钮：一级页关闭设置，二级页回一级
			const showList = () => {
				titleSpan.textContent = "设置";
				nav.style.display = "";
				if (content) content.style.display = "none";
				applyNavStyle();
			};
			const showContent = (titleText) => {
				const sectionTitle = content?.querySelector(".zGbnIq_title, h2");
				titleSpan.textContent = titleText || (sectionTitle ? sectionTitle.textContent : "设置");
				nav.style.display = "none";
				if (content) {
					content.style.display = "flex";
					content.style.flexDirection = "column";
					content.style.flex = "1 1 0%";
					content.style.minHeight = "0";
					content.style.overflowY = "auto";
				}
				const options = content?.querySelector(".VOzbGW_options");
				if (options) {
					options.style.flex = "1 1 0%";
					options.style.minHeight = "0";
					options.style.overflowY = "auto";
				}
			};
			backBtn.addEventListener("click", () => {
				const atList = !content || content.style.display === "none";
				if (atList) closeDialog();
				else showList();
			});
			// nav 竖向化 + 分类小标题 + 可滚动
			const applyNavStyle = () => {
				if (!isNarrow()) return;
				nav.style.flexDirection = "column";
				nav.style.alignItems = "stretch";
				nav.style.overflowY = "auto";
				nav.style.overflowX = "hidden";
				nav.style.width = "100%";
				nav.style.gap = "2px";
				nav.style.padding = "10px";
				nav.style.flex = "1 1 0%";
				nav.style.minHeight = "0";
				const navList = nav.querySelector(".VOzbGW_navList");
				if (navList) {
					navList.style.flex = "1 1 0%";
					navList.style.minHeight = "0";
					navList.style.overflowY = "auto";
				}
				if (navList && !navList.querySelector("[data-mp-group]")) {
					const groups = [
						{ label: "通用", items: ["通用设置"] },
						{ label: "模型", items: ["模型"] },
						{ label: "插件", items: ["插件"] },
						{ label: "高级", items: ["Agent 预设", "快照", "附件缓存", "开发者选项"] },
					];
					for (const g of groups) {
						const first = [...navList.querySelectorAll("button")].find((b) => g.items.includes((b.innerText || "").trim()));
						if (!first) continue;
						const label = document.createElement("div");
						label.className = "mp-nav-group";
						label.dataset.mpGroup = "1";
						label.textContent = g.label;
						label.style.cssText = "padding:14px 16px 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#888);";
						navList.insertBefore(label, first);
					}
				}
				Array.from(nav.children).forEach((c) => {
					if (c.querySelector && c.querySelector("button")) {
						c.style.flexDirection = "column";
						c.style.overflowX = "hidden";
						c.style.gap = "2px";
						c.style.flex = "1 1 0%";
						c.style.minWidth = "0";
					}
				});
				nav.querySelectorAll("button").forEach((b) => {
					b.style.width = "100%";
					b.style.minHeight = "50px";
					b.style.justifyContent = "flex-start";
					b.style.padding = "0 16px";
					b.style.borderRadius = "12px";
					b.style.fontSize = "15px";
					b.style.flex = "none";
					b.style.textAlign = "left";
				});
			};
			const contentHeader = content?.querySelector(".VOzbGW_header");
			if (contentHeader) contentHeader.style.display = "none";
			nav.addEventListener("click", (e) => {
				const btn = e.target.closest("button");
				if (!btn) return;
				const titleText = (btn.innerText || "").trim();
				setTimeout(() => showContent(titleText || "设置"), 0);
			});
			// 立即应用，去掉 800ms 延迟（旧样式闪烁根因）
			applyNavStyle();
			showList();
		}

			// ── 8. 移动端头部重构：顶栏承载 会话标题/模式名/⋮菜单；隐藏桌面 header 与 对话/轨迹 tabs ──
			let mpHdMenu = null;
			function setupMobileHeader() {
				const frame = document.querySelector("[data-mobile]");
				if (!frame) return;
				const topbar = frame.querySelector("[data-mobile-topbar]");
				if (!topbar) return;
				const header = frame.querySelector(".wSkVaW_header");
				if (!header) return;
				const titleEl = header.querySelector(".wSkVaW_crumbCurrent");
				if (!titleEl) return;
				const modeEl = header.querySelector(".SVAs4q_label");
				const snapEl = header.querySelector(".u_badge");
				const logBtn = header.querySelector(".nL4_yW_sessionLogButton");
				const tabs = Array.from(frame.querySelectorAll("[role=tablist] button"));

				// 隐藏原静态标题（DeepSeek Harness），换成会话标题 + 模式名
				const oldTitle = topbar.querySelector("._3HOSdG_mobileTitle");
				if (oldTitle) oldTitle.style.display = "none";

				let center = topbar.querySelector(".mp-hd-center");
				let menuBtn = topbar.querySelector(".mp-hd-menu-btn");
				if (!center) {
					center = document.createElement("div");
					center.className = "mp-hd-center";
					center.innerHTML = '<span class="mp-hd-title"></span><span class="mp-hd-mode"></span>';
					const hamburger = topbar.querySelector("._3HOSdG_mobileHamburger") || topbar.firstElementChild;
					topbar.insertBefore(center, hamburger ? hamburger.nextSibling : null);
				}
				if (!menuBtn) {
					menuBtn = document.createElement("button");
					menuBtn.type = "button";
					menuBtn.className = "mp-hd-menu-btn";
					menuBtn.setAttribute("aria-label", "更多");
					menuBtn.textContent = "⋮";
					menuBtn.addEventListener("click", (e) => {
						e.stopPropagation();
						if (!mpHdMenu) return;
						const hidden = mpHdMenu.style.display === "none";
						if (hidden) showHdMenu(menuBtn);
						else hideHdMenu();
					});
					topbar.appendChild(menuBtn);
				}
				if (!mpHdMenu) {
					mpHdMenu = document.createElement("div");
					mpHdMenu.className = "mp-hd-menu";
					mpHdMenu.style.display = "none";
					mpHdMenu.innerHTML =
						'<button type="button" data-mp-hd="log">下载日志</button>' +
						'<button type="button" data-mp-hd="snap"></button>' +
						'<button type="button" data-mp-hd="trace"></button>';
					document.body.appendChild(mpHdMenu);
					mpHdMenu.addEventListener("click", (e) => {
						const b = e.target.closest("button[data-mp-hd]");
						if (!b) return;
						hideHdMenu();
						if (b.dataset.mpHd === "log" && logBtn) logBtn.click();
						else if (b.dataset.mpHd === "snap" && snapEl) {
						snapEl.click();
						// 快照面板渲染在隐藏的 header 内（display:none），迁到 body 全屏显示
						let snapTries = 0;
						const snapTick = () => {
							const overlay = document.querySelector(".u_overlay[data-undo-panel]");
							if (!overlay) {
								if (snapTries++ < 15) setTimeout(snapTick, 100);
								return;
							}
							if (overlay.parentElement !== document.body) {
								document.body.appendChild(overlay);
							}
							overlay.style.position = "fixed";
							overlay.style.left = "0";
							overlay.style.right = "0";
							overlay.style.top = "0";
							overlay.style.bottom = "0";
							overlay.style.zIndex = "9999";
							// 面板内部样式完全保留
						};
						snapTick();
					}
						else if (b.dataset.mpHd === "trace") {
							const target = tabs.find((t) => t.getAttribute("aria-selected") !== "true");
							if (target) target.click();
						}
					});
				}

				// 刷新标题 / 模式名 / 快照 / 轨迹项文案
				const t = center.querySelector(".mp-hd-title");
				const m = center.querySelector(".mp-hd-mode");
				if (t) t.textContent = (titleEl.innerText || "").trim();
				if (m) m.textContent = modeEl ? (modeEl.innerText || "").trim() : "";
				const snapItem = mpHdMenu.querySelector('[data-mp-hd="snap"]');
				if (snapItem) snapItem.textContent = snapEl ? (snapEl.innerText || "").trim() : "快照";
				const traceItem = mpHdMenu.querySelector('[data-mp-hd="trace"]');
				if (traceItem) {
					const onConvo = !tabs.length || tabs[0].getAttribute("aria-selected") === "true";
					traceItem.textContent = onConvo ? "查看轨迹" : "返回对话";
				}

				function showHdMenu(btn) {
					const r = btn.getBoundingClientRect();
					mpHdMenu.style.top = Math.max(8, r.bottom + 4) + "px";
					mpHdMenu.style.right = "12px";
					mpHdMenu.style.display = "block";
					let mask = document.querySelector(".mp-hd-mask");
					if (!mask) {
						mask = document.createElement("div");
						mask.className = "mp-hd-mask";
						mask.addEventListener("click", hideHdMenu);
						document.body.appendChild(mask);
					}
					mask.style.display = "block";
				}
				function hideHdMenu() {
					if (!mpHdMenu) return;
					mpHdMenu.style.display = "none";
					const mask = document.querySelector(".mp-hd-mask");
					if (mask) mask.style.display = "none";
				}
			}


		// ── 全局 MutationObserver：懒处理动态挂载的元素 ──
		// 节流 300ms + 去重：防止历史/流式渲染时的高频 mutation 造成
		// 全量 DOM 扫描风暴（华为 WebView 114 renderer 会 mmap OOM 崩溃）。
		let moTimer = 0;
		const mo = new MutationObserver((muts) => {
			// 设置 dialog 挂载时立即处理，避免 300ms 节流导致旧样式闪烁
			for (const m of muts) {
				for (const n of m.addedNodes) {
					if (!n || n.nodeType !== 1) continue;
					if (n.matches && n.matches('[role="dialog"][aria-modal="true"]')) {
						setupSettingsDialog(n);
					} else if (n.querySelectorAll) {
						n.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(setupSettingsDialog);
					}
				}
			}
			if (moTimer) return;
			moTimer = setTimeout(() => {
				moTimer = 0;
				document.querySelectorAll(".p-xYUq_timeEnd").forEach(trimMeta);
				processStatsLine();
				watchApproval();
				setupMobileHeader();
				document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(setupSettingsDialog);
			}, 300);
		});

		function apply(ctx) {
			injectStyles();
			// 初始一轮
			document.querySelectorAll(".p-xYUq_timeEnd").forEach(trimMeta);
			processStatsLine();
			watchApproval();
			setupMobileHeader();
			document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(setupSettingsDialog);
			document.addEventListener("click", onNewSessionClick, true);
			mo.observe(document.body, { childList: true, subtree: true, characterData: true });
			// 审批徽章可能在侧栏抽屉渲染完成前不存在：轮询兜底（低频）
			const t = window.setInterval(watchApproval, 5000);
			return () => {
				mo.disconnect();
				document.removeEventListener("click", onNewSessionClick, true);
				window.clearInterval(t);
			};
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});