// dsh-mobile-persona — browser half (client plugin bundle).
//
// 展示「移动端系统提示词已启用」设置面板（只读，always-on）。
// 无需后端 API；完整重写的系统提示词由 host 端 index.js 注入。

window.__ModuleLoader__.load({
	id: "dsh-mobile-persona",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			function Panel() {
				return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0" } },
					React.createElement("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary, inherit)" } },
						"移动端系统提示词"),
					React.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))", lineHeight: 1.5 } },
						"已启用：完整重写的 DeepCode 系统提示词（含 Android 环境、包管理、图片/视频生成守则）。新会话生效。")
				);
			}

			ctx.slots.inject("settings.plugins.tab", function() {
				return ctx.slots.register({
					name: "settings.plugins.tab",
					id: "mobile-persona",
					order: 2,
					label: "移动端人设"
				}, Panel);
			});
		};
		return module.exports;
	}
});
