// Keeping lantern current, so the agent is always driving the latest: the daemon asks npm once a day whether there
// is a newer lantern, and when this is a global npm install it puts the new one in, in the background. The next
// command notices the build changed and restarts the daemon (bin/lantern.ts), so the update just lands. The skills
// that ship in the package are linked into the agent's skills folder by `lantern skills install`, so they come
// along with every update. `lantern update` does the check and the install on demand; LANTERN_UPDATE=off (or
// `update: false` in a settings file) turns the daily check off.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const NAME = '@benwallacestock/lantern'
const REGISTRY = () => process.env.LANTERN_REGISTRY || 'https://registry.npmjs.org'
const DAY = 24 * 60 * 60_000

/** Where this lantern lives: the package root (holding skills/ and package.json), from either entry file. The entry
 * is reached through a symlink when installed (<prefix>/bin/lantern → …/node_modules/@benwallacestock/lantern/dist/lantern.js), so: the real path. */
export const entryFile = () => { try { return fs.realpathSync(process.argv[1]) } catch { return process.argv[1] } }
export const packageRoot = () => path.join(path.dirname(entryFile()), '..')
export const version = () => { try { return String(JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version) } catch { return '0.0.0' } }
/** Installed with `npm install -g` (as opposed to run from a checkout, or by npx from its cache): the one kind we can update in place. */
export const isGlobalInstall = () => { const p = packageRoot().split(path.sep).join('/'); return p.includes('/node_modules/' + NAME) && !p.includes('/_npx/') }
export const npmBin = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm')

export const newer = (a: string, b: string) => { // a > b, for x.y.z (anything else never counts as newer)
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n))) return false
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i]
  return false
}

/** What npm says the latest lantern is, or null when it cannot be reached in time. */
export async function latest(timeoutMs = 4000): Promise<string | null> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(`${REGISTRY()}/${NAME.replace('/', '%2F')}/latest`, { signal: ac.signal, headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const v = (await r.json())?.version
    return typeof v === 'string' ? v : null
  } catch { return null } finally { clearTimeout(t) }
}

type Memo = { checked?: number; latest?: string; installing?: string }
const memoFile = (home: string) => path.join(home, 'update.json')
export const readMemo = (home: string): Memo => { try { return JSON.parse(fs.readFileSync(memoFile(home), 'utf8')) } catch { return {} } }
const writeMemo = (home: string, m: Memo) => { try { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(memoFile(home), JSON.stringify(m)) } catch {} }

/** The daily check, from the daemon: never blocks a command, never runs twice a day, only installs a global npm install. */
export async function dailyCheck(home: string, log: (...a: unknown[]) => void, enabled = true): Promise<void> {
  if (!enabled || !isGlobalInstall()) return
  const memo = readMemo(home)
  if (memo.checked && Date.now() - memo.checked < DAY) return
  const v = await latest()
  writeMemo(home, { ...memo, checked: Date.now(), latest: v ?? memo.latest })
  if (!v || !newer(v, version()) || memo.installing === v) return
  writeMemo(home, { checked: Date.now(), latest: v, installing: v })
  log(`lantern ${v} is out (this is ${version()}): installing it in the background`)
  // Detached, with its own log: the daemon may stop before npm is done, and that is fine.
  try {
    fs.mkdirSync(path.join(home, 'log'), { recursive: true })
    const out = fs.openSync(path.join(home, 'log', 'update.log'), 'a')
    spawn(npmBin(), ['install', '-g', `${NAME}@${v}`], { detached: true, stdio: ['ignore', out, out] }).unref()
  } catch (e) { log('could not start the update:', (e as Error).message) }
}

