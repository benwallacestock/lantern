// `lantern frame`: a screenshot, or a before/after pair, framed for a pull request — padding, rounded corners, a
// shadow, Before/After headers, a title, and a footer saying which branch and moment it came from. Chromium is
// the renderer: the layout is a small HTML page rendered in a page of its own and captured, so it needs no image
// library and looks like a product, not a test artifact.
import fs from 'node:fs'
import path from 'node:path'
import type { Chrome } from './cdp.ts'
import type { Reply } from './page.ts'
import { ORANGE } from './pageScripts.ts'
import { esc, footHtml, frameCss, titleHtml } from './frameHtml.ts'

export type FrameReq = { images: string[]; title?: string; captions?: string[]; out?: string; scale?: number; layout?: 'side' | 'stack'; branch?: string; note?: string; footer?: string; accent?: string; mark?: boolean; cwd: string }
/** A PNG's size from its header, to decide how to lay the pictures out. */
const pngSize = (p: string) => { const b = Buffer.alloc(24); const fd = fs.openSync(p, 'r'); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const png = (p: string) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function html(req: FrameReq): string {
  const n = req.images.length
  const heads = req.captions?.length ? req.captions : n === 2 ? ['Before', 'After'] : n > 2 ? req.images.map((_, i) => `Step ${i + 1}`) : ['']
  // Screenshots are 2x (the page draws at 2x, as a Retina screen does), so they are shown at half their pixels
  // and the frame is captured at 2x: sharp, and the same size as on screen. --scale 1 for a 1x picture.
  const scale = req.scale ?? 0.5
  const panels = req.images.map((f, i) => `<figure><figcaption>${esc(heads[i] ?? '')}</figcaption><img src="${png(f)}" style="zoom:${scale}"></figure>`).join('')
  // Side by side, two wide screenshots come out a quarter size in a pull request's column. Landscape pictures stack,
  // one above the other, and keep their width; portrait ones (a phone) sit side by side. --side / --stack override.
  const sizes = req.images.map(pngSize)
  const stack = req.layout ? req.layout === 'stack' : n > 1 && sizes.every((s) => s.w > s.h)
  // Title, captions and footer are a fixed fraction of the frame's longer side, so wherever the frame is shown
  // fitted to a box (a pull request's column, a chat, a viewer that fits a tall frame to its height) the type is
  // the same size on screen — whether the frame is one phone, two desktops wide, or two desktops tall. The floor
  // is for frames smaller than that box, which display at their own size.
  const shown = sizes.map((s) => ({ w: s.w * scale, h: s.h * scale }))
  const across = stack ? Math.max(...shown.map((s) => s.w)) : shown.reduce((a, s) => a + s.w, 0) + 22 * (n - 1)
  const tall = stack ? shown.reduce((a, s) => a + s.h, 0) + 22 * (n - 1) : Math.max(...shown.map((s) => s.h))
  const u = Math.max(0.5, Math.max(across, tall) / 900)
  return `<!doctype html><meta charset="utf-8"><style>${frameCss(u, req.accent ?? ORANGE, true)}
    .row { display: flex; gap: calc(22px * var(--u)); align-items: flex-start; }
    .row.stack { flex-direction: column; align-items: stretch; }
    figure { background: #fff; }
    figcaption { padding: calc(9px * var(--u)) calc(14px * var(--u)); font-size: calc(13px * var(--u)); font-weight: 700; background: #2c2c33; color: #f2f2f4; border-bottom: 1px solid #3a3a42; }
    figcaption:empty { display: none; }
    img { display: block; }
    .row.stack img { margin: 0 auto; } /* a small picture in a stacked pair sits in the middle, not at the left edge */
  </style><body><div class="frame">${titleHtml(req.title)}<div class="row${stack ? ' stack' : ''}">${panels}</div>${footHtml(req)}</div></body>`
}

export async function frame(chrome: Chrome, req: FrameReq, outDir: string): Promise<Reply> {
  if (!req.images?.length) return { ok: false, text: 'give one screenshot to frame, or two for a before/after' }
  for (const f of req.images) {
    if (!fs.existsSync(f)) return { ok: false, text: `no such image: ${f}` }
    const head = Buffer.alloc(8); try { const fd = fs.openSync(f, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd) } catch {}
    if (!head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ok: false, text: `not a PNG: ${f} (frame takes the PNGs that \`lantern screenshot\` makes)` }
  }
  fs.mkdirSync(outDir, { recursive: true })
  const { targetId } = await chrome.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await chrome.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
  const s = <T = any>(method: string, params: object = {}) => chrome.send<T>(method, params, sessionId, 20_000)
  try {
    await s('Page.enable')
    // Transparent outside the rounded frame, so the PNG sits on any background.
    await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    await s('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 2, mobile: false })
    const { frameTree } = await s<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    await s('Page.setDocumentContent', { frameId: frameTree.frame.id, html: html(req) })
    await sleep(300)
    const { result } = await s<{ result: { value: [number, number] } }>('Runtime.evaluate', { expression: '[document.body.scrollWidth, document.body.scrollHeight]', returnByValue: true })
    const [w, h] = result.value.map(Math.ceil)
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
    await sleep(300) // let it paint at the new size
    const shot = await s<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true })
    const out = req.out ? path.resolve(req.cwd, req.out) : path.join(outDir, `framed-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
    return { ok: true, text: `${out}\n(${w * 2}×${h * 2}${req.title ? '' : ' — untitled: pass --title "what it shows" so the picture says what it is wherever it ends up'})` }
  } finally { await chrome.send('Target.closeTarget', { targetId }).catch(() => {}) }
}
