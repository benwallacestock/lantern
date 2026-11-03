// Where glade keeps things. One Chrome per project (the git root, or the folder glade was run from), so each
// has its own socket, profile and log under ~/.glade; pictures and videos go in the project, under tmp/glade,
// because that is the one place an agent is always allowed to read.
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export const home = process.env.GLADE_HOME || path.join(os.homedir(), '.glade')

export function paths(root: string) {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)
  return {
    home, key, root,
    sock: path.join(home, 'run', `${key}.sock`),
    pid: path.join(home, 'run', `${key}.pid`),
    log: path.join(home, 'log', `${key}.log`),
    profile: path.join(home, 'profiles', key),
    out: path.join(root, 'tmp', 'glade'),
  }
}
