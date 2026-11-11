// Offline, read-only verifier for the dsh-purge 1.1.71 / dsh 0.2.2-rc.1 adapter.
// Usage:
//   node verify.mjs --plugin-dir <dir> --dsh-home <dir> --harness-root <dir> [--repo <dir>] [--strict]
// Exit code 0 = all checks passed, 1 = at least one failure.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PLUGIN = arg("plugin-dir", "");
const HOME = arg("dsh-home", "");
const HARNESS = arg("harness-root", "");
const REPO = arg("repo", "");
const STRICT = argv.includes("--strict");

if (!PLUGIN || !HOME) {
  console.error("usage: node verify.mjs --plugin-dir <dir> --dsh-home <dir> --harness-root <dir> [--repo <dir>] [--strict]");
  process.exit(2);
}

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log("  PASS  " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  " + extra : "")); }
};
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const has = (p, s) => { const t = read(p); return t !== null && t.includes(s); };
const j = (...xs) => path.join(...xs);
const section = (s) => console.log("\n=== " + s + " ===");

section("1 / Fixed sources present");
const core = j(PLUGIN, "lib", "core.js");
const desktop = j(PLUGIN, "lib", "desktop.js");
const index = j(PLUGIN, "lib", "index.js");
const redteam = j(PLUGIN, "lib", "redteam", "index.js");
const preset = j(PLUGIN, "presets", "redteam", "agent.cordis.yml");
for (const [name, p] of [["core.js", core], ["desktop.js", desktop], ["index.js", index], ["redteam/index.js", redteam], ["agent.cordis.yml", preset]]) {
  check("file exists: " + name, fs.existsSync(p));
}

section("2 / Six fixes are in place");
check("F1 atomicCopyFileSync defined", has(core, "export function atomicCopyFileSync"));
check("F1 randomBytes used for unique tmp name", has(core, "randomBytes") && has(core, ".copytmp"));
check("F1 plain-copy fallback on rename failure", has(core, "const fallbackCopy"));
check("F2 desktop.js calls the sync backup", has(desktop, "atomicCopyFileSync(fp, bak)"));
check("F2 no un-awaited async backup left", !/try\s*\{\s*atomicCopyFile\(fp,\s*bak\)/.test(read(desktop) || ""));
check("F3 patch 40 0.2.2 needle defined", has(core, "COMPLETE_PROMPT_022_NEEDLE"));
check("F3 patch 40 0.2.2 replacement registered", has(core, "COMPLETE_PROMPT_022_INJECT_LINE") && has(core, "pattern: COMPLETE_PROMPT_022_NEEDLE"));
check("F3 official tools/requiredContexts preserved", has(core, "COMPLETE_PROMPT_WATERFALL_INJECT"));
check("F4 cwd variable registered in apply()", has(index, "registerCwdPromptVariable(ctx)") && has(index, 'prompt.variable("cwd"'));
check("F4 cwd provider has last-cwd fallback", has(index, "last-cwd.txt") && has(index, "process.cwd()"));
const red = read(redteam) || "";
const repairBlock = red.slice(red.indexOf("function repairDelegation"), red.indexOf("function repairDelegation") + 2600);
check("F5 self-heal no longer re-enables list-agents", !repairBlock.includes('"tool-subagent-list-agents"'));
check("F5 self-heal still re-enables the other 3 rows", ["tool-subagent-control", '"tool-subagent"', "tool-subagent-fork"].every((s) => repairBlock.includes(s)));
const yml = read(preset) || "";
check("F6 redundant list-agents row disabled", /- id: tool-subagent-list-agents[\s\S]{0,220}disabled: true/.test(yml));
check("F6 removed unsupported toolFilter", !yml.includes("toolFilter:"));
check("F6 maxDepth: 1 hard cap kept", yml.includes("maxDepth: 1"));
check("F6 still 19 plugin rows", (yml.match(/^\s*- id:/gm) || []).length >= 19);

section("3 / Syntax");
for (const [name, p] of [["core.js", core], ["desktop.js", desktop], ["index.js", index], ["redteam/index.js", redteam]]) {
  let ok = false, err = "";
  try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); ok = true; }
  catch (e) { err = String(e.stderr || e.message).slice(0, 120); }
  check("node --check " + name, ok, err);
}

