// A frame around a video, the same look as `frame` puts around a still: the title with the glyph above (when
// there is one), the banner below with lantern, a note, the branch, the time and "made with lantern". Rendered by
// Chrome as a PNG the exact size of the finished video, transparent where the clip shows through — it is laid OVER
// the clip, so the picture's corners come out rounded like a still's — by ffmpeg, or by the Chrome encoder.
import type { Chrome } from './cdp.ts'
import { footHtml, frameCss, titleHtml } from './frameHtml.ts'
import { ORANGE } from './pageScripts.ts'

export type VideoFrameReq = { innerW: number; innerH: number; title?: string; mark?: boolean; note?: string; branch?: string; footer?: string; accent?: string }
export type VideoFrame = { png: Buffer; w: number; h: number; x: number; y: number }
/** What the frame's gradient ends in: the clip is padded with it before the frame goes on top. */
export const FRAME_BG = '#15151a'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function html(req: VideoFrameReq): string {
  const accent = req.accent ?? ORANGE
  const u = Math.max(0.5, req.innerW / 900) // type sized to the width, as for stills, so a video and a still in one pull request read the same
  return `<!doctype html><meta charset="utf-8"><style>${frameCss(u, accent, false)}
    h1 { max-width: ${req.innerW}px; }
    .hole { width: ${req.innerW}px; height: ${req.innerH}px; background: transparent; }
  </style><body><div class="frame">${titleHtml(req.title)}<div class="hole" id="hole"></div>${footHtml(req)}</div></body>`
}

export async function videoFrame(chrome: Chrome, req: VideoFrameReq): Promise<VideoFrame> {
  const { targetId } = await chrome.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await chrome.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
  const s = <T = any>(method: string, params: object = {}) => chrome.send<T>(method, params, sessionId, 20_000)
  try {
    await s('Page.enable')
    await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }) // the hole is see-through
    await s('Emulation.setDeviceMetricsOverride', { width: req.innerW + 200, height: req.innerH + 300, deviceScaleFactor: 1, mobile: false })
    const { frameTree } = await s<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    await s('Page.setDocumentContent', { frameId: frameTree.frame.id, html: html(req) })
    await sleep(250)
    // Cut the hole out of the frame (a mask with a rounded rectangle missing), so the clip shows through it when
    // the frame is laid on top; the frame's own gradient would otherwise paint under the hole.
    const { result } = await s<{ result: { value: { w: number; h: number; x: number; y: number } } }>('Runtime.evaluate', { expression: `(() => {
      const f = document.querySelector('.frame'), hole = document.getElementById('hole'), b = hole.getBoundingClientRect()
      const x = Math.round(b.left), y = Math.round(b.top), w = ${req.innerW}, h = ${req.innerH}, r = parseFloat(getComputedStyle(hole).borderRadius) || 0
      const W = Math.ceil(document.body.scrollWidth / 2) * 2, H = Math.ceil(document.body.scrollHeight / 2) * 2
      const d = 'M0 0H' + W + 'V' + H + 'H0Z M' + (x + r) + ' ' + y + 'h' + (w - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (h - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 -' + r + ' ' + r + 'h-' + (w - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 -' + r + ' -' + r + 'v-' + (h - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' -' + r + 'z'
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><path fill-rule="evenodd" d="' + d + '"/></svg>'
      f.style.maskImage = f.style.webkitMaskImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'; f.style.maskSize = f.style.webkitMaskSize = W + 'px ' + H + 'px'
      return { w: W, h: H, x, y }
    })()`, returnByValue: true })
    const { w, h, x, y } = result.value
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    const shot = await s<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
    return { png: Buffer.from(shot.data, 'base64'), w, h, x, y }
  } finally { await chrome.send('Target.closeTarget', { targetId }).catch(() => {}) }
}
