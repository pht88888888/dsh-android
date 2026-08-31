// dsh-agvideo — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-agvideo/client.js and executed
// through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with require()
// resolved against the shell's module table.
//
// Registers a custom tool-card view for `generate_video` calls: renders the
// finished MP4(s) as playable video cards, each fitted to 240px max
// (mirroring the dsh-agimage image card size, aspect ratio preserved via
// height:auto). Handles both single videos (meta.url) and batches produced by
// an array prompt (meta.videos).

window.__ModuleLoader__.load({
	id: "dsh-agvideo",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			function VideoCard(props) {
				var block = props.block;
				if (block.kind !== "tool-result") {
					return React.createElement("span", { style: { fontSize: "13px", color: "rgba(128,128,128,0.9)" } }, "Generating video...");
				}
				var meta = block.meta;
				if (!meta || meta.shown !== true) {
					return React.createElement("span", { style: { fontSize: "13px", color: "rgba(128,128,128,0.9)" } }, "Video not available");
				}
				var list = meta.videos && meta.videos.length > 0 ? meta.videos : (meta.url ? [{ url: meta.url, prompt: meta.prompt }] : []);
				if (list.length === 0) {
					return React.createElement("span", { style: { fontSize: "13px", color: "rgba(128,128,128,0.9)" } }, "Video not available");
				}
				if (list.length === 1) {
					return React.createElement("video", {
						src: list[0].url,
						controls: true,
						style: { maxWidth: "240px", width: "100%", height: "auto", borderRadius: "8px", display: "block" }
					});
				}
				return React.createElement(
					"div",
					{ style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
					list.map(function(v, i) {
						return React.createElement("video", {
							key: i,
							src: v.url,
							controls: true,
							style: { maxWidth: "240px", width: "100%", height: "auto", borderRadius: "8px", display: "block" }
						});
					})
				);
			}

			ctx.slots.inject("tool.call.toolview", function() {
				return ctx.slots.register({
					name: "tool.call.toolview",
					key: "generate_video"
				}, VideoCard);
			});
		};
		return module.exports;
	}
});
