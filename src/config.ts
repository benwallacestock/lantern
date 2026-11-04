// Settings for a project, from three places, the first that has a value winning:
//   1. the environment of the command that starts the daemon (LANTERN_URL, LANTERN_ON_LOAD, …) — what a tool wrapping
//      lantern sets for the sessions it spawns
//   2. ~/.lantern/projects/<hash>.json — lantern's own folder, outside the repository: for this machine's settings, a
//      dev login with a password in it, anything that must not be committed. `lantern settings` prints its path.
//   3. .lantern.json at the project root — for a team that chooses to commit the project's URL and hosts
//   4. ~/.lantern/settings.json — the user's defaults for every project (an accent, the footer, update: false)
//
//   url     where relative paths go the first time: "http://localhost:3000"
//   hosts   the only hosts the page may visit (comma-separated, or an array): "app.localhost,api.app.localhost"
//   out     where pictures and videos go, relative to the project root: "tmp/lantern"
//   note    a word for the frame's footer — a ticket, say: "SPR-123"
//   onLoad  JavaScript to run in the page after every load — a dev login, say
//   watermark  false to leave the banner off videos and "made with lantern" out of a frame's footer
//   footer  the frame's footer, in place of "lantern · note · branch · time"
//   branch  false to leave the branch name out of the footer and banner (a branch named after an internal environment, say)
//   accent  the colour of highlights, click rings and the frame's glyph: "#ff7a2f"
//   update  false to stop the daemon's daily check for a newer lantern (LANTERN_UPDATE=off in the environment)
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Config = { url?: string; hosts?: string[]; out?: string; note?: string; onLoad?: string; watermark?: boolean; footer?: string; accent?: string; update?: boolean; branch?: boolean }
export const KEYS = ['url', 'hosts', 'out', 'note', 'onLoad', 'watermark', 'footer', 'accent', 'update', 'branch'] as const
export type Source = 'environment' | 'home' | 'repo' | 'user'

/** lantern's own folder (LANTERN_HOME, or ~/.lantern), and the hash every instance of a project shares. */
export const home = process.env.LANTERN_HOME || path.join(os.homedir(), '.lantern')
export const projectKey = (root: string) => { let real = root; try { real = fs.realpathSync(root) } catch {}; return crypto.createHash('sha1').update(real).digest('hex').slice(0, 12) }
/** The settings file for a project in lantern's folder: outside the repository, for what must not be committed. */
export const homeSettingsFile = (root: string) => path.join(home, 'projects', `${projectKey(root)}.json`)
/** The user's defaults for every project. */
export const userSettingsFile = () => path.join(home, 'settings.json')

const ENV: Record<(typeof KEYS)[number], string> = { url: 'LANTERN_URL', hosts: 'LANTERN_HOSTS', out: 'LANTERN_OUT', note: 'LANTERN_NOTE', onLoad: 'LANTERN_ON_LOAD', watermark: 'LANTERN_WATERMARK', footer: 'LANTERN_FOOTER', accent: 'LANTERN_ACCENT', update: 'LANTERN_UPDATE', branch: 'LANTERN_BRANCH' }
const BOOLS = new Set(['watermark', 'update', 'branch'])
const list = (v: unknown): string[] | undefined => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? !['off', 'false', '0'].includes(v.toLowerCase()) : undefined)
const readJson = (f: string): Record<string, unknown> => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }

/** The settings in force for a project, and where each came from. */
export function readSettings(root: string): { config: Config; sources: Partial<Record<(typeof KEYS)[number], Source>>; homeFile: string; repoFile: string; userFile: string } {
  const homeFile = homeSettingsFile(root), repoFile = path.join(root, '.lantern.json'), userFile = userSettingsFile()
  const layers: [Source, Record<string, unknown>][] = [['environment', Object.fromEntries(KEYS.map((k) => [k, process.env[ENV[k]]]))], ['home', readJson(homeFile)], ['repo', readJson(repoFile)], ['user', readJson(userFile)]]
  const config: Config = {}, sources: Partial<Record<(typeof KEYS)[number], Source>> = {}
  for (const k of KEYS) {
    for (const [source, layer] of layers) {
      const raw = layer[k]
      if (raw === undefined || raw === null || raw === '') continue
      const v = k === 'hosts' ? list(raw) : BOOLS.has(k) ? bool(raw) : String(raw)
      if (v === undefined) continue
      ;(config as any)[k] = v; sources[k] = source; break
    }
  }
  return { config, sources, homeFile, repoFile, userFile }
}

export const readConfig = (root: string): Config => readSettings(root).config

/** Is this host one the page may visit? With no list, anywhere. */
export const hostAllowed = (hosts: string[] | undefined, host: string) => !hosts?.length || hosts.some((h) => host === h || host.endsWith('.' + h))
