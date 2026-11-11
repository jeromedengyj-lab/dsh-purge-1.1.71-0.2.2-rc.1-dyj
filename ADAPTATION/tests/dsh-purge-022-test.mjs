import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = "C:/Users/Administrator/AppData/Local/Temp/dsh-purge-022-test";
const HOST = "D:/app/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai";
const FILE = "dsh-system-prompt/lib/index.js";
const lib = "C:/Users/Administrator/.dsh/plugins/dsh-purge/lib";
const core = await import("file:///" + lib + "/core.js");
const { hostPromptKeepsInject } = await import("file:///" + lib + "/host-clean.js");

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, "official", "dsh-system-prompt", "lib"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "already", "dsh-system-prompt", "lib"), { recursive: true });

const pristine = fs.readFileSync(path.join(HOST, FILE + ".dshpurge.bak"), "utf8");
const current = fs.readFileSync(path.join(HOST, FILE), "utf8");
const patch40 = core.ALL_PATCHES.find((p) => p.id === 40);
if (!patch40) throw new Error("patch 40 not found");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -> " + detail : ""));
  ok ? pass++ : fail++;
};

const NEEDLE = "\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],\n";

for (const [variant, text] of [["official-pristine", pristine], ["already-patched", current]]) {
  console.log("\n=== variant: " + variant + " (" + text.length + " chars) ===");
  const r = core.applyReplacementsToText(text, patch40, FILE);
  const out = r.text;
  const target = path.join(ROOT, variant === "official-pristine" ? "official" : "already", FILE);
  fs.writeFileSync(target, out);

  check("replacement fired (changed=true)", r.changed === true);
  check("official drops-inject line removed", !out.includes(NEEDLE));
  check("dropsInject needle gone for host-clean", !out.includes("transformed.sections : [completeSection]"));
  check("inject marker present", out.includes("[dsh-purge] complete prompt keeps inject + agent-instructions"));
  // 终检要求 identity 标记也在；pristine 原文还没跑 identity 补丁，须模拟全量 apply。
  const full = variant === "official-pristine"
    ? core.ALL_PATCHES.reduce((t, p) => core.applyReplacementsToText(t, p, FILE).text, pristine)
    : out;
  check("hostPromptKeepsInject() true after full apply", hostPromptKeepsInject(full) === true,
    "before=" + hostPromptKeepsInject(text) + " after=" + hostPromptKeepsInject(full));
  check("official tools field preserved", out.includes("\t\t\ttools,"));
  check("requiredContexts preserved", out.includes("const requiredContexts = new Set("));
  check("contexts filter preserved", out.includes("transformed.contexts.filter((entry) => requiredContexts.has(entry.name))"));
  check("no duplicate injection", (out.match(/complete prompt keeps inject \+ agent-instructions/g) || []).length === 1);
  check("other pre-existing markers kept", !text.includes("[dsh-purge] identity stripped") || out.includes("[dsh-purge] identity stripped"));
  check("forbid marker absent", !out.includes("dsh-purge:committed"));

  // idempotency
  const r2 = core.applyReplacementsToText(out, patch40, FILE);
  check("idempotent (2nd run no change)", r2.changed === false && r2.text === out);

  // JS syntax of the resulting host file
  try {
    execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    check("resulting index.js parses as valid JS", true);
  } catch (e) {
    check("resulting index.js parses as valid JS", false, String(e.stderr || e).slice(0, 200));
  }

  // runtime behaviour: complete mode must keep dsh-purge waterfall sections
  const m = out.match(/sections: (completeSection === void 0 \? transformed\.sections : \(function[\s\S]*?\)\(completeSection, transformed\)),\n/);
  if (!m) {
    check("complete-mode expression extractable", false);
  } else {
    const sections = [
      { name: "dsh-purge:rules", text: "PURGE" },
      { name: "agent-instructions", text: "AGENT" },
      { name: "other", text: "OTHER" },
    ];
    const ctx = vm.createContext({
      completeSection: { name: "complete", text: "COMPLETE" },
      transformed: { sections },
    });
    try {
      const names = vm.runInContext("(" + m[1] + ")", ctx).map((s) => s.name);
      check("complete mode keeps dsh-purge inject section", names.includes("dsh-purge:rules"), names.join(","));
      check("complete mode keeps agent-instructions", names.includes("agent-instructions"), names.join(","));
      check("complete mode keeps complete section", names.includes("complete"), names.join(","));
      check("no duplicate complete section", names.filter((n) => n === "complete").length === 1, names.join(","));
      // normal mode
      ctx.completeSection = undefined;
      const normal = vm.runInContext("(" + m[1] + ")", ctx);
      check("normal mode still returns transformed.sections", normal === sections);
    } catch (e) {
      check("complete-mode expression executes", false, String(e.message).slice(0, 200));
    }
  }
}

console.log("\n=== RESULT: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