/** `lantern update`: check now, install now (when this is a global install), say what happened. */
export async function updateNow(home: string): Promise<{ ok: boolean; text: string }> {
  const cur = version(), v = await latest(8000)
  if (!v) return { ok: false, text: `could not reach npm to check for a newer lantern (this is ${cur})` }
  writeMemo(home, { ...readMemo(home), checked: Date.now(), latest: v })
  if (!newer(v, cur)) return { ok: true, text: `lantern ${cur} is the latest` }
  if (!isGlobalInstall()) return { ok: true, text: `lantern ${v} is out (this is ${cur}). This copy is not a global npm install, so update it where it came from — \`npm install -g ${NAME}\` to have one that keeps itself current.` }
  const log = await new Promise<string>((res) => execFile(npmBin(), ['install', '-g', `${NAME}@${v}`], { maxBuffer: 1 << 24 }, (e, so, se) => res(e ? `${se || so || e.message}` : '')))
  if (log) return { ok: false, text: `npm could not install ${v}:\n${log.trim().slice(-600)}` }
  writeMemo(home, { checked: Date.now(), latest: v, installing: v })
  return { ok: true, text: `lantern ${cur} → ${v}. The browser restarts on the next command; the skills, if \`lantern skills install\` linked them, are already the new ones.` }
}

/** A one-line hint for `lantern version`, when the last check saw something newer. */
export function updateHint(home: string): string {
  const m = readMemo(home)
  return m.latest && newer(m.latest, version()) ? (isGlobalInstall() ? ` — ${m.latest} is out and installs itself with the next daemon start; \`lantern update\` does it now` : ` — ${m.latest} is out: \`lantern update\``) : ''
}

// ---- skills: the ones in this package, linked where the agents look

/** Where each agent reads personal skills from. Codex only when it is set up on this machine. */
export function skillHomes(): { agent: string; dir: string }[] {
  const home = os.homedir()
  const out = [{ agent: 'Claude Code', dir: path.join(home, '.claude', 'skills') }]
  const codex = process.env.CODEX_HOME || path.join(home, '.codex')
  if (fs.existsSync(codex)) out.push({ agent: 'Codex', dir: path.join(codex, 'skills') })
  return out
}

export function skillsInPackage(): string[] {
  const dir = path.join(packageRoot(), 'skills')
  try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))).sort() } catch { return [] }
}

/** Link (or, from an npx cache whose path changes per version, copy) each skill into each agent's skills folder. */
export function installSkills(): string {
  const src = path.join(packageRoot(), 'skills'), names = skillsInPackage()
  if (!names.length) return `no skills found in ${src}`
  const copy = packageRoot().split(path.sep).join('/').includes('/_npx/') // a cache path that changes per version: a link would go stale
  const lines: string[] = []
  for (const { agent, dir } of skillHomes()) {
    fs.mkdirSync(dir, { recursive: true })
    for (const n of names) {
      const to = path.join(dir, n), from = path.join(src, n)
      try { const st = fs.lstatSync(to); if (st.isSymbolicLink() || st.isDirectory()) fs.rmSync(to, { recursive: true, force: true }) } catch {}
      if (copy) fs.cpSync(from, to, { recursive: true }); else fs.symlinkSync(from, to, 'junction')
    }
    lines.push(`${agent}: ${names.join(', ')} ${copy ? 'copied into' : 'linked into'} ${dir}`)
  }
  lines.push(copy ? 'Copied, since this lantern runs from the npx cache: run `lantern skills install` again after an update. A global install (`npm install -g ' + NAME + '`) links them instead, so they follow every update.' : 'Linked: they follow every lantern update, with nothing to run again.')
  return lines.join('\n')
}

export function skillsStatus(): string {
  const src = path.join(packageRoot(), 'skills'), names = skillsInPackage()
  const lines = [`skills in this lantern (${version()}): ${names.join(', ')} — in ${src}`]
  for (const { agent, dir } of skillHomes()) {
    const state = names.map((n) => {
      const to = path.join(dir, n)
      try { const st = fs.lstatSync(to); if (st.isSymbolicLink()) return `${n} → ${fs.readlinkSync(to) === path.join(src, n) ? 'this lantern' : fs.readlinkSync(to)}`; return `${n} (a copy)` } catch { return `${n} missing` }
    })
    lines.push(`${agent} (${dir}): ${state.join('; ')}`)
  }
  lines.push('`lantern skills install` links them so they follow every update.')
  return lines.join('\n')
}
