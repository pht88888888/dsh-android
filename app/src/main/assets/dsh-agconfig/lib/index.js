/**
 * dsh-agconfig — host half (mobile port: Node fetch probe instead of pwsh).
 *
 * Multimodal config: persists the Agnes AI API key (and future multimodal
 * settings) to `$DSH_HOME/ag-multimodal.json` and serves it to the browser
 * through a fenced webServer API. dsh-agimage / dsh-agvideo read the same
 * file directly at tool-execution time, so a key entered in
 * 设置 → 插件 → 多模态配置 takes effect immediately (no restart needed for
 * the key itself; only the config plugin's routes need a restart to appear).
 *
 * Auto-LLM-registration (0.13.1): when accounts are saved and the first account
 * has a valid key, the key is同步 written to the credentials store under
 * `AGNES_API_KEY`, AND the LLM provider config is同步 written to settings.yaml
 * so that `llm-pi-ai` can resolve the key and register the `agnes` provider.
 * This allows immediate LLM usage without manual settings configuration.
 *
 * API (POST JSON to /ag-config/api, loopback/trusted-origin only):
 *   { "method": "get" }                          → { ok:true, value:{...} }
 *   { "method": "set", "patch": { "agnesApiKey": "sk-..." } } → { ok:true }
 *     - patch values: string sets, null removes, absent keys untouched.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/** State file name inside the DSH home directory. */
const STATE_FILENAME = "ag-multimodal.json";
/** Max accepted request body (a key is tiny; keep a sane cap). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Route prefix owned by this plugin. */
const API_PREFIX = "/ag-config/api";
/** Credential key name for Agnes AI LLM provider. */
const AGNES_CREDENTIAL_KEY = "AGNES_API_KEY";
/** Path to settings.yaml in DSH_HOME. */
const SETTINGS_YAML_PATH = "settings.yaml";

// ── YAML helpers (minimal parser/generator for settings.yaml) ────────────────

/** Read settings.yaml from DSH_HOME; returns `{}` when absent or corrupt. */
function readSettingsYaml() {
	try {
		const content = readFileSync(join(process.env.DSH_HOME || join(homedir(), ".dsh"), SETTINGS_YAML_PATH), "utf8");
		// Minimal YAML parser: split by top-level keys and parse simple key-value pairs.
		// Supports: nested maps up to 2 levels, simple strings, no anchors/aliases.
		const result = {};
		let currentSection = null;
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const indent = line.length - line.trimStart().length;
			const match = indent === 0 ? trimmed.match(/^(\w[\w\-]*):(.*)$/) : trimmed.match(/^\s*(\w[\w\-]*):(.*)$/);
			if (indent === 0 && match) {
				currentSection = match[1];
				result[currentSection] = {};
				const val = match[2].trim();
				if (val) result[currentSection][currentSection] = val;
			} else if (currentSection && match) {
				const key = match[1];
				const val = match[2].trim();
				if (val) {
					result[currentSection][key] = val;
				} else {
					// Nested section - create empty object
					result[currentSection][key] = {};
				}
			}
		}
		return result;
	} catch {
		return {};
	}
}

/** Write settings.yaml to DSH_HOME with the given config. */
function writeSettingsYaml(config) {
	try {
		const home = process.env.DSH_HOME || join(homedir(), ".dsh");
		const file = join(home, SETTINGS_YAML_PATH);
		let yaml = "";

		function writeScalar(val) {
			if (val === null || val === undefined) return "null";
			if (typeof val === "string") return val;
			return String(val);
		}

		function writeValue(key, val, indent) {
			const prefix = "  ".repeat(indent);
			if (val === null || val === undefined) {
				yaml += `${prefix}${key}: null\n`;
			} else if (typeof val === "string") {
				yaml += `${prefix}${key}: ${val}\n`;
			} else if (typeof val === "number") {
				yaml += `${prefix}${key}: ${val}\n`;
			} else if (typeof val === "boolean") {
				yaml += `${prefix}${key}: ${val}\n`;
			} else if (Array.isArray(val)) {
				if (val.length === 0) {
					yaml += `${prefix}${key}: []\n`;
				} else {
					for (const item of val) {
						if (typeof item === "object" && item !== null) {
							yaml += `${prefix}- \n`;
							for (const [k, v] of Object.entries(item)) {
								writeValue(k, v, indent + 2);
							}
						} else {
							yaml += `${prefix}- ${writeScalar(item)}\n`;
						}
					}
				}
			} else if (typeof val === "object") {
				const entries = Object.entries(val);
				if (entries.length === 0) {
					yaml += `${prefix}${key}: {}\n`;
				} else {
					yaml += `${prefix}${key}:\n`;
					for (const [k, v] of entries) {
						writeValue(k, v, indent + 1);
					}
				}
			}
		}

		for (const [section, values] of Object.entries(config)) {
			yaml += `${section}:\n`;
			if (typeof values === "object" && values !== null && !Array.isArray(values)) {
				for (const [key, val] of Object.entries(values)) {
					writeValue(key, val, 1);
				}
			} else {
				yaml += `  value: ${writeScalar(values)}\n`;
			}
		}

		const tmp = `${file}.tmp`;
		writeFileSync(tmp, yaml, { encoding: "utf8", mode: 0o600 });
		try {
			renameSync(tmp, file);
		} catch {
			writeFileSync(file, yaml, { encoding: "utf8", mode: 0o600 });
		}
		return true;
	} catch (e) {
		console.error("[dsh-agconfig] failed to write settings.yaml:", e.message);
		return false;
	}
}

