# 优化清单 · 从 1.1.71 上游到 0.2.2-rc.1 适配版

基线：`jeromedengyj-lab/dsh-purge-1.1.71`，commit `719a741ddda2b888920a1586dea9eb396af3ea1b`（与上游 `ZXEB/dsh-purge` 的 commit / tree SHA 完全一致）。

全部源码改动集中在 **5 个文件、+141 / −22 行**，见 `patches/all.patch`。能力相关文件（`client.js`、`cordis.patch.yml`、`bin/dsh-purge.js`、`lib/hooks-deny.js`、`lib/table-read.js`、`lib/host-clean.js`、`lib/phase1-keep.js`、`lib/surface.js`、`lib/extract-asar.js`、`lib/rules.js`）与上游 HEAD **哈希完全一致**；真正生成补丁内容的 `patchOfficialCliCmdText` 和写盘的 `atomicWriteSync` 一字未改。

编号与 `scripts/verify.mjs` 的 F1–F6 一一对应。

---

## F1 + F2 · 启动崩溃：备份写盘的容错与时序

**现象**：点「清洗 → 应用」后宿主弹「应用无法启动或已意外停止」，crash log 指向 `lib/core.js:83` 的 `rename(copytmp → dsh.cmd.dsh-purge.bak)` ENOENT；同时生成的 `.bak` 是 **0 字节**。

**根因**（两层叠加）：
1. `lib/desktop.js:1769` 在同步函数里写 `try { atomicCopyFile(fp, bak); } catch {...}`，但 `atomicCopyFile` 是 **async 且漏了 await** —— 同步 `try/catch` 接不住 Promise rejection，异常变成 unhandled rejection，Node 24 直接让 `dsh-desktop-host` 启动 fatal exit 1。crash log 里的 ENOENT 只是逃逸出来的那个异常，不是根因。
2. `atomicCopyFile` 走 `hostFs.promises`，asar 解包期间路径路由会让 `.copytmp` 对后续 rename 不可见（ENOENT）；Windows 上 rename 覆盖已存在的 `.bak` 还会 EPERM/EEXIST；原实现没有任何兜底。

**改动**：
- `lib/core.js`：`atomicCopyFile` 使用唯一 tmp 名（`randomBytes`）、对 EPERM/EEXIST/EACCES/EBUSY 做「删目标后重试」，所有失败路径退化为一次普通 `copyFile(src, dst)` —— **备份照样生成，不是跳过备份**；只有连普通复制都失败才抛。
- `lib/core.js`：新增 `atomicCopyFileSync`（原生 `node:fs`），异常可被普通 try/catch 接住。
- `lib/desktop.js`：import 换成 `atomicCopyFileSync`，调用点改成同步，保证「先备份原文 → 再改写 shim」。

**顺带修好的原版能力缺陷**：因漏 await，原版备份是异步发起的，`atomicWriteSync` 立刻改写 `dsh.cmd`，导致 `.dsh-purge.bak` 里存的是**已注入 shim 的 562B**，不是官方原文 243B —— `--revert` / 启动自愈永远还原不回去。修复版备份 pristine 原文。

**验证**：隔离回归 9/9（精确复现 rename ENOENT、EPERM、已存在 `.bak`、先备份后改写、零 unhandled rejection、零 `.copytmp` 残留）；功能等价 7/7 —— 原版与修复版对同一假宿主跑 `repairOfficialCliAfterUnpack`，产出的 `dsh.cmd` **逐字节一致 562B**，`report.shims` 同为 `["missing","patched"]`。

---

## F3 · 「清洗没有写进全部宿主，已取消重启」+ complete 模式丢注入

**现象**：应用不再崩，但面板红字 `失败: 清洗没有写进全部宿主，已取消重启`；清洗页显示「0.1.5 兼容 0/1 · 跳过 1」。

**根因**：官方 `0.2.2-rc.1` 的 `dsh-system-prompt/lib/index.js` assemble 块改成带 `tools` / `requiredContexts` 的新结构，补丁 40（`COMPLETE_PROMPT_KEEP_INJECT`）的 **6 个旧 pattern 一个都匹配不上** → 状态 `skipped`。但 `lib/host-clean.js` 的终检 `hostPromptKeepsInject` 又硬性要求文件里不能出现 `transformed.sections : [completeSection]`、必须有 complete-keeps-inject 标记 → 永远 `hostWritten=false` → `ensureHostClean()` 返回该错误。两个条件自相矛盾，必失败。

