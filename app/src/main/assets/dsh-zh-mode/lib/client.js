// dsh-zh-mode — browser half (client plugin bundle).
//
// 注册「中文模式」设置页：设置 → 插件 → 中文模式。
// 开关经 /zh-mode/api 持久化到 $DSH_HOME/zh-mode.json。

window.__ModuleLoader__.load({
	id: "dsh-zh-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			var API_URL = "/zh-mode/api";

			function callApi(payload) {
				return fetch(API_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				}).then(function(r) { return r.json(); });
			}

			function ZhModePanel() {
				var enabledState = React.useState(false);
				var enabled = enabledState[0];
				var setEnabled = enabledState[1];
				var statusState = React.useState({ phase: "loading" });
				var status = statusState[0];
				var setStatus = statusState[1];

				React.useEffect(function() {
					var cancelled = false;
					callApi({ method: "get" }).then(function(res) {
						if (cancelled) return;
						if (res && res.ok === true && res.value) {
							setEnabled(res.value.enabled === true);
							setStatus({ phase: "ready" });
						} else {
							setStatus({ phase: "error", message: "无法读取开关状态" });
						}
					}).catch(function() {
						if (cancelled) return;
						setStatus({ phase: "error", message: "连接配置服务失败" });
					});
					return function() { cancelled = true; };
				}, []);

				function save(val) {
					var next = !val ? val : val;
					// 用户点击 switch 后立即更新 UI，再持久化
					setStatus({ phase: "saving" });
					callApi({ method: "set", patch: { enabled: !!val } }).then(function(res) {
						setEnabled(!!val);
						setStatus(res && res.ok === true ? { phase: "saved" } : { phase: "error", message: "保存失败" });
					}).catch(function() {
						setStatus({ phase: "error", message: "保存失败" });
					});
				}

				function toggle() {
					save(!enabled);
				}

				var statusLine = null;
				if (status.phase === "loading") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, "读取中...");
				} else if (status.phase === "saving") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, "保存中...");
				} else if (status.phase === "saved") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #2ea043)" } }, "已保存 ✓（新会话生效）");
				} else if (status.phase === "error") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "rgba(255,80,80,0.9)" } }, status.message || "出错了");
				} else {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, enabled ? "已开启" : "未开启");
				}

				var switchStyle = {
					position: "relative",
					width: "44px",
					height: "24px",
					borderRadius: "12px",
					border: "none",
					cursor: "pointer",
					background: enabled ? "var(--dsw-alias-brand-primary, #4f46e5)" : "rgba(128,128,128,0.35)",
					transition: "background .15s",
					flexShrink: 0
				};
				var knobStyle = {
					position: "absolute",
					top: "2px",
					left: enabled ? "22px" : "2px",
					width: "20px",
					height: "20px",
					borderRadius: "50%",
					background: "#fff",
					transition: "left .15s"
				};

				return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "4px 0" } },
					React.createElement("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary, inherit)" } },
						"中文模式"),
					React.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))", lineHeight: 1.5 } },
						"开启后，系统提示词注入中文 persona 段：AI 始终用简体中文回复，思考过程（chain-of-thought）也全部使用中文。工具名称与代码保持原文。"),
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
						React.createElement("button", {
							onClick: toggle,
							disabled: status.phase === "saving",
							style: Object.assign({}, switchStyle, { opacity: status.phase === "saving" ? 0.6 : 1 })
						},
							React.createElement("span", { style: knobStyle })
						),
						statusLine
					)
				);
			}

			ctx.slots.inject("settings.plugins.tab", function() {
				return ctx.slots.register({
					name: "settings.plugins.tab",
					id: "zh-mode",
					order: 4,
					label: "中文模式"
				}, ZhModePanel);
			});
		};
		return module.exports;
	}
});