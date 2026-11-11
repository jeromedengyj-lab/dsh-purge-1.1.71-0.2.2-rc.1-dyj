import fs from "node:fs";
import { execFileSync } from "node:child_process";

const HOST_BASE = "D:/app/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai";
const FILE = "dsh-system-prompt/lib/index.js";
const fp = HOST_BASE + "/" + FILE;
const BK = "C:/Users/Administrator/.dsh/backup-20261109-1216/patched-src/host-index.js.before-022-fix";
const lib = "C:/Users/Administrator/.dsh/plugins/dsh-purge/lib";
const core = await import("file:///" + lib + "/core.js");
const { hostPromptKeepsInject } = await import("file:///" + lib + "/host-clean.js");

const before = fs.readFileSync(fp, "utf8");
fs.writeFileSync(BK, before);
console.log("backup -> " + BK + " (" + before.length + " chars)");

const patch40 = core.ALL_PATCHES.find((p) => p.id === 40);
const r = core.applyReplacementsToText(before, patch40, FILE);
console.log("changed = " + r.changed);
if (!r.changed) { console.log("NOTHING TO DO (already patched or pattern mismatch)"); process.exit(0); }

fs.writeFileSync(fp, r.text);
const after = fs.readFileSync(fp, "utf8");

const checks = [
  ["file equals plugin-generated output", after === r.text],
  ["official drops-inject line gone", !after.includes("sections: completeSection === void 0 ? transformed.sections : [completeSection],")],
  ["host-clean dropsInject needle gone", !after.includes("transformed.sections : [completeSection]")],
  ["identity marker kept", after.includes("[dsh-purge] identity stripped")],
  ["inject marker written", after.includes("[dsh-purge] complete prompt keeps inject + agent-instructions")],
  ["tools field kept", after.includes("\t\t\ttools,")],
  ["requiredContexts kept", after.includes("const requiredContexts = new Set(")],
  ["contexts filter kept", after.includes("transformed.contexts.filter((entry) => requiredContexts.has(entry.name))")],
  ["hostPromptKeepsInject() true", hostPromptKeepsInject(after)],
  ["core.hostCleanMarkersPresent(aiBase) true", core.hostCleanMarkersPresent(HOST_BASE)],
];
let syntax = true, syntaxErr = "";
try { execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" }); }
catch (e) { syntax = false; syntaxErr = String(e.stderr || e).slice(0, 300); }
checks.push(["index.js parses as valid JS", syntax, syntaxErr]);

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -> " + detail : ""));
  if (!ok) fail++;
}
console.log("\nsize: " + before.length + " -> " + after.length + " chars");
console.log("RESULT: " + (checks.length - fail) + "/" + checks.length + " passed");
process.exit(fail ? 1 : 0);
