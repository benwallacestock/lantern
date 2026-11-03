// A frame around a video, like `frame` puts around a still: a title with the glyph, the footer with lantern, a note,
// the branch and the time, dark. Rendered by Chrome as a PNG the exact size of the finished video; the clip is laid
// into its hole by ffmpeg, or by the Chrome encoder when there is no ffmpeg.
import type { Chrome } from './cdp.ts'

export type VideoFrameReq = { innerW: number; innerH: number; title: string; note?: string; branch?: string; footer?: string; accent?: string }
export type VideoFrame = { png: Buffer; w: number; h: number; x: number; y: number }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const GLYPH = (accent: string) => `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M100 66 C100 38, 156 38, 156 66" fill="none" stroke="#e8e8ee" stroke-width="14" stroke-linecap="round"/><rect x="84" y="70" width="88" height="16" rx="6" fill="#e8e8ee"/><rect x="92" y="86" width="72" height="92" rx="12" fill="${accent}" stroke="#e8e8ee" stroke-width="12"/><path d="M128 112 C140 126, 146 136, 146 146 C146 157, 138 164, 128 164 C118 164, 110 157, 110 146 C110 136, 116 126, 128 112 Z" fill="#fff1c2"/><rect x="84" y="178" width="88" height="16" rx="6" fill="#e8e8ee"/></svg>`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function html(req: VideoFrameReq): string {
  const accent = req.accent ?? '#ff7a2f'
  const u = Math.max(0.5, req.innerW / 900) // type sized to the width, as for stills, so it reads the same wherever the video is shown
  const when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const foot = req.footer !== undefined ? `<span>${esc(req.footer)}</span>` : [`<b>lantern</b>`, req.note ? `<span>${esc(req.note)}</span>` : '', req.branch ? `<span class="mono">${esc(req.branch)}</span>` : '', `<span>${esc(when)}</span>`].filter(Boolean).join('<span>·</span>')
  return `<!doctype html><meta charset="utf-8"><style>
    :root { --u: ${u.toFixed(3)}; }
    html, body { margin: 0; background: transparent; overflow: hidden; }
    body { display: inline-block; font-family: -apple-system, system-ui, sans-serif; color: #f2f2f4; }
    .frame { display: inline-flex; flex-direction: column; gap: calc(14px * var(--u)); padding: calc(24px * var(--u)) calc(28px * var(--u)) calc(20px * var(--u)); background: linear-gradient(160deg, #26262c, #15151a); }
    h1 { margin: 0; font-size: calc(18px * var(--u)); font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: ${req.innerW}px; }
    h1 svg { width: calc(20px * var(--u)); height: calc(20px * var(--u)); vertical-align: -0.15em; margin-right: calc(10px * var(--u)); }
    .hole { width: ${req.innerW}px; height: ${req.innerH}px; background: #000; border-radius: calc(10px * var(--u)); box-shadow: 0 12px 36px rgba(0,0,0,.45); }
    .foot { display: flex; flex-wrap: wrap; gap: 4px calc(12px * var(--u)); align-items: center; font-size: calc(10.5px * var(--u)); color: #a0a0aa; width: 0; min-width: 100%; }
    .foot b { color: ${accent}; } .foot .mono { font-family: ui-monospace, Menlo, monospace; }
  </style><body><div class="frame"><h1>${GLYPH(accent)}${esc(req.title)}</h1><div class="hole" id="hole"></div><div class="foot">${foot}</div></div></body>`
}

export async function videoFrame(chrome: Chrome, req: VideoFrameReq): Promise<VideoFrame> {
  const { targetId } = await chrome.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await chrome.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
  const s = <T = any>(method: string, params: object = {}) => chrome.send<T>(method, params, sessionId, 20_000)
  try {
    await s('Page.enable')
    await s('Emulation.setDeviceMetricsOverride', { width: req.innerW + 200, height: req.innerH + 300, deviceScaleFactor: 1, mobile: false })
    const { frameTree } = await s<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    await s('Page.setDocumentContent', { frameId: frameTree.frame.id, html: html(req) })
    await sleep(250)
    const { result } = await s<{ result: { value: { w: number; h: number; x: number; y: number } } }>('Runtime.evaluate', { expression: '(() => { const h = document.getElementById("hole").getBoundingClientRect(); return { w: Math.ceil(document.body.scrollWidth / 2) * 2, h: Math.ceil(document.body.scrollHeight / 2) * 2, x: Math.round(h.left), y: Math.round(h.top) } })()', returnByValue: true })
    const { w, h, x, y } = result.value
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    const shot = await s<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
    return { png: Buffer.from(shot.data, 'base64'), w, h, x, y }
  } finally { await chrome.send('Target.closeTarget', { targetId }).catch(() => {}) }
}
