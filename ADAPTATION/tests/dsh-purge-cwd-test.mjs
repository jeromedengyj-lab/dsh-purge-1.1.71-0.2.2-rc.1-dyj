import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const PLUGIN = "C:/Users/Administrator/.dsh/plugins/dsh-purge";
const HOME = "C:/Users/Administrator/.dsh";
const HOST = "D:/app/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log("  PASS  " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  FAIL  " + name + "  " + extra); }
};

// ---- extract the real function body from plugin source ----
const src = fs.readFileSync(path.join(PLUGIN, "lib/index.js"), "utf8");
const start = src.indexOf("function registerCwdPromptVariable(");
const end = src.indexOf("export function apply(", start);
check("registerCwdPromptVariable exists in source", start > 0 && end > start);
const body = src.slice(start, end);
const callPos = src.indexOf("registerCwdPromptVariable(ctx);");
const lifePos = src.indexOf("const life = watchContextLife(ctx);", callPos);
check("apply() registers cwd exactly once, before any early return",
  callPos > 0 && lifePos > callPos && (src.match(/registerCwdPromptVariable\(ctx\);/g) || []).length === 1);

const mockCore = {
  pinDshHome: () => HOME,
  findDshHome: () => HOME,
  applyRuntimeEnv: () => {},
};
const sandbox = {
  core: mockCore,
  fs, path, process, console,
  purgeLog: () => {},
};
vm.createContext(sandbox);
vm.runInContext(body + "\nthis.__fn = registerCwdPromptVariable;", sandbox);
const register = sandbox.__fn;
check("function body executes in isolation", typeof register === "function");

// ---- capture what the plugin registers ----
let capturedName = null, capturedProvider = null;
const ctx = {
  systemPrompt: {
    variable: (name, provider) => {
      if (capturedName === null) { capturedName = name; capturedProvider = provider; }
      else throw new Error("already registered");
      return () => {};
    },
  },
};
register(ctx);
check("registers exactly one variable named cwd", capturedName === "cwd", "got=" + capturedName);
check("provider is a function", typeof capturedProvider === "function");

// ---- provider value checks ----
const saved = fs.readFileSync(path.join(HOME, "dsh-purge", "last-cwd.txt"), "utf8").trim();
check("last-cwd.txt holds the real workspace", saved.length > 0, JSON.stringify(saved));
const v1 = capturedProvider({});
check("falls back to last-cwd.txt", v1 === saved, JSON.stringify(v1));
const v2 = capturedProvider({ agent: { options: { cwd: "D:/OTHER" } } });
check("prefers context.agent.options.cwd", v2 === "D:/OTHER", JSON.stringify(v2));
const v3 = capturedProvider({ scope: { cwd: "D:/SCOPE" } });
check("supports context.scope.cwd", v3 === "D:/SCOPE", JSON.stringify(v3));
const v4 = capturedProvider(null);
check("null context does not throw", typeof v4 === "string" && v4.length > 0, JSON.stringify(v4));

// ---- duplicate registration must not break startup ----
let dupThrew = false;
try { register(ctx); } catch { dupThrew = true; }
check("duplicate registration swallowed", !dupThrew);

// ---- real host renderer: reproduce the crash, then verify the fix ----
const host = await import(pathToFileURL(HOST).href);
check("host exports renderPrompt", typeof host.renderPrompt === "function");
const suffix = "Your working directory is {{cwd}}.";
const assembly = (variables) => ({
  sections: [{ name: "deployment:persona-suffix", text: suffix }],
  contexts: [],
  variables,
});
let crash = null;
try { host.renderPrompt(assembly({ provider: "magpie", model: "workbuddy/hy4free" })); }
catch (e) { crash = e; }
check("reproduces screenshot error without cwd", !!crash && /unknown prompt variable "\{\{cwd\}\}"/.test(String(crash?.message)), String(crash?.message).slice(0, 120));
check("registered variables really are only provider/model", !!crash && /provider, model/.test(String(crash?.message)), String(crash?.message));

let rendered = null, renderErr = null;
try { rendered = host.renderPrompt(assembly({ provider: "magpie", model: "workbuddy/hy4free", cwd: v1 })); }
catch (e) { renderErr = e; }
check("renders successfully once cwd is registered", !renderErr && typeof rendered === "string", String(renderErr?.message || ""));
check("rendered text contains the real workspace path", typeof rendered === "string" && rendered.includes(saved), JSON.stringify(rendered));
check("no unresolved template remains", typeof rendered === "string" && !rendered.includes("{{"), JSON.stringify(rendered));

// ---- capability files untouched ----
const patch = fs.readFileSync(path.join(PLUGIN, "cordis.patch.yml"), "utf8");
check("personaSuffix原文未被改动", patch.includes("personaSuffix: Your working directory is {{cwd}}."));
check("personaPrefix清空仍在", patch.includes('personaPrefix: ""'));
check("includeHarnessIdentity关闭仍在", patch.includes("includeHarnessIdentity: false"));
const coreSrc = fs.readFileSync(path.join(PLUGIN, "lib/core.js"), "utf8");
check("补丁40适配仍在", coreSrc.includes("COMPLETE_PROMPT_022_NEEDLE") && coreSrc.includes("COMPLETE_PROMPT_022_INJECT_LINE"));
const identity = fs.readFileSync(path.join(PLUGIN, "lib/identity.js"), "utf8");
check("CWD_ONLY_SUFFIX 原样保留", identity.includes('export const CWD_ONLY_SUFFIX = "Your working directory is {{cwd}}.";'));

console.log("\nRESULT: " + pass + " pass / " + fail + " fail");
if (fail) process.exitCode = 1;
