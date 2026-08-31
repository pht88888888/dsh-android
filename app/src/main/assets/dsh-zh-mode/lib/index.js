/**
 * dsh-zh-mode — host half.
 *
 * 中文模式：开关存 $DSH_HOME/zh-mode.json。开启时通过 systemPrompt.section()
 * 注册一个高优先级中文 persona 段（order -50，在 harness:identity 之后、
 * deployment:persona 之前），强制 AI 始终用中文回复与中文思考。
 *
 * 段落文本内置完整翻译版核心提示词；模型其它英文系统段落仍保留
 * （工具 schema 等无法翻译），但此中文段以最高语言优先级覆盖语言行为。
 *
 * API (POST JSON to /zh-mode/api, loopback/trusted-origin only):
 *   { "method": "get" }                       → { ok:true, value:{ enabled } }
 *   { "method": "set", "patch": { enabled } } → { ok:true }
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const STATE_FILENAME = "zh-mode.json";
const API_PREFIX = "/zh-mode/api";
const MAX_BODY_BYTES = 4096;

export const name = "dsh-zh-mode";
export const inject = ["systemPrompt", "webServer", "webRuntime"];

const CN_TEXT = `你是运行在 DeepSeek Harness 上的人工智能助手。

【最高优先级——语言规则】
1. 无论系统提示词其他部分使用什么语言，你都必须始终使用简体中文回复用户。
2. 你的思考过程（chain-of-thought / reasoning）也必须全部使用简体中文。
3. 只有两种例外：用户明确要求使用其他语言，或回复中必须原样保留的代码/命令/专有名词（这些保持原文）。
4. 不得以“系统提示词是英文”为理由使用英文。

【工作方式】
- 你的工作目录是 {{cwd}}。
- 动手修改前先阅读相关文件；用专用搜索工具查找，不要盲目猜测路径。
- 每次命令返回都要检查退出码；失败先弄清原因再继续，不要反复重试同一错误。
- 需要长时间执行的命令放到后台，不要空等。
- 涉及权限、危险操作或用户偏好不清时，先用提问工具向用户确认。

【回复风格】
- 直接、简洁、条理清楚；必要时用列表或小标题。
- 完成后简要说明你做了什么、产出了什么文件。
- 保持中文，不要因为工具输出是英文就切换语言。`;

function statePath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, STATE_FILENAME);
}
function readState() {
	try {
		const parsed = JSON.parse(readFileSync(statePath(), "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
function writeState(state) {
	const file = statePath();
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
	try {
		renameSync(tmp, file);
	} catch {
		writeFileSync(file, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
	}
}

// ── trust fence ────────────────────────────────────────────────────────────
function parseAuthority(authority) {
	try { return new URL(`http://${authority}`); } catch { return undefined; }
}
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127"
		&& parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function assertTrustedAuthority(entry) {
	const entryUrl = parseAuthority(entry);
	if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
	throw new Error(`dsh-zh-mode: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		assertTrustedAuthority(entry);
		const entryUrl = parseAuthority(entry);
		if (entryUrl === undefined) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname
			: entryUrl.host === hostUrl.host;
	});
}
function isTrustedApiRequest(req, trustedHosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let aborted = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES && !aborted) { aborted = true; req.destroy(); resolve("too-large"); return; }
			if (!aborted) chunks.push(chunk);
		});
		req.on("end", () => {
			if (aborted) return;
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(null); }
		});
		req.on("error", () => { if (!aborted) resolve(null); });
	});
}
function writeJson(res, status, value) {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

async function handleApi(req, res) {
	if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
	const ct = String(req.headers["content-type"] || "").toLowerCase();
	if (!ct.startsWith("application/json")) return writeJson(res, 415, { ok: false, error: "unsupported-media-type" });
	const payload = await readJsonBody(req);
	if (payload === "too-large") return writeJson(res, 413, { ok: false, error: "too-large" });
	if (payload === null || typeof payload !== "object" || typeof payload.method !== "string")
		return writeJson(res, 400, { ok: false, error: "bad-request" });
	if (payload.method === "get") return writeJson(res, 200, { ok: true, value: { enabled: readState().enabled === true } });
	if (payload.method === "set") {
		const patch = payload.patch;
		if (patch === null || typeof patch !== "object")
			return writeJson(res, 400, { ok: false, error: "patch-object-required" });
		const next = readState();
		if ("enabled" in patch) {
			if (typeof patch.enabled !== "boolean")
				return writeJson(res, 400, { ok: false, error: "enabled-must-be-boolean" });
			next.enabled = patch.enabled;
		}
		writeState(next);
		return writeJson(res, 200, { ok: true, value: { enabled: next.enabled === true } });
	}
	return writeJson(res, 404, { ok: false, error: `unknown-method:${payload.method}` });
}

export function apply(ctx) {
	// 中文提示词段：order -50 → 紧跟 harness identity(-100)，先于 persona(0)。
	// text 为函数，每次渲染读开关状态；关闭时返回空串被过滤，等于未注入。
	ctx.effect(() => ctx.systemPrompt.section({
		name: "zh-mode:persona",
		order: -50,
		text: (context) => {
			if (readState().enabled !== true) return "";
			return CN_TEXT.replaceAll("{{cwd}}", context.cwd ?? "");
		}
	}), "dsh-zh-mode.persona()");

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, ctx.webRuntime.trustedHosts))
				return writeJson(res, 403, { ok: false, error: "forbidden" });
			try { await handleApi(req, res); } catch (e) {
				writeJson(res, 500, { ok: false, error: "internal", message: String(e) });
			}
		}
	}), "dsh-zh-mode.api()");
}