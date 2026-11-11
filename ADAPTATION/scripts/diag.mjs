// Read-only diagnostics using the plugin's own detection functions.
// Usage: node diag.mjs --plugin-dir <dir> [--harness-root <dir>]
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, d = "") => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PLUGIN = arg("plugin-dir");
if (!PLUGIN) { console.error("usage: node diag.mjs --plugin-dir <dir>"); process.exit(2); }
const u = (f) => pathToFileURL(path.join(PLUGIN, "lib", f)).href;

const core = await import(u("core.js"));
const reapply = await import(u("reapply.js"));

const line = (k, v) => console.log("  " + k.padEnd(30) + String(v));
console.log("=== host discovery ===");
let bases = [];
try { bases = core.enumeratePatchAiBases({ discover: true }); } catch (e) { console.log("  ERR " + e.message); }
bases.forEach((b, i) => console.log("  [" + i + "] " + b));
if (!bases.length) console.log("  (none; normal in a standalone node process on a freshly sealed host)");

console.log("\n=== patch status ===");
if (bases.length) {
  const st = await core.patchStatus(bases[0]);
  const counts = {};
  for (const v of Object.values(st)) counts[v] = (counts[v] || 0) + 1;
  line("patch counts", JSON.stringify(counts));
  line("patch 40 (0.2.2 complete)", st[40]);
  line("patch 76 (unrestricted soft)", st[76]);
  const pending = Object.entries(st).filter(([, v]) => v === "pending").map(([k]) => k);
  line("pending", JSON.stringify(pending));
  line("hostCleanMarkersPresent", core.hostCleanMarkersPresent(bases[0]));
  const snap = bases.map((b) => ({ aiBase: b, hostWritten: core.hostCleanMarkersPresent(b) }));
  line("allPatchHostsWritten", core.allPatchHostsWritten(snap));
}

console.log("\n=== boot self-heal verdict ===");
for (const [k, fn] of [
  ["desktopAsarStillSealed", () => core.desktopAsarStillSealed()],
  ["hostStillHasAppliedPatches", () => reapply.hostStillHasAppliedPatches()],
  ["patchesMatchInstall", () => reapply.patchesMatchInstall()],
  ["patchesMatchInstallStrict", () => reapply.patchesMatchInstallStrict()],
  ["patchesLostAfterHostReset", () => reapply.patchesLostAfterHostReset()],
  ["hostCleanEnoughToKeep", () => reapply.hostCleanEnoughToKeep()],
]) {
  try { line(k, await fn()); } catch (e) { line(k, "ERR " + e.message); }
}
console.log("\nExpected on a finished install: desktopAsarStillSealed=false,");
console.log("patchesMatchInstallStrict=true, patchesLostAfterHostReset=false -> boot:host-untouched.");
