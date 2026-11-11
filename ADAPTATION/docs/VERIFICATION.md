# 验证记录

所有测试都在 `Windows / DeepSeek Harness 0.2.2-rc.1 / Node 22.x` 上实测。原始脚本保存在 `ADAPTATION/tests/`（路径硬编码在本机，复用前请看 `tests/README.md`）。

## 汇总

| 编号 | 测试 | 结果 | 覆盖内容 |
|---|---|---|---|
| T1 | `dsh-purge-fix-test.mjs` | **9/9** | 精确复现 rename ENOENT、EPERM、已存在 `.bak`、先备份后改写、零 unhandled rejection、零 `.copytmp` 残留 |
| T2 | `dsh-purge-equiv-test.mjs` | **7/7** | 原版 vs 修复版对同一假宿主跑 `repairOfficialCliAfterUnpack`，产出 `dsh.cmd` 逐字节一致 562B；修复版备份 pristine 243B |
| T3 | `dsh-purge-022-test.mjs` | **36/36** | 补丁 40：官方原文 / 已打补丁两种输入、替换触发、幂等、无重复注入、语法、vm 运行时保留三段、normal 模式不变 |
| T4 | `dsh-purge-022-apply.mjs` | **11/11** | 把补丁 40 产出写入当前宿主文件 |
| T5 | `dsh-purge-preset-resolve.mjs` | 递归扫描 | 19 行插件、25 条启用行全部可解析，定位 3 处疑似问题（1 处本就 disabled） |
| T6 | `dsh-purge-preset-fix.mjs` | **21/21** | 预设两副本、无 `toolFilter`、19 行不变、25 条 active 行可解析、无致命字段 |
| T7 | `dsh-purge-selfheal-test.mjs` | **10/10** | 临时 `DSH_HOME` 跑真实 `installPreset({force:false})`：自愈不改回 `disabled`、其余三行重新启用能力完好 |
| T8 | `dsh-purge-cwd-test.mjs` | **22/22** | 用宿主真实 `renderPrompt()` 复现 `{{cwd}}` 报错，补变量后渲染成 `Your working directory is D:\DSH.`；provider 四级取值、null context、duplicate、能力文件原文 |
| T9 | `dsh-purge-diag-hosts.mjs` | 只读诊断 | 宿主清单、`patchStatus`、`hostWritten`、终检判定 |
| T10 | `scripts/verify.mjs` | 通用 | F1–F6 标记、4 个 JS 语法、能力文件、`all.patch` 范围、宿主/运行时状态（`--strict`） |

合计：**116+ 项断言全部通过**（T5/T9/T10 为诊断型，无固定计数）。

## 关键等价性结论

「不影响插件能力」不是口头保证，有三层实证：

1. **改动范围**：`git diff --name-only` 只有 5 个文件；`client.js`、`cordis.patch.yml`、`bin/dsh-purge.js`、`lib/hooks-deny.js`、`lib/table-read.js`、`lib/host-clean.js`、`lib/phase1-keep.js`、`lib/surface.js`、`lib/extract-asar.js` 与上游 HEAD 哈希完全一致。生成补丁内容的 `patchOfficialCliCmdText`、写盘的 `atomicWriteSync` 一字未改。
2. **端到端产出**：原版与修复版跑同一个 `repairOfficialCliAfterUnpack`，`dsh.cmd` 逐字节相同（562B），`report.shims` 同为 `["missing","patched"]` —— shim 注入能力完全一致。
3. **兜底语义**：成功路径仍是 `tmp + rename` 原子写；只有 rename 失败才退化为一次普通 `copyFile`，备份照样生成。只有连普通复制都失败才抛给调用方。

反向发现：原版因漏 await，备份的是**已注入 shim 的 562B**，`--revert` 永远还原不回官方原文。修复版备份 243B pristine，**还原能力是被修正确了，不是被削弱**。

## 终态复验（宿主侧）

```
patch 40                    applied
pending patches             0
allPatchHostsWritten        true
desktopAsarStillSealed      false
patchesMatchInstallStrict   true
patchesLostAfterHostReset   false
=> boot:host-untouched, no re-apply, no restart loop
```

`applied.json` = `1.1.71`；`preset-declare.json` = `ok:true / phase:"registered" / plugins:19`；`dsh.cmd --version` = `0.2.2-rc.1`（exit 0）；`app.asar.bak` = 213,202,918 字节（11-04 原件）；`dsh.cmd` = 562B 三级回退，官方原文存于 `.dsh-purge.bak`。

## 未验证 / 已知边界

- 未在 macOS / Linux、web / TUI / headless profile、dsh 0.1.x / 0.3+ 上验证。
- 「真实发消息端到端」在本机由用户确认「正常了没报错」，但未做额度消耗的自动化回归。
- `skills/redteam/` 的红队命令模板只做静态审查，未执行任何演练动作。
- AES 加密的内置提示词内容无法静态审计（上游设计）。
