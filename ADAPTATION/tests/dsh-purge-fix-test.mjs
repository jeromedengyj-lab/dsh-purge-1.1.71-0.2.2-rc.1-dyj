import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LIB = "C:/Users/Administrator/.dsh/plugins/dsh-purge/lib";
const url = (f) => pathToFileURL(path.join(LIB, f)).href;

const unhandled = [];
process.on("unhandledRejection", (r) => unhandled.push(r));

const out = [];
const ok = (name) => out.push(["PASS", name]);
const fail = (name, e) => out.push(["FAIL", name, String((e && e.message) || e)]);

const core = await import(url("core.js"));
const { hostFs } = await import(url("extract-asar.js"));
await import(url("desktop.js")); // import chain must resolve
ok("core.js + desktop.js import cleanly");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-fix-"));
const src = path.join(dir, "dsh.cmd");
const ORIGINAL = "@echo off\r\nORIGINAL-CLI\r\n";
const PATCHED = "@echo off\r\nPATCHED-CLI\r\n";
fs.writeFileSync(src, ORIGINAL);

// 1. normal backup
try {
  const dst = path.join(dir, "normal.bak");
  await core.atomicCopyFile(src, dst);
  assert.equal(fs.readFileSync(dst, "utf8"), ORIGINAL);
  ok("atomicCopyFile: normal backup");
} catch (e) { fail("atomicCopyFile: normal backup", e); }

// 2. dst already exists (the .bak left by the crashed apply)
try {
  const dst = path.join(dir, "existing.bak");
  fs.writeFileSync(dst, "STALE-BAK");
  fs.writeFileSync(src, PATCHED);
  await core.atomicCopyFile(src, dst);
  assert.equal(fs.readFileSync(dst, "utf8"), PATCHED);
  ok("atomicCopyFile: overwrites an existing .bak");
} catch (e) { fail("atomicCopyFile: overwrites an existing .bak", e); }

// 3. the exact crash: rename(tmp -> dst) throws ENOENT
try {
  const orig = hostFs.promises.rename;
  hostFs.promises.rename = async () => { const e = new Error("ENOENT: simulated asar routing"); e.code = "ENOENT"; throw e; };
  try {
    const dst = path.join(dir, "enoent.bak");
    await core.atomicCopyFile(src, dst);
    assert.equal(fs.readFileSync(dst, "utf8"), PATCHED);
    ok("atomicCopyFile: survives rename ENOENT (the fatal case)");
  } finally { hostFs.promises.rename = orig; }
} catch (e) { fail("atomicCopyFile: survives rename ENOENT (the fatal case)", e); }

// 4. Windows rename-over-existing failure (EPERM)
try {
  const orig = hostFs.promises.rename;
  hostFs.promises.rename = async () => { const e = new Error("EPERM: simulated"); e.code = "EPERM"; throw e; };
  try {
    const dst = path.join(dir, "eperm.bak");
    fs.writeFileSync(dst, "OLD-BAK");
    await core.atomicCopyFile(src, dst);
    assert.equal(fs.readFileSync(dst, "utf8"), PATCHED);
    ok("atomicCopyFile: survives rename EPERM");
  } finally { hostFs.promises.rename = orig; }
} catch (e) { fail("atomicCopyFile: survives rename EPERM", e); }

// 5. sync version: backup happens BEFORE the shim is overwritten
try {
  const s = path.join(dir, "sync.cmd");
  const b = path.join(dir, "sync.cmd.dsh-purge.bak");
  fs.writeFileSync(s, "SYNC-ORIGINAL");
  core.atomicCopyFileSync(s, b);
  fs.writeFileSync(s, "SYNC-PATCHED");
  assert.equal(fs.readFileSync(b, "utf8"), "SYNC-ORIGINAL");
  assert.equal(fs.readFileSync(s, "utf8"), "SYNC-PATCHED");
  ok("atomicCopyFileSync: backs up the ORIGINAL before overwrite");
} catch (e) { fail("atomicCopyFileSync: backs up the ORIGINAL before overwrite", e); }

// 6. sync version with an existing .bak
try {
  const s = path.join(dir, "sync2.cmd");
  const b = path.join(dir, "sync2.cmd.dsh-purge.bak");
  fs.writeFileSync(s, "NEW-ORIGINAL");
  fs.writeFileSync(b, "STALE");
  core.atomicCopyFileSync(s, b);
  assert.equal(fs.readFileSync(b, "utf8"), "NEW-ORIGINAL");
  ok("atomicCopyFileSync: overwrites an existing .bak");
} catch (e) { fail("atomicCopyFileSync: overwrites an existing .bak", e); }

// 7. a sync failure must be catchable by a plain try/catch
try {
  let caught = false;
  try { core.atomicCopyFileSync(path.join(dir, "does-not-exist"), path.join(dir, "x.bak")); }
  catch { caught = true; }
  assert.equal(caught, true);
  ok("sync failure is catchable (no escaping rejection)");
} catch (e) { fail("sync failure is catchable (no escaping rejection)", e); }

// 8. no temp files leaked, no unhandled rejections
try {
  await new Promise((r) => setTimeout(r, 60));
  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".copytmp") || n.endsWith(".tmp"));
  assert.equal(leftovers.length, 0, "leftover tmp files: " + leftovers.join(", "));
  assert.equal(unhandled.length, 0, "unhandled rejections: " + unhandled.map(String).join(" | "));
  ok("no leaked .copytmp files and zero unhandled rejections");
} catch (e) { fail("no leaked .copytmp files and zero unhandled rejections", e); }

for (const row of out) console.log(row.join(" | "));
const failed = out.filter((r) => r[0] === "FAIL").length;
console.log(`\nRESULT: ${out.length - failed}/${out.length} passed; temp dir: ${dir}`);
process.exitCode = failed ? 1 : 0;
