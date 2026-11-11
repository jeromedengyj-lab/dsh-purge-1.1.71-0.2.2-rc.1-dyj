# 操作手册 · dsh-purge 1.1.71 / DeepSeek Harness 0.2.2-rc.1 适配版

> 本目录是「本机适配包」。仓库**根目录**才是修好的插件本体，`ADAPTATION/` 只是补丁、脚本与文档，插件运行时不会加载它。

---

## 0. 这是什么

上游 dsh-purge 1.1.71 是按较早期的 dsh 0.2.x 结构写的，直接装到 **DeepSeek Harness 桌面版 `0.2.2-rc.1`（Windows）** 会依次遇到 4 个故障：应用即崩溃、清洗终检失败、红队模式不出现、每轮对话 `unknown prompt variable "{{cwd}}"`。此外它自带的 asar 交换脚本在部分 Windows 环境会被安全策略拦住，导致重启循环。

本仓库做了两件事：

1. **修源码**（5 个文件，共 +141 / −22 行），全部是「补能力 / 补容错」，没有关闭任何补丁、没有删掉任何提示词或技能。逐项根因与证据见 [`OPTIMIZATIONS.md`](OPTIMIZATIONS.md)。
2. **把宿主侧收尾步骤脚本化**（asar 交换 + CLI shim），避免手工操作踩坑。

**适用**：Windows、官方桌面版 `0.2.2-rc.1`、`desktop` profile。
**不适用**：dsh 0.1.x、0.3+、web / TUI / headless profile（未验证）；macOS / Linux 的 asar 交换路径未测。
**前提**：`dsh` 可以不在 PATH，用安装目录自带的 `resources\runtime\cli\bin\dsh.cmd` 即可。

---

## 1. 安装前必读

- **必须完全退出 DSH**：托盘图标右键「退出」，不是关窗口。脚本会检测进程，检测到就拒绝执行（不会替你杀进程，避免丢会话）。
- **会改动的东西**（脚本自动备份到 `~/.dsh/backup-adapter-<时间戳>/`）：
  - `~/.dsh/profiles/desktop/package.json`（依赖 + bundle 登记）
  - `~/.dsh/profiles/desktop/cordis.yml` / `cordis.patch.yml` / `pnpm-lock.yaml`
  - `~/.dsh/cordis.patch.yml`
  - `<安装目录>\resources\app.asar` → 改名 `app.asar.bak`（**不删除**）
  - `<安装目录>\resources\runtime\cli\bin\dsh.cmd` → 注入三级回退 shim，原件存为 `dsh.cmd.dsh-purge.bak`
- 现有的 Magpie 网关、rea MCP、其它插件配置**不动**。
- 插件本身会把 `DSH_PERMISSION_MODE` 改成 `danger-full-access`、清空系统身份前缀、注入一份 AES 加密的内置提示词，并附带红队技能文档。这些是上游行为，本适配版**原样保留**，请自行评估后再安装。详见 [`NOTICE.md`](NOTICE.md)。

---

## 2. 安装（路径 A：全新机器，推荐）

在本仓库根目录打开 PowerShell：

```powershell
# 步骤 0：只做预检，不写任何文件
powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1 -CheckOnly
```

预检会报告：桌面 exe、`dsh.cmd` 版本（必须 `0.2.2-rc.1`）、profile、DSH 是否完全退出、node 路径。通过后：

```powershell
# 步骤 1：自动安装（备份 → 复制修好的源码 → 注册 profile → 同步预设 → 静态验证）
powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1
```

自定义路径：

```powershell
powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1 `
  -HarnessRoot "E:\Apps\DeepSeek Harness" -Profile desktop -DshHome "$env:USERPROFILE\.dsh"
