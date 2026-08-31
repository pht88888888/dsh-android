/**
 * dsh-agimage — host half (mobile port: Node fetch instead of pwsh).
 *
 * Static form of the former dynamic plugin `img-2`: registers the
 * `generate_image` model tool. Uses Node global fetch (Node 20+).
 * Downloads PNG, saves as attachment for conversation display.
 */

import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const name = "dsh-agimage";
export const inject = ["tools", "webServer", "webRuntime"];

const DEFAULT_ENDPOINT = "https://api.agnes-ai.cn/v1";
const DEFAULT_API_KEY = "sk-2BsAqJq1OrbcQBfUPhHLZVclSxZn0SwZtaHkXymAlX6kC4GX";
const MODEL = "agnes-image-2.1-flash";

function agConfigPath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, "ag-multimodal.json");
}
function agLogPath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, "ag-image.log");
}
function appendLog(record) {
	try { appendFileSync(agLogPath(), JSON.stringify(record) + "\n", "utf8"); } catch {}
}
function readAccounts() {
	try {
		const parsed = JSON.parse(readFileSync(agConfigPath(), "utf8"));
		if (parsed && typeof parsed === "object") {
			if (Array.isArray(parsed.accounts)) {
				const accs = parsed.accounts.filter(a => a && typeof a.endpoint === "string" && typeof a.key === "string" && a.key.trim().length > 0)
					.map(a => ({ endpoint: a.endpoint, key: a.key.trim() }));
				if (accs.length > 0) return accs;
			}
			if (typeof parsed.agnesApiKey === "string" && parsed.agnesApiKey.trim().length > 0)
				return [{ endpoint: DEFAULT_ENDPOINT, key: parsed.agnesApiKey.trim() }];
		}
	} catch {}
	return [{ endpoint: DEFAULT_ENDPOINT, key: DEFAULT_API_KEY }];
}
function resolveImageToDataUri(path, dshHome) {
	if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
	// sha256 hex -> attachment store
	const m = path.match(/^([0-9a-fA-F]{64})$/);
	if (m) {
		const h = m[1].toLowerCase();
		const p = join(dshHome, "attachments", "v1", "objects", h.slice(0, 2), h);
		return readFileToDataUri(p);
	}
	// local file path
	return readFileToDataUri(path);
}
function readFileToDataUri(filePath) {
	try {
		const bytes = readFileSync(filePath);
		const ext = filePath.toLowerCase().split(".").pop();
		const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "image/png";
		return "data:" + mime + ";base64," + bytes.toString("base64");
	} catch { return ""; }
}

