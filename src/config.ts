// Settings for a project. Any folder from the project up to the root of the filesystem can hold `.lantern/settings.json`;
// the nearer the file, the stronger, merged key by key — the way Claude Code reads its .claude folders. Your own
// ~/.lantern/settings.json is the top of that walk (and is read even for a project outside your home). The environment
// of the command that starts the daemon (LANTERN_URL, LANTERN_ON_LOAD, …) wins over every file. So: a team commits
// .lantern/settings.json in the repo for the app's URL and hosts; a tool that keeps many checkouts under one folder
// puts what they share (a dev login) in that folder's .lantern/settings.json and never touches a checkout; a person
// customises one run with LANTERN_*. The keys:
//
//   url     where relative paths go the first time: "http://localhost:3000"
//   hosts   the only hosts the page may visit (comma-separated, or an array): "app.localhost,api.app.localhost"
//   out     where pictures and videos go, relative to the project root: "tmp/lantern"
//   note    a word for the frame's footer — a ticket, say: "SPR-123"
//   onLoad  JavaScript to run in the page after every load — a dev login, say
//   watermark  false to leave the banner off videos and "made with lantern" out of a frame's footer
//   footer  the frame's footer, in place of "lantern · note · branch · time"
//   branch  false to leave the branch name out of the footer and banner
//   accent  the colour of highlights, click rings and the glyph: "#ff7a2f"
//   update  false to stop the daemon's daily check for a newer lantern
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Config = { url?: string; hosts?: string[]; out?: string; note?: string; onLoad?: string; watermark?: boolean; footer?: string; accent?: string; update?: boolean; branch?: boolean }
export const KEYS = ['url', 'hosts', 'out', 'note', 'onLoad', 'watermark', 'footer', 'accent', 'update', 'branch'] as const

/** lantern's own folder (LANTERN_HOME, or ~/.lantern), and the hash every instance of a project shares. */
/** lantern's own folder (LANTERN_HOME, or ~/.lantern), and the hash every instance of a project shares. */
export const home = process.env.LANTERN_HOME || path.join(os.homedir(), '.lantern')
export const projectKey = (root: string) => { let real = root; try { real = fs.realpathSync(root) } catch {}; return crypto.createHash('sha1').update(real).digest('hex').slice(0, 12) }
/** The user's own settings: the top of the walk. */
export const userSettingsFile = () => path.join(home, 'settings.json')

const ENV: Record<(typeof KEYS)[number], string> = { url: 'LANTERN_URL', hosts: 'LANTERN_HOSTS', out: 'LANTERN_OUT', note: 'LANTERN_NOTE', onLoad: 'LANTERN_ON_LOAD', watermark: 'LANTERN_WATERMARK', footer: 'LANTERN_FOOTER', accent: 'LANTERN_ACCENT', update: 'LANTERN_UPDATE', branch: 'LANTERN_BRANCH' }
const BOOLS = new Set(['watermark', 'update', 'branch'])
const list = (v: unknown): string[] | undefined => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? !['off', 'false', '0'].includes(v.toLowerCase()) : undefined)
const readJson = (f: string): Record<string, unknown> => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }

/** The settings files that apply to a project: .lantern/settings.json from the project folder up, nearest first, then the user's own. */
export function settingsFiles(root: string): string[] {
  const out: string[] = []
  let dir = path.resolve(root)
  for (;;) { const f = path.join(dir, '.lantern', 'settings.json'); if (fs.existsSync(f)) out.push(f); const up = path.dirname(dir); if (up === dir) break; dir = up }
  const mine = userSettingsFile(); if (!out.includes(mine) && fs.existsSync(mine)) out.push(mine)
  return out
}

/** The settings in force for a project, and where each came from: 'environment', or the path of the file. */
export function readSettings(root: string): { config: Config; sources: Partial<Record<(typeof KEYS)[number], string>>; files: string[]; userFile: string } {
  const files = settingsFiles(root)
  const layers: [string, Record<string, unknown>][] = [['environment', Object.fromEntries(KEYS.map((k) => [k, process.env[ENV[k]]]))], ...files.map((f): [string, Record<string, unknown>] => [f, readJson(f)])]
  const config: Config = {}, sources: Partial<Record<(typeof KEYS)[number], string>> = {}
  for (const k of KEYS) {
    for (const [source, layer] of layers) {
      const raw = layer[k]
      if (raw === undefined || raw === null || raw === '') continue
      const v = k === 'hosts' ? list(raw) : BOOLS.has(k) ? bool(raw) : String(raw)
      if (v === undefined) continue
      ;(config as any)[k] = v; sources[k] = source; break
    }
  }
  return { config, sources, files, userFile: userSettingsFile() }
}

export const readConfig = (root: string): Config => readSettings(root).config

/** Is this host one the page may visit? With no list, anywhere. */
export const hostAllowed = (hosts: string[] | undefined, host: string) => !hosts?.length || hosts.some((h) => host === h || host.endsWith('.' + h))
