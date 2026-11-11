import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'C:/Users/Administrator/.dsh/plugins/dsh-purge'
const SRC_PRESET = 'C:/Users/Administrator/.dsh/.agent-presets/redteam'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-purge-selfheal-'))
process.env.DSH_HOME = TMP
const DEST = path.join(TMP, '.agent-presets', 'redteam')
fs.mkdirSync(DEST, { recursive: true })
for (const f of fs.readdirSync(SRC_PRESET)) fs.copyFileSync(path.join(SRC_PRESET, f), path.join(DEST, f))

const { installPreset } = await import(pathToFileURL(path.join(PLUGIN, 'lib/redteam/index.js')).href + '?t=' + Date.now())
const logs = []
let result
try { result = installPreset({ force: false, log: (m) => logs.push(m) }) }
catch (e) { console.log('installPreset THREW:', e.stack); process.exit(1) }

console.log('=== installPreset result ===')
console.log('action :', result.action)
console.log('dir    :', result.dir)
console.log('logs   :', JSON.stringify(logs, null, 2))

const after = fs.readFileSync(path.join(DEST, 'agent.cordis.yml'), 'utf8')
const before = fs.readFileSync(path.join(SRC_PRESET, 'agent.cordis.yml'), 'utf8')

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); ok ? pass++ : fail++ }

check('list-agents row still disabled after self-heal',
  /- id: tool-subagent-list-agents[\s\S]{0,260}?disabled: true/.test(after),
  (after.match(/- id: tool-subagent-list-agents[\s\S]{0,260}?disabled: (true|false)/) || [])[1] || 'no match')
check('no toolFilter reintroduced', !after.includes('toolFilter:'))
check('maxDepth: 1 preserved', /maxDepth: 1\b/.test(after))
check('primary control row still enabled', /- id: tool-subagent-control[\s\S]{0,160}?disabled: false/.test(after))
check('spawn subagent row still enabled', /- id: tool-subagent\r?\n\s+name: '@deepseek-ai\/dsh-tool-subagent'[\s\S]{0,120}?disabled: false/.test(after))
check('self-heal did not clobber the file', after.replace(/\r\n/g, '\n').trim() === before.replace(/\r\n/g, '\n').trim(),
  `before ${before.length}B / after ${after.length}B`)
check('no template placeholders left', !after.includes('{{REDTEAM_SKILLS_DIR}}'))

// other three rows must STILL be re-enabled (self-heal capability intact)
const disabledSpawn = after.replace(
  /(- id: tool-subagent\r?\n\s+name: '@deepseek-ai\/dsh-tool-subagent'\r?\n\s+)disabled: false/,
  '$1disabled: true')
check('test fixture: can temporarily disable spawn row', disabledSpawn !== after)
fs.writeFileSync(path.join(DEST, 'agent.cordis.yml'), disabledSpawn, 'utf8')
const r2 = installPreset({ force: false, log: () => {} })
const after2 = fs.readFileSync(path.join(DEST, 'agent.cordis.yml'), 'utf8')
check('self-heal still re-enables a disabled spawn row (capability intact)',
  /- id: tool-subagent\r?\n\s+name: '@deepseek-ai\/dsh-tool-subagent'\r?\n\s+disabled: false/.test(after2))
check('self-heal still leaves list-agents disabled',
  /- id: tool-subagent-list-agents[\s\S]{0,260}?disabled: true/.test(after2))
console.log('\nr2.action:', r2.action)

console.log(`\n=== TOTAL ${pass} passed, ${fail} failed ===`)
fs.rmSync(TMP, { recursive: true, force: true })
if (fail) process.exitCode = 1
