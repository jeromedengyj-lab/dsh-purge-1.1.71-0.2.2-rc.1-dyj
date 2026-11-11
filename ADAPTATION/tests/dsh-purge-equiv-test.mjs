import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "C:/Users/Administrator/AppData/Local/Temp/dsh-purge-equiv-1244";
const REAL_CMD = "D:/app/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd";
const ORIGINAL = fs.readFileSync(REAL_CMD, "utf8");
const url = (p) => pathToFileURL(p).href;

const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(String((e && e.message) || e)));

const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function runShim(variant) {
  const base = path.join(ROOT, variant);
  const fx = path.join(base, "fixture-" + tag);
  const bin = path.join(fx, "resources", "runtime", "cli", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const exe = path.join(fx, "DeepSeek Harness.exe");
  fs.writeFileSync(exe, "fixture-exe");
  const cmd = path.join(bin, "dsh.cmd");
  fs.writeFileSync(cmd, ORIGINAL);

  const mod = await import(url(path.join(base, "lib", "desktop.js")));
  const report = mod.repairOfficialCliAfterUnpack(exe);
  await new Promise((r) => setTimeout(r, 250)); // let the ORIGINAL's un-awaited async backup settle
  const bakPath = cmd + ".dsh-purge.bak";
  return {
    report,
    cmd: fs.readFileSync(cmd, "utf8"),
    bak: fs.existsSync(bakPath) ? fs.readFileSync(bakPath, "utf8") : null,
  };
}

// Reproduce core.js:6141 — backupAll creates a 0-byte "wx" placeholder first.
async function runBackupWithPlaceholder(variant) {
  const base = path.join(ROOT, variant);
  const core = await import(url(path.join(base, "lib", "core.js")));
  const dir = path.join(base, "placeholder-" + tag);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, "target.js");
  const dst = path.join(dir, "target.js.dshpurge.bak");
  fs.writeFileSync(src, "ORIGINAL-CONTENT");
  fs.closeSync(fs.openSync(dst, "wx")); // 0-byte placeholder, exactly like backupAll
  let err = null;
  try { await core.atomicCopyFile(src, dst); } catch (e) { err = String((e && e.message) || e); }
  return { err, bak: fs.readFileSync(dst, "utf8"), size: fs.statSync(dst).size };
}

const a = await runShim("orig");
const b = await runShim("fixed");
const pa = await runBackupWithPlaceholder("orig");
const pb = await runBackupWithPlaceholder("fixed");
await new Promise((r) => setTimeout(r, 100));

const rows = [];
const check = (name, cond, detail = "") => rows.push([cond ? "PASS" : "FAIL", name, detail]);

check("shim output is byte-identical between ORIGINAL and FIXED", a.cmd === b.cmd,
  `orig=${a.cmd.length}B fixed=${b.cmd.length}B`);
check("shim really got injected (capability still active)", a.cmd !== ORIGINAL,
  `original=${ORIGINAL.length}B -> patched=${a.cmd.length}B`);
check("shim report.status identical",
  JSON.stringify(a.report.shims.map((s) => s.status)) === JSON.stringify(b.report.shims.map((s) => s.status)),
  `orig=${JSON.stringify(a.report.shims.map((s) => s.status))} fixed=${JSON.stringify(b.report.shims.map((s) => s.status))}`);
check("FIXED backs up the PRISTINE original before patching",
  b.bak === ORIGINAL,
  `fixed.bak=${b.bak === null ? "missing" : b.bak.length + "B"} pristine=${ORIGINAL.length}B`);
check("ORIGINAL had a real defect: its .bak captured the already-patched text",
  a.bak !== ORIGINAL && a.bak === a.cmd,
  `orig.bak=${a.bak === null ? "missing" : a.bak.length + "B"} (= patched output, so --revert could never restore the official file)`);
check("FIXED leaves no unhandled rejection", unhandled.length === 0, unhandled.join(" | "));

// The 0-byte-placeholder case: the ORIGINAL loses the backup, the FIXED one keeps it.
check("FIXED fills the 0-byte placeholder with real content (stronger backup)",
  pb.err === null && pb.bak === "ORIGINAL-CONTENT",
  `fixed: err=${pb.err} size=${pb.size}B`);
rows.push(["INFO", "placeholder behaviour of ORIGINAL",
  `err=${pa.err} size=${pa.size}B content=${JSON.stringify(pa.bak)}`]);

for (const r of rows) console.log(r.join(" | "));
const failed = rows.filter((r) => r[0] === "FAIL").length;
console.log(`\nRESULT: ${rows.filter((r) => r[0] === "PASS").length}/${rows.filter((r) => r[0] !== "INFO").length} passed`);
process.exitCode = failed ? 1 : 0;
