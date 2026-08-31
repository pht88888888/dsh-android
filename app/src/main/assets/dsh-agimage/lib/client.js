// dsh-agimage — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-agimage/client.js and executed
// through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with require()
// resolved against the shell's module table.
//
// Registers a custom tool-card view for `generate_image` calls:
//  - multi-image results render as a self-adaptive GRID (CSS Grid auto-fill,
//    so ordering is ROW-MAJOR: left→right, then next row; auto-fits the card
//    width, mixed aspect ratios stay top-aligned like a loose masonry);
//  - large batches (> 12) collapse to a compact preview with an "expand all"
//    toggle so the card never scrolls the conversation;
//  - each thumbnail carries a numbered badge and a hover zoom hint;
//  - clicking a thumbnail opens a full-screen lightbox with prev/next arrows
//    and keyboard ←/→ navigation, download, close, ESC, and a counter.

window.__ModuleLoader__.load({
	id: "dsh-agimage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			var COLLAPSE_LIMIT = 12;
			// Grid + badge + hover styles (React inline styles can't do :hover).
			// CSS Grid auto-fill gives ROW-MAJOR order (left→right, then next
			// row) — auto-fills to the card width; align-items:start keeps
			// mixed-ratio rows top-aligned like a loose masonry.
			ctx.effect(function() {
				var style = document.createElement("style");
				style.textContent =
					".agimage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;width:100%;align-items:start}" +
					".agimage-thumb{position:relative;border-radius:8px;overflow:hidden;cursor:zoom-in;line-height:0;background:rgba(128,128,128,0.08)}" +
					".agimage-thumb img{display:block}" +
					".agimage-badge{position:absolute;left:6px;top:6px;background:rgba(0,0,0,0.62);color:#fff;font-size:11px;line-height:1;padding:3px 7px;border-radius:6px;font-family:inherit;pointer-events:none}" +
					".agimage-zoom{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;padding:3px 7px;border-radius:6px;opacity:0;transition:opacity .15s;pointer-events:none;font-family:inherit}" +
					".agimage-thumb:hover .agimage-zoom{opacity:1}" +
					".agimage-expand{width:100%;margin-top:2px;padding:8px;border:none;border-radius:8px;background:rgba(128,128,128,0.12);color:inherit;font-size:13px;font-family:inherit;cursor:pointer}" +
					".agimage-expand:hover{background:rgba(128,128,128,0.2)}" +
					".agimage-modal img{display:block}";
				document.head.appendChild(style);
				return function() { document.head.removeChild(style); };
			});

			function singleFit(attachment) {
				var w = attachment.width;
				var h = attachment.height;
				var ratio = w / h;
				var box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
				var scale = Math.min(1, w / box.width, h / box.height);
				return {
					width: Math.max(1, Math.round(box.width * scale)),
					height: Math.max(1, Math.round(box.height * scale))
				};
			}

			function ImageCard(props) {
				var block = props.block;
				if (block.kind !== "tool-result") {
					return React.createElement("span", { style: { fontSize: "13px", color: "rgba(128,128,128,0.9)" } }, "Generating image...");
				}
				var meta = block.meta;
				var refs = meta && meta.refs ? meta.refs : (meta && meta.ref ? [meta.ref] : []);
				var urls = meta && meta.urls ? meta.urls : [];
				var state = React.useState({ phase: "init", images: [], errs: [] });
				var st = state[0];
				var setSt = state[1];
				React.useEffect(function() {
					if (!meta || meta.shown !== true || refs.length === 0) {
						setSt({ phase: "skip", images: [], errs: [] });
						return;
					}
					var cancelled = false;
					setSt({ phase: "loading", images: new Array(refs.length).fill(null), errs: new Array(refs.length).fill("") });
					// Functional updates accumulate per-index so parallel loads never
					// overwrite each other (fixes "only last image shows" stale-closure bug).
					function mark(idx, url, err) {
						if (cancelled) return;
						setSt(function(prev) {
							var imgs = prev.images.slice();
							var errs = prev.errs.slice();
							if (url !== null) {
								imgs[idx] = url;
								errs[idx] = "";
							} else {
								errs[idx] = err || "load failed";
							}
							return { phase: "done", images: imgs, errs: errs };
						});
					}
					function loadFromRef(idx, ref) {
						var sessions = ctx.get("sessions");
						if (sessions === undefined) { mark(idx, null, "sessions service unavailable"); return; }
						var binding = sessions.binding(props.sessionId);
						if (binding === undefined) { mark(idx, null, "no session binding"); return; }
						binding.session.readAttachment(ref.attachmentId).then(function(result) {
							if (cancelled) return;
							if (!result.ok) {
								mark(idx, null, "readAttachment failed: " + (result.error ? result.error.code : "unknown"));
								return;
							}
							var data = result.value.data;
							var mediaType = result.value.attachment.mediaType;
							var blob = new Blob([data.buffer], { type: mediaType });
							mark(idx, URL.createObjectURL(blob));
						}).catch(function(err) {
							mark(idx, null, "call failed: " + String(err));
						});
					}
					refs.forEach(function(ref, idx) {
						if (cancelled) return;
						// Try direct URL from meta.urls first
						if (urls[idx]) {
							fetch(urls[idx]).then(function(r) {
								if (!r.ok) throw new Error("HTTP " + r.status);
								return r.blob();
							}).then(function(blob) {
								mark(idx, URL.createObjectURL(blob));
							}).catch(function() {
								loadFromRef(idx, ref);
							});
						} else {
							loadFromRef(idx, ref);
						}
					});
					return function() { cancelled = true; };
				}, []);
				React.useEffect(function() {
					return function() {
						st.images.forEach(function(u) { if (u) URL.revokeObjectURL(u); });
					};
				}, [st.images]);
				// Lightbox preview state: selected index or null.
				var previewState = React.useState(null);
				var previewIdx = previewState[0];
				var setPreview = previewState[1];
				// Collapse toggle for large batches.
				var expandState = React.useState(false);
				var expanded = expandState[0];
				var setExpanded = expandState[1];
				var total = refs.length;
				var collapsible = total > COLLAPSE_LIMIT;
				var shown = collapsible && !expanded ? COLLAPSE_LIMIT : total;
				// Close on Escape, navigate on arrow keys.
				React.useEffect(function() {
					if (previewIdx === null) return;
					function onKey(e) {
						if (e.key === "Escape") setPreview(null);
						else if (e.key === "ArrowRight") setPreview((previewIdx + 1) % total);
						else if (e.key === "ArrowLeft") setPreview((previewIdx - 1 + total) % total);
					}
					window.addEventListener("keydown", onKey);
					return function() { window.removeEventListener("keydown", onKey); };
				}, [previewIdx]);
				if (st.phase === "skip") return null;
				// Show error summary if any image failed
				var hasError = st.errs.some(function(e) { return e; });
				if (hasError) {
					return React.createElement("span", { style: { fontSize: "12px", color: "rgba(255,80,80,0.9)" } },
						"Image load error: " + st.errs.filter(Boolean).join("; ")
					);
				}
				if (st.phase === "loading") {
					return React.createElement("span", { style: { fontSize: "13px", color: "rgba(128,128,128,0.9)" } },
						"Loading " + refs.length + " images from local cache...");
				}
				// Masonry thumbnails (CSS columns auto-balance width & interleave
				// mixed aspect ratios). Numbered badge + hover zoom hint.
				var thumbs = [];
				for (var idx = 0; idx < shown; idx++) {
					var imgUrl = st.images[idx];
					if (!imgUrl) {
						thumbs.push(React.createElement("div", { key: idx, className: "agimage-thumb", style: { padding: "12px" } },
							React.createElement("span", { style: { fontSize: "12px", color: "rgba(128,128,128,0.9)" } },
								"Image " + (idx + 1) + " not loaded")));
						continue;
					}
					var fit = refs[idx] && refs[idx].width ? singleFit(refs[idx]) : null;
					thumbs.push(React.createElement("div", {
						key: idx,
						className: "agimage-thumb",
						onClick: function(i) { return function() { setPreview(i); }; }(idx)
					},
						React.createElement("img", {
							src: imgUrl,
							alt: "Generated image " + (idx + 1),
							style: {
								width: "100%",
								height: "auto",
								borderRadius: "8px"
							}
						}),
						React.createElement("span", { className: "agimage-badge" }, idx + 1),
						React.createElement("span", { className: "agimage-zoom" }, "\u2924 \u653e\u5927\u9884\u89c8")
					));
				}
				var container = React.createElement("div", { className: "agimage-grid" }, thumbs);
				// Expand toggle for collapsed batches.
				if (collapsible && !expanded) {
					container = React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
						container,
						React.createElement("button", { className: "agimage-expand", onClick: function() { setExpanded(true); } },
							"\u5c55\u5f00\u5168\u90e8 (" + total + " \u5f20)")
					);
				}
				// Full-screen lightbox when an image is selected.
				if (previewIdx !== null && st.images[previewIdx]) {
					var src = st.images[previewIdx];
					var navBtn = function(label, onClick) {
						return React.createElement("button", {
							onClick: function(e) { e.stopPropagation(); onClick(); },
							style: {
								background: "rgba(255,255,255,0.15)",
								color: "#fff",
								border: "none",
								borderRadius: "8px",
								width: 40,
								height: 40,
								fontSize: "20px",
								lineHeight: "38px",
								cursor: "pointer",
								padding: 0
							}
						}, label);
					};
					var closeBtn = React.createElement("button", {
						onClick: function(e) { e.stopPropagation(); setPreview(null); },
						style: {
							background: "rgba(255,255,255,0.15)",
							color: "#fff",
							border: "none",
							borderRadius: "8px",
							width: 32,
							height: 32,
							fontSize: "18px",
							lineHeight: "30px",
							cursor: "pointer",
							padding: 0
						}
					}, "\u00d7");
					var downloadLink = React.createElement("a", {
						href: src,
						download: "generated_image_" + (previewIdx + 1) + ".png",
						onClick: function(e) { e.stopPropagation(); },
						style: {
							color: "#fff",
							textDecoration: "none",
							fontSize: "13px",
							background: "rgba(255,255,255,0.15)",
							padding: "7px 14px",
							borderRadius: "8px",
							cursor: "pointer",
							display: "inline-block"
						}
					}, "\u4e0b\u8f7d");
					var topBar = React.createElement("div", {
						style: {
							position: "absolute",
							top: 0,
							left: 0,
							right: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							padding: "14px 18px",
							boxSizing: "border-box"
						}
					},
						React.createElement("span", { style: { color: "rgba(255,255,255,0.85)", fontSize: "13px" } },
							"Image " + (previewIdx + 1) + "/" + total),
						React.createElement("div", { style: { display: "flex", gap: "10px", alignItems: "center" } },
							downloadLink,
							closeBtn
						)
					);
					var fullImg = React.createElement("img", {
						src: src,
						alt: "Preview",
						onClick: function(e) { e.stopPropagation(); },
						style: {
							maxWidth: "92vw",
							maxHeight: "86vh",
							objectFit: "contain",
							borderRadius: "4px",
							boxShadow: "0 8px 40px rgba(0,0,0,0.5)"
						}
					});
					var leftBtn = total > 1
						? React.createElement("div", { style: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", zIndex: 2 } },
							navBtn("\u2039", function() { setPreview((previewIdx - 1 + total) % total); }))
						: null;
					var rightBtn = total > 1
						? React.createElement("div", { style: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 2 } },
							navBtn("\u203a", function() { setPreview((previewIdx + 1) % total); }))
						: null;
					var modal = React.createElement("div", {
						className: "agimage-modal",
						onClick: function() { setPreview(null); },
						style: {
							position: "fixed",
							inset: 0,
							zIndex: 9999,
							background: "rgba(0,0,0,0.85)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: "24px",
							cursor: "zoom-out",
							boxSizing: "border-box"
						}
					}, topBar, leftBtn, rightBtn, fullImg);
					return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
						container, modal);
				}
				return container;
			}

			ctx.slots.inject("tool.call.toolview", function() {
				return ctx.slots.register({
					name: "tool.call.toolview",
					key: "generate_image"
				}, ImageCard);
			});
		};
		return module.exports;
	}
});