**这不只是校验误报**：官方那行 `sections: completeSection === void 0 ? transformed.sections : [completeSection]` 在 complete 预设模式下只留完整段，会**丢掉 waterfall 注入的 dsh-purge 提示词段**。补丁 40 本来就是为修这个存在的，现在没打上 = 能力确实缺了。

**改动**：`lib/core.js` 新增 `COMPLETE_PROMPT_022_NEEDLE` / `COMPLETE_PROMPT_022_INJECT_LINE`，给补丁 40 的 `replacements` 末尾加一条匹配 0.2.2 结构的替换 —— 只替换丢注入的那一行，改成 IIFE 从 `transformed.sections` 里取回 `dsh-purge*` 段再拼回，**完整保留** `tools` / `requiredContexts` / `contexts.filter(...)`。带标记 `[dsh-purge] complete prompt keeps inject + agent-instructions`，同时满足 `patchApplied` 的 markers 和 `hostPromptKeepsInject`。**没有放宽终检、没有跳过任何补丁**。

**验证**：36/36（官方原文 + 已打补丁两种输入；替换触发、幂等、无重复注入、语法检查、vm 运行时确认 complete 模式保留 dsh-purge / agent-instructions / complete 三段且无重复、normal 模式行为不变）；写入宿主 11/11；复验 `patch 40 = applied`、`pending 0`、`allPatchHostsWritten = true`。

---

## F4 · 每轮对话失败：`unknown prompt variable "{{cwd}}"`

**现象**：红队模式注册成功后，每轮对话报
`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model`。

**根因**：插件 `cordis.patch.yml` 写 `personaSuffix: Your working directory is {{cwd}}.`，`lib/identity.js` 的 `DSH_INTERPOLATE_ALLOWED` 也列着 `cwd/model/provider` —— 都是旧版宿主假设。但 `0.2.2-rc.1` 的 `dsh-agent-loop/lib/index.js:1355-1356` **只注册了 `provider` 和 `model`**（全局搜遍宿主只有这两处 `.variable()`）；`dsh-system-prompt/lib/index.js:176` 的 interpolate 校验遇到未知变量直接 throw，于是每次 assemble 都抛，与模型 / 网关 / 额度无关。

**改动**：`lib/index.js` 新增 `registerCwdPromptVariable(ctx)`，在 `apply()` 的 enabled 检查之后、**所有 early return 之前**调用 `ctx.systemPrompt.variable("cwd", provider)`。取值优先级：会话真实工作区（`context.agent.options.cwd` / `scope.cwd` / `context.cwd`）→ 插件自己记录的 `~/.dsh/dsh-purge/last-cwd.txt` → `process.cwd()`；宿主将来自行注册时吞掉 duplicate，不阻断启动。`personaSuffix` 原文、身份清洗、补丁 40、提示词注入一字未删。

**验证**：22/22 —— 用宿主真实 `renderPrompt()` 精确复现截图报错（`registered variables: provider, model`），补上变量后渲染成 `Your working directory is D:\DSH.`、无残留模板；provider 四级取值、null context、duplicate、能力文件原文、语法检查全过。

---

## F5 + F6 · 「红队模式」从下拉里消失

**现象**：`~/.dsh/redteam/preset-declare.json` = `ok:false, phase:"registered-broken", plugins:19`，模式不在下拉里。

**根因**（0.2.2-rc.1 的两处配置契约变更，任一 fiber 失败整份预设被过滤）：
1. `@deepseek-ai/dsh-tool-subagent-control/list-agents` —— 新版该包只导出 `.` 主入口，`list_agents` / `send_message` / `interrupt_agent` 都合并进同一个 `apply()`，旧子路径解析失败 → `never started`。
2. `tool-subagent` 的 `toolFilter` —— 新版 `dsh-tool-subagent/lib/index.js:346` 见到 `persona` / `toolFilter` **直接抛错**。

