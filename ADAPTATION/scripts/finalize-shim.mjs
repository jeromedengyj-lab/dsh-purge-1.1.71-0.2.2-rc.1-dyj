// Called by finalize.ps1. Uses the plugin's own shim writer so the generated
// dsh.cmd is byte-for-byte what dsh-purge would produce.
import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginDir = process.argv[2];
const exe = process.argv[3];
if (!pluginDir || !exe) {
  console.error("usage: node finalize-shim.mjs <plugin-dir> <harness-exe>");
  process.exit(2);
}
const url = pathToFileURL(path.join(pluginDir, "lib", "desktop.js")).href;
const desktop = await import(url);
const report = desktop.repairOfficialCliAfterUnpack(exe);
console.log(JSON.stringify(report, null, 2));
if (!report || !Array.isArray(report.shims) || report.shims.length === 0) {
  console.error("no shim was written; check the harness exe path");
  process.exit(1);
}
