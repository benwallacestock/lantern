// The glade daemon: one per project, started by the first `glade` command and gone again after half an hour
// idle. It owns the Chrome and the page, so the page lives on between an agent's commands — however long the
// agent thinks in between. A unix socket under ~/.glade: one JSON line in, one out. Only this user can reach it.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { findChrome, launchChrome, NO_CHROME } from './chrome.ts'
import type { Chrome } from './cdp.ts'
import { frame } from './frame.ts'
import { Page, SETTLE, type Reply } from './page.ts'
import { paths } from './paths.ts'

const root = process.argv[2]
if (!root) { console.error('usage: daemon.ts <project root>'); process.exit(2) }
const P = paths(root)
const IDLE = 30 * 60_000

let chrome: Chrome | undefined
let page: Page | undefined
let used = Date.now()
let queue: Promise<unknown> = Promise.resolve()
let server: net.Server | undefined

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (...a: unknown[]) => console.log(stamp(), ...a)

function shutdown(why: string) {
  log('shutting down:', why)
  try { server?.close() } catch {}
  try { fs.rmSync(P.sock, { force: true }); fs.rmSync(P.pid, { force: true }) } catch {}
  chrome?.kill()
  setTimeout(() => process.exit(0), 200)
}

async function dispatch(req: any): Promise<Reply> {
  switch (req.cmd) {
    case 'status': return { ok: true, text: `glade is up for ${root}\n  pid ${process.pid}, chrome pid ${chrome?.proc.pid}\n  ${page ? `page at ${await page.where()}${page.rec ? ` (recording, ${page.rec.frames.length} frames)` : ''}` : 'no page open yet'}` }
    case 'close': setTimeout(() => shutdown('asked to close'), 50); return { ok: true, text: 'closed' }
    case 'frame': return frame(chrome!, req, P.out)
    case 'browser': {
      page ??= await Page.open(chrome!, P.out)
      const args: string[] = req.args ?? []
      if (page.rec) page.rec.until = Infinity // frames are kept while a command runs…
      try { return await page.run(args[0], args.slice(1), req.cwd ?? root) }
      finally { if (page.rec) page.rec.until = Date.now() + SETTLE } // …and for a beat after, while the page settles
    }
    default: return { ok: false, text: `glade does not know that request (${req.cmd})` }
  }
}

/** One command at a time: an agent that runs two in parallel gets them in order, never interleaved on the page. */
function handle(req: any): Promise<Reply> {
  used = Date.now()
  const job = () => dispatch(req).catch((e: any): Reply => ({ ok: false, text: String(e?.message ?? e) }))
  const r = queue.then(job, job)
  queue = r.then(() => {}, () => {})
  return r
}

async function main() {
  const bin = findChrome()
  if (!bin) { console.error(NO_CHROME); process.exit(1) }
  log('starting for', root, 'with', bin)
  chrome = launchChrome(bin, P.profile)
  chrome.proc.on('exit', (code) => shutdown(`chrome exited (${code})`))
  const v = await chrome.send<{ product: string }>('Browser.getVersion', {}, undefined, 30_000)
  log('chrome is up:', v.product)
  fs.mkdirSync(path.dirname(P.sock), { recursive: true })
  try { fs.rmSync(P.sock, { force: true }) } catch {}
  server = net.createServer((conn) => {
    let buf = ''
    conn.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n'); if (nl < 0) return
      const line = buf.slice(0, nl); buf = ''
      let req: any = null
      try { req = JSON.parse(line) } catch {}
      const done = (r: Reply) => { try { conn.end(JSON.stringify(r) + '\n') } catch {} }
      if (!req) return done({ ok: false, text: 'glade could not read that request' })
      handle(req).then(done)
    })
    conn.on('error', () => {})
  })
  server.on('error', (e) => { console.error('socket error:', e.message); shutdown('socket error') })
  server.listen(P.sock, () => { try { fs.chmodSync(P.sock, 0o600); fs.writeFileSync(P.pid, String(process.pid)) } catch {}; log('listening on', P.sock) })
  setInterval(() => { if (Date.now() - used > IDLE && !page?.rec) shutdown('idle for 30 minutes') }, 60_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', (e) => { console.error('uncaught:', e); })
main().catch((e) => { console.error('could not start:', e); shutdown('failed to start') })
