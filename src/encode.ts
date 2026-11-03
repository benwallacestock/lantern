// Assembling a recording without ffmpeg: Chrome does it. A hidden page draws each frame onto a canvas for as long
// as that frame is meant to show, and MediaRecorder encodes what the canvas shows — MP4 where this Chrome can
// write one, WebM otherwise (GitHub plays both inline). It runs at real time, so a twenty-second clip takes
// twenty seconds to assemble; ffmpeg, when installed, is faster and smaller, and is used instead.
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Chrome } from './cdp.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const page = (files: string[], durs: number[]) => `<!doctype html><meta charset="utf-8"><title>lantern encoder</title><canvas id="c"></canvas><script>
const FRAMES = ${JSON.stringify(files)}, DURS = ${JSON.stringify(durs)}, MAXW = 1920
window.__status = 'loading'
;(async () => {
  try {
    const imgs = await Promise.all(FRAMES.map((f) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + f)); i.src = f })))
    const w0 = imgs[0].naturalWidth, h0 = imgs[0].naturalHeight, k = Math.min(1, MAXW / w0)
    const c = document.getElementById('c'); c.width = Math.round(w0 * k / 2) * 2; c.height = Math.round(h0 * k / 2) * 2
    const ctx = c.getContext('2d')
    const stream = c.captureStream(0), track = stream.getVideoTracks()[0]
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!mime) throw new Error('this Chrome cannot record video')
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 })
    const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const stopped = new Promise((res) => { rec.onstop = res })
    const draw = (i) => { ctx.drawImage(imgs[i], 0, 0, c.width, c.height); track.requestFrame() }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    draw(0); rec.start(1000); window.__status = 'encoding'
    const t0 = performance.now(); let at = 0
    for (let i = 0; i < imgs.length; i++) {
      draw(i); at += DURS[i] * 1000
      // A hold (a caption staying up) keeps handing the encoder the same picture, redrawn so the capture sees a change
      // and the hold is time in the file, not a gap at the end.
      while (performance.now() - t0 < at) { await sleep(Math.min(100, Math.max(1, at - (performance.now() - t0)))); draw(i) }
    }
    draw(imgs.length - 1); await sleep(250); rec.stop(); await stopped
    const buf = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer())
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
    if (!buf.length) throw new Error('Chrome produced no video data (page ' + document.visibilityState + ')')
    window.__result = { mime, data: btoa(s), size: buf.length }
    window.__status = 'done'
  } catch (e) { window.__status = 'error: ' + (e && e.message || e) }
})()
</script>`

/** The frames and the page, served to Chrome from here: a page loaded from file:// gets each image as a foreign origin, which
 * taints the canvas, and a tainted canvas captures nothing. One origin on 127.0.0.1, gone when the encoding is done. */
function serve(dir: string, html: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent((req.url ?? '/').split('?')[0]))
    if (req.url === '/' || !name) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html) }
    const file = path.join(dir, name)
    if (!/^f-\d+\.jpg$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' }); fs.createReadStream(file).pipe(res)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() })))
}

/** Frames (JPEG files in one folder) and how long each shows, to a video file next to `outBase` (the extension is chosen). */
export async function encodeInChrome(chrome: Chrome, frames: string[], durs: number[], outBase: string): Promise<{ file: string; mime: string }> {
  const dir = path.dirname(frames[0])
  const site = await serve(dir, page(frames.map((f) => path.basename(f)), durs))
  const total = durs.reduce((n, d) => n + d, 0)
  // Its own window: a tab in the background captures no frames from its canvas, and the recorder writes nothing.
  const { targetId } = await chrome.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1280, height: 800 })
  const { sessionId } = await chrome.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
  const s = <T = any>(method: string, params: object = {}, ms = 20_000) => chrome.send<T>(method, params, sessionId, ms)
  const ev = async <T = any>(expression: string) => (await s<{ result: { value: T } }>('Runtime.evaluate', { expression, returnByValue: true })).result.value
  try {
    await s('Page.enable')
    await s('Page.navigate', { url: site.url })
    const deadline = Date.now() + (total + 45) * 1000
    let status = 'loading'
    while (Date.now() < deadline) { await sleep(500); status = (await ev<string>('window.__status').catch(() => 'loading')) ?? 'loading'; if (status === 'done' || status.startsWith('error')) break }
    if (status !== 'done') throw new Error(status.startsWith('error') ? status.slice(7) : `Chrome did not finish encoding in time (${status})`)
    const { mime, size } = await ev<{ mime: string; size: number }>('({ mime: window.__result.mime, size: window.__result.size })')
    // The file comes over in slices: one message per couple of megabytes rather than one the size of the video.
    const parts: Buffer[] = []
    const STEP = 2_000_000
    for (let i = 0; ; i += STEP) { const chunk = await ev<string>(`window.__result.data.slice(${i}, ${i + STEP})`); if (!chunk) break; parts.push(Buffer.from(chunk, 'base64')) }
    const buf = Buffer.concat(parts)
    if (buf.length !== size) throw new Error(`the video came over incomplete (${buf.length} of ${size} bytes)`)
    const file = `${outBase}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`
    fs.writeFileSync(file, buf)
    return { file, mime }
  } finally { await chrome.send('Target.closeTarget', { targetId }).catch(() => {}); site.close() }
}