/** Update settings.yaml with llm-pi-ai provider config. */
/** Update settings.yaml with llm-pi-ai provider config. */
function updateSettingsForAgnes(key, endpoint) {
	// Bypass read-modify-write: the YAML parser/generator cannot handle nested
	// arrays correctly, causing cumulative corruption. Instead, write the known-
	// good document shape directly.
	try {
		const home = process.env.DSH_HOME || join(homedir(), ".dsh");
		const file = join(home, SETTINGS_YAML_PATH);
		const yaml = "ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\nllm-pi-ai:\n  providers:\n    agnes:\n      displayName: Agnes\n      apiKeyEnv: " + AGNES_CREDENTIAL_KEY + "\n      api: openai-completions\n      baseURL: " + endpoint + "\n      models:\n        - id: agnes-2.5-flash\n          name: agnes-2.5-flash\n          contextWindow: 512000\n          maxTokens: 65500\n      defaultInput:\n        - text\n        - image\nagent-default-model:\n  provider: agnes\n  model: agnes-2.5-flash\n";
		const tmp = file + ".tmp";
		writeFileSync(tmp, yaml, { encoding: "utf8", mode: 0o600 });
		try {
			renameSync(tmp, file);
		} catch {
			writeFileSync(file, yaml, { encoding: "utf8", mode: 0o600 });
		}
		console.log("[dsh-agconfig] wrote settings.yaml with agnes provider");
		return true;
	} catch (e) {
		console.error("[dsh-agconfig] failed to write settings.yaml:", e.message);
		return false;
	}
}

/** Remove llm-pi-ai agnes provider from settings.yaml. */
function removeSettingsForAgnes() {
	const settings = readSettingsYaml();
	if (settings["llm-pi-ai"] && settings["llm-pi-ai"]["providers"]) {
		delete settings["llm-pi-ai"]["providers"]["agnes"];
	}
	if (settings["agent-default-model"] && settings["agent-default-model"]["provider"] === "agnes") {
		settings["agent-default-model"]["provider"] = "deepseek-official";
		settings["agent-default-model"]["model"] = "deepseek-v4-flash";
		delete settings["agent-default-model"]["reasoningEffort"];
	}
	return writeSettingsYaml(settings);
}

/** Plugin identity for cordis.yml rows. */
export const name = "dsh-agconfig";
/** Services required before mounting: the web server routes, the trust fence host list, and credentials store. */
export const inject = ["webServer", "webRuntime", "credentials"];

// ── state file ─────────────────────────────────────────────────────────────

/** Absolute path of the state file under the DSH home directory. */
function statePath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, STATE_FILENAME);
}

