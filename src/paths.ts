// Where lantern keeps things. One Chrome per project (the git root, or the folder lantern was run from), so each
// has its own socket, profile and log under ~/.lantern; pictures and videos go in the project, under tmp/lantern,
// because that is the one place an agent is always allowed to read.
import crypto from 'node:crypto'
import { readConfig } from './config.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const home = process.env.LANTERN_HOME || path.join(os.homedir(), '.lantern')

/** A name for one of several lanterns on the same project (parallel agents): letters, digits, dashes, dots; LANTERN_NAME or --name. */
export const cleanName = (name?: string) => { const n = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32); return n || undefined }
/** The hash every instance of a project shares: <hash>.sock is the unnamed one, <hash>-<name>.sock a named one. */
export const projectKey = (root: string) => crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)

export function paths(root: string, name?: string) {
  const base = projectKey(root), key = name ? `${base}-${name}` : base
  const out = path.resolve(root, readConfig(root).out ?? path.join('tmp', 'lantern'))
  return {
    home, key, root, name, base,
    sock: path.join(home, 'run', `${key}.sock`),
    pid: path.join(home, 'run', `${key}.pid`),
    build: path.join(home, 'run', `${key}.build`),
    log: path.join(home, 'log', `${key}.log`),
    profile: path.join(home, 'profiles', key),
    out: name ? path.join(out, name) : out, // a named lantern's pictures in a folder of their own
  }
}

/** The instances of a project that are up: their names ('' for the unnamed one), from the sockets under ~/.lantern/run. */
export function instances(root: string): string[] {
  const base = projectKey(root)
  try { return fs.readdirSync(path.join(home, 'run')).filter((f) => f.endsWith('.sock') && (f === `${base}.sock` || f.startsWith(`${base}-`))).map((f) => f.slice(base.length, -5).replace(/^-/, '')).sort() } catch { return [] }
}

/** Which lantern this is: the version and when its entry file was written, so a daemon started by an earlier
 * install can be told apart from the CLI talking to it (the daemon keeps the code it started with). */
export function buildId(): string {
  let entry = process.argv[1]; try { entry = fs.realpathSync(entry) } catch {} // the installed command is a symlink to the bundle
  let version = '?', written = 0
  try { version = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version } catch {}
  try { written = Math.round(fs.statSync(entry).mtimeMs) } catch {}
  return `${version}@${written}`
}