export function apply(ctx) {
	const sleep = (ms) => new Promise(r => setTimeout(r, ms));
	ctx.tools.register({
		name: "generate_image",
		description:
			"Generate or edit images with the Agnes AI image API (agnes-image-2.1-flash). "
			+ "prompt is an array of instructions — each generates one image. "
			+ "WHEN THE USER ATTACHES/SENDS AN IMAGE AND ASKS TO MODIFY, TRANSFORM, STYLE-TRANSFER, OR COMBINE IT: "
			+ "this tool DOES support image editing — pass the user's image in the image parameter. "
			+ "The user's attached image appears in your context as 'Image sha256:<64-hex>'; "
			+ "put that 64-character hex value into the image parameter (the plugin resolves it automatically). "
			+ "1 image = img2img edit; 2+ images = multi-image composition. "
			+ "You may also pass a local file path, a public HTTPS URL, or a data-URI base64 as an image entry. "
			+ "size accepts tiers 1K/2K/3K/4K (optionally combined with ratio, e.g. size=2K ratio=16:9) or legacy exact sizes. "
			+ "Images are displayed in the conversation UI by default (cached locally); pass show=false only for very large batches to skip display. "
			+ "The generated images are shown to the USER in the UI, never to you: "
			+ "the tool result returns only plain text — a success note plus each requested prompt. "
			+ "Do not echo image URLs, base64, or binary data into the conversation; "
			+ "when you summarize the result, describe the images according to the requested prompts.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				prompt: { type: "array", items: { type: "string" }, description: "Array of image prompts." },
				size: { type: "string", enum: ["1K", "2K", "3K", "4K", "1024x768", "768x1024", "1024x1024"], description: "Output size. Default: 1K" },
				ratio: { type: "string", enum: ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"], description: "Aspect ratio." },
				image: { type: "array", items: { type: "string" }, description: "Reference images (sha256 hex, local path, URL, data URI)." },
				show: { type: "boolean", description: "Show images in UI. Default: true." }
			},
			required: ["prompt"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: {
								url: { type: "string" },
								task_id: { type: "string" },
								localPath: { type: "string" },
								attachmentRef: { type: "object" }
							}
						}
					}
				}
			},
			render: (args, value) => {
				const prompts = Array.isArray(args.prompt) ? args.prompt : [args.prompt];
				const results = Array.isArray(value.results) ? value.results : [value];
				const texts = prompts.map((p, i) => {
					const r = results[i] || {};
					return "[agnes-plugin] Image " + (i + 1) + "/" + results.length + " generated successfully.\nRequested prompt: " + p
						+ (r.localPath ? "\nlocalPath: " + r.localPath : "");
				});
				return [{ type: "text", text: texts.join("\n\n") }];
			},
			presentationMeta: (args, value) => {
				const prompts = Array.isArray(args.prompt) ? args.prompt : [args.prompt];
				const results = Array.isArray(value.results) ? value.results : [value];
				const refs = results.map(r => r.attachmentRef || null);
				return {
					shown: args.show !== false,
					ref: refs.filter(Boolean),
					prompt: prompts[0] || "",
					prompts: prompts,
					refs: refs,
					urls: results.map((r, i) => r.task_id ? "/agimage/img?ref=" + encodeURIComponent(JSON.stringify(refs[i])) : null)
				};
			}
		},
		async execute(args, exec) {
			const prompts = Array.isArray(args.prompt) ? args.prompt : [args.prompt];
			const size = args.size || "1K";
			const show = args.show !== false;
			const images = Array.isArray(args.image) ? args.image.filter(x => typeof x === "string" && x.length > 0) : [];
			const accounts = readAccounts();
			const attachments = ctx.get("attachments");
			const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
			const tmpDir = process.env.TMPDIR && process.env.TMPDIR.length > 0 ? process.env.TMPDIR : join(homedir(), "tmp");
			const aborted = () => exec.signal !== undefined && exec.signal.aborted;

			const attempt = async (prompt, idx, account) => {
				const imageUrl = account.endpoint.replace(/\/+$/, "") + "/images/generations";
				const apiKey = account.key;
				const body = { model: MODEL, prompt, size };
				if (args.ratio !== undefined && ["1K","2K","3K","4K"].includes(size))
					body.ratio = args.ratio;
				const extra = { response_format: "url" };
				if (images.length > 0) {
					extra.image = images.map(p => resolveImageToDataUri(p, dshHome)).filter(Boolean);
				}
				body.extra_body = extra;
				// POST
				const resp = await fetch(imageUrl, {
					method: "POST",
					headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
					body: JSON.stringify(body)
				});
				if (!resp.ok) {
					const msg = "HTTP " + resp.status + " " + resp.statusText;
					appendLog({ t: new Date().toISOString(), phase: "attempt", idx, msg });
					return { ok: false, status: resp.status, message: msg };
				}
				const data = await resp.json();
				if (!data || !data.data || !data.data.length)
					return { ok: false, status: 0, message: "Unexpected API response" };
				const task = data.task_id;
				let url = "", buf = null;
				if (data.data[0].url) {
					const imgResp = await fetch(data.data[0].url);
					if (!imgResp.ok) return { ok: false, status: 0, message: "download failed" };
					buf = Buffer.from(await imgResp.arrayBuffer());
					url = data.data[0].url;
				} else if (data.data[0].b64_json) {
					buf = Buffer.from(data.data[0].b64_json, "base64");
				} else {
					return { ok: false, status: 0, message: "no url or b64 in response" };
				}
				// Write to TMPDIR for localPath (writable on Android)
				let file = "";
				try {
					const p = join(tmpDir, task + ".png");
					mkdirSync(dirname(p), { recursive: true });
					writeFileSync(p, buf);
					file = p;
				} catch { /* non-fatal: localPath omitted */ }
				// Save attachment directly from memory (no fs service needed)
				let attachmentRef = null;
				if (show && attachments !== undefined) {
					try {
						attachmentRef = await attachments.saveImage({ data: buf, mediaType: "image/png", name: "generated_image_" + idx + ".png" });
					} catch (e) {
						appendLog({ t: new Date().toISOString(), phase: "save-attachment", idx, msg: String(e) });
					}
				}
				return { ok: true, status: 0, url, task_id: task, file, attachmentRef };
			};

			const CN_MARKER = "api.agnes-ai.cn";
			const intlPool = accounts.filter(a => !a.endpoint.includes(CN_MARKER));
			const activePool = intlPool.length > 0 ? intlPool : accounts;
			const capacity = activePool.length * 10;
			const jobs = prompts.map((prompt, idx) => ({ prompt, idx, state: "pending", result: null }));
			let rrIdx = 0;
			const nextAcc = () => { const a = activePool[rrIdx % activePool.length]; rrIdx += 1; return a; };
			const finishJob = async (job, result) => {
				const response = { task_id: result.task_id };
				if (result.url) response.url = result.url;
				if (result.file) response.localPath = result.file;
				if (result.attachmentRef) response.attachmentRef = result.attachmentRef;
				job.result = response;
				job.state = "done";
			};
			let throttleHits = 0, lastCooldown = 0;
			const THROTTLE_TRIGGER = 12, THROTTLE_COOLDOWN_MS = 30000;
			const RPM_WINDOW_MS = 60000, RPM_LIMIT = 20;
			const keyWindows = new Map();
			const acquireKey = async (key) => {
				let arr = keyWindows.get(key);
				if (arr === undefined) { arr = []; keyWindows.set(key, arr); }
				for (;;) {
					if (aborted()) throw new Error("Cancelled");
					const now = Date.now();
					while (arr.length > 0 && arr[0] <= now - RPM_WINDOW_MS) arr.shift();
					if (arr.length < RPM_LIMIT) { arr.push(now); return; }
					await sleep(arr[0] - (now - RPM_WINDOW_MS) + 100);
				}
			};
			const runJob = async (job) => {
				let backoff = 2000;
				for (let a = 1; a <= 8; a++) {
					if (aborted()) throw new Error("Image " + (job.idx + 1) + " cancelled");
					if (job.state === "done") return;
					const acc = nextAcc();
					await acquireKey(acc.key);
					let result;
					try { result = await attempt(job.prompt, job.idx, acc); } catch (error) {
						result = { ok: false, status: -1, message: "throw: " + (error?.message || String(error)) };
					}
					appendLog({ t: new Date().toISOString(), phase: "image", idx: job.idx, key: acc.key.slice(0, 10), endpoint: acc.endpoint, status: result.status, ok: result.ok === true, msg: result.message || "", attempt: a });
					if (result.ok === true) { await finishJob(job, result); return; }
					if (result.status === 429 || result.status === 401) {
						throttleHits += 1;
						if (throttleHits >= THROTTLE_TRIGGER && Date.now() - lastCooldown > THROTTLE_COOLDOWN_MS * 2) {
							lastCooldown = Date.now(); throttleHits = 0;
							appendLog({ t: new Date().toISOString(), phase: "breaker", idx: job.idx, msg: "cooldown " + THROTTLE_COOLDOWN_MS + "ms" });
							await sleep(THROTTLE_COOLDOWN_MS); continue;
						}
					}
					await sleep(backoff);
					backoff = Math.min(16000, backoff * 2);
				}
				job.state = "failed";
			};
			for (let i = 0; i < jobs.length; i += capacity) {
				if (i > 0) await sleep(5000);
				await Promise.all(jobs.slice(i, i + capacity).map(runJob));
			}
			const results = jobs.map(j => j.result);
			const failed = jobs.filter(j => j.state !== "done");
			if (failed.length > 0)
				throw new Error(failed.length + " image(s) failed: " + failed.map(j => j.idx + 1).join(", "));
			return { results };
		}
	});
	// Route to serve images via attachment store
	ctx.webServer.register({
		kind: "exact", path: "/agimage/img",
		handler: async (req, res) => {
			const host = typeof req.headers.host === "string" ? req.headers.host : "";
			const trustedHosts = ctx.webRuntime?.trustedHosts || [];
			const isTrusted = (() => {
				try {
					const hostUrl = new URL("http://" + host);
					if (hostUrl.hostname === "localhost" || hostUrl.hostname === "127.0.0.1" || hostUrl.hostname === "[::1]") return true;
					return trustedHosts.some(e => { try { return new URL("http://" + e).host === hostUrl.host; } catch { return false; } });
				} catch { return false; }
			})();
			if (!isTrusted) { res.writeHead(403); res.end(); return; }
			const q = req.url.indexOf("?");
			const query = q >= 0 ? req.url.slice(q + 1) : "";
			if (q < 0 || req.url.slice(0, q) !== "/agimage/img") { res.writeHead(404); res.end(); return; }
			let ref;
			try { ref = JSON.parse(decodeURIComponent(new URLSearchParams(query).get("ref") || "")); } catch { res.writeHead(400); res.end(); return; }
			if (!ref || typeof ref.attachmentId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(ref.attachmentId)) { res.writeHead(400); res.end(); return; }
			const att = ctx.get("attachments");
			if (!att) { res.writeHead(500); res.end(); return; }
			try {
				const stored = await att.readImage(ref, undefined);
				res.writeHead(200, { "content-type": stored.attachment?.mediaType || "image/png", "cache-control": "public, max-age=3600" });
				res.end(Buffer.from(stored.data));
			} catch { res.writeHead(404); res.end(); }
		}
	});
}
