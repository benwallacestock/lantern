// The lantern daemon: one per project, started by the first `lantern` command and gone again half an hour after
// the last one. It owns the Chrome and the page, so the page lives on between an agent's commands — however long
// the agent thinks in between. A unix socket under ~/.lantern: one JSON line in, one out. Only this user can reach it.
// Only commands count as use: a live view left open in a tab, or a recording nobody stopped, doesn't keep it alive.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { findChrome, launchChrome, NO_CHROME } from './chrome.ts'
import type { Chrome } from './cdp.ts'
import { frame } from './frame.ts'
import { Page, SETTLE, type Reply } from './page.ts'
import { buildId, paths } from './paths.ts'
import { dailyCheck } from './update.ts'
import { readConfig } from './config.ts'

let root = ''
let P: ReturnType<typeof paths>
let CONFIG: ReturnType<typeof readConfig>
const IDLE = Number(process.env.LANTERN_IDLE_MS) || 30 * 60_000 // the env is for the tests
/** Commands whose outcome a watcher is told about, in words. */
const ACTS = new Set(['open', 'click', 'dblclick', 'rightclick', 'hover', 'highlight', 'callout', 'badge', 'ring', 'arrow', 'blur', 'clear', 'drag', 'scroll', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'upload', 'back', 'reload', 'wait'])
/** Commands a recording keeps rolling for: things that happen on the page. A snapshot or a text read between
 * steps is the agent looking, not the user doing, and is cut from the video like any other thinking. */
const RECORDS = new Set([...ACTS, 'record'])

let chrome: Chrome | undefined
let page: Page | undefined
let used = Date.now()
let queue: Promise<unknown> = Promise.resolve()
let server: net.Server | undefined

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (...a: unknown[]) => console.log(stamp(), ...a)

let stopping: Promise<void> | undefined
let owned = false // the socket and pid file are ours to remove only once we have written them
/** Stop taking commands, close Chrome and wait for it to let go of the profile, so the next daemon can start at once. */
function stop(why: string): Promise<void> {
  if (stopping) return stopping
  log('shutting down:', why)
  try { server?.close() } catch {}
  try { preview?.close() } catch {}
  try { if (owned) { fs.rmSync(P.sock, { force: true }); fs.rmSync(P.pid, { force: true }); fs.rmSync(P.build, { force: true }) } } catch {}
  stopping = (async () => {
    if (page?.rec) { log('a recording was still running; it is lost'); try { fs.rmSync(page.rec.dir, { recursive: true, force: true }) } catch {} }
    // Keep the login: cookies go to the profile folder (readable by this user only) and come back next start.
    if (page) { try { fs.writeFileSync(path.join(P.profile, 'cookies.json'), JSON.stringify(await page.cookiesOut()), { mode: 0o600 }) } catch (e) { log('could not save cookies:', (e as Error).message) } }
  })().then(() => new Promise<void>((done) => {
    const c = chrome
    if (!c || c.proc.exitCode !== null) return done()
    const t = setTimeout(() => { try { c.proc.kill('SIGKILL') } catch {}; done() }, 5000)
    c.proc.once('exit', () => { clearTimeout(t); done() })
    c.kill()
  }))
  return stopping
}
function shutdown(why: string) { void stop(why).then(() => setTimeout(() => process.exit(0), 100)) }

async function dispatch(req: any): Promise<Reply> {
  switch (req.cmd) {
    case 'status': return { ok: true, text: `lantern is up for ${root}\n  pid ${process.pid}, chrome pid ${chrome?.proc.pid}, log ${P.log}\n  ${page ? `page at ${await page.where()}${page.rec ? ` (recording, ${page.rec.frames.length} frames)` : ''}` : 'no page open yet'}` }
    case 'close': await stop('asked to close'); setTimeout(() => process.exit(0), 100); return { ok: true, text: 'closed' }
    case 'frame': return frame(chrome!, { note: CONFIG.note, footer: CONFIG.footer, accent: CONFIG.accent, mark: CONFIG.watermark !== false, ...req, ...(CONFIG.branch === false ? { branch: undefined } : {}) }, P.out)
    case 'preview': { const url = await previewUrl(); return { ok: true, text: url } }
    case 'browser': {
      const p = await thePage()
      if (req.branch && CONFIG.branch !== false) p.branch = req.branch
      const args: string[] = req.args ?? []
      const rolling = RECORDS.has(args[0])
      if (p.rec && rolling) p.rec.until = Infinity // frames are kept while an action runs…
      try { const r = await p.run(args[0], args.slice(1), req.cwd ?? root); if (r.ok && ACTS.has(args[0])) p.did(r.text.split('\n')[0].slice(0, 90)); if (p.dead) { if (p.rec) { try { fs.rmSync(p.rec.dir, { recursive: true, force: true }) } catch {}; p.rec = undefined; r.text = 'the recording was abandoned: ' + r.text } const note = await relaunch(); return { ...r, text: note + r.text } } return r }
      finally { if (p.rec && rolling) p.rec.until = Date.now() + SETTLE } // …and for a beat after, while the page settles
    }
    default: return { ok: false, text: `lantern does not know that request (${req.cmd})` }
  }
}