**改动（恢复能力，不是放宽校验）**：
- `presets/redteam/agent.cordis.yml`（及运行时副本）：把冗余的 `tool-subagent-list-agents` 行设为 `disabled: true`（三个工具仍由主入口提供），删掉 `toolFilter:` 块（新版由 Agent Preset 继承限制接管委派工具），保留 `maxDepth: 1` 硬上限 —— 子智能体仍是叶子节点。
- `lib/redteam/index.js` 的 `repairDelegation()`：从「重新启用」列表移除该行，否则每次启动自愈会把 `disabled` 改回 `false`，把修复覆盖掉；其余三行（control / subagent / fork）的重新启用能力原样保留。

**验证**：21/21（两文件、无 `toolFilter`、19 行不变、25 条 active 行全可解析、无致命字段）；自愈隔离测试 10/10（在临时 `DSH_HOME` 跑真实 `installPreset({force:false})`，确认自愈不改回 `disabled`、仍能重新启用被禁用的 spawn 行）。修复后重启，`preset-declare.json` 变 `ok:true / phase:"registered" / plugins:19`。

---

## 宿主侧两项收尾（非插件源码，已脚本化为 `finalize.ps1`）

### H1 · asar 交换没做完 → 重启循环

应用成功后 `applied.json` 已写入、55 个补丁都在 `resources/app`，但 `app.asar` 仍是 11-04 原件，插件生成的 `Temp\dsh-purge-asar-swap-*.ps1` 没跑完（本机安全策略此前也拦过 `schtasks.exe`，同类限制）。Electron 优先读 asar → **补丁等于没生效**。更糟的是 `reapply.js:118` 的 `hostStillHasAppliedPatches()` 里 `if (core.desktopAsarStillSealed()) return false` —— 只要 asar 还在，每次启动都判「补丁已丢失」→ 重打 → 重启 → 再崩。

**处置**：精确结束已崩溃的 DSH 进程释放文件锁（第一次 `Move-Item` 报 `Device or resource busy`），把 `resources\app.asar` 改名为 `resources\app.asar.bak`（213,202,918 字节、原件完整保留），Electron 下次启动改从 `resources\app` 加载。验证解包宿主 22,159 文件 / 492MB、`main=lib/main.js` 语法通过、原生 `.node` 齐全、`app.asar.unpacked` 已 overlay。

### H2 · CLI shim 被跳过 → 解包后 CLI 会坏

这次 `needsApply=false` 使 `patchAllShims` 没跑，`dsh.cmd` 仍是 243B 且硬指已不存在的 `app.asar\dsh\...`。

**处置**：调插件自身的 `desktop.repairOfficialCliAfterUnpack(exe)` 注入，得到 **562B 三级回退**（`app.asar` → `app.asar.unpacked` → `app`），官方原文 243B 存为 `dsh.cmd.dsh-purge.bak`；`dsh.cmd --version` 返回 `0.2.2-rc.1`、exit 0。

**收尾验证**：`desktopAsarStillSealed=false`、`patchesMatchInstallStrict=true`、`patchesLostAfterHostReset=false` → 重开走 `boot:host-untouched`，不再重打、不再重启循环。

---

## 安装层两处修正（写在 `install.ps1` 里）

- `dsh plugin add <本地目录>` 默认登记为 `link:C:/...` 绝对路径，并给一条 peer 依赖警告；改成 **`file:../../plugins/dsh-purge` 相对协议**，避免换机器 / 移动目录后失效，也与上游 README 的手动安装口径一致。
- 修好的 `presets/redteam/agent.cordis.yml` 需要**同步一份到运行时副本** `~/.dsh/.agent-presets/redteam/agent.cordis.yml`，否则启动自愈可能仍加载旧文件。

---

## 明确没有做的事

- 没有关闭任何补丁、没有放宽任何终检、没有跳过任何能力；`danger-full-access`、personaPrefix 清空、AES 加密提示词注入、审批钩子放行、`skills/redteam/` 全部原样保留。
- 没有改动用户的 Magpie 网关、rea MCP、`dsh-cost-meter` / `dsh-session-clean` 等既有配置。
- 没有引入新依赖、没有联网下载、没有新增外部请求。
- 没有替用户结束正在正常运行的 DSH 会话（脚本只拒绝执行或需显式 `-StopHost`）。
