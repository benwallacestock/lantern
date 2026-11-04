// After `npm install -g @benwallacestock/lantern`: link the skills that ship in the package into the agents' skills
// folders (~/.claude/skills, and Codex's), so the one install is the whole setup and every update brings the new
// skills along. Only for a global install (npm sets npm_config_global), never in CI, never when LANTERN_SKILLS=off,
// and never a reason for the install to fail.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '..', 'dist', 'lantern.js')
const off = process.env.npm_config_global !== 'true' || process.env.CI || /^(off|false|0)$/i.test(process.env.LANTERN_SKILLS ?? '') || !fs.existsSync(cli)
if (!off) {
  try { process.stdout.write(execFileSync(process.execPath, [cli, 'skills', 'install'], { env: { ...process.env, LANTERN_UPDATE: 'off' } }).toString()) }
  catch (e) { console.log(`lantern: could not link the skills (${e?.message?.split('\n')[0]}); \`lantern skills install\` does it`) }
}