```

成功后会打印备份目录和后续步骤，然后：

| 步骤 | 操作 | 期望结果 |
|---|---|---|
| 2 | 打开 DSH | 首页出现 `dsh-purge` 按钮；无需先点应用 |
| 3 | 打开面板 →「清洗」→「应用」**一次** | 显示「0.1.5 兼容 1/1」、55+ 补丁 applied，**不报「清洗没有写进全部宿主」**；可能弹出重启/崩溃框，属正常 |
| 4 | 托盘完全退出 DSH | 进程全部消失（弹框点「退出」即可） |
| 5 | `powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\finalize.ps1` | 完成 `app.asar → app.asar.bak` + 注入 `dsh.cmd` shim；打印 `dsh.cmd --version = 0.2.2-rc.1` |
| 6 | 重新打开 DSH | **不要再点「应用」**。补丁此时才真正进入运行中的宿主 |

> 若第 5 步提示进程仍占用文件，用 `-StopHost` 让脚本精确结束残留的 DSH 进程（会丢未保存的界面状态，但不碰会话数据）。
>
> 为什么需要第 5 步：插件生成的 `Temp\dsh-purge-asar-swap-*.ps1` 在部分 Windows 环境被安全策略拦下，`app.asar` 没被挪走。Electron 优先读 asar，补丁等于没生效；而 `reapply.js` 只要看到 asar 还在，每次启动都判「补丁已丢失」→ 重打 → 重启 → 再崩，形成循环。

### 只想用命令行装插件（不跑脚本）

```powershell
$cli = "D:\app\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
git clone <本仓库 URL> C:\Users\Administrator\.dsh\plugins\dsh-purge
& $cli plugin --profile desktop add C:\Users\Administrator\.dsh\plugins\dsh-purge
```

然后把 `profiles\desktop\package.json` 里的 `"dsh-purge": "link:..."` 改成 `"file:../../plugins/dsh-purge"`，再跑 `& $cli plugin --profile desktop install`。之后仍需按上表第 2–6 步操作。

---

## 3. 路径 B：已装上游 1.1.71、想就地升级

不用重装，直接把补丁打到现有源码上：

```powershell
$plugin = "$env:USERPROFILE\.dsh\plugins\dsh-purge"
Copy-Item $plugin\lib\core.js "$plugin\lib\core.js.bak"
git -C $plugin apply --check <本仓库>\ADAPTATION\patches\all.patch   # 先试跑
git -C $plugin apply <本仓库>\ADAPTATION\patches\all.patch
```

或直接用本仓库里 5 个已修好的文件覆盖同名文件。然后：

1. 检查运行时预设 `~/.dsh/.agent-presets/redteam/agent.cordis.yml`：若已含 `tool-subagent-list-agents ... disabled: true` 且没有 `toolFilter:`，**不要覆盖**（它可能带你自己加的约束行）；否则把修好的源码预设复制过去，先备份旧文件。
2. `node ADAPTATION\scripts\verify.mjs --plugin-dir $plugin --dsh-home $env:USERPROFILE\.dsh --harness-root "D:\app\DeepSeek Harness"`
3. 完全退出并重开 DSH，再按路径 A 的第 3–6 步走一遍。

> 如果之前已经点过「应用」且当前能正常用，只需重启让新 `index.js` 里的 cwd 注册生效，通常不用重跑应用。

---

## 4. 验证

```powershell
$node = "D:\app\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
& $node .\ADAPTATION\scripts\verify.mjs `
    --plugin-dir "$env:USERPROFILE\.dsh\plugins\dsh-purge" `
    --dsh-home "$env:USERPROFILE\.dsh" `
    --harness-root "D:\app\DeepSeek Harness" `
    --repo (Get-Location).Path --strict