async function thePage(): Promise<Page> { return (page ??= await Page.open(chrome!, P.out, path.join(P.profile, 'lantern.json'), CONFIG)) }

/** A new Chrome in place of one whose page stopped taking input: cookies carried over, the page opened again. */
async function relaunch(): Promise<string> {
  const old = chrome!, p = page!
  let cookies: object[] = []; try { cookies = await p.cookiesOut() } catch {}
  try { fs.writeFileSync(path.join(P.profile, 'cookies.json'), JSON.stringify(cookies), { mode: 0o600 }) } catch {}
  page = undefined
  old.proc.removeAllListeners('exit') // its going is intended: not the "chrome exited" that shuts the daemon down
  await new Promise<void>((done) => { const t = setTimeout(() => { try { old.proc.kill('SIGKILL') } catch {}; done() }, 5000); old.proc.once('exit', () => { clearTimeout(t); done() }); old.kill() })
  chrome = launchChrome(findChrome()!, P.profile)
  chrome.proc.on('exit', (code) => { if (!stopping) shutdown(`chrome exited (${code})`) })
  await chrome.send('Browser.getVersion', {}, undefined, 30_000)
  const fresh = await thePage()
  const url = /^https?:/.test(p.currentUrl) ? p.currentUrl : p.lastUrl // where it was, including after a click that navigated
  if (url) { await fresh.load(url) }
  log('restarted chrome: the page had stopped taking input')
  return `(the page stopped taking input after that navigation, so lantern restarted its browser${url ? ` and opened ${url} again` : ''}; the step above was done, the next one is safe)\n`
}

/** A watcher over the socket (forest's panel, say): JSON lines — {frame, url} as the page paints, {did} as commands land. */
async function watch(conn: net.Socket) {
  const p = await thePage()
  const w = { frame: (jpeg: Buffer, url: string) => { if (!conn.destroyed && conn.writableLength < 1_500_000) conn.write(JSON.stringify({ frame: jpeg.toString('base64'), url }) + '\n') }, did: (text: string) => { if (!conn.destroyed) conn.write(JSON.stringify({ did: text }) + '\n') } }
  p.watchers.add(w)
  await p.wantFrames()
  if (p.lastFrame) w.frame(p.lastFrame, p.currentUrl)
  conn.on('close', () => { p.watchers.delete(w); void p.doneWithFrames() })
  conn.on('error', () => {})
}

