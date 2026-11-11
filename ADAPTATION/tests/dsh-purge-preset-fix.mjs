import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'C:/Users/Administrator/.dsh/plugins/dsh-purge'
const HOST = 'D:/app/DeepSeek Harness/resources/app/dsh/node_modules'
const targets = [
  path.join(PLUGIN, 'presets/redteam/agent.cordis.yml'),
  'C:/Users/Administrator/.dsh/.agent-presets/redteam/agent.cordis.yml',
]

const OLD_ROW = `    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
      disabled: false`

const NEW_ROW = `    # 0.2.2-rc.1: dsh-tool-subagent-control 只导出 "." 主入口；list-agents 子路径
    # 已合并进上面的 tool-subagent-control 行（同一个 apply() 注册 list_agents /
    # send_message / interrupt_agent）。旧子路径解析失败会让整份预设被下拉过滤，
    # 因此禁用这条冗余行，三个工具仍由主入口提供，能力不减。
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
      disabled: true`

const OLD_FILTER = `        # 子智能体是角色执行者（信息收集/资产梳理/漏洞发现/漏洞利用/内网渗透），**必须是叶子节点**：
        # 靠提示词劝"不要再往下委派"是软的——模型完全可以无视。这里直接把委派工具从子会话的
        # 工具目录里摘掉，子智能体连看都看不到 subagent / subagent_fork / workflow / ralph。
        # maxDepth 同时收成 1 作为二道保险（默认 3 层太深，会白吃并发预算与上下文）。
        maxDepth: 1
        # 注意：不能 deny \`subagent\` —— 它是这一行自己注册的 scoped 工具，不在全局工具库里，
        # 写进 deny 会让 tools.restrict() 校验失败、整个委派路径报 "unknown global tool"（v0.8.0 踩过）。
        # 子智能体拿不到 subagent_fork/workflow/ralph，加上 maxDepth: 1，实际已无派发能力。
        toolFilter:
          deny:
            - subagent_fork
            - workflow
            - ralph`

const NEW_FILTER = `        # 子智能体是角色执行者（信息收集/资产梳理/漏洞发现/漏洞利用/内网渗透），**必须是叶子节点**。
        # 0.2.2-rc.1 起 tool-subagent 不再接受 toolFilter / persona（遇到直接抛错，
        # 整份预设会 broken 并被模式下拉过滤）。新版由宿主的 Agent Preset 继承限制
        # 接管子智能体的委派工具；这里保留 maxDepth: 1 作为硬上限，子智能体仍无法再往下派发。
        maxDepth: 1`

for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const text = raw.replace(/\r\n/g, '\n')
  const nRow = text.split(OLD_ROW).length - 1
  const nFilter = text.split(OLD_FILTER).length - 1
  if (nRow !== 1 || nFilter !== 1) {
    console.log(`SKIP ${file}: row=${nRow} filter=${nFilter} (expected 1/1)`)
    process.exitCode = 1
    continue
  }
  let out = text.replace(OLD_ROW, NEW_ROW).replace(OLD_FILTER, NEW_FILTER)
  if (crlf) out = out.replace(/\n/g, '\r\n')
  fs.writeFileSync(file, out, 'utf8')
  console.log(`PATCHED ${file} (${crlf ? 'CRLF' : 'LF'}, ${raw.length} -> ${out.length} bytes)`)
}

// ---- verification ----------------------------------------------------------
const { readPresetDefinition } = await import(pathToFileURL(path.join(PLUGIN, 'lib/redteam/preset-composition.js')).href)
const req = createRequire(path.join(HOST, 'probe.cjs'))
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); ok ? pass++ : fail++ }

for (const [label, dir] of [['source', path.join(PLUGIN, 'presets/redteam')], ['installed', 'C:/Users/Administrator/.dsh/.agent-presets/redteam']]) {
  console.log(`\n=== verify ${label} ===`)
  const text = fs.readFileSync(path.join(dir, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n')
  check(`${label}: no toolFilter anywhere`, !text.includes('toolFilter:'))
  check(`${label}: list-agents row disabled`, /- id: tool-subagent-list-agents[\s\S]{0,220}?disabled: true/.test(text))
  check(`${label}: maxDepth 1 still present`, /maxDepth: 1\b/.test(text))
  check(`${label}: primary control row still enabled`, /- id: tool-subagent-control[\s\S]{0,160}?disabled: false/.test(text))

  let def
  try { def = readPresetDefinition('redteam', dir) } catch (e) { check(`${label}: definition parses`, false, e.message); continue }
  check(`${label}: definition parses`, true)
  check(`${label}: preset name preserved`, def.name === '红队模式', String(def.name))
  check(`${label}: plugin rows still 19`, def.plugins.length === 19, String(def.plugins.length))

  const rows = []
  const walk = (list) => { for (const r of list) { rows.push(r); if (r.group === true && Array.isArray(r.config)) walk(r.config) } }
  walk(def.plugins)
  const active = rows.filter((r) => r.disabled !== true && !String(r.name).startsWith('cordis:') && !String(r.name).startsWith('dsh-purge/'))
  const unresolvable = []
  const fatal = []
  for (const r of active) {
    if (!String(r.name).startsWith('file:')) { try { req.resolve(String(r.name)) } catch { unresolvable.push(String(r.name)) } }
    if (r.config && typeof r.config === 'object' && !Array.isArray(r.config)) {
      if (Object.hasOwn(r.config, 'toolFilter')) fatal.push(`${r.id}:toolFilter`)
      if (Object.hasOwn(r.config, 'persona')) fatal.push(`${r.id}:persona`)
    }
  }
  check(`${label}: all ${active.length} non-file active rows resolvable`, unresolvable.length === 0, unresolvable.join(', '))
  check(`${label}: no fatal 0.2.2 config fields`, fatal.length === 0, fatal.join(', '))
  const listRow = rows.find((r) => r.id === 'tool-subagent-list-agents')
  check(`${label}: redundant list-agents row disabled in parsed rows`, listRow?.disabled === true, JSON.stringify(listRow?.disabled))
}

// source vs installed should still differ only by the one pre-existing extra line
const a = fs.readFileSync(targets[0], 'utf8').replace(/\r\n/g, '\n').split('\n')
const b = fs.readFileSync(targets[1], 'utf8').replace(/\r\n/g, '\n').split('\n')
const onlyInB = b.filter((l) => !a.includes(l))
check('source/installed still differ only by the one pre-existing host-guide line', onlyInB.length === 1 && onlyInB[0].includes('spawn_teammate'), JSON.stringify(onlyInB.slice(0, 2)))

console.log(`\n=== TOTAL ${pass} passed, ${fail} failed ===`)
if (fail) process.exitCode = 1
