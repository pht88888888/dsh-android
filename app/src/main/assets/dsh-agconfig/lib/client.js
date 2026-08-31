// dsh-agconfig — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-agconfig/client.js and executed
// through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with require()
// resolved against the shell's module table.
//
// Registers a "多模态配置" tab inside the Plugins settings section
// (settings.plugins.tab). The panel manages an ACCOUNT POOL: each row is one
// Agnes AI account (region/endpoint + API key). Every account is an
// independent rate-limit slot, so N accounts raise the video RPM from 1/min
// to N/min. Persisted via the fenced host API (/ag-config/api) to
// $DSH_HOME/ag-multimodal.json as { "accounts": [{ endpoint, key }, ...] }.

window.__ModuleLoader__.load({
	id: "dsh-agconfig",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			var API_URL = "/ag-config/api";

			var CN_ENDPOINT = "https://api.agnes-ai.cn/v1";
			var INTL_ENDPOINT = "https://apihub.agnes-ai.cn/v1";
			var REGIONS = [
				{ label: "国内站", endpoint: CN_ENDPOINT },
				{ label: "国际站", endpoint: INTL_ENDPOINT }
			];

			function callApi(payload) {
				return fetch(API_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				}).then(function(r) { return r.json(); });
			}

			function regionFor(endpoint) {
				for (var i = 0; i < REGIONS.length; i++) {
					if (REGIONS[i].endpoint === endpoint) return REGIONS[i];
				}
				return null;
			}

			function MultimodalConfigPanel() {
				var accountsState = React.useState([]);
				var accounts = accountsState[0];
				var setAccounts = accountsState[1];
				var statusState = React.useState({ phase: "loading" });
				var status = statusState[0];
				var setStatus = statusState[1];
				var testStatesState = React.useState({});
				var testStates = testStatesState[0];
				var setTestStates = testStatesState[1];

				React.useEffect(function() {
					var cancelled = false;
					callApi({ method: "get" }).then(function(res) {
						if (cancelled) return;
						if (res && res.ok === true && res.value) {
							var list = [];
							if (Array.isArray(res.value.accounts)) {
								list = res.value.accounts.map(function(a) {
									return { endpoint: a.endpoint, key: a.key };
								});
							} else if (typeof res.value.agnesApiKey === "string" && res.value.agnesApiKey.length > 0) {
								// backward compat: legacy single key becomes one cn account
								list = [{ endpoint: CN_ENDPOINT, key: res.value.agnesApiKey }];
							}
							if (list.length === 0) list = [{ endpoint: CN_ENDPOINT, key: "" }];
							setAccounts(list);
							setStatus({ phase: "ready" });
						} else {
							setAccounts([{ endpoint: CN_ENDPOINT, key: "" }]);
							setStatus({ phase: "ready" });
						}
					}).catch(function() {
						if (cancelled) return;
						setStatus({ phase: "error", message: "无法连接配置服务" });
					});
					return function() { cancelled = true; };
				}, []);

				function setRow(idx, patch) {
					setAccounts(function(prev) {
						return prev.map(function(row, i) {
							return i === idx ? Object.assign({}, row, patch) : row;
						});
					});
					setTestStates(function(prev) {
						if (!prev[idx]) return prev;
						var next = Object.assign({}, prev);
						delete next[idx];
						return next;
					});
				}
				function addRow() {
					setAccounts(function(prev) { return prev.concat([{ endpoint: CN_ENDPOINT, key: "" }]); });
				}
				function removeRow(idx) {
					setAccounts(function(prev) {
						var next = prev.filter(function(_, i) { return i !== idx; });
						return next.length > 0 ? next : [{ endpoint: CN_ENDPOINT, key: "" }];
					});
					setTestStates(function(prev) {
						var next = Object.assign({}, prev);
						delete next[idx];
						return next;
					});
				}
				function testRow(idx) {
					var row = accounts[idx];
					if (!row || row.key.trim().length === 0) return;
					setTestStates(function(prev) {
						var next = Object.assign({}, prev);
						next[idx] = { phase: "testing" };
						return next;
					});
					callApi({ method: "test", payload: { endpoint: row.endpoint, key: row.key.trim() } }).then(function(res) {
						setTestStates(function(prev) {
							var next = Object.assign({}, prev);
							if (res && res.ok === true) {
								next[idx] = { phase: "done", ok: true };
							} else if (res && res.ok === false && res.reason === "invalid") {
								next[idx] = { phase: "done", ok: false, reason: "invalid" };
							} else {
								next[idx] = { phase: "done", ok: false, reason: "network" };
							}
							return next;
						});
					}).catch(function() {
						setTestStates(function(prev) {
							var next = Object.assign({}, prev);
							next[idx] = { phase: "done", ok: false, reason: "error" };
							return next;
						});
					});
				}

				function save() {
					setStatus({ phase: "saving" });
					callApi({ method: "set", patch: { accounts: accounts } }).then(function(res) {
						setStatus(res && res.ok === true ? { phase: "saved" } : { phase: "error", message: "保存失败" });
					}).catch(function() {
						setStatus({ phase: "error", message: "保存失败" });
					});
				}

				var rows = accounts.map(function(row, idx) {
					var region = regionFor(row.endpoint);
					var select = React.createElement("select", {
						value: region ? row.endpoint : "",
						onChange: function(e) { setRow(idx, { endpoint: e.target.value }); },
						style: {
							padding: "8px 8px",
							borderRadius: "8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))",
							background: "var(--dsw-alias-bg-base, transparent)",
							color: "var(--dsw-alias-label-primary, inherit)",
							fontSize: "13px",
							width: "96px"
						}
					},
						REGIONS.map(function(r) {
							return React.createElement("option", { key: r.endpoint, value: r.endpoint }, r.label);
						})
					);
					var keyInput = React.createElement("input", {
						type: "password",
						value: row.key,
						placeholder: "sk-xxxxxxxxxxxx",
						spellCheck: false,
						onChange: function(e) { setRow(idx, { key: e.target.value }); },
						style: {
							flex: "1",
							minWidth: "180px",
							padding: "8px 12px",
							borderRadius: "8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))",
							background: "var(--dsw-alias-bg-base, transparent)",
							color: "var(--dsw-alias-label-primary, inherit)",
							fontSize: "13px",
							fontFamily: "monospace"
						}
					});
					var rowTest = testStates[idx];
					var testBtn = React.createElement("button", {
						onClick: function() { testRow(idx); },
						disabled: !row || row.key.trim().length === 0 || (rowTest && rowTest.phase === "testing"),
						style: {
							padding: "7px 10px",
							borderRadius: "8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))",
							background: "transparent",
							color: "var(--dsw-alias-label-primary, inherit)",
							fontSize: "12px",
							cursor: "pointer",
							opacity: !row || row.key.trim().length === 0 || (rowTest && rowTest.phase === "testing") ? 0.5 : 1
						}
					}, "测试");
					var testResult = null;
					if (rowTest) {
						if (rowTest.phase === "testing") {
							testResult = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, "测试中...");
						} else if (rowTest.ok) {
							testResult = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #2ea043)" } }, "✓ 密钥有效");
						} else if (rowTest.reason === "invalid") {
							testResult = React.createElement("span", { style: { fontSize: "12px", color: "rgba(255,80,80,0.9)" } }, "✗ 密钥无效");
						} else {
							testResult = React.createElement("span", { style: { fontSize: "12px", color: "rgba(255,160,60,0.95)" } }, "✗ 连接失败/网络错误");
						}
					}
					var removeBtn = React.createElement("button", {
						onClick: function() { removeRow(idx); },
						style: {
							padding: "7px 10px",
							borderRadius: "8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))",
							background: "transparent",
							color: "var(--dsw-alias-label-primary, inherit)",
							fontSize: "12px",
							cursor: "pointer"
						}
					}, "移除");
					return React.createElement("div", {
						key: idx,
						style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }
					},
						React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))", width: "22px" } }, String(idx + 1) + "."),
						select,
						keyInput,
						testBtn,
						testResult,
						removeBtn
					);
				});

				var statusLine = null;
				if (status.phase === "loading") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, "读取中...");
				} else if (status.phase === "saving") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } }, "保存中...");
				} else if (status.phase === "saved") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #2ea043)" } },
						status.message || ("已保存 ✓（" + accounts.filter(function(a) { return a.key.trim().length > 0; }).length + " 个有效号）"));
				} else if (status.phase === "error") {
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "rgba(255,80,80,0.9)" } }, status.message || "出错了");
				} else {
					var valid = accounts.filter(function(a) { return a.key.trim().length > 0; }).length;
					statusLine = React.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))" } },
						"已配置 " + valid + " 个号 · 视频生成速率 " + valid + " 次/分钟" + (valid > 0 ? "" : "（未填密钥将使用内置默认号）"));
				}

				var addBtn = React.createElement("button", {
					onClick: addRow,
					style: {
						padding: "7px 14px",
						borderRadius: "8px",
						border: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,0.5))",
						background: "transparent",
						color: "var(--dsw-alias-label-primary, inherit)",
						fontSize: "13px",
						cursor: "pointer",
						alignSelf: "flex-start"
					}
				}, "+ 添加号");

				var saveBtn = React.createElement("button", {
					onClick: save,
					disabled: status.phase === "saving",
					style: {
						padding: "8px 16px",
						borderRadius: "8px",
						border: "none",
						background: "var(--dsw-alias-brand-primary, #4f46e5)",
						color: "#fff",
						fontSize: "13px",
						cursor: "pointer",
						opacity: status.phase === "saving" ? 0.6 : 1
					}
				}, "保存");

				return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "4px 0" } },
					React.createElement("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary, inherit)" } },
						"Agnes AI 账号池（多模态）"),
					React.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, rgba(128,128,128,0.9))", lineHeight: 1.5 } },
						"每个号一个独立密钥，图片生成（generate_image）和视频生成（generate_video）按号轮询使用。每多一个号，视频生成速率 +1 次/分钟。国内站/国际站各自计费与限流。留空全部号将回退到插件内置的默认号。"),
					React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, rows),
					addBtn,
					React.createElement("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, saveBtn, statusLine)
				);
			}

			ctx.slots.inject("settings.plugins.tab", function() {
				return ctx.slots.register({
					name: "settings.plugins.tab",
					id: "multimodal",
					order: 5,
					label: "多模态配置"
				}, MultimodalConfigPanel);
			});
		};
		return module.exports;
	}
});

