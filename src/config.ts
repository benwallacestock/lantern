// Settings a project (or a tool wrapping lantern, such as forest) can give the daemon: in the environment of the
// command that starts it, or in a `.lantern.json` at the project root. The environment wins.
//
//   url     where relative paths go the first time: "http://localhost:3000"
//   hosts   the only hosts the page may visit (comma-separated, or an array): "app.localhost,api.app.localhost"
//   out     where pictures and videos go, relative to the project root: "tmp/lantern"
//   note    a word for the frame's footer — a ticket, say: "SPR-123"
//   onLoad  JavaScript to run in the page after every load — a dev login, say
//   watermark  false to leave the "made with lantern" mark off recordings
//   footer  the frame's footer, in place of "lantern · note · branch · time"
//   accent  the colour of highlights, click rings and the frame's glyph: "#ff7a2f"
import fs from 'node:fs'
import path from 'node:path'

export type Config = { url?: string; hosts?: string[]; out?: string; note?: string; onLoad?: string; watermark?: boolean; footer?: string; accent?: string }

export function readConfig(root: string): Config {
  let file: any = {}
  try { file = JSON.parse(fs.readFileSync(path.join(root, '.lantern.json'), 'utf8')) } catch {}
  const list = (v: unknown): string[] | undefined => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : undefined)
  const env = process.env
  return {
    url: env.LANTERN_URL || file.url || undefined,
    hosts: list(env.LANTERN_HOSTS) ?? list(file.hosts),
    out: env.LANTERN_OUT || file.out || undefined,
    note: env.LANTERN_NOTE || file.note || undefined,
    onLoad: env.LANTERN_ON_LOAD || file.onLoad || undefined,
    watermark: env.LANTERN_WATERMARK ? env.LANTERN_WATERMARK !== 'false' && env.LANTERN_WATERMARK !== '0' : file.watermark,
    footer: env.LANTERN_FOOTER || file.footer || undefined,
    accent: env.LANTERN_ACCENT || file.accent || undefined,
  }
}

/** Is this host one the page may visit? With no list, anywhere. */
export const hostAllowed = (hosts: string[] | undefined, host: string) => !hosts?.length || hosts.some((h) => host === h || host.endsWith('.' + h))
