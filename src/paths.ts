// Where lantern keeps things. One Chrome per project (the git root, or the folder lantern was run from), so each
// has its own socket, profile and log under ~/.lantern; pictures and videos go in the project, under tmp/lantern,
// because that is the one place an agent is always allowed to read.
import crypto from 'node:crypto'
import { readConfig } from './config.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const home = process.env.LANTERN_HOME || path.join(os.homedir(), '.lantern')

export function paths(root: string) {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)
  return {
    home, key, root,
    sock: path.join(home, 'run', `${key}.sock`),
    pid: path.join(home, 'run', `${key}.pid`),
    build: path.join(home, 'run', `${key}.build`),
    log: path.join(home, 'log', `${key}.log`),
    profile: path.join(home, 'profiles', key),
    out: path.resolve(root, readConfig(root).out ?? path.join('tmp', 'lantern')),
  }
}

/** Which lantern this is: the version and when its entry file was written, so a daemon started by an earlier
 * install can be told apart from the CLI talking to it (the daemon keeps the code it started with). */
export function buildId(): string {
  const entry = process.argv[1]
  let version = '?', written = 0
  try { version = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version } catch {}
  try { written = Math.round(fs.statSync(entry).mtimeMs) } catch {}
  return `${version}@${written}`
}
