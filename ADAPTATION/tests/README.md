# 本机实测脚本

这些是 2026-11-09 当天在适配过程中写的一次性回归脚本，**原样保留作为证据**。它们把本机绝对路径写死了，例如：

- `C:/Users/Administrator/.dsh/plugins/dsh-purge`
- `D:/app/DeepSeek Harness/resources/app/...`
- `C:/Users/Administrator/AppData/Local/Temp/...`

要在你自己的机器上跑，请把上述路径替换成实际路径；或者直接使用 `../scripts/verify.mjs` 和 `../scripts/diag.mjs` —— 那两个是参数化的通用版本，也是 `install.ps1` / `finalize.ps1` 实际调用的。

| 文件 | 用途 |
|---|---|
| `dsh-purge-fix-test.mjs` | T1：备份容错 9/9 |
| `dsh-purge-equiv-test.mjs` | T2：原版 vs 修复版功能等价 7/7 |
| `dsh-purge-diag-hosts.mjs` | T9：宿主清单与终检只读诊断 |
| `dsh-purge-preset-resolve.mjs` | T5：预设 19 行可解析性扫描 |
| `dsh-purge-022-test.mjs` | T3：补丁 40 适配 36/36 |
| `dsh-purge-022-apply.mjs` | T4：把补丁 40 产出写进宿主 11/11 |
| `dsh-purge-preset-fix.mjs` | T6：红队预设修复 21/21 |
| `dsh-purge-selfheal-test.mjs` | T7：启动自愈不覆盖修复 10/10 |
| `dsh-purge-cwd-test.mjs` | T8：`{{cwd}}` 变量 22/22 |

结果汇总见 [`../docs/VERIFICATION.md`](../docs/VERIFICATION.md)。

> 注意：`dsh-purge-022-apply.mjs` 和 `dsh-purge-preset-fix.mjs` **会写文件**，不要在生产宿主上随手跑。
