# 故障速查 · 5 个实测过的现象

按「现象 → 根因 → 处置」组织。前 4 个是插件在 `0.2.2-rc.1` 上的版本适配缺陷，本适配版已在源码层修好；第 5 个是 Windows 宿主收尾问题，由 `finalize.ps1` 解决。

---

## 1. 点「应用」后宿主崩溃：`应用无法启动或已意外停止`

**日志**：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*host.log`，指向 `lib/core.js:83` 的 `rename(...copytmp → dsh.cmd.dsh-purge.bak)` ENOENT、`phase: startup`、fatal load failure。

**根因**：`lib/desktop.js:1769` 漏 `await` 调用 async `atomicCopyFile`，Promise rejection 逃逸成 unhandled rejection，Node 24 让 host exit 1。备份失败本身又源于 asar 路由导致 tmp 不可见 + Windows rename 覆盖已存在 `.bak`。

**处置**：不要用上游 1.1.71 重试。用本仓库修好的 5 个文件覆盖（F1/F2）。已崩溃时先让 Electron 回落：把 `resources\app\` 改名、从 `resources\app.asar` 启动，确认 `dsh.cmd --version` 正常。

---

## 2. 不崩了，但红字 `失败: 清洗没有写进全部宿主，已取消重启`

**面板**：「0.1.5 兼容 0/1 · 跳过 1」。

**根因**：官方 `dsh-system-prompt/lib/index.js` assemble 块新增 `tools` / `requiredContexts`，补丁 40 的 6 个旧 pattern 全部失配 → `skipped`；而 `host-clean.js` 的终检仍要求 `transformed.sections : [completeSection]` 消失 → `hostWritten=false` 永远成立。同时 complete 模式确实会丢掉 waterfall 注入段。

**诊断**（只读）：
```powershell
node ADAPTATION\scripts\diag.mjs --plugin-dir <插件目录>
```
看 `patch 40` 是否为 `applied`、`allPatchHostsWritten` 是否为 `true`。

**处置**：应用 F3 补丁（新增 0.2.2 needle/replace）。若宿主文件已被解包但补丁没打上，用插件自己的 `applyReplacementsToText` 把补丁 40 产出写进 `resources\app\...\dsh-system-prompt\lib\index.js`，再点一次应用。

---

## 3. 「红队模式」不在模式下拉里

**证据**：`~/.dsh/redteam/preset-declare.json` = `ok:false, phase:"registered-broken", plugins:19`，`broken` 列出 `tool-subagent-list-agents (never started)` 和 `tool-subagent: toolFilter is no longer supported`。

**根因**：0.2.2-rc.1 的 `dsh-tool-subagent-control` 只导出 `.` 主入口；`dsh-tool-subagent` 见 `persona` / `toolFilter` 直接抛错。任一 fiber 失败，整份预设被下拉过滤。

**处置**：应用 F5/F6（禁用冗余行、删 `toolFilter`、修 `repairDelegation` 防自愈覆盖），并**同步运行时副本** `~/.dsh/.agent-presets/redteam/agent.cordis.yml`。必须托盘完全退出再重开（预设注册发生在启动时）。成功后 `preset-declare.json` 变 `ok:true / registered`。

**注意**：`dsh-purge` 是侧栏面板入口，不是模式；模式下拉里只会出现「红队模式」。另外「REA 逆向工作台」「无限制模式」属于其它第三方预设，本包不带。

---

## 4. 每轮对话失败：`unknown prompt variable "{{cwd}}"`

**原文**：`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model`。

**根因**：`cordis.patch.yml` 的 `personaSuffix` 用 `{{cwd}}`，但 0.2.2-rc.1 的 `dsh-agent-loop` 只注册 `provider` / `model`，模板校验器遇到未知变量直接 throw。与模型、Magpie 网关、额度都无关（实测 `/v1/models` 返回 200 / 8ms）。

**处置**：应用 F4（`registerCwdPromptVariable`）。**必须重启 DSH**，因为变量注册发生在插件 `apply()` 时。

---

## 5. 应用成功，但重启后 `dsh desktop host stopped` / 反复重启循环

**日志**：`phase: running`，错误只有 host 退出时留下的模型列表输出，**没有异常堆栈**。

**证据**：插件生成了 `Temp\dsh-purge-asar-swap-*.ps1`，但 `resources\app.asar.bak` 和 `rename-pending` 都不存在、`app.asar` 还是原件 → 负责「杀宿主 → 挪走 asar → 重新打开」的 PowerShell 脚本没跑完（本机安全策略同类限制）。

**循环根因**：`reapply.js` 只要看到 `app.asar` 还在，每次启动都判「补丁已丢失」→ 重打 + 重启 → 再崩。点崩溃框里的「重启」只重启 host、不做 swap，**永远出不来**。

**处置**：
1. 托盘完全退出 DSH（或 `finalize.ps1 -StopHost`）；
2. 跑 `finalize.ps1` 完成 `app.asar → app.asar.bak` + 注入 `dsh.cmd` 三级回退 shim；
3. 重新打开，**不要再点应用**。

**验证**：`diag.mjs` 应显示 `desktopAsarStillSealed=false`、`patchesMatchInstallStrict=true`。

---

## 其它常见问题

| 现象 | 检查 |
|---|---|
| 新建会话 503 / 底部「重新连接中…」 | 崩溃后 host 后端没被拉起，renderer 靠缓存显示。托盘完全退出 → 冷启动；不是数据丢失，也不是网关故障 |
| `dsh.cmd --version` 报错或找不到入口 | asar 已挪走但 shim 没注入（H2）。跑 `finalize.ps1` 或手工执行 `finalize-shim.mjs` |
| 会话列表少了某个会话 | 多为视图分组折叠 / 归档筛选。数据仍在 `~/.dsh/sessions/`，`workspace.json` 的 `sessionIds` 里。先展开工作区分组、切「全部」、清搜索框 |
| 换机器后 `node_modules/dsh-purge` 失效 | 用了 `link:C:/...` 绝对路径。改成 `file:../../plugins/dsh-purge` 再 `plugin install` |
| 模式下拉里改了配置不生效 | dsh 只在启动时读配置，必须完全退出重开 |
| 已产生对话的会话切不了 preset | 设计如此，新开一个会话再切 |

## 完整回退

见 `ADAPTATION/README.md` 第 6 节，或 `scripts/rollback.ps1`。最小手工回退：`app.asar.bak → app.asar` + `dsh.cmd.dsh-purge.bak → dsh.cmd`。
