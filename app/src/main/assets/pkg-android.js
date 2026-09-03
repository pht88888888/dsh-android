// Android package client for dsh-mobile-apk.
// The shell wrapper supplies the snapshot node binary and preserves argv.
const fs = require("fs");
const endpointPath = process.env.DSH_PKG_ENDPOINT ||
  `${process.env.HOME || "/data/data/com.dsharnessmobile.shell/files/home"}/../.dsh-pkg-endpoint`;
let base = process.env.DSH_PKG_URL;
let token = process.env.DSH_PKG_TOKEN;
try {
  if (!base || !token) {
    const lines = fs.readFileSync(endpointPath, "utf8").trim().split(/\r?\n/);
    base = lines[0];
    token = lines[1];
  }
} catch (_) {}
const args = process.argv.slice(2);

(async () => {
  if (!base || !token) {
    console.error("dsh pkg service is not running");
    process.exitCode = 1;
    return;
  }
  try {
    const response = await fetch(base + "/pkg", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, args }),
    });
    const result = await response.json();
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = Number(result.code || 0);
  } catch (error) {
    console.error("dsh pkg service request failed: " + error.message);
    process.exitCode = 1;
  }
})();
