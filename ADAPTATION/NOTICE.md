# 来源、许可与风险声明

## 来源链

| 项 | 值 |
|---|---|
| 本仓库基线 | `jeromedengyj-lab/dsh-purge-1.1.71`，commit `719a741ddda2b888920a1586dea9eb396af3ea1b` |
| 上游镜像 | `ZXEB/dsh-purge`（236 star），commit / tree SHA 与本仓库基线**完全一致**，为原样快照 |
| 原始作者 | `YuJunZhiXue/dsh-purge` v1.1.71 —— 原仓库与 npm 包均已删除 |
| 插件版本 | 1.1.71，包名 `dsh-purge`，`type: module`，主入口 `lib/index.js` |
| 适用宿主 | DeepSeek Harness 桌面版 **0.2.2-rc.1**（Windows） |
| 适配日期 | 2026-11-09（整理成仓库：2026-11-12） |

来源核实方法：比对 GitHub API 返回的 commit SHA 与 tree SHA，两者（`719a741…` / `aa4449d…`）与上游一致，未夹带私货。由于原始仓库已删除，无法与作者原始签名比对；上游属于第三方「镜像重建版」，请自行判断是否信任。

## 许可

插件本体为 **MIT License**，版权声明 `Copyright (c) 2026 小杨`，见仓库根 `LICENSE`。本仓库保留该声明；`ADAPTATION/` 下的补丁、脚本与文档同样以 MIT 提供。MIT 允许修改与再分发，条件是保留版权与许可声明。

## 本适配版的改动范围

只改 5 个文件：`lib/core.js`、`lib/desktop.js`、`lib/index.js`、`lib/redteam/index.js`、`presets/redteam/agent.cordis.yml`。完整可审计 diff 见 `patches/all.patch`。所有改动均为「版本适配 / 错误兜底」，未新增功能、未新增依赖、未新增外部请求。

## 使用前必须知道的风险（上游行为，本适配版原样保留）

1. **权限提升**：插件会把 `DSH_PERMISSION_MODE` 改成 `danger-full-access`，并清空系统身份前缀（`personaPrefix`）。
2. **改写宿主**：备份并改写 `@deepseek-ai/*` 包产物、解包 `app.asar` 成 `resources/app/`（约 492MB）、注入 CLI shim、注册 hooks。本仓库的 `finalize.ps1` 还会把 `app.asar` 改名为 `app.asar.bak`。
3. **不可直接审计的提示词**：默认提示词以 **AES-256-GCM 加密内置**在 `lib/table-read.js`，内容无法静态审阅。
4. **红队技能文档**：`skills/redteam/` 含 chisel 隧道、nuclei、sqlmap、ffuf、代理池、FOFA API 等命令模板。README 声明仅限自管主机 / 授权演练、不自动执行，但确实附带这些内容。
5. **网络行为**：上游主要为 GitHub / codeload / jsdelivr 的更新检查；本适配版没有新增任何联网请求。
6. **数据安全**：脚本会自动备份 profile 配置、`app.asar` 和 `dsh.cmd`，但**不备份会话数据**。操作前建议自行备份 `~/.dsh/sessions/` 与 `~/.dsh/storages/`。

请仅在自己拥有或获得明确授权的环境中使用。作者与本仓库维护者不对误用、数据丢失或违反当地法律法规的行为负责。

##  trademarks

DeepSeek Harness、DeepSeek 及相关名称归各自权利人所有。本仓库是非官方的第三方适配，与官方无隶属或背书关系。