section("4 / Capability files untouched");
const capability = [
  "client.js", "cordis.patch.yml", "bin/dsh-purge.js", "lib/hooks-deny.js",
  "lib/table-read.js", "lib/host-clean.js", "lib/phase1-keep.js", "lib/surface.js",
  "lib/extract-asar.js", "lib/rules.js", "lib/uninstall.js",
];
check("all capability files present", capability.every((f) => fs.existsSync(j(PLUGIN, f))));
const bundlePatch = read(j(PLUGIN, "cordis.patch.yml")) || "";
check("bundle patch keeps personaSuffix/{{cwd}}", bundlePatch.includes("personaSuffix: Your working directory is {{cwd}}."));
check("bundle patch keeps hooksDenyBypass", bundlePatch.includes("hooksDenyBypass: true"));
check("danger-full-access source intact in core.js", has(core, "DSH_PERMISSION_MODE"));
if (REPO && fs.existsSync(j(REPO, "ADAPTATION", "patches", "all.patch"))) {
  const patch = read(j(REPO, "ADAPTATION", "patches", "all.patch")) || "";
  const touched = [...patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
  check("all.patch touches exactly the 5 fixed files", touched.length === 5, touched.join(", "));
  check("all.patch never touches capability files", touched.every((f) => !capability.includes(f)));
}

section("5 / Host + runtime state");
const resources = HARNESS ? j(HARNESS, "resources") : "";
const asar = j(resources, "app.asar");
const asarBak = j(resources, "app.asar.bak");
const appDir = j(resources, "app");
const cli = j(HARNESS, "resources", "runtime", "cli", "bin", "dsh.cmd");
const unsealed = !fs.existsSync(asar) && fs.existsSync(asarBak);
const hostComplete = fs.existsSync(j(appDir, "package.json")) && fs.existsSync(j(appDir, "lib", "main.js"));
const cliText = read(cli) || "";
const shimOk = cliText.includes("dsh-purge cli entry begin") && cliText.includes("app\\dsh\\node_modules");
console.log("  INFO  unsealed=" + unsealed + "  appDirComplete=" + hostComplete + "  dsh.cmd=" + cliText.length + "B");
check("dsh.cmd exists", fs.existsSync(cli));
if (STRICT) {
  check("app.asar moved aside (unsealed)", unsealed);
  check("unpacked host complete", hostComplete);
  check("dsh.cmd has 3-level fallback shim", shimOk);
} else {
  check("host state is consistent (sealed OR unsealed+shim)", !unsealed || (hostComplete && shimOk));
}
const applied = j(HOME, "dsh-purge", "applied.json");
const declared = j(HOME, "redteam", "preset-declare.json");
if (fs.existsSync(applied)) check("applied.json records 1.1.71", (read(applied) || "").includes("1.1.71"));
else console.log("  INFO  applied.json absent (Clean -> Apply not done yet)");
if (fs.existsSync(declared)) {
  try { const d = JSON.parse(read(declared)); check("redteam preset registered", d.ok === true && d.phase === "registered", "phase=" + d.phase); }
  catch { check("redteam preset declared file readable", false); }
} else console.log("  INFO  preset-declare.json absent (first DSH start will create it)");
const runtimePreset = j(HOME, ".agent-presets", "redteam", "agent.cordis.yml");
if (fs.existsSync(runtimePreset)) {
  // The runtime copy may carry local edits (e.g. an extra persona line). Only
  // the adaptation markers must match; never require a byte-identical file.
  const rt = read(runtimePreset) || "";
  const norm = (s) => s.replace(/\r\n/g, "\n");
  check("runtime preset has the disabled list-agents row", /- id: tool-subagent-list-agents[\s\S]{0,220}disabled: true/.test(norm(rt)));
  check("runtime preset has no toolFilter", !rt.includes("toolFilter:"));
  check("runtime preset keeps maxDepth: 1", rt.includes("maxDepth: 1"));
  if (norm(rt).trim() !== norm(yml).trim()) {
    console.log("  INFO  runtime preset has local edits (expected on machines where the user edited it); adaptation markers checked above");
  }
} else console.log("  INFO  runtime preset not generated yet");

section("Summary");
console.log("  " + pass + " passed, " + fail + " failed" + (STRICT ? "  (strict)" : ""));
process.exit(fail === 0 ? 0 : 1);