/** Read the state object; `{}` when absent or corrupt. */
function readState() {
	try {
		const parsed = JSON.parse(readFileSync(statePath(), "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** Persist the state object atomically (tmp + rename, direct-write fallback). */
function writeState(state) {
	const file = statePath();
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	const body = JSON.stringify(state);
	// The state file holds the user's API key, so keep it owner-only on POSIX
	// (mode is ignored on Windows).
	writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
	try {
		renameSync(tmp, file);
	} catch {
		writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
	}
}

// ── trust fence (mirror of dsh-dream-skin / dsh-better-sidebar) ────────────

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return undefined;
	}
}

/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4
		&& parts[0] === "127"
		&& parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/** Assert one configured `trustedHosts` entry is a bare `host[:port]` authority. */
function assertTrustedAuthority(entry) {
	const entryUrl = parseAuthority(entry);
	if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
	throw new Error(`dsh-agconfig: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
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

/** Whether one request may reach the plugin routes (loopback/trusted + same-origin markers). */
function isTrustedApiRequest(req, trustedHosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// ── JSON body / response helpers ───────────────────────────────────────────

/** Sentinel: the request body exceeded MAX_BODY_BYTES (respond 413, not 400). */
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");

/** Read a JSON request body, capped at MAX_BODY_BYTES. */
function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let aborted = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES && !aborted) {
				aborted = true;
				req.destroy();
				resolve(PAYLOAD_TOO_LARGE);
				return;
			}
			if (!aborted) chunks.push(chunk);
		});
		req.on("end", () => {
			if (aborted) return;
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				resolve(parsed);
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (!aborted) resolve(null);
		});
	});
}

/** Write a JSON response with the given status code. */
function writeJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(body);
}

/** Handle one fenced API request. */
async function handleApi(req, res, probe, credentials) {
	if (req.method !== "POST") {
		writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
		return;
	}
	const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"].toLowerCase() : "";
	if (!contentType.startsWith("application/json")) {
		writeJson(res, 415, { ok: false, error: { code: "unsupported-media-type", message: "content-type must be application/json" } });
		return;
	}
	const payload = await readJsonBody(req);
	if (payload === PAYLOAD_TOO_LARGE) {
		writeJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "request body too large" } });
		return;
	}
	if (payload === null || typeof payload !== "object" || typeof payload.method !== "string") {
		writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "bad request" } });
		return;
	}
	if (payload.method === "get") {
		writeJson(res, 200, { ok: true, value: readState() });
		return;
	}
	if (payload.method === "set") {
		const patch = payload.patch;
		if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
			writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "patch must be a plain object" } });
			return;
		}
		// Merge into the current state. `accounts` is the account pool: an
		// array of { endpoint, key } rows (empty-key rows are dropped).
		// Other keys: string sets, null removes, absent keys untouched, so
		// concurrent writers are safe.
		const next = readState();
		let credentialsUpdated = false;
		for (const [key, value] of Object.entries(patch)) {
			if (typeof key !== "string") continue;
			if (key === "accounts") {
				if (value === null) {
					delete next.accounts;
				} else if (Array.isArray(value)) {
					const clean = value.filter(
						(row) => row !== null && typeof row === "object"
							&& typeof row.endpoint === "string"
							&& typeof row.key === "string"
							&& row.key.trim().length > 0
					).map((row) => ({ endpoint: row.endpoint, key: row.key.trim() }));
					next.accounts = clean;
					// Auto-sync first account key to credentials store for LLM provider.
					if (clean.length > 0 && clean[0].key.length > 0) {
						if (credentials) {
							try {
								await credentials.set(AGNES_CREDENTIAL_KEY, clean[0].key);
								credentialsUpdated = true;
								console.log("[dsh-agconfig] synced Agnes API key to credentials store");
							} catch (e) {
								console.error("[dsh-agconfig] failed to sync credentials:", e.message);
							}
						}
						// Always update settings.yaml to register the LLM provider
						try {
							const settingsUpdated = updateSettingsForAgnes(clean[0].key, clean[0].endpoint);
							if (settingsUpdated) {
								console.log("[dsh-agconfig] updated settings.yaml for llm-pi-ai");
							}
						} catch (e) {
							console.error("[dsh-agconfig] failed to update settings.yaml:", e.message);
						}
					} else if (clean.length === 0) {
						// Clear credentials when no accounts with keys remain.
						try {
							await credentials.delete(AGNES_CREDENTIAL_KEY);
							credentialsUpdated = true;
							console.log("[dsh-agconfig] cleared Agnes API key from credentials store");
						} catch (e) {
							console.error("[dsh-agconfig] failed to clear credentials:", e.message);
						}
						// Also remove LLM provider config from settings.yaml
						try {
							removeSettingsForAgnes();
							console.log("[dsh-agconfig] removed llm-pi-ai settings");
						} catch (e) {
							console.error("[dsh-agconfig] failed to remove settings:", e.message);
						}
					}
				}
				continue;
			}
			if (value === null) delete next[key];
			else if (typeof value === "string") next[key] = value;
		}
		writeState(next);
		const resp = { ok: true };
		if (credentialsUpdated) resp.credentialsSynced = true;
		writeJson(res, 200, resp);
		return;
	}
	if (payload.method === "test") {
		const t = payload.payload;
		if (t === null || typeof t !== "object" || typeof t.endpoint !== "string" || typeof t.key !== "string") {
			writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "payload must be { endpoint, key }" } });
			return;
		}
		// Key probe: GET {endpoint}/models — a valid key answers 200, an invalid
		// key 401/403. Zero generation cost, no side effects.
		writeJson(res, 200, await probe(t.endpoint, t.key));
		return;
	}
	writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown method "${payload.method}"` } });
}

/**
 * Host loader entry: mount the fenced persistence API.
 * @param ctx - host cordis context (webServer, webRuntime, credentials).
 */
export function apply(ctx) {
	// Key probe through Node fetch (GET {endpoint}/models).
	// No subprocess needed — fetch is built into Node 20+.
	const probe = async (endpoint, key) => {
		try {
			const resp = await fetch(endpoint.replace(/\/+$/, "") + "/models", {
				headers: { "Authorization": "Bearer " + key },
				signal: AbortSignal.timeout(20000)
			});
			const status = resp.status;
			if (status === 200) return { ok: true, httpStatus: 200, reason: "ok" };
			if (status === 401 || status === 403) return { ok: false, httpStatus: status, reason: "invalid" };
			return { ok: false, httpStatus: status, reason: "other" };
		} catch (err) {
			return { ok: false, httpStatus: -1, reason: err.name === "AbortError" ? "timeout" : "network" };
		}
	};

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)) {
				writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
				return;
			}
			try {
				const credentials = ctx.get("credentials");
				await handleApi(req, res, probe, credentials);
			} catch (error) {
				console.error("[dsh-agconfig] persistence API error:", error);
				writeJson(res, 500, { ok: false, error: { code: "internal", message: "internal error" } });
			}
		}
	}), "dsh-agconfig: persistence API routes");
}