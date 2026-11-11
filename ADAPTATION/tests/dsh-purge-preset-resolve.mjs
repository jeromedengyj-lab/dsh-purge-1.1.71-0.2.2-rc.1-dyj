import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'C:/Users/Administrator/.dsh/plugins/dsh-purge'
const HOST = 'D:/app/DeepSeek Harness/resources/app/dsh/node_modules'
const installed = 'C:/Users/Administrator/.dsh/.agent-presets/redteam'

const { readPresetDefinition } = await import(pathToFileURL(path.join(PLUGIN, 'lib/redteam/preset-composition.js')).href)
const req = createRequire(path.join(HOST, 'probe.cjs'))

let problems = []
function walk(rows, prefix) {
  for (const [i, row] of rows.entries()) {
    const tag = `${prefix}${i + 1}`
    const n = String(row.name || '')
    const flags = []
    if (row.config && typeof row.config === 'object' && !Array.isArray(row.config)) {
      if (Object.hasOwn(row.config, 'toolFilter')) flags.push('HAS toolFilter (FATAL on 0.2.2-rc.1)')
      if (Object.hasOwn(row.config, 'persona')) flags.push('HAS persona (FATAL on 0.2.2-rc.1)')
    }
    let resolvable = 'n/a'
    if (!n.startsWith('cordis:') && !n.startsWith('file:') && !n.startsWith('dsh-purge/')) {
      try { req.resolve(n); resolvable = 'OK' } catch { resolvable = 'UNRESOLVABLE' }
    }
    const short = n.length > 72 ? n.slice(0, 69) + '...' : n
    console.log(`  ${tag.padEnd(7)} ${resolvable.padEnd(13)} ${short}${flags.length ? '  << ' + flags.join('; ') : ''}`)
    if (resolvable === 'UNRESOLVABLE' || flags.length) problems.push({ tag, name: n, issue: `${resolvable} ${flags.join('; ')}` })
    if (row.group === true && Array.isArray(row.config)) walk(row.config, `${tag}.`)
  }
}

for (const [label, dir] of [['plugin source', path.join(PLUGIN, 'presets/redteam')], ['installed preset', installed]]) {
  console.log(`\n=== ${label}: ${dir} ===`)
  problems = []
  let def
  try { def = readPresetDefinition('redteam', dir) } catch (e) { console.log('READ FAILED:', e.message); continue }
  console.log(`name=${JSON.stringify(def.name)} order=${def.order} top-level plugins=${def.plugins.length}`)
  walk(def.plugins, '')
  console.log(`  --> real problems: ${problems.length}`)
  for (const p of problems) console.log('      ', p.tag, p.name, p.issue)
}
