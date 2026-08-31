/**
 * dsh-agvideo — host half (mobile port: Node fetch instead of pwsh).
 *
 * Static form of `agvid-video`: registers `generate_video` tool. Uses Node
 * global fetch for task create, poll, download. Three modes: text / keyframe /
 * reference.
 */

export const name = "dsh-agvideo";
export const inject = ["tools"];

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const DEFAULT_ENDPOINT = "https://api.agnes-ai.cn/v1";
const DEFAULT_API_KEY = "sk-2BsAqJq1OrbcQBfUPhHLZVclSxZn0SwZtaHkXymAlX6kC4GX";
const MODEL = "agnes-video-2.5-flash";

function agConfigPath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, "ag-multimodal.json");
}
function endpointRoot(endpoint) {
	return endpoint.replace(/\/v1\/?$/, "");
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
function resolveMediaToDataUri(path, dshHome) {
	if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
	const m = path.match(/^([0-9a-fA-F]{64})$/);
	if (m) {
		const h = m[1].toLowerCase();
		return readFileToDataUri(join(dshHome, "attachments", "v1", "objects", h.slice(0, 2), h));
	}
	return readFileToDataUri(path);
}
function readFileToDataUri(filePath) {
	try {
		const bytes = readFileSync(filePath);
		const ext = filePath.toLowerCase().split(".").pop();
		const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] || "image/png";
		return "data:" + mime + ";base64," + bytes.toString("base64");
	} catch { return ""; }
}

// ── per-account hard rate limit: each account ≤ 1 task per minute ──────────
const VIDEO_RPM_MS = 60000;
const accountBusy = new Map();
let rrIndex = 0;
function pickVideoAccount(accounts) {
	const n = accounts.length;
	for (let i = 0; i < n; i++) {
		const idx = (rrIndex + i) % n;
		const last = accountBusy.get(idx) || 0;
		if (Date.now() - last >= VIDEO_RPM_MS) {
			rrIndex = (idx + 1) % n;
			accountBusy.set(idx, Date.now());
			return { account: accounts[idx], waitSec: 0 };
		}
	}
	let minRemain = Infinity;
	for (let i = 0; i < n; i++) {
		const remain = VIDEO_RPM_MS - (Date.now() - (accountBusy.get(i) || 0));
		if (remain < minRemain) minRemain = remain;
	}
	return { account: null, waitSec: Math.max(1, Math.ceil(minRemain / 1000)) };
}