// A live view in any browser: `lantern watch` prints this page's URL. Frames arrive as a motion-JPEG stream, the
// line under the picture says what the agent just did. Only on this machine (127.0.0.1), only while the daemon lives.
let preview: http.Server | undefined
function previewUrl(): Promise<string> {
  if (preview) return Promise.resolve(`http://127.0.0.1:${(preview.address() as net.AddressInfo).port}/`)
  preview = http.createServer(async (req, res) => {
    const p = await thePage()
    if (req.url === '/stream') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      // A browser shows a part once the next part has begun, so each frame is followed at once by the next part's
      // headers (the boundary delimits the picture): a page that isn't changing still shows its first frame.
      const HEAD = '--frame\r\nContent-Type: image/jpeg\r\n\r\n'
      res.write(HEAD)
      const send = (jpeg: Buffer) => { if (res.destroyed || res.writableLength > 1_500_000) return; res.write(jpeg); res.write('\r\n' + HEAD) }
      const w = { frame: send }
      p.watchers.add(w); await p.wantFrames()
      if (p.lastFrame) send(p.lastFrame)
      req.on('close', () => { p.watchers.delete(w); void p.doneWithFrames() })
    } else if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      let last = p.currentUrl
      const w = { did: (text: string) => { if (!res.destroyed) res.write(`data: ${JSON.stringify({ did: text, url: p.currentUrl })}\n\n`) }, frame: (_j: Buffer, url: string) => { if (!res.destroyed && url !== last) { last = url; res.write(`data: ${JSON.stringify({ url })}\n\n`) } } }
      p.watchers.add(w)
      res.write(`data: ${JSON.stringify({ url: p.currentUrl })}\n\n`)
      req.on('close', () => { p.watchers.delete(w) })
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      const name = root.split('/').pop()
      res.end(`<!doctype html><meta charset="utf-8"><title>lantern · ${name}</title>
<style>
html,body{margin:0;height:100%;background:#16161a;color:#e8e8ee;font:13px -apple-system,system-ui,sans-serif}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #26262c;background:#1b1b20}
header svg{width:22px;height:22px;flex:none}
header b{font-size:14px;letter-spacing:.01em}
header .name{color:#8a8a95}
header .live{margin-left:auto;display:flex;align-items:center;gap:7px;color:#8a8a95;font-size:12px}
header .live i{width:8px;height:8px;border-radius:50%;background:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.8);display:inline-block;animation:p 1.6s ease-in-out infinite}
body.closed header .live i{background:#55555f;box-shadow:none;animation:none}
body.closed img,body.closed canvas{opacity:.35;filter:grayscale(1)}
canvas{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,.6);border-radius:4px}
body.closed #did{color:#ff7a2f}
@keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,rgba(255,122,47,.08),transparent 60%),#0f0f12}
img{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,.6);border-radius:4px}
footer{display:flex;gap:14px;align-items:center;padding:8px 14px;border-top:1px solid #26262c;background:#1b1b20}
#did{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#url{color:#8a8a95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%;font-family:ui-monospace,Menlo,monospace;font-size:12px}
</style>
<header><svg viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" rx="56" fill="#16161a"/><circle cx="128" cy="146" r="92" fill="#ff7a2f" opacity=".25"/><path d="M100 66 C100 38, 156 38, 156 66" fill="none" stroke="#e8e8ee" stroke-width="8" stroke-linecap="round"/><path d="M90 76 L166 76 L158 60 L98 60 Z" fill="#e8e8ee"/><rect x="84" y="74" width="88" height="12" rx="5" fill="#e8e8ee"/><rect x="92" y="86" width="72" height="92" rx="12" fill="#ff7a2f" fill-opacity=".7" stroke="#e8e8ee" stroke-width="8"/><path d="M128 112 C140 126, 146 136, 146 146 C146 157, 138 164, 128 164 C118 164, 110 157, 110 146 C110 136, 116 126, 128 112 Z" fill="#fff1c2"/><rect x="84" y="178" width="88" height="14" rx="6" fill="#e8e8ee"/><rect x="100" y="192" width="56" height="10" rx="4" fill="#c9c9d2"/></svg><b>lantern</b><span class="name">${name}</span><span class="live"><i></i>live</span></header>
<main><img src="/stream" alt="the page lantern is driving"></main>
<footer><span id="did">watching — the picture moves as the page changes</span><span id="url">${p.currentUrl}</span></footer>
<script>const es=new EventSource('/events');es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.did)document.getElementById('did').textContent=d.did;if(d.url)document.getElementById('url').textContent=d.url}
const im=document.querySelector('img'),cv=document.createElement('canvas');setInterval(()=>{if(im.naturalWidth&&im.isConnected){cv.width=im.naturalWidth;cv.height=im.naturalHeight;cv.getContext('2d').drawImage(im,0,0)}},500)
es.onerror=()=>{es.close();document.body.classList.add('closed');if(cv.width)im.replaceWith(cv);else im.remove();document.querySelector('.live').lastChild.textContent='closed';document.getElementById('did').textContent='lantern has closed (no command for a while) — run lantern watch again for a new view'}</script>`)
    }
  })
  return new Promise((r) => preview!.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(preview!.address() as net.AddressInfo).port}/`)))
}

/** One command at a time: an agent that runs two in parallel gets them in order, never interleaved on the page. */
function handle(req: any): Promise<Reply> {
  used = Date.now()
  const job = () => dispatch(req).catch((e: any): Reply => ({ ok: false, text: String(e?.message ?? e) }))
  const r = queue.then(job, job)
  queue = r.then(() => {}, () => {})
  return r
}

/** Run the daemon for a project, in this process, until it stops. */
export async function runDaemon(projectRoot: string) {
  root = projectRoot; P = paths(root); CONFIG = readConfig(root)
  void dailyCheck(P.home, log, CONFIG.update !== false) // once a day, in the background: is there a newer lantern? (then it installs itself)
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('uncaughtException', (e) => { console.error('uncaught:', e) })
  await main().catch((e) => { console.error('could not start:', e); shutdown('failed to start') })
}

async function main() {
  const bin = findChrome()
  if (!bin) { console.error(NO_CHROME); process.exit(1) }
  log('starting for', root, 'with', bin)
  chrome = launchChrome(bin, P.profile)
  chrome.proc.on('exit', (code) => { if (!stopping) shutdown(`chrome exited (${code})`) })
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
      if (!req) return done({ ok: false, text: 'lantern could not read that request' })
      if (req.cmd === 'watch') { used = Date.now(); void watch(conn).catch((e) => done({ ok: false, text: String(e?.message ?? e) })); return }
      handle(req).then(done)
    })
    conn.on('error', () => {})
  })
  server.on('error', (e) => { console.error('socket error:', e.message); shutdown('socket error') })
  server.listen(P.sock, () => { try { fs.chmodSync(P.sock, 0o600); fs.writeFileSync(P.pid, String(process.pid)); fs.writeFileSync(P.build, buildId()); owned = true } catch {}; log('listening on', P.sock) })
  setInterval(() => { if (Date.now() - used > IDLE) shutdown(`no command for ${Math.round(IDLE / 60_000)} minutes`) }, Math.min(60_000, IDLE))
}