```

`--strict` 会额外要求：`app.asar.bak` 存在且 `app.asar` 不存在、解包宿主完整、`dsh.cmd` 含三级回退 shim。全绿则退出码 0。

只读诊断（宿主清单、补丁状态、启动自愈判定）：

```powershell
& $node .\ADAPTATION\scripts\diag.mjs --plugin-dir "$env:USERPROFILE\.dsh\plugins\dsh-purge"
```

成品机器应看到 `desktopAsarStillSealed=false`、`patchesMatchInstallStrict=true`、`patchesLostAfterHostReset=false` → 启动走 `boot:host-untouched`，不会重打补丁、不会重启循环。

`applied.json` 为 `1.1.71`、`~/.dsh/redteam/preset-declare.json` 为 `ok:true / phase:"registered" / plugins:19`，说明清洗与红队注册都成功。

全部回归测试项目与结果见 [`docs/VERIFICATION.md`](docs/VERIFICATION.md)。

---

## 5. 日常使用

- **入口**：首页「标准模式」旁的 `dsh-purge` chip，或会话标题旁的 `dsh-purge` 标签 → 打开右侧栏「清洗 / 演练台」。它是**侧栏面板，不是模式**。
- **模式下拉里的「红队模式」** 才是本插件提供的 Agent Preset（修复后 `ok:true / registered`）。官方内置的「标准 / PTC / 极简 / 创造」一直都在。
- **必须新开一轮会话**：注入的提示词在新建会话时进上下文，旧会话不会自动补上；已产生对话的会话不能切换 preset。
- 命令：`/purge status|apply|revert|uninstall|edit`、`/rules list|use <id>`、`/skills list`、`/rewind`（回退上一轮）；命令行 `dsh-purge --status`（在插件目录用 node 跑 `bin/dsh-purge.js`）。
- 演练台首次进入要读声明 → 倒计时 → 勾三项授权；红队模式首次使用会跑环境体检。红队技能含 chisel / nuclei / sqlmap / ffuf 等命令模板，**仅限自管主机或授权演练**，插件不自动执行。
- 「REA 逆向工作台」「无限制模式」**不在这个包里**，是另外的第三方预设，本仓库没有附带。

---

## 6. 回退与卸载

```powershell
# 只还原宿主 + profile 配置（保留插件源码与 bundle 登记）
powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\rollback.ps1

# 连 bundle 登记一起去掉
powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\rollback.ps1 -RemovePlugin
```

脚本从 `~/.dsh/last-adapter-backup.txt` 指向的备份目录还原，并把 `app.asar.bak` 改回 `app.asar`、`dsh.cmd.dsh-purge.bak` 拷回 `dsh.cmd`。`resources\app`（补丁版解包目录）仍在磁盘上但会被忽略，确认官方版正常后可手动删除。

纯手工最小回退：

```powershell
Rename-Item "D:\app\DeepSeek Harness\resources\app.asar.bak" "app.asar"
Copy-Item "D:\app\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd.dsh-purge.bak" `
          "D:\app\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" -Force
```

要连**宿主代码补丁**一起还原：在插件目录执行 `node bin/dsh-purge.js --revert`，或 `node bin/dsh-purge.js --uninstall` 卸载插件。

---

## 7. 目录说明

```
<仓库根>/                 修好的 dsh-purge 1.1.71 插件本体（可直接 plugin add）
ADAPTATION/
  README.md               本操作手册
  OPTIMIZATIONS.md        6 项优化的根因、证据、改法、验证
  NOTICE.md               来源、许可、风险声明
  patches/
    all.patch             完整可审计 diff（只碰 5 个文件）
    by-file/*.patch       按文件拆开，便于逐项审阅
  scripts/
    install.ps1           Stage A 自动安装
    finalize.ps1          Stage C asar 交换 + shim（含 -StopHost / -CheckOnly）
    finalize-shim.mjs     调插件自身函数写 shim
    rollback.ps1          完整回退
    verify.mjs            通用只读验证（--strict）
    diag.mjs              只读诊断
  docs/
    TROUBLESHOOTING.md    5 个故障现象 → 根因 → 处置
    VERIFICATION.md       全部回归测试清单与结果
  tests/*.mjs             本机实测脚本（路径硬编码，见 tests/README.md）
```

故障速查见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。
