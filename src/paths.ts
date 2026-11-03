// Where lantern keeps things. One Chrome per project (the git root, or the folder lantern was run from), so each
// has its own socket, profile and log under ~/.lantern; pictures and videos go in the project, under tmp/lantern,
// because that is the one place an agent is always allowed to read.
import crypto from 'node:crypto'
import { readConfig } from './config.ts'
import os from 'node:os'
import path from 'node:path'

export const home = process.env.LANTERN_HOME || path.join(os.homedir(), '.lantern')

export function paths(root: string) {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)
  return {
    home, key, root,
    sock: path.join(home, 'run', `${key}.sock`),
    pid: path.join(home, 'run', `${key}.pid`),
    log: path.join(home, 'log', `${key}.log`),
    profile: path.join(home, 'profiles', key),
    out: path.resolve(root, readConfig(root).out ?? path.join('tmp', 'lantern')),
  }
}