export function apply(ctx) {
	const sleep = (ms) => new Promise(r => setTimeout(r, ms));

	async function createAndPoll(jobArgs, apiKey, createBase, queryBase, exec) {
		const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
		const tmpDir = process.env.TMPDIR && process.env.TMPDIR.length > 0 ? process.env.TMPDIR : join(homedir(), "tmp");
		const aborted = () => exec.signal !== undefined && exec.signal.aborted;

		const mode = jobArgs.mode || "text";
		const body = {
			model: MODEL,
			prompt: String(jobArgs.prompt || ""),
			mode,
			seconds: String(jobArgs.seconds || "5"),
			size: "720P",
			aspect_ratio: jobArgs.aspect_ratio || "16:9"
		};
		if (typeof jobArgs.seed === "number") body.seed = jobArgs.seed;
		if (mode === "keyframe") {
			if (jobArgs.first_frame) body.first_frame = resolveMediaToDataUri(String(jobArgs.first_frame), dshHome);
			if (jobArgs.last_frame) body.last_frame = resolveMediaToDataUri(String(jobArgs.last_frame), dshHome);
			if (!body.first_frame && !body.last_frame) throw new Error("keyframe mode needs first_frame and/or last_frame");
		}
		if (mode === "reference") {
			const imgs = Array.isArray(jobArgs.images) ? jobArgs.images.map(i => resolveMediaToDataUri(String(i), dshHome)).filter(Boolean) : [];
			if (imgs.length > 0) body.images = imgs;
			if (Array.isArray(jobArgs.audios) && jobArgs.audios.length > 0) body.audios = jobArgs.audios.map(String);
			if (!body.images && !body.audios) throw new Error("reference mode needs images and/or audios");
		}
		// Create
		const resp = await fetch(createBase, {
			method: "POST",
			headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
			body: JSON.stringify(body)
		});
		if (!resp.ok) return { ok: false, status: resp.status, message: "HTTP " + resp.status + " " + resp.statusText };
		const created = await resp.json();
		const vid = created.video_id;
		if (!vid) return { ok: false, status: 0, message: "no video_id in response" };

		// Poll
		const deadline = Date.now() + 10 * 60 * 1000;
		const queryUrl = queryBase + "?video_id=" + encodeURIComponent(vid) + "&model_name=" + encodeURIComponent(MODEL);
		let result = { ok: false, status: "timeout", video_id: vid };
		while (Date.now() < deadline) {
			if (aborted()) throw new Error("Video generation cancelled");
			await sleep(3000);
			let q;
			try {
				const qr = await fetch(queryUrl, { headers: { "Authorization": "Bearer " + apiKey } });
				if (qr.status === 429) { await sleep(6000); continue; }
				if (!qr.ok) continue;
				q = await qr.json();
			} catch { continue; }
			if (q.status === "completed") {
				const taskFile = join(tmpDir, vid + ".mp4");
				try {
					const mr = await fetch(q.url);
					if (mr.ok) {
						const buf = Buffer.from(await mr.arrayBuffer());
						mkdirSync(dirname(taskFile), { recursive: true });
						writeFileSync(taskFile, buf);
						result = { ok: true, status: "completed", video_id: vid, url: q.url, file: taskFile };
					} else {
						result = { ok: true, status: "completed", video_id: vid, url: q.url, file: "", download_error: "failed" };
					}
				} catch {
					result = { ok: true, status: "completed", video_id: vid, url: q.url, file: "", download_error: "failed" };
				}
				break;
			}
			if (q.status === "failed") {
				result = { ok: false, status: "failed", video_id: vid, message: JSON.stringify(q.error || "") };
				break;
			}
		}
		return result;
	}

	ctx.tools.register({
		name: "generate_video",
		description:
			"Generate a short AI video with the Agnes AI video API (agnes-video-2.5-flash, currently free, 720P only). "
			+ "When the user supplies images, CHOOSE THE MODE BY INTENT:\n"
			+ "- reference: the user wants the character/subject IN the image to PERFORM A NEW ACTION (dance, run, walk, turn, act) while keeping its appearance/style — pass the image(s) in images and refer to them as <Picture N> in the prompt. Best when the user describes an action or motion for the subject.\n"
			+ "- keyframe: the user wants THE IMAGE ITSELF to come alive as the video first frame — same exact composition as the image, then camera movement or subtle motion (push-in, pan, wind, lighting). Pass the image in first_frame (optionally last_frame). Best when the user says things like \"make this image move\", \"camera push in on this\", or only describes camera/animation on the still scene.\n"
			+ "- text: no image provided, prompt-only.\n"
			+ "A single uploaded portrait + 'make this character dance' → reference. A single image + 'animate this scene, slow zoom' → keyframe. If in doubt with one still image and an action verb, prefer reference.\n"
			+ "seconds is a string 4-12 (default 5); aspect_ratio: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 (default 16:9). Media (first_frame/last_frame/images) accept public HTTPS URLs, local file paths, or the 64-char sha256 hex of a user-attached image (from 'Image sha256:...' in the user message) — the plugin resolves them. "
			+ "Generation is asynchronous and takes roughly 30s-2min; the plugin polls until done and the videos play in the conversation UI. "
			+ "prompt accepts a single string OR an array of strings: an array generates multiple videos in ONE call, "
			+ "each taking one account slot and running concurrently (N configured accounts = N concurrent videos; "
			+ "extra prompts queue until a slot frees on the 1 video/min per-account limit). "
			+ "The videos are shown to the USER in the UI, never to you: the tool result returns only plain text. Do not echo video URLs or binary data.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				prompt: { type: ["string", "array"], description: "Video content description, or array of descriptions. Reference mode can use <Picture N> and <Audio N>." },
				mode: { type: "string", enum: ["text", "keyframe", "reference"], description: "Workflow mode." },
				seconds: { type: "string", enum: ["4", "5", "6", "7", "8", "9", "10", "11", "12"], description: "Duration string. Default: '5'" },
				aspect_ratio: { type: "string", enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], description: "Aspect ratio. Default: 16:9." },
				first_frame: { type: "string", description: "First frame image (URL/local path/sha256). keyframe mode." },
				last_frame: { type: "string", description: "End frame image. keyframe mode." },
				images: { type: "array", items: { type: "string" }, description: "Reference images. reference mode." },
				audios: { type: "array", items: { type: "string" }, description: "Reference audio URLs. reference mode." },
				seed: { type: "integer", description: "Random seed." },
				show: { type: "boolean", description: "Show video card. Default: true." }
			},
			required: ["prompt"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					video_id: { type: "string" },
					url: { type: "string" },
					status: { type: "string" },
					videos: { type: "array", items: { type: "object", additionalProperties: true } }
				}
			},
			render: (args, value) => {
				const list = Array.isArray(value.videos) && value.videos.length > 0 ? value.videos : [value];
				const lines = list.map((v, i) => {
					const base = "[agnes-plugin] Video " + (i + 1) + "/" + list.length + " generated successfully.\nvideo_id: " + (v.video_id || "") + "\nRequested prompt: " + String(v.prompt !== undefined ? v.prompt : (Array.isArray(args.prompt) ? args.prompt[i] : args.prompt || ""));
					return v.localPath ? base + "\nlocalPath: " + v.localPath : base;
				});
				return [{ type: "text", text: lines.join("\n\n") }];
			},
			presentationMeta: (args, value) => {
				const list = Array.isArray(value.videos) && value.videos.length > 0 ? value.videos : [value];
				return { shown: args.show !== false, videos: list.map(v => ({ url: v.url || "", video_id: v.video_id || "", prompt: String(v.prompt !== undefined ? v.prompt : (Array.isArray(args.prompt) ? args.prompt : args.prompt || "")) })) };
			}
		},
		async execute(args, exec) {
			const accounts = readAccounts();
			const rawPrompts = Array.isArray(args.prompt)
				? args.prompt.map(p => (p === null || p === undefined ? "" : String(p)))
				: [args.prompt === null || args.prompt === undefined ? "" : String(args.prompt)];
			const prompts = rawPrompts.filter(p => p.trim().length > 0);
			if (prompts.length === 0) throw new Error("prompt required");
			const aborted = () => exec.signal !== undefined && exec.signal.aborted;
			const runOne = async (prompt) => {
				for (;;) {
					if (aborted()) throw new Error("Video generation cancelled");
					const pick = pickVideoAccount(accounts);
					if (pick.account === null) { await sleep(Math.max(1000, pick.waitSec * 1000)); continue; }
					const account = pick.account;
					const createBase = account.endpoint.replace(/\/+$/, "") + "/videos";
					const queryBase = endpointRoot(account.endpoint) + "/agnesapi";
					const jobArgs = Object.assign({}, args, { prompt });
					const MAX_ATTEMPTS = 3;
					for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
						const result = await createAndPoll(jobArgs, account.key, createBase, queryBase, exec);
						if (result.ok === true) return { video_id: result.video_id, url: result.url, status: result.status, prompt, localPath: result.file || "" };
						if (result.status === "failed" || result.status === "timeout")
							throw new Error(result.status === "failed" ? "Video failed: " + (result.message || "") : "Video timed out after 10 minutes");
						if (attempt >= MAX_ATTEMPTS)
							throw new Error("Video create failed after " + attempt + " attempts: " + (result.message || "unknown error"));
						await sleep(3000);
					}
				}
			};
			const videos = await Promise.all(prompts.map(runOne));
			if (prompts.length === 1) {
				const v = videos[0];
				return { video_id: v.video_id, url: v.url, status: v.status, localPath: v.localPath || "", videos };
			}
			return { videos, status: "completed" };
		}
	});
}
