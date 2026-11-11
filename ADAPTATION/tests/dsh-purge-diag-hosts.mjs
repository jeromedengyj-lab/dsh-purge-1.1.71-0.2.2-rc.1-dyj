import path from "node:path";
import fs from "node:fs";

const lib = "C:/Users/Administrator/.dsh/plugins/dsh-purge/lib";
const core = await import("file:///" + lib + "/core.js");
const desktop = await import("file:///" + lib + "/desktop.js");

const show = (label, arr) => {
  console.log("\n=== " + label + " ===");
  if (!Array.isArray(arr) || !arr.length) { console.log("  (empty)"); return; }
  arr.forEach((p, i) => console.log("  [" + i + "] " + p));
};

try {
  show("enumeratePatchAiBases discover:false", core.enumeratePatchAiBases({ discover: false }));
  show("enumeratePatchAiBases discover:true", core.enumeratePatchAiBases({ discover: true }));
  show("listDesktopPackageRoots discover:true", desktop.listDesktopPackageRoots({ discover: true }));
  show("listDesktopPackageRoots discover:false", desktop.listDesktopPackageRoots({ discover: false }));
} catch (e) {
  console.log("ENUM ERROR: " + (e && e.stack ? e.stack : e));
}

console.log("\n=== per-host status (discover:true) ===");
const bases = core.enumeratePatchAiBases({ discover: true });
for (const b of bases) {
  let written = false, flash = null, status = null;
  try { written = core.hostCleanMarkersPresent(b); } catch (e) { written = "ERR:" + e.message; }
  try { flash = core.silenceCmdFlash(b); } catch (e) { flash = "ERR:" + e.message; }
  try {
    const st = await core.patchStatus(b);
    const counts = {};
    for (const v of Object.values(st)) counts[v] = (counts[v] || 0) + 1;
    status = counts;
  } catch (e) { status = "ERR:" + e.message; }
  const marker = path.join(b, "dsh-system-prompt", "lib", "index.js");
  console.log("\n  BASE: " + b);
  console.log("    exists        : " + fs.existsSync(b));
  console.log("    marker file   : " + marker + " exists=" + fs.existsSync(marker) +
    (fs.existsSync(marker) ? " size=" + fs.statSync(marker).size : ""));
  console.log("    hostWritten   : " + written);
  console.log("    flash         : " + JSON.stringify(flash));
  console.log("    patchStatus   : " + JSON.stringify(status));
}

console.log("\n=== allPatchHostsWritten on snapshot ===");
const snap = bases.map((b) => ({ aiBase: b, hostWritten: core.hostCleanMarkersPresent(b), flash: core.silenceCmdFlash(b) }));
console.log("  " + JSON.stringify(snap.map((h) => ({ aiBase: h.aiBase, hostWritten: h.hostWritten, flashOk: h.flash && h.flash.ok })), null, 2));
console.log("  allWritten = " + core.allPatchHostsWritten(snap));
